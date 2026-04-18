'use strict';
/**
 * executor.sjs
 * Executes a query plan produced by planner.sjs and shapes the response.
 *
 * Responsibilities:
 *  1. Run cts.search() for each root plan using the pre-built CTS query.
 *  2. Normalise each result document (XML or JSON) to a plain JS object.
 *  3. Resolve relation fields by performing secondary doc lookups.
 *  4. Project the object down to only the fields in the GraphQL selection set.
 *  5. Handle __schema / __type introspection queries.
 *  6. Assemble the final { data, errors } response envelope.
 */

const { documentToObject, projectObject } = require('/lib/graphql/normalizer.sjs');
const { buildIntrospectionSchema }        = require('/lib/graphql/schema.sjs');

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * execute(plans, registry, document, variables)
 *
 * @param {Object[]} plans      - QueryPlan[] from planner.plan()
 * @param {Object}   registry   - schema registry from schema.sjs
 * @param {Object}   document   - parsed GraphQL Document AST (for fragments)
 * @param {Object}   variables  - runtime variable values
 * @returns {{ data: Object, errors: Object[] }}
 */
function execute(plans, registry, document, variables) {
  const data   = {};
  const errors = [];

  xdmp.log('[executor] execute() called with ' + plans.length + ' plan(s)', 'info');

  // Build a fragment lookup map from the parsed document
  const fragmentMap = _buildFragmentMap(document);

  for (const queryPlan of plans) {
    try {
      if (queryPlan.error) {
        xdmp.log('[executor] plan has error: ' + queryPlan.error, 'warning');
        errors.push({ message: queryPlan.error });
        data[queryPlan.field ? (queryPlan.field.alias || queryPlan.field.name) : '__error'] = null;
        continue;
      }

      if (queryPlan.introspection) {
        xdmp.log('[executor] executing introspection plan', 'info');
        _executeIntrospection(queryPlan.field, registry, data, fragmentMap);
        continue;
      }

      xdmp.log('[executor] executing plan for field "' + queryPlan.fieldAlias + '" typeName=' + queryPlan.typeName, 'info');
      const results = _executePlan(queryPlan, registry, fragmentMap, variables);
      const resultCount = Array.isArray(results) ? results.length : (results === null ? 0 : 1);
      xdmp.log('[executor] plan "' + queryPlan.fieldAlias + '" returned ' + resultCount + ' result(s)', 'info');
      data[queryPlan.fieldAlias] = results;

    } catch (e) {
      xdmp.log('[executor] error executing plan "' + queryPlan.fieldAlias + '": ' + e.message, 'error');
      errors.push({ message: e.message || String(e), path: [queryPlan.fieldAlias] });
      data[queryPlan.fieldAlias] = null;
    }
  }

  const response = { data };
  if (errors.length) response.errors = errors;
  xdmp.log('[executor] execute() complete. data keys: ' + JSON.stringify(Object.keys(data)) + ' errors: ' + errors.length, 'info');
  return response;
}

// ---------------------------------------------------------------------------
// Execute a single query plan
// ---------------------------------------------------------------------------
function _executePlan(plan, registry, fragmentMap, variables) {
  // ── Search options ──
  const searchOptions = ['score-zero', 'unfaceted'];
  if (plan.orderBy && plan.orderBy.length) {
    for (const o of plan.orderBy) searchOptions.push(o);
  }

  // ── Run the search ──
  const startPos = (plan.offset || 0) + 1;  // cts.search is 1-based
  const pageLen  = plan.limit || 50;

  xdmp.log('[executor] _executePlan: typeName=' + plan.typeName + ' collection=' + plan.collection + ' startPos=' + startPos + ' pageLen=' + pageLen + ' ctsQuery=' + xdmp.quote(plan.ctsQuery), 'info');

  const rawDocs = [];
  for (const doc of fn.subsequence(cts.search(plan.ctsQuery, searchOptions), startPos, pageLen)) {
    rawDocs.push(doc);
  }
  xdmp.log('[executor] cts.search returned ' + rawDocs.length + ' doc(s) for ' + plan.typeName, 'info');

  const typeDef    = registry.types[plan.typeName] || {};
  const results    = [];

  for (const doc of rawDocs) {
    let obj = documentToObject(doc);
    if (!obj) continue;

    // Unwrap root wrapper element, e.g. { "airport": { "code": ... } } → { "code": ... }
    obj = _unwrapRootObject(obj, typeDef, plan.typeName);

    // Resolve relation fields (secondary lookups)
    if (Object.keys(plan.subPlans || {}).length > 0) {
      obj = _resolveRelations(obj, plan.subPlans, typeDef, registry, fragmentMap, variables);
    }

    // Project to requested fields
    const projected = projectObject(obj, plan.selectionSet, registry, plan.typeName, fragmentMap);
    results.push(projected);
  }

  return plan.isList ? results : (results[0] || null);
}

// ---------------------------------------------------------------------------
// Root-wrapper unwrapper
// ---------------------------------------------------------------------------
/**
 * _unwrapRootObject(obj, typeDef, typeName)
 * JSON documents are often stored with a single root-key wrapper, e.g.:
 *   { "airport": { "code": "SFO", "name": "San Francisco" } }
 * In that case projectObject would look for "code" directly on the outer
 * object and find nothing.  This function detects that pattern and returns
 * the inner object so field projection works correctly.
 *
 * Unwrapping happens when:
 *  1. typeDef.rootPath is set explicitly (trusts schema author), OR
 *  2. The object has exactly one key whose lower-case form matches the
 *     lower-case GraphQL type name, AND the inner value is a plain object.
 */
