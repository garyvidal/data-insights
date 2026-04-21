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
const { encodeCursor }                    = require('/lib/graphql/planner.sjs');

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
function execute(plans, registry, document) {
  const data   = {};
  const errors = [];

  xdmp.log('[executor] execute() called with ' + plans.length + ' plan(s)', 'debug');

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
        xdmp.log('[executor] executing introspection plan', 'debug');
        _executeIntrospection(queryPlan.field, registry, data, fragmentMap);
        continue;
      }

      xdmp.log('[executor] executing plan for field "' + queryPlan.fieldAlias + '" typeName=' + queryPlan.typeName, 'debug');
      const results = _executePlan(queryPlan, registry, fragmentMap);
      const resultCount = Array.isArray(results) ? results.length : (results === null ? 0 : 1);
      xdmp.log('[executor] plan "' + queryPlan.fieldAlias + '" returned ' + resultCount + ' result(s)', 'debug');
      data[queryPlan.fieldAlias] = results;

    } catch (e) {
      xdmp.log('[executor] error executing plan "' + queryPlan.fieldAlias + '": ' + e.message, 'error');
      errors.push({ message: e.message || String(e), path: [queryPlan.fieldAlias] });
      data[queryPlan.fieldAlias] = null;
    }
  }

  const response = { data };
  if (errors.length) response.errors = errors;
  xdmp.log('[executor] execute() complete. data keys: ' + JSON.stringify(Object.keys(data)) + ' errors: ' + errors.length, 'debug');
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

  xdmp.log('[executor] _executePlan: typeName=' + plan.typeName + ' collection=' + plan.collection + ' startPos=' + startPos + ' pageLen=' + pageLen, 'debug');

  const rawDocs = [];
  for (const doc of fn.subsequence(cts.search(plan.ctsQuery, searchOptions), startPos, pageLen)) {
    rawDocs.push(doc);
  }
  xdmp.log('[executor] cts.search returned ' + rawDocs.length + ' doc(s) for ' + plan.typeName, 'debug');

  const typeDef = registry.types[plan.typeName] || {};

  // Normalise and unwrap all primary docs first
  // __uri is captured here for cursor generation and stripped before projection
  const objects = [];
  for (const doc of rawDocs) {
    let obj = documentToObject(doc);
    if (!obj) continue;
    xdmp.log('[executor] raw obj keys before unwrap: ' + JSON.stringify(Object.keys(obj)), 'fine');
    obj = _unwrapRootObject(obj, typeDef, plan.typeName);
    obj.__uri = String(fn.baseUri(doc) || '');
    objects.push(obj);
  }

  // Batch-resolve all relation fields in one secondary search per relation
  const hasSubPlans = Object.keys(plan.subPlans || {}).length > 0;
  const resolved = hasSubPlans
    ? _resolveRelationsBatched(objects, plan.subPlans, registry, fragmentMap)
    : objects;

  if (plan.connection) {
    return _buildConnectionResult(resolved, plan, registry, fragmentMap);
  }

  // Project to requested fields
  const results = resolved.map(obj =>
    projectObject(obj, plan.selectionSet, registry, plan.typeName, fragmentMap)
  );

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
        xdmp.log('[executor] _unwrapRootObject: unwrapping "' + key + '"', 'finest');
        return inner;
      }
    }
  }

  return obj;
}

// ---------------------------------------------------------------------------
// Batched relation resolver — one secondary search per relation field
// ---------------------------------------------------------------------------
/**
 * _resolveRelationsBatched(objects, subPlans, typeDef, registry, fragmentMap)
 *
 * For each FK relation in subPlans:
 *   1. Collect every distinct FK value across all result objects.
 *   2. Issue a single cts.search() with an OR across all FK values.
 *   3. Index the related docs into a Map keyed by their FK field value.
 *   4. Attach the related object(s) to each parent by map lookup.
 *
 * Inline/embedded sub-plans are resolved directly from the document — no search.
 *
 * Reduces N+1 searches to 1 search per relation field regardless of page size.
 */
