'use strict';
/**
 * planner.sjs
 * GraphQL AST + schema registry → CTS Query Plan
 *
 * The planner is the performance-critical layer.  It translates the
 * GraphQL where/filter/orderBy/limit/offset/first/after/before arguments into
 * a CTS query tree so that MarkLogic evaluates all predicates in a single
 * cts.search() call — no post-filtering in application code.
 *
 * ─── Root Query Plan shape ─────────────────────────────────────────────────
 * {
 *   typeName:     "Order",
 *   collection:   "orders",
 *   format:       "json",              // "json" | "xml"
 *   namespaces:   { ... },             // XML only
 *   ctsQuery:     cts.andQuery([...]), // fully composed CTS query
 *   orderBy:      [cts.indexOrder(...)],
 *   limit:        25,
 *   offset:       0,
 *   beforeOffset: null,                // decoded from before: cursor (or null)
 *   connection:   true,                // true when edges/pageInfo detected
 *   selectionSet: { ... },             // original AST selectionSet for executor
 *   subPlans:     { fieldName: SubPlan }
 * }
 *
 * ─── SubPlan shape (relation / child fields) ───────────────────────────────
 * {
 *   relation:     { type, via, foreignKey },
 *   typeDef:      { ... },
 *   selectionSet: { ... },
 *   connection:   false,               // true when child edges/pageInfo detected
 *   beforeOffset: null,
 *   // optional — only present when child field carries arguments:
 *   ctsQuery:     cts.andQuery([...]),
 *   orderBy:      [cts.indexOrder(...)],
 *   limit:        10,                  // from first:/last:/limit: (first wins)
 *   offset:       0,                   // from after: cursor or explicit offset:
 * }
 *
 * ─── Cursor format ─────────────────────────────────────────────────────────
 * Cursors are opaque base64-encoded JSON:
 *   { offset: <1-based next-page start>, uri: "<document URI>" }
 *
 * offset — absolute 1-based position to pass to fn.subsequence() on the next
 *          request (i.e. the position AFTER the last item on this page).
 * uri    — URI of the last document seen; used to detect stale cursors.
 *          If the document no longer exists the cursor falls back to offset.
 *
 * Encode: encodeCursor({ offset, uri })  → base64 string  (exported)
 * Decode: _decodeCursor(cursor)          → { offset, uri } (internal)
 *
 * ─── Relay Connection response shape ───────────────────────────────────────
 * Automatically activated when the selection set contains edges, pageInfo, or
 * totalCount — no schema changes required.
 *
 * {
 *   totalCount: 142,                   // cts.estimate() — root level only
 *   pageInfo: {
 *     hasNextPage:     true,
 *     hasPreviousPage: false,
 *     startCursor:     "eyJvZmZzZXQiOjAsInVyaSI6Ii9vcmRlcnMvMSJ9",
 *     endCursor:       "eyJvZmZzZXQiOjksInVyaSI6Ii9vcmRlcnMvMTAifQ=="
 *   },
 *   edges: [
 *     { cursor: "eyJvZmZzZXQiOjAsInVyaSI6Ii9vcmRlcnMvMSJ9", node: { ... } },
 *     ...
 *   ]
 * }
 *
 * ─── Pagination example ────────────────────────────────────────────────────
 *
 * First page (10 orders, shipped, sorted by date desc):
 *
 *   query FirstPage {
 *     orders(
 *       where:   { status: "shipped" }
 *       orderBy: { field: "orderDate", dir: "desc" }
 *       first:   10
 *     ) {
 *       totalCount
 *       pageInfo { hasNextPage endCursor }
 *       edges {
 *         cursor
 *         node {
 *           id
 *           status
 *           orderDate
 *           lineItems(first: 3, orderBy: { field: "amount", dir: "desc" }) {
 *             pageInfo { hasNextPage endCursor }
 *             edges {
 *               cursor
 *               node { productId qty amount }
 *             }
 *           }
 *         }
 *       }
 *     }
 *   }
 *
 * Next page (use endCursor from previous response):
 *
 *   query NextPage($cursor: String!) {
 *     orders(
 *       where:   { status: "shipped" }
 *       orderBy: { field: "orderDate", dir: "desc" }
 *       first:   10
 *       after:   $cursor
 *     ) {
 *       pageInfo { hasNextPage endCursor }
 *       edges {
 *         cursor
 *         node { id status orderDate }
 *       }
 *     }
 *   }
 *
 * ─── Supported where argument operators (root and child level) ─────────────
 * where: {
 *   status:  "shipped"                   → value equality
 *   amount:  { gt: 100, lte: 500 }       → range queries
 *   name:    { contains: "foo" }         → word query
 *   name:    { notContains: "foo" }      → cts.notQuery(wordQuery)
 *   name:    { startsWith: "foo" }       → wildcarded value query "foo*"
 *   status:  { in: ["a","b"] }           → cts.orQuery of value queries
 *   status:  { notIn: ["a","b"] }        → cts.notQuery(orQuery)
 *   name:    { exists: true }            → cts.jsonPropertyScopeQuery / cts.elementQuery
 *   name:    { exists: false }           → cts.notQuery(scopeQuery)
 *   AND: [ { ... }, { ... } ]            → cts.andQuery
 *   OR:  [ { ... }, { ... } ]            → cts.orQuery
 *   NOT: { ... }                         → cts.notQuery
 *   _collection: "orders"                → cts.collectionQuery override (root only)
 *   _uri:    { startsWith: "/orders/" }  → cts.directoryQuery            (root only)
 * }
 *
 * ─── Pagination / sort arguments (root and child level) ───────────────────
 *   first:   10       → page size (Connection-style; takes precedence over limit)
 *   last:    10       → page size from tail (alias for first in offset pagination)
 *   after:   $cursor  → start after this cursor (decodes to offset)
 *   before:  $cursor  → end before this cursor  (decodes to offset)
 *   limit:   10       → legacy page size
 *   offset:  20       → legacy skip count
 *   orderBy: { field: "amount", dir: "desc" }
 *
 * Note: first/after take precedence over limit/offset when both are supplied.
 * Note: _collection and _uri overrides are not supported at the child level.
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
  xdmp.log('[planner] plan() called, queryFields: ' + JSON.stringify(Object.keys(registry.queryFields || {})), 'fine');

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
      xdmp.log('[planner] unknown query field: "' + fieldName + '"', 'warning');
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

  xdmp.log('[planner] _buildPlan typeName=' + typeName + ' collection=' + collection, 'fine');

  // ── Extract known arguments ──
  const args        = _argsToMap(fieldSel.arguments, variables);
  const whereArg    = args['where']    || null;
  const orderByArg  = args['orderBy']  || null;
  const uriArg      = args['_uri']     || null;
  const colArg      = args['_collection'] || null;

  // Connection pagination args: first/after take precedence over limit/offset
  const afterCursor = args['after']  || null;
  const beforeCursor= args['before'] || null;
  const afterOffset = afterCursor  ? _decodeCursor(afterCursor).offset  : null;
  const beforeOffset= beforeCursor ? _decodeCursor(beforeCursor).offset : null;

  // first/last are Connection-style; limit/offset are legacy
  const rawFirst = args['first'] !== undefined ? args['first'] : undefined;
  const rawLast  = args['last']  !== undefined ? args['last']  : undefined;
  const limit    = rawFirst !== undefined ? rawFirst
                 : rawLast  !== undefined ? rawLast
                 : args['limit'] !== undefined ? args['limit'] : 50;
  // after-cursor offset wins over explicit offset
  const offset   = afterOffset !== null ? afterOffset
                 : args['offset'] !== undefined ? args['offset'] : 0;

  xdmp.log('[planner] args: limit=' + limit + ' offset=' + offset, 'fine');

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
  const { orders: orderBy, warnings: orderByWarnings } = _buildOrderBy(orderByArg, fields, format, namespaces);

  // ── Relation sub-plans ──
  const subPlans = {};
  const relations = typeDef.relations || {};
  const fieldDefs = typeDef.fields || {};
  xdmp.log('[planner] subPlan scan — typeName=' + typeName + ' relations=' + JSON.stringify(Object.keys(relations)) + ' fieldDefs=' + JSON.stringify(Object.keys(fieldDefs)), 'debug');
  for (const sel of (fieldSel.selectionSet ? fieldSel.selectionSet.selections : [])) {
    if (sel.kind !== 'Field') continue;
    xdmp.log('[planner] checking sel.name="' + sel.name + '" inRelations=' + !!(relations[sel.name]) + ' inFields=' + !!(fieldDefs[sel.name]), 'debug');
    if (relations[sel.name]) {
      const relDef     = relations[sel.name];
      const relTypeDef = registry.types[relDef.type] || {};
      const subWarnings = _validateSubPlan(sel.name, relDef, relTypeDef, registry);
      subPlans[sel.name] = Object.assign(
        { relation: relDef, typeDef: relTypeDef, selectionSet: sel.selectionSet, warnings: subWarnings },
        _buildChildPlanArgs(sel.arguments, relTypeDef, sel.selectionSet, variables)
      );
    } else if (fieldDefs[sel.name]) {
      // Inline embedded field — resolved from the same document, no secondary lookup.
      // Activated when the field has embedded:true OR when its type resolves to a
      // registered type in the registry (auto-derived schemas may lack the explicit flag).
      const fieldDef    = fieldDefs[sel.name];
      const nestedTypeName = _unwrapType(fieldDef.type);
      const isEmbedded  = fieldDef.embedded === true || String(fieldDef.embedded) === 'true';
      const isNestedType = !!(registry.types[nestedTypeName]);
      const SCALARS = ['String', 'Int', 'Float', 'Boolean', 'ID'];
      const isComplexType = nestedTypeName && !SCALARS.includes(nestedTypeName);
      xdmp.log('[planner] inline candidate "' + sel.name + '" nestedTypeName="' + nestedTypeName + '" isEmbedded=' + isEmbedded + ' isNestedType=' + isNestedType + ' isComplexType=' + isComplexType + ' args=' + JSON.stringify(sel.arguments), 'debug');
      if (isEmbedded || isNestedType || isComplexType) {
        const relTypeDef = registry.types[nestedTypeName] || {};
        xdmp.log('[planner] inline "' + sel.name + '" relTypeDef.fields=' + JSON.stringify(Object.keys(relTypeDef.fields || {})), 'debug');
        const childArgs = _buildChildPlanArgs(sel.arguments, relTypeDef, sel.selectionSet, variables);
        xdmp.log('[planner] inline "' + sel.name + '" childArgs.whereArg=' + JSON.stringify(childArgs.whereArg) + ' childArgs.ctsQuery=' + (childArgs.ctsQuery ? 'set' : 'null'), 'debug');
        subPlans[sel.name] = Object.assign(
          {
            inline:       true,
            sourceKey:    fieldDef.sourceKey || sel.name,
            relation:     { type: nestedTypeName, via: null, foreignKey: null },
            typeDef:      relTypeDef,
            selectionSet: sel.selectionSet,
          },
          childArgs
        );
      }
    }
  }

  // ── Detect Relay Connection mode ──
  // Triggered when the selection set contains 'edges' or 'pageInfo'.
  const connection = _isConnectionSelection(fieldSel.selectionSet);

  xdmp.log('[planner] plan built for ' + typeName + ' connection=' + connection, 'fine');

  return {
    typeName,
    collection: effectiveCollection,
    format,
    namespaces,
    ctsQuery,
    orderBy,
    orderByWarnings,
    limit,
    offset,
    beforeOffset,
    connection,
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

  // Object: range operators, word queries, or extended operators
  const clauses = [];
  for (const [op, opVal] of Object.entries(val)) {
    if (op === 'contains') {
      clauses.push(_wordQuery(fieldDef, opVal, format, namespaces));
    } else if (op === 'notContains') {
      clauses.push(cts.notQuery(_wordQuery(fieldDef, opVal, format, namespaces)));
    } else if (op === 'startsWith') {
      clauses.push(_valueQuery(fieldDef, opVal + '*', format, namespaces, ['wildcarded', 'case-insensitive']));
    } else if (op === 'in') {
      const vals = Array.isArray(opVal) ? opVal : [opVal];
      const subQ = vals.map(v => _valueQuery(fieldDef, v, format, namespaces));
      clauses.push(subQ.length === 1 ? subQ[0] : cts.orQuery(subQ));
    } else if (op === 'notIn') {
      const vals = Array.isArray(opVal) ? opVal : [opVal];
      const subQ = vals.map(v => _valueQuery(fieldDef, v, format, namespaces));
      clauses.push(cts.notQuery(subQ.length === 1 ? subQ[0] : cts.orQuery(subQ)));
    } else if (op === 'exists') {
      const scopeQ = _existsQuery(fieldDef, format, namespaces);
      clauses.push(opVal === false || opVal === 'false' ? cts.notQuery(scopeQ) : scopeQ);
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

function _valueQuery(fieldDef, value, format, namespaces, options) {
  const opts = options || ['case-insensitive'];
  if (format === 'json') {
    return cts.jsonPropertyValueQuery(fieldDef.sourceKey, value, opts);
  }
  const qname = _xmlQName(fieldDef, namespaces);
  return cts.elementValueQuery(qname, String(value), opts);
}

function _existsQuery(fieldDef, format, namespaces) {
  if (format === 'json') {
    return cts.jsonPropertyScopeQuery(fieldDef.sourceKey, cts.trueQuery());
  }
  const qname = _xmlQName(fieldDef, namespaces);
  return cts.elementQuery(qname, cts.trueQuery());
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

/**
 * _buildOrderBy(orderByArg, fields, format, namespaces)
 * Returns { orders: [...], warnings: [...] }
 * warnings entries: { field, sourceKey, type, reason, remediation }
 */
