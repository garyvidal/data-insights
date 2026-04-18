'use strict';
/**
 * planner.sjs
 * GraphQL AST + schema registry → CTS Query Plan
 *
 * The planner is the performance-critical layer.  It translates the
 * GraphQL where/filter/orderBy/limit/offset arguments into a CTS query
 * tree so that MarkLogic evaluates all predicates in a single cts.search()
 * call — no post-filtering in application code.
 *
 * ─── Query Plan shape ──────────────────────────────────────────────────────
 * {
 *   typeName:   "Order",
 *   collection: "orders",
 *   format:     "json",        // "json" | "xml"
 *   namespaces: { ... },       // XML only
 *   ctsQuery:   cts.andQuery([...]),  // fully composed CTS query
 *   orderBy:    [cts.indexOrder(...)],
 *   limit:      25,
 *   offset:     0,
 *   selectionSet: { ... },     // original AST selectionSet for the executor
 *   subPlans:   { fieldName: QueryPlan }  // for relation fields
 * }
 *
 * ─── Supported where argument operators ────────────────────────────────────
 * where: {
 *   status:  "shipped"                   → value equality
 *   amount:  { gt: 100, lte: 500 }       → range queries
 *   name:    { contains: "foo" }         → word query
 *   AND: [ { ... }, { ... } ]            → cts.andQuery
 *   OR:  [ { ... }, { ... } ]            → cts.orQuery
 *   NOT: { ... }                         → cts.notQuery
 *   _collection: "orders"                → cts.collectionQuery override
 *   _uri:    { startsWith: "/orders/" }  → cts.directoryQuery
 * }
 */

const { resolveValue } = require('/lib/graphql/parser.sjs');