function _resolveRelationsBatched(objects, subPlans, registry, fragmentMap) {
  // Clone all objects so we don't mutate the originals
  const results = objects.map(o => Object.assign({}, o));

  for (const [fieldName, subPlan] of Object.entries(subPlans)) {

    // ── Inline embedded: resolve from the same document, then apply predicates ──
    if (subPlan.inline) {
      const relTypeName = subPlan.relation.type;
      const emptyConnection = { pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null }, edges: [] };
      for (const obj of results) {
        // Try the declared sourceKey first, then the GraphQL field name, then a
        // de-pluralised variant (e.g. "orderDetails" → "orderDetail") to handle
        // XML documents where repeated sibling elements are keyed by localName.
        let rawVal = obj[subPlan.sourceKey];
        if (rawVal === undefined && subPlan.sourceKey !== fieldName) {
          rawVal = obj[fieldName];
        }
        if (rawVal === undefined && subPlan.sourceKey.length > 1 && subPlan.sourceKey.endsWith('s')) {
          rawVal = obj[subPlan.sourceKey.slice(0, -1)];
        }
        if (rawVal === undefined) {
          xdmp.log('[executor.inline] "' + fieldName + '" sourceKey="' + subPlan.sourceKey + '" not found in obj keys: ' + JSON.stringify(Object.keys(obj)), 'debug');
          obj[fieldName] = subPlan.connection ? emptyConnection : null;
          continue;
        }

        // Normalise to array for uniform handling
        let items = Array.isArray(rawVal) ? rawVal : [rawVal];

        xdmp.log('[executor.inline] "' + fieldName + '" items=' + items.length +
                 ' whereArg=' + JSON.stringify(subPlan.whereArg) +
                 ' first item keys=' + JSON.stringify(items.length > 0 ? Object.keys(items[0]) : []), 'debug');

        // Apply where predicate — pure in-memory comparison, no index needed
        if (subPlan.whereArg) {
          items = _filterInline(items, subPlan.whereArg, subPlan.typeDef ? subPlan.typeDef.fields : {});
          xdmp.log('[executor.inline] "' + fieldName + '" after filter=' + items.length, 'debug');
        }

        // Apply orderBy (in-memory sort)
        if (subPlan.orderBy && subPlan.orderBy.length) {
          items = _sortInline(items, subPlan.orderBy);
        }

        // Apply offset + limit
        const start = subPlan.offset || 0;
        const end   = subPlan.limit !== undefined ? start + subPlan.limit : items.length;
        const paged = items.slice(start, end);

        if (subPlan.connection) {
          obj[fieldName] = _buildChildConnectionResult(paged, subPlan, registry, fragmentMap);
        } else if (subPlan.selectionSet) {
          const shaped = paged.map(item => projectObject(item, subPlan.selectionSet, registry, relTypeName, fragmentMap));
          obj[fieldName] = Array.isArray(rawVal) ? shaped : (shaped.length > 0 ? shaped[0] : null);
        } else {
          obj[fieldName] = Array.isArray(rawVal) ? paged : (paged.length > 0 ? paged[0] : null);
        }
      }
      continue;
    }

    const rel        = subPlan.relation;  // { type, via, foreignKey }
    const relTypeDef = subPlan.typeDef;

    // ── Step 1: collect distinct FK values from all parent objects ──
    const fkValues = [];
    const fkSet    = {};
    for (const obj of results) {
      const val = obj[rel.via];
      if (val !== undefined && val !== null && !fkSet[String(val)]) {
        fkSet[String(val)] = true;
        fkValues.push(val);
      }
    }

    if (fkValues.length === 0) {
      for (const obj of results) obj[fieldName] = null;
      continue;
    }

    xdmp.log('[executor.batch] relation "' + fieldName + '": fetching ' + fkValues.length + ' FK value(s) from collection=' + relTypeDef.collection + ' format=' + relTypeDef.format + ' foreignKey=' + rel.foreignKey, 'debug');

    // ── Step 2: one search — OR across all FK values ──
    // For XML: build QNames for every known namespace in the related type plus
    // the no-namespace fallback, so the query matches regardless of whether the
    // schema carries an explicit namespaces map (derived schemas often don't).
    let fkConstraint;
    if (relTypeDef.format === 'xml') {
      const relNs    = relTypeDef.namespaces || {};
      const nsUris   = Object.values(relNs).filter(Boolean);
      const qnames   = [fn.QName('', rel.foreignKey)];
      for (const uri of nsUris) {
        qnames.push(fn.QName(uri, rel.foreignKey));
      }
      fkConstraint = cts.andQuery([
        relTypeDef.collection ? cts.collectionQuery(relTypeDef.collection) : cts.trueQuery(),
        cts.elementValueQuery(qnames, fkValues.map(String), ['case-insensitive'])
      ]);
    } else {
      fkConstraint = cts.andQuery([
        relTypeDef.collection ? cts.collectionQuery(relTypeDef.collection) : cts.trueQuery(),
        cts.jsonPropertyValueQuery(rel.foreignKey, fkValues, ['case-insensitive'])
      ]);
    }

    // AND in any child-level where predicate compiled by the planner
    const relQuery = subPlan.ctsQuery
      ? cts.andQuery([fkConstraint, subPlan.ctsQuery])
      : fkConstraint;

    // Build search options — add orderBy index orders if present
    const relSearchOpts = ['score-zero', 'unfaceted', 'unfiltered'];
    if (subPlan.orderBy && subPlan.orderBy.length) {
      for (const o of subPlan.orderBy) relSearchOpts.push(o);
    }

    // Apply limit/offset via fn.subsequence (1-based start position)
    const relStart  = (subPlan.offset || 0) + 1;
    const relLimit  = subPlan.limit !== undefined ? subPlan.limit : Infinity;

    // ── Step 3: index related docs by their FK field value ──
    // A FK may map to multiple related docs (1:many), so store arrays.
    // Must unwrap root wrapper (e.g. XML <order>…</order> → inner object)
    // before reading the FK field — same unwrap that _executePlan does for
    // primary docs.
    const relMap = {};
    const relDocs = relLimit === Infinity
      ? cts.search(relQuery, relSearchOpts)
      : fn.subsequence(cts.search(relQuery, relSearchOpts), relStart, relLimit);
    for (const doc of relDocs) {
      let relObj = documentToObject(doc);
      if (!relObj) continue;
      relObj = _unwrapRootObject(relObj, relTypeDef, rel.type);
      const pkVal = String(relObj[rel.foreignKey]);
      if (!pkVal || pkVal === 'undefined' || pkVal === 'null') continue;
      const shaped = subPlan.selectionSet
        ? projectObject(relObj, subPlan.selectionSet, registry, rel.type, fragmentMap)
        : relObj;
      if (!relMap[pkVal]) {
        relMap[pkVal] = [];
      }
      relMap[pkVal].push(shaped);
    }

    xdmp.log('[executor.batch] relation "' + fieldName + '": indexed ' + Object.keys(relMap).length + ' related doc(s)', 'debug');

    // ── Step 4: attach to each parent by lookup ──
    for (const obj of results) {
      const localVal = obj[rel.via];
      if (localVal === undefined || localVal === null) {
        obj[fieldName] = subPlan.connection ? { pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null }, edges: [] } : null;
        continue;
      }
      const matches = relMap[String(localVal)] || [];
      if (subPlan.connection) {
        obj[fieldName] = _buildChildConnectionResult(matches, subPlan, registry, fragmentMap);
      } else if (matches.length === 0) {
        obj[fieldName] = null;
      } else if (matches.length === 1) {
        obj[fieldName] = matches[0];  // 1:1 — unwrap the array
      } else {
        obj[fieldName] = matches;     // 1:many — return the array
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Inline predicate helpers (in-memory, no cts.search)
// ---------------------------------------------------------------------------

/**
 * _filterInline(items, whereClause)
 * Pure in-memory filter — no index required.
 * whereClause is the raw where argument object from the GraphQL query
 * (not a compiled CTS query), so subPlans must carry the raw where too.
 * See _matchesWhere for supported operators.
 */
function _filterInline(items, whereClause, fieldDefs) {
  if (!whereClause || !items.length) return items;
  return items.filter(function(item) {
    return _matchesWhere(item, whereClause, fieldDefs || {});
  });
}

/**
 * _matchesWhere(obj, where)
 * Recursively evaluates a where clause object against a plain JS object.
 * Supports: equality, AND/OR/NOT, and all RANGE_OPS (eq, ne, lt, lte, gt, gte),
 * plus contains, notContains, startsWith, in, notIn, exists.
 */
function _matchesWhere(obj, where, fieldDefs) {
  if (!where || typeof where !== 'object') return true;
  const defs = fieldDefs || {};
  xdmp.log('[executor] _matchesWhere where=' + JSON.stringify(where) + ' fields=' + JSON.stringify(Object.keys(defs)), 'debug');
  for (const key in where) {
    if (!where.hasOwnProperty(key)) continue;
    const val = where[key];

    if (key === 'AND') {
      if (!val.every(function(w) { return _matchesWhere(obj, w, defs); })) return false;
      continue;
    }
    if (key === 'OR') {
      if (!val.some(function(w) { return _matchesWhere(obj, w, defs); })) return false;
      continue;
    }
    if (key === 'NOT') {
      if (_matchesWhere(obj, val, defs)) return false;
      continue;
    }
    if (key === '_collection' || key === '_uri') continue;

    // Resolve sourceKey: raw doc objects are keyed by sourceKey, not GraphQL name
    const sourceKey = (defs[key] && defs[key].sourceKey) ? defs[key].sourceKey : key;
    const fieldVal  = obj[sourceKey] !== undefined ? obj[sourceKey] : obj[key];

    if (val === null || typeof val !== 'object') {
      // Simple equality
      if (String(fieldVal) !== String(val)) return false;
      continue;
    }

    // Operator object
    for (const op in val) {
      if (!val.hasOwnProperty(op)) continue;
      const opVal = val[op];

      // For numeric operators coerce both sides to numbers so string "40" >= 100
      // does not pass due to lexicographic comparison.
      const isNumericOp = (op === 'eq' || op === 'ne' || op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte');
      const numOpVal    = isNumericOp && !isNaN(opVal)    ? Number(opVal)    : opVal;
      const fv          = isNumericOp && !isNaN(fieldVal) ? Number(fieldVal) : fieldVal;

      if (op === 'eq')  { if (!(fv == numOpVal))  return false; }
      else if (op === 'ne')  { if (!(fv != numOpVal))  return false; }
      else if (op === 'gt')  { if (!(fv >  numOpVal))  return false; }
      else if (op === 'gte') { if (!(fv >= numOpVal))  return false; }
      else if (op === 'lt')  { if (!(fv <  numOpVal))  return false; }
      else if (op === 'lte') { if (!(fv <= numOpVal))  return false; }
      else if (op === 'contains') {
        if (String(fv).toLowerCase().indexOf(String(opVal).toLowerCase()) === -1) return false;
      }
      else if (op === 'notContains') {
        if (String(fv).toLowerCase().indexOf(String(opVal).toLowerCase()) !== -1) return false;
      }
      else if (op === 'startsWith') {
        if (String(fv).toLowerCase().indexOf(String(opVal).toLowerCase()) !== 0) return false;
      }
      else if (op === 'in') {
        const arr = Array.isArray(opVal) ? opVal : [opVal];
        if (arr.indexOf(fv) === -1 && arr.map(String).indexOf(String(fv)) === -1) return false;
      }
      else if (op === 'notIn') {
        const arr = Array.isArray(opVal) ? opVal : [opVal];
        if (arr.indexOf(fv) !== -1 || arr.map(String).indexOf(String(fv)) !== -1) return false;
      }
      else if (op === 'exists') {
        const exists = fv !== undefined && fv !== null;
        if (opVal === false || opVal === 'false') { if (exists)  return false; }
        else                                      { if (!exists) return false; }
      }
    }
  }
  return true;
}

/**
 * _sortInline(items, orderByList)
 * Sorts a plain JS array using the field/direction encoded in each
 * cts.indexOrder. We extract the field name from the serialised order string
 * and sort by that field value.
 */
function _sortInline(items, orderByList) {
  if (!orderByList || !orderByList.length || items.length < 2) return items;
  // Build sort specs from the index orders: [ { key, descending } ]
  const specs = orderByList.map(function(o) {
    const quoted = xdmp.quote(o);
    // cts.indexOrder serialises as: cts.indexOrder(cts.jsonPropertyReference("field",...),["ascending"|"descending"])
    const keyMatch  = quoted.match(/[jJ]son[Pp]roperty[Rr]eference\("([^"]+)"/);
    const elemMatch = quoted.match(/[eE]lement[Rr]eference\([^,]*local-name\s*=\s*"([^"]+)"/);
    const key       = keyMatch ? keyMatch[1] : (elemMatch ? elemMatch[1] : null);
    const descending = quoted.indexOf('descending') !== -1;
    return { key, descending };
  }).filter(function(s) { return s.key; });

  if (!specs.length) return items;

  return items.slice().sort(function(a, b) {
    for (const spec of specs) {
      const av = a[spec.key];
      const bv = b[spec.key];
      if (av === bv) continue;
      if (av === undefined || av === null) return spec.descending ? -1 : 1;
      if (bv === undefined || bv === null) return spec.descending ? 1 : -1;
      const cmp = av < bv ? -1 : 1;
      return spec.descending ? -cmp : cmp;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Internal-field stripper
// ---------------------------------------------------------------------------
function _stripInternalFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Object.assign({}, obj);
  delete out.__uri;
  return out;
}

// ---------------------------------------------------------------------------
// Relay Connection envelope builder
// ---------------------------------------------------------------------------
/**
 * _buildConnectionResult(objects, plan, registry, fragmentMap)
 *
 * Wraps a page of resolved objects into the Relay Connection shape:
 * {
 *   totalCount,
 *   pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
 *   edges:    [ { cursor, node }, ... ]
 * }
 *
 * Cursor payload: { offset, uri }
 *   offset — absolute 0-based position of the node in the full result set
 *   uri    — document URI for staleness detection on subsequent pages
 *
 * The nodeSelectionSet is extracted from edges { node { ... } } so that
 * projectObject shapes each node correctly. pageInfo and totalCount fields
 * are synthesised and never passed to projectObject.
 */
function _buildConnectionResult(objects, plan, registry, fragmentMap) {
  const offset     = plan.offset || 0;
  const limit      = plan.limit  || 50;
  const totalCount = cts.estimate(plan.ctsQuery);

  // Extract the node selectionSet from edges > node in the query AST
  const nodeSelectionSet = _extractNodeSelectionSet(plan.selectionSet, fragmentMap);

  const edges = objects.map((obj, i) => {
    const absoluteOffset = offset + i;
    const cursor = encodeCursor({ offset: absoluteOffset + 1, uri: obj.__uri || null });
    const bare   = _stripInternalFields(obj);
    const node   = nodeSelectionSet
      ? projectObject(bare, nodeSelectionSet, registry, plan.typeName, fragmentMap)
      : bare;
    return { cursor, node };
  });

  const hasNextPage     = (offset + objects.length) < totalCount;
  const hasPreviousPage = offset > 0;
  const startCursor     = edges.length > 0 ? edges[0].cursor               : null;
  const endCursor       = edges.length > 0 ? edges[edges.length - 1].cursor : null;

  return {
    totalCount,
    pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
    edges,
  };
}

/**
 * _buildChildConnectionResult(items, subPlan, fkVal, registry, fragmentMap)
 *
 * Same as _buildConnectionResult but for a child relation's already-fetched
 * item array. totalCount is approximated as items.length when no before/after
 * cursor is active; with a cursor it uses the decoded total stored in the cursor.
 * For child relations, offset is the subPlan offset (default 0).
 */
function _buildChildConnectionResult(items, subPlan, registry, fragmentMap) {
  const offset     = subPlan.offset || 0;
  const nodeSelectionSet = _extractNodeSelectionSet(subPlan.selectionSet, fragmentMap);

  // hasNextPage: true when we fetched a full page (items.length === limit),
  // implying more records likely exist beyond this page.
  const pageLimit     = subPlan.limit !== undefined ? subPlan.limit : Infinity;
  const hasNextPage   = pageLimit !== Infinity && items.length >= pageLimit;
  const hasPreviousPage = offset > 0;

  const edges = items.map((obj, i) => {
    const absoluteOffset = offset + i;
    const cursor = encodeCursor({ offset: absoluteOffset + 1, uri: obj.__uri || null });
    const bare   = _stripInternalFields(obj);
    const node   = nodeSelectionSet
      ? projectObject(bare, nodeSelectionSet, registry, subPlan.relation.type, fragmentMap)
      : bare;
    return { cursor, node };
  });

  const startCursor = edges.length > 0 ? edges[0].cursor               : null;
  const endCursor   = edges.length > 0 ? edges[edges.length - 1].cursor : null;

  return {
    pageInfo: { hasNextPage, hasPreviousPage, startCursor, endCursor },
    edges,
  };
}

/**
 * _extractNodeSelectionSet(connectionSelectionSet, fragmentMap)
 * Walks edges > node inside a Connection selectionSet and returns the
 * node's selectionSet, or null if not found.
 */
function _extractNodeSelectionSet(selectionSet, fragmentMap) {
  if (!selectionSet) return null;
  for (const sel of selectionSet.selections) {
    if (sel.kind === 'Field' && sel.name === 'edges' && sel.selectionSet) {
      for (const edgeSel of sel.selectionSet.selections) {
        if (edgeSel.kind === 'Field' && edgeSel.name === 'node') {
          return edgeSel.selectionSet || null;
        }
      }
    }
    if (sel.kind === 'FragmentSpread' && fragmentMap[sel.name]) {
      const result = _extractNodeSelectionSet(fragmentMap[sel.name].selectionSet, fragmentMap);
      if (result) return result;
    }
    if (sel.kind === 'InlineFragment') {
      const result = _extractNodeSelectionSet(sel.selectionSet, fragmentMap);
      if (result) return result;
    }
  }
  return null;
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