function _unwrapRootObject(obj, typeDef, typeName) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;

  // Explicit: schema says which key to unwrap
  if (typeDef.rootPath) {
    const inner = obj[typeDef.rootPath];
    return (inner !== null && inner !== undefined) ? inner : obj;
  }

  // Auto-detect: single-key wrapper whose name matches the type name
  const keys = Object.keys(obj);
  if (keys.length === 1) {
    const key   = keys[0];
    const inner = obj[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      if (key.toLowerCase() === typeName.toLowerCase()) {
        xdmp.log('[executor] _unwrapRootObject: unwrapping root key "' + key + '" for type ' + typeName, 'fine');
        return inner;
      }
    }
  }

  return obj;
}

// ---------------------------------------------------------------------------
// Relation resolver (secondary doc lookups)
// ---------------------------------------------------------------------------
function _resolveRelations(obj, subPlans, typeDef, registry, fragmentMap, variables) {
  const result = Object.assign({}, obj);

  for (const [fieldName, subPlan] of Object.entries(subPlans)) {
    const rel       = subPlan.relation;   // { type, via, foreignKey }
    const relTypeDef = subPlan.typeDef;
    const localVal  = obj[rel.via];       // e.g. obj["customerId"]

    if (localVal === undefined || localVal === null) {
      result[fieldName] = null;
      continue;
    }

    // Find matching documents by the foreign key field
    let relQuery;
    if (relTypeDef.format === 'xml') {
      relQuery = cts.andQuery([
        relTypeDef.collection ? cts.collectionQuery(relTypeDef.collection) : cts.trueQuery(),
        cts.elementValueQuery(fn.QName('', rel.foreignKey), String(localVal))
      ]);
    } else {
      relQuery = cts.andQuery([
        relTypeDef.collection ? cts.collectionQuery(relTypeDef.collection) : cts.trueQuery(),
        cts.jsonPropertyValueQuery(rel.foreignKey, localVal)
      ]);
    }

    const relDocs = [];
    for (const doc of cts.search(relQuery, ['score-zero', 'unfaceted'], 1)) {
      relDocs.push(doc);
    }

    if (relDocs.length === 0) {
      result[fieldName] = null;
    } else if (relDocs.length === 1) {
      const relObj = documentToObject(relDocs[0]);
      result[fieldName] = subPlan.selectionSet
        ? projectObject(relObj, subPlan.selectionSet, registry, rel.type, fragmentMap)
        : relObj;
    } else {
      result[fieldName] = relDocs.map(doc => {
        const relObj = documentToObject(doc);
        return subPlan.selectionSet
          ? projectObject(relObj, subPlan.selectionSet, registry, rel.type, fragmentMap)
          : relObj;
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Introspection execution
// ---------------------------------------------------------------------------
function _executeIntrospection(fieldSel, registry, data, fragmentMap) {
  const fieldName = fieldSel.name;
  const alias     = fieldSel.alias || fieldName;

  if (fieldName === '__schema') {
    const introSchema = buildIntrospectionSchema(registry);
    data[alias] = _projectIntrospection(introSchema, fieldSel.selectionSet, fragmentMap);
    return;
  }

  if (fieldName === '__type') {
    const nameArg = (fieldSel.arguments || []).find(a => a.name === 'name');
    const typeName = nameArg ? nameArg.value.value : null;
    if (!typeName) { data[alias] = null; return; }

    const introSchema = buildIntrospectionSchema(registry);
    const typeObj     = introSchema.types.find(t => t.name === typeName) || null;
    data[alias] = typeObj ? _projectIntrospectionType(typeObj, fieldSel.selectionSet, fragmentMap) : null;
    return;
  }

  data[alias] = null;
}

/**
 * _projectIntrospection
 * Walk an introspection result object and apply the selection set.
 * Introspection types are plain JS objects so we can recurse without the
 * full schema machinery.
 */
function _projectIntrospection(obj, selectionSet, fragmentMap) {
  if (!selectionSet || !obj) return obj;
  const result = {};

  for (const sel of selectionSet.selections) {
    if (sel.kind === 'Field') {
      const key   = sel.alias || sel.name;
      const value = obj[sel.name];

      if (sel.selectionSet && value !== null && value !== undefined) {
        if (Array.isArray(value)) {
          result[key] = value.map(item => _projectIntrospection(item, sel.selectionSet, fragmentMap));
        } else {
          result[key] = _projectIntrospection(value, sel.selectionSet, fragmentMap);
        }
      } else {
        result[key] = value !== undefined ? value : null;
      }
    } else if (sel.kind === 'InlineFragment') {
      Object.assign(result, _projectIntrospection(obj, sel.selectionSet, fragmentMap));
    } else if (sel.kind === 'FragmentSpread') {
      const frag = fragmentMap[sel.name];
      if (frag) Object.assign(result, _projectIntrospection(obj, frag.selectionSet, fragmentMap));
    }
  }
  return result;
}

function _projectIntrospectionType(typeObj, selectionSet, fragmentMap) {
  return _projectIntrospection(typeObj, selectionSet, fragmentMap);
}

// ---------------------------------------------------------------------------
// Fragment map
// ---------------------------------------------------------------------------
function _buildFragmentMap(document) {
  const map = {};
  if (!document || !document.definitions) return map;
  for (const def of document.definitions) {
    if (def.kind === 'FragmentDefinition') {
      map[def.name] = def;
    }
  }
  return map;
}

module.exports = { execute };