// ---------------------------------------------------------------------------
// Range operator map
// ---------------------------------------------------------------------------
const RANGE_OP = {
  eq:  '=',  ne:  '!=',
  lt:  '<',  lte: '<=',
  gt:  '>',  gte: '>=',
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * plan(operationDef, registry, variables)
 *
 * @param {Object} operationDef  - OperationDefinition AST node
 * @param {Object} registry      - schema registry from schema.sjs
 * @param {Object} variables     - runtime variable values
 * @returns {Object[]}  array of QueryPlan objects (one per root field)
 */
function plan(operationDef, registry, variables) {
  const plans = [];
  const selectionSet = operationDef.selectionSet;
  xdmp.log('[planner] plan() called, queryFields available: ' + JSON.stringify(Object.keys(registry.queryFields || {})), 'debug');

  for (const sel of selectionSet.selections) {
    if (sel.kind !== 'Field') continue;
    const fieldName = sel.name;

    // __schema / __type introspection — planner defers to executor
    if (fieldName === '__schema' || fieldName === '__type') {
      plans.push({ introspection: true, field: sel });
      continue;
    }

    const rootFieldDef = registry.queryFields[fieldName];
    if (!rootFieldDef) {
      xdmp.log('[planner] Unknown query field: "' + fieldName + '". Available fields: ' + JSON.stringify(Object.keys(registry.queryFields || {})), 'warning');
      plans.push({ error: `Unknown query field: ${fieldName}`, field: sel });
      continue;
    }

    const typeName = _unwrapType(rootFieldDef.type);
    const typeDef  = registry.types[typeName] || {};

    plans.push(_buildPlan(sel, typeName, typeDef, registry, variables));
  }

  return plans;
}

// ---------------------------------------------------------------------------
// Build a single query plan for one root field
// ---------------------------------------------------------------------------
function _buildPlan(fieldSel, typeName, typeDef, registry, variables) {
  const collection = typeDef.collection || null;
  const format     = typeDef.format || 'json';
  const namespaces = typeDef.namespaces || {};
  const fields     = typeDef.fields || {};

  xdmp.log('[planner] _buildPlan typeName=' + typeName + ' collection=' + collection + ' format=' + format, 'debug');

  // ── Extract known arguments ──
  const args        = _argsToMap(fieldSel.arguments, variables);
  const whereArg    = args['where']    || null;
  const orderByArg  = args['orderBy']  || null;
  const limit       = args['limit']    !== undefined ? args['limit']  : 50;
  const offset      = args['offset']   !== undefined ? args['offset'] : 0;
  const uriArg      = args['_uri']     || null;
  const colArg      = args['_collection'] || null;

  xdmp.log('[planner] args: limit=' + limit + ' offset=' + offset + ' whereArg=' + JSON.stringify(whereArg) + ' colArg=' + colArg, 'debug');

  // ── Base query: collection constraint ──
  const baseQueries = [];
  const effectiveCollection = colArg || collection;
  if (effectiveCollection) {
    baseQueries.push(cts.collectionQuery(effectiveCollection));
  }

  // ── URI / directory constraint ──
  if (uriArg) {
    if (typeof uriArg === 'string') {
      baseQueries.push(cts.documentQuery(uriArg));
    } else if (uriArg.startsWith) {
      baseQueries.push(cts.directoryQuery(uriArg.startsWith, 'infinity'));
    }
  }

  // ── where clause → CTS ──
  if (whereArg) {
    const whereQuery = _buildWhereQuery(whereArg, fields, format, namespaces);
    if (whereQuery) baseQueries.push(whereQuery);
  }

  const ctsQuery = baseQueries.length === 0
    ? cts.trueQuery()
    : baseQueries.length === 1
      ? baseQueries[0]
      : cts.andQuery(baseQueries);

  // ── orderBy → cts index orders ──
  const orderBy = _buildOrderBy(orderByArg, fields, format, namespaces);

  // ── Relation sub-plans ──
  const subPlans = {};
  const relations = typeDef.relations || {};
  for (const sel of (fieldSel.selectionSet ? fieldSel.selectionSet.selections : [])) {
    if (sel.kind !== 'Field') continue;
    if (relations[sel.name]) {
      const relDef      = relations[sel.name];
      const relTypeDef  = registry.types[relDef.type] || {};
      subPlans[sel.name] = { relation: relDef, typeDef: relTypeDef, selectionSet: sel.selectionSet };
    }
  }

  xdmp.log('[planner] plan built for ' + typeName + ': effectiveCollection=' + effectiveCollection + ' ctsQuery=' + xdmp.quote(ctsQuery), 'debug');

  return {
    typeName,
    collection: effectiveCollection,
    format,
    namespaces,
    ctsQuery,
    orderBy,
    limit,
    offset,
    selectionSet: fieldSel.selectionSet,
    fieldAlias: fieldSel.alias || fieldSel.name,
    subPlans,
    isList: true,
  };
}

// ---------------------------------------------------------------------------
// where clause → CTS query
// ---------------------------------------------------------------------------
function _buildWhereQuery(where, fields, format, namespaces) {
  if (!where || typeof where !== 'object') return null;

  const clauses = [];

  for (const [key, val] of Object.entries(where)) {
    // Logical combinators
    if (key === 'AND') {
      const subQueries = val.map(w => _buildWhereQuery(w, fields, format, namespaces)).filter(Boolean);
      if (subQueries.length) clauses.push(cts.andQuery(subQueries));
      continue;
    }
    if (key === 'OR') {
      const subQueries = val.map(w => _buildWhereQuery(w, fields, format, namespaces)).filter(Boolean);
      if (subQueries.length) clauses.push(cts.orQuery(subQueries));
      continue;
    }
    if (key === 'NOT') {
      const inner = _buildWhereQuery(val, fields, format, namespaces);
      if (inner) clauses.push(cts.notQuery(inner));
      continue;
    }
    // Internal meta-filters
    if (key === '_collection') continue;  // handled above
    if (key === '_uri')        continue;  // handled above

    // Field-level filters
    const fieldDef = _findField(key, fields);
    if (!fieldDef) continue;  // unknown field — skip

    const query = _buildFieldQuery(fieldDef, val, format, namespaces);
    if (query) clauses.push(query);
  }

  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0];
  return cts.andQuery(clauses);
}

// ---------------------------------------------------------------------------
// Single field → CTS predicate
// ---------------------------------------------------------------------------
function _buildFieldQuery(fieldDef, val, format, namespaces) {
  const index = fieldDef.index;  // "value" | "range" | null

  if (typeof val !== 'object' || val === null) {
    // Simple equality
    return _valueQuery(fieldDef, val, format, namespaces);
  }

  // Object: range operators or word query
  const clauses = [];
  for (const [op, opVal] of Object.entries(val)) {
    if (op === 'contains') {
      clauses.push(_wordQuery(fieldDef, opVal, format, namespaces));
    } else if (op === 'eq') {
      clauses.push(_valueQuery(fieldDef, opVal, format, namespaces));
    } else if (RANGE_OP[op]) {
      clauses.push(_rangeQuery(fieldDef, RANGE_OP[op], opVal, format, namespaces));
    }
  }
  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0];
  return cts.andQuery(clauses);
}