function _buildOrderBy(orderByArg, fields, format, namespaces) {
  if (!orderByArg) return { orders: [], warnings: [] };
  const specs    = Array.isArray(orderByArg) ? orderByArg : [orderByArg];
  const orders   = [];
  const warnings = [];

  for (const ob of specs) {
    const fieldName = ob.field;
    const dir       = (ob.direction || ob.dir || 'asc').toLowerCase();
    const options   = dir === 'desc' ? ['descending'] : ['ascending'];

    const fieldDef = _findField(fieldName, fields);
    if (!fieldDef) {
      warnings.push({
        field:       fieldName,
        sourceKey:   null,
        type:        null,
        reason:      'Field "' + fieldName + '" not found in schema — orderBy ignored',
        remediation: 'Add "' + fieldName + '" to the type\'s fields definition in the schema.',
      });
      continue;
    }

    const refOptions = _gqlTypeToRefOptions(fieldDef.type);
    const gqlType    = (fieldDef.type || '').replace(/[\[\]!]/g, '');
    const mlType     = gqlType === 'Int' ? 'int' : gqlType === 'Float' ? 'decimal' : 'string';
    // Collation is only relevant for string-typed indexes
    const collation  = mlType === 'string' ? _defaultCollation(refOptions) : null;
    // Resolve namespace using the same priority as _xmlQName: per-field override → doc default → none
    const namespace  = format === 'xml'
      ? (fieldDef.namespace || (namespaces && (namespaces[''] || namespaces['xmlns'])) || null)
      : null;

    let ref;
    let indexError = null;
    try {
      if (format === 'json') {
        ref = cts.jsonPropertyReference(fieldDef.sourceKey, refOptions);
      } else {
        const qname = _xmlQName(fieldDef, namespaces);
        ref = cts.elementReference(qname, refOptions);
      }
      orders.push(cts.indexOrder(ref, options));
    } catch (e) {
      indexError = e;
    }

    if (indexError) {
      const errMsg     = indexError.message || String(indexError);
      const errLower   = errMsg.toLowerCase();
      xdmp.log('[planner] orderBy index problem for "' + fieldName + '" refOptions=' + JSON.stringify(refOptions) +
               (namespace ? ' namespace="' + namespace + '"' : '') + ': ' + errMsg, 'warning');

      // Diagnose the most common failure modes from the error message text
      let diagnosis;
      if (errLower.indexOf('range index') !== -1 && errLower.indexOf('not found') !== -1) {
        diagnosis = 'No matching range index exists. The index may not have been created yet.';
      } else if (errLower.indexOf('collation') !== -1) {
        diagnosis = 'A range index exists for this field but its collation does not match "' + collation + '". ' +
                    'Check the collation configured on the existing index and either update the index or add a ' +
                    'collation= option to the schema field definition.';
      } else if (errLower.indexOf('type') !== -1 || errLower.indexOf('scalar') !== -1) {
        diagnosis = 'A range index exists for this field but its scalar-type does not match "' + mlType + '". ' +
                    'The schema declares this field as ' + (fieldDef.type || 'String') + ' → scalar-type "' + mlType + '". ' +
                    'Verify the index scalar-type in the Admin UI matches, or correct the field type in the schema.';
      } else if (errLower.indexOf('namespace') !== -1) {
        diagnosis = 'A range index exists but the namespace does not match. ' +
                    'The schema resolves this field to namespace "' + (namespace || '(none)') + '". ' +
                    'Verify the element namespace on the existing index matches exactly.';
      } else {
        diagnosis = 'MarkLogic error: ' + errMsg;
      }

      // Exact index spec the planner requested — helps the user compare against what is in the Admin UI
      const requestedSpec = format === 'xml'
        ? 'element-range-index: element="' + fieldDef.sourceKey + '"' +
          ' namespace="' + (namespace || '') + '"' +
          ' scalar-type="' + mlType + '"' +
          (collation ? ' collation="' + collation + '"' : '')
        : 'json-property-range-index: property="' + fieldDef.sourceKey + '"' +
          ' scalar-type="' + mlType + '"' +
          (collation ? ' collation="' + collation + '"' : '');

      const remediation =
        'Requested index spec: [' + requestedSpec + ']. ' +
        diagnosis + ' ' +
        'To create or fix the index: MarkLogic Admin UI → Databases → [your database] → Range Indexes → Add Range Index. ' +
        'After adding the index a re-index may be required (Admin UI → Database → Re-index).';

      warnings.push({
        field:        fieldName,
        sourceKey:    fieldDef.sourceKey,
        type:         fieldDef.type,
        namespace:    namespace,
        collation:    collation,
        requestedSpec,
        reason:       'Range index lookup failed for "' + fieldName + '" (sourceKey: "' + fieldDef.sourceKey + '"): ' + errMsg,
        remediation,
      });
    }
  }
  return { orders, warnings };
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
 * Build a QName for XML CTS queries.
 *
 * Priority:
 *  1. fieldDef.namespace — explicit per-field override
 *  2. namespaces[""] or namespaces["xmlns"] — the document's default namespace
 *  3. Empty string (no namespace)
 */
function _xmlQName(fieldDef, namespaces) {
  const ns = fieldDef.namespace
    || (namespaces && (namespaces[''] || namespaces['xmlns']))
    || '';
  return fn.QName(ns, fieldDef.sourceKey);
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
 * _defaultCollation(refOptions)
 * Extracts the collation from a refOptions array, or returns the MarkLogic
 * root collation as the default for string indexes when none is specified.
 */
function _defaultCollation(refOptions) {
  for (const opt of (refOptions || [])) {
    if (String(opt).startsWith('collation=')) {
      return String(opt).slice('collation='.length);
    }
  }
  // MarkLogic default collation for string range indexes
  return 'http://marklogic.com/collation/';
}

/**
 * _unwrapType(typeStr)  "[Order!]!" → "Order"
 */
function _unwrapType(typeStr) {
  if (!typeStr) return '';
  return typeStr.replace(/[\[\]!]/g, '');
}

/**
 * _buildChildPlanArgs(arguments, relTypeDef, selectionSet, variables)
 * Compiles child-field arguments (where, orderBy, first, last, after, before,
 * limit, offset) into plan fragments the executor merges into the secondary
 * cts.search(). Also detects Relay Connection mode from the selection set.
 */
function _buildChildPlanArgs(args, relTypeDef, selectionSet, variables) {
  const map        = _argsToMap(args, variables);
  const whereArg   = map['where']   || null;
  const orderByArg = map['orderBy'] || null;

  // Cursor-based pagination
  const afterCursor  = map['after']  || null;
  const beforeCursor = map['before'] || null;
  const afterOffset  = afterCursor  ? _decodeCursor(afterCursor).offset  : null;
  const beforeOffset = beforeCursor ? _decodeCursor(beforeCursor).offset : null;

  // first/last are Connection-style; limit is legacy
  const rawFirst = map['first'] !== undefined ? map['first'] : undefined;
  const rawLast  = map['last']  !== undefined ? map['last']  : undefined;
  const limit    = rawFirst !== undefined ? rawFirst
                 : rawLast  !== undefined ? rawLast
                 : map['limit'] !== undefined ? map['limit'] : undefined;
  const offset   = afterOffset !== null ? afterOffset
                 : map['offset'] !== undefined ? map['offset'] : undefined;

  const connection = _isConnectionSelection(selectionSet);

  const result = { connection, beforeOffset };

  if (whereArg) {
    xdmp.log("whereArg:" + xdmp.quote(whereArg),"info");
    result.whereArg = whereArg;  // always stored — drives in-memory filtering for inline types
    try {
      const childQuery = _buildWhereQuery(whereArg, relTypeDef.fields || {}, relTypeDef.format || 'json', relTypeDef.namespaces || {});
      if (childQuery) result.ctsQuery = childQuery;
    } catch (e) {
      // CTS query build failed (e.g. no range index for an inline/embedded field).
      // whereArg is still set above so the executor will apply in-memory filtering.
      xdmp.log('[planner] _buildChildPlanArgs: CTS where build failed, falling back to in-memory filter: ' + e.message, 'fine');
    }
  }

  if (orderByArg) {
    const { orders, warnings } = _buildOrderBy(orderByArg, relTypeDef.fields || {}, relTypeDef.format || 'json', relTypeDef.namespaces || {});
    result.orderBy         = orders;
    result.orderByWarnings = warnings;
  }

  if (limit  !== undefined) result.limit  = limit;
  if (offset !== undefined) result.offset = offset;

  return result;
}

// ---------------------------------------------------------------------------
// SubPlan validation
// ---------------------------------------------------------------------------

/**
 * _validateSubPlan(fieldName, relDef, relTypeDef, registry)
 * Checks for common misconfiguration problems that cause a subquery to
 * silently return null. Returns an array of warning strings (empty = ok).
 */
function _validateSubPlan(fieldName, relDef, relTypeDef, registry) {
  const warnings = [];

  // 1. Related type not registered
  if (!relDef.type) {
    warnings.push('Relation "' + fieldName + '" has no type defined. Add a type: "TypeName" to the relation definition.');
  } else if (!registry.types[relDef.type]) {
    warnings.push('Relation type "' + relDef.type + '" is not registered in the schema. ' +
                  'Generate or create a schema for "' + relDef.type + '" and reload.');
  }

  // 2. Missing join keys
  if (!relDef.via) {
    warnings.push('Relation "' + fieldName + '" is missing the "via" field (the local FK field on the parent type). ' +
                  'Set via: "<parentField>" in the relation definition.');
  }
  if (!relDef.foreignKey) {
    warnings.push('Relation "' + fieldName + '" is missing "foreignKey" (the matching field on the child type). ' +
                  'Set foreignKey: "<childField>" in the relation definition.');
  }

  // 3. Child type has no collection — search will scan everything
  if (relTypeDef && !relTypeDef.collection) {
    warnings.push('Child type "' + relDef.type + '" has no collection defined. ' +
                  'The secondary search will not be scoped and may match unrelated documents. ' +
                  'Add collection: "<name>" to the "' + relDef.type + '" schema.');
  }

  // 4. via field does not exist on the parent type fields
  if (relDef.via && Object.keys(relTypeDef.fields || {}).length === 0) {
    // Can't check parent fields here (we only have relTypeDef), skip
  }

  // 5. foreignKey field not found in child type's fields
  if (relDef.foreignKey && relTypeDef && relTypeDef.fields) {
    const fkFieldDef = relTypeDef.fields[relDef.foreignKey] ||
      Object.values(relTypeDef.fields).find(function(f) { return f.sourceKey === relDef.foreignKey; });
    if (!fkFieldDef) {
      warnings.push('Child type "' + relDef.type + '" has no field matching foreignKey "' + relDef.foreignKey + '". ' +
                    'Verify the foreignKey name matches a sourceKey in the "' + relDef.type + '" schema, ' +
                    'or the FK value query will match nothing.');
    }
  }

  if (warnings.length) {
    xdmp.log('[planner] subPlan "' + fieldName + '" warnings: ' + JSON.stringify(warnings), 'warning');
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Relay Connection helpers
// ---------------------------------------------------------------------------

/**
 * _isConnectionSelection(selectionSet)
 * Returns true when the selection set contains 'edges' or 'pageInfo',
 * which signals the caller wants a Relay Connection envelope.
 */
function _isConnectionSelection(selectionSet) {
  if (!selectionSet || !selectionSet.selections) return false;
  for (const sel of selectionSet.selections) {
    if (sel.kind === 'Field' && (sel.name === 'edges' || sel.name === 'pageInfo' || sel.name === 'totalCount')) {
      return true;
    }
  }
  return false;
}

/**
 * encodeCursor({ offset, uri })
 * Produces an opaque base64 string encoding the cursor payload.
 * uri is the document URI of the last-seen record (for staleness detection).
 */
function encodeCursor(payload) {
  return xdmp.base64Encode(JSON.stringify(payload));
}

/**
 * _decodeCursor(cursor)
 * Decodes a cursor string back to { offset, uri }.
 * Returns { offset: 0, uri: null } on any parse failure so the query
 * degrades safely to the first page.
 */
function _decodeCursor(cursor) {
  try {
    return JSON.parse(xdmp.base64Decode(cursor));
  } catch (e) {
    xdmp.log('[planner] _decodeCursor: invalid cursor "' + cursor + '": ' + e.message, 'warning');
    return { offset: 0, uri: null };
  }
}

module.exports = { plan, encodeCursor };