// ---------------------------------------------------------------------------
// CTS leaf query builders
// ---------------------------------------------------------------------------

function _valueQuery(fieldDef, value, format, namespaces) {
  if (format === 'json') {
    return cts.jsonPropertyValueQuery(fieldDef.sourceKey, value, ['case-insensitive']);
  }
  // XML
  const qname = _xmlQName(fieldDef, namespaces);
  return cts.elementValueQuery(qname, String(value), ['case-insensitive']);
}

function _wordQuery(fieldDef, value, format, namespaces) {
  if (format === 'json') {
    return cts.jsonPropertyWordQuery(fieldDef.sourceKey, value, ['case-insensitive']);
  }
  const qname = _xmlQName(fieldDef, namespaces);
  return cts.elementWordQuery(qname, value, ['case-insensitive']);
}

function _rangeQuery(fieldDef, operator, value, format, namespaces) {
  if (format === 'json') {
    const ref = cts.jsonPropertyReference(fieldDef.sourceKey, ['type=decimal']);
    return cts.jsonPropertyRangeQuery(fieldDef.sourceKey, operator, value);
  }
  const qname = _xmlQName(fieldDef, namespaces);
  return cts.elementRangeQuery(qname, operator, value);
}

// ---------------------------------------------------------------------------
// orderBy → [cts.indexOrder]
// ---------------------------------------------------------------------------
function _buildOrderBy(orderByArg, fields, format, namespaces) {
  if (!orderByArg) return [];
  const orders = Array.isArray(orderByArg) ? orderByArg : [orderByArg];
  const result = [];

  for (const ob of orders) {
    const fieldName = ob.field;
    const dir       = (ob.direction || ob.dir || 'asc').toLowerCase();
    const options   = dir === 'desc' ? ['descending'] : ['ascending'];

    const fieldDef = _findField(fieldName, fields);
    if (!fieldDef) continue;

    try {
      let ref;
      const refOptions = _gqlTypeToRefOptions(fieldDef.type);
      if (format === 'json') {
        ref = cts.jsonPropertyReference(fieldDef.sourceKey, refOptions);
      } else {
        const qname = _xmlQName(fieldDef, namespaces);
        ref = cts.elementReference(qname, refOptions);
      }
      result.push(cts.indexOrder(ref, options));
    } catch (e) {
      xdmp.log('[planner] orderBy: could not build index reference for field "' + fieldName + '" (sourceKey="' + (fieldDef && fieldDef.sourceKey) + '"): ' + e.message, 'warning');
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * _argsToMap(args, variables)
 * Converts an AST arguments array into a plain JS object with resolved values.
 */
function _argsToMap(args, variables) {
  const map = {};
  for (const arg of (args || [])) {
    map[arg.name] = resolveValue(arg.value, variables);
  }
  return map;
}

/**
 * _findField(gqlName, fields)
 * Look up a field definition by its GraphQL name (camelCase) or source key.
 */
function _findField(gqlName, fields) {
  if (fields[gqlName]) return fields[gqlName];
  // Try matching by sourceKey
  for (const def of Object.values(fields)) {
    if (def.sourceKey === gqlName) return def;
  }
  return null;
}

/**
 * _xmlQName(fieldDef, namespaces)
 * Build a QName for XML CTS queries.  Handles optional namespace.
 */
function _xmlQName(fieldDef, namespaces) {
  const ns = fieldDef.namespace || '';
  if (ns) {
    return fn.QName(ns, fieldDef.sourceKey);
  }
  return fn.QName('', fieldDef.sourceKey);
}

/**
 * _gqlTypeToRefOptions(gqlType)
 * Returns cts.*Reference options array with the correct type= for the range index.
 */
function _gqlTypeToRefOptions(gqlType) {
  const t = (gqlType || '').replace(/[\[\]!]/g, '');
  if (t === 'Int')     return ['type=int'];
  if (t === 'Float')   return ['type=decimal'];
  if (t === 'Boolean') return ['type=string'];
  return ['type=string'];  // String, ID, and everything else
}

/**
 * _unwrapType(typeStr)  "[Order!]!" → "Order"
 */
function _unwrapType(typeStr) {
  if (!typeStr) return '';
  return typeStr.replace(/[\[\]!]/g, '');
}

module.exports = { plan };
