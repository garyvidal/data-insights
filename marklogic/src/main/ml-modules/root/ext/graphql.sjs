'use strict';
/**
 * ext/graphql.sjs
 * MarkLogic REST extension — entry point for the GraphQL engine.
 *
 * Registration (run once via Management API or ml-gradle):
 *   PUT /v1/config/resources/graphql
 *   Content-Type: application/vnd.marklogic-javascript
 *   Body: this file
 *
 * Endpoint:   POST /v1/resources/graphql
 * Content-Type: application/json
 *
 * Request body:
 * {
 *   "query":         "{ orders(where:{ status:\"shipped\" }) { id status amount } }",
 *   "variables":     { "myVar": "value" },
 *   "operationName": "MyOperation"    // optional, selects which operation to run
 * }
 *
 * Response: standard GraphQL JSON envelope
 * {
 *   "data":   { ... },
 *   "errors": [ { "message": "..." } ]   // omitted when empty
 * }
 *
 * Introspection:
 *   POST /v1/resources/graphql
 *   { "query": "{ __schema { types { name kind } } }" }
 *
 * Schema derivation trigger (GET):
 *   GET /v1/resources/graphql?rs:action=derive&rs:collection=orders&rs:type=Order&rs:analysisUri=/analysis/results/123.xml
 *   Generates /graphql/derive/Order.json and returns the derived schema.
 *
 * Schema registration (GET):
 *   GET /v1/resources/graphql?rs:action=schema&rs:type=Order
 *   Returns the stored schema for a type (or all types if rs:type is omitted).
 */

const { parse }          = require('/lib/graphql/parser.sjs');
const { loadRegistry, deriveFromAnalysis, invalidateRegistryCache } = require('/lib/graphql/schema.sjs');
const { plan }           = require('/lib/graphql/planner.sjs');
const { execute }        = require('/lib/graphql/executor.sjs');

// ---------------------------------------------------------------------------
// Declare the extension
// ---------------------------------------------------------------------------
var exports = module.exports = {};

// ---------------------------------------------------------------------------
// POST  — execute a GraphQL query
// ---------------------------------------------------------------------------
exports.POST = function(context, params, input) {
  context.outputTypes = ['application/json'];
  xdmp.log("[graphql]============================","info");
  let body;
  try {
    body = fn.head(xdmp.fromJSON(input));
  } catch (e) {
    return _error(context, 400, 'Invalid JSON request body: ' + e.message);
  }

  // ── action=saveRelations : persist relations into the authoritative schema doc ──
  if (body.action === 'saveRelations') {
    const typeName  = body.type;
    const relations = body.relations;

    if (!typeName || !relations) {
      return _error(context, 400, 'saveRelations requires type and relations');
    }

    // Write to /graphql/schema/ (authoritative, survives re-derives) rather than
    // /graphql/derive/ which is overwritten every time Generate is clicked.
    const schemaUri = '/graphql/schema/' + typeName + '.json';
    const deriveUri = '/graphql/derive/' + typeName + '.json';
    try {
      xdmp.invokeFunction(function() {
        // Prefer an existing schema doc; fall back to the derive hint so all
        // fields are preserved when promoting a derived type to a stored schema.
        const existingSchema = cts.doc(schemaUri);
        const existingDerive = cts.doc(deriveUri);
        let doc = existingSchema
          ? existingSchema.toObject()
          : (existingDerive ? existingDerive.toObject() : { type: typeName, fields: {}, relations: {} });
        doc.relations = relations;
        xdmp.documentInsert(schemaUri, doc, { collections: ['graphql-schema'] });
      }, { update: 'true' });
      invalidateRegistryCache();
      return xdmp.toJSON({ saved: true, type: typeName, uri: schemaUri });
    } catch (e) {
      xdmp.log('[graphql] saveRelations error: ' + (e.stack || e.message), 'error');
      return _error(context, 500, e.message);
    }
  }

  // ── action=derive : generate schema from analysis output (needs write access) ──
  if (body.action === 'derive') {
    const typeName    = body.type;
    const collection  = body.collection;
    const analysisUri = body.analysisUri;
    const format      = body.format || 'json';
    const deriveDb    = body.db || null;

    if (!typeName || !collection || !analysisUri) {
      return _error(context, 400, 'derive requires type, collection, analysisUri');
    }

    try {
      // Analysis doc lives in the app server's own DB (data-insights) — no DB switch needed
      const analysisDoc = cts.doc(analysisUri);
      if (!analysisDoc) {
        return _error(context, 404, `Analysis document not found: ${analysisUri}`);
      }

      let derived;
      try {
        derived = deriveFromAnalysis(analysisDoc, { typeName, collection, format });
      } catch (e) {
        xdmp.log('[graphql] deriveFromAnalysis error: ' + e.message, 'error');
        return _error(context, 500, 'Derivation error: ' + e.message);
      }

      // Write the full derived schema as the hint doc — self-contained, no analysis re-read at query time.
      // Preserve any relations already saved to the authoritative schema doc so that
      // clicking Generate again does not wipe out user-defined relations.
      const hintUri   = '/graphql/derive/' + typeName + '.json';
      const schemaUri = '/graphql/schema/' + typeName + '.json';
      const existingRelations = (function() {
        const s = cts.doc(schemaUri);
        if (s) { const o = s.toObject(); return (o && o.relations) ? o.relations : {}; }
        const h = cts.doc(hintUri);
        if (h) { const o = h.toObject(); return (o && o.relations) ? o.relations : {}; }
        return {};
      }());
      const hintDoc = Object.assign({}, derived, { db: deriveDb, relations: existingRelations });
      xdmp.invokeFunction(function() {
        xdmp.documentInsert(hintUri, hintDoc, { collections: ['graphql-derive'] });
      }, { update: 'true' });

      invalidateRegistryCache();
      return xdmp.toJSON({ derived, savedAt: hintUri });
    } catch (e) {
      xdmp.log('[graphql] derive error: ' + (e.stack || e.message), 'error');
      return _error(context, 500, e.message);
    }
  }

  const queryStr      = body.query;
  const variables     = body.variables || {};
  const operationName = body.operationName || null;

  xdmp.log('[graphql] POST query received operationName=' + operationName, 'fine');

  if (!queryStr) {
    return _error(context, 400, 'Missing required field: query');
  }

  // Reject queries that are blank after stripping comments and whitespace —
  // the parser throws a misleading "undefined" token error in that case.
  const strippedQuery = queryStr.replace(/#[^\n]*/g, '').trim();
  if (!strippedQuery) {
    return _gqlError('Query is empty — please enter a GraphQL query');
  }

  // ── Parse ──
  let document;
  try {
    document = parse(queryStr);
  } catch (e) {
    return _gqlError('Parse error: ' + e.message);
  }

  // ── Select operation ──
  let operationDef;
  try {
    operationDef = _selectOperation(document, operationName);
  } catch (e) {
    return _gqlError(e.message);
  }

  // Query-only: reject mutations and subscriptions
  if (operationDef.operation !== 'query') {
    return _gqlError(`Operation type "${operationDef.operation}" is not supported. This engine is query-only.`);
  }

  const db = body.db || null;

  // ── action=explain : return plan without executing ──
  if (body.action === 'explain') {
    let registry, plans;
    try { registry = loadRegistry(); } catch (e) { return _gqlError('Schema load error: ' + e.message); }
    // Plan must run in the content DB so cts.*Reference calls validate against
    // the correct range indexes — same db-switch logic as the execute path.
    try {
      if (db) {
        plans = fn.head(xdmp.invokeFunction(function() {
          return plan(operationDef, registry, variables);
        }, { database: xdmp.database(db) }));
      } else {
        plans = plan(operationDef, registry, variables);
      }
    } catch (e) { return _gqlError('Planning error: ' + e.message); }
    const planInfos = plans.map(function(p) {
      const subPlanInfo = {};
      for (const k of Object.keys(p.subPlans || {})) {
        const v = p.subPlans[k];
        subPlanInfo[k] = {
          inline:          v.inline || false,
          sourceKey:       v.sourceKey || null,
          type:            v.relation ? v.relation.type : null,
          via:             v.relation ? v.relation.via : null,
          foreignKey:      v.relation ? v.relation.foreignKey : null,
          connection:      v.connection || false,
          limit:           v.limit !== undefined ? v.limit : null,
          offset:          v.offset !== undefined ? v.offset : null,
          ctsQuery:        v.ctsQuery ? xdmp.quote(v.ctsQuery) : null,
          orderBy:         (v.orderBy || []).map(function(o) { return xdmp.quote(o); }),
          orderByWarnings: v.orderByWarnings || [],
          warnings:        v.warnings || [],
        };
      }
      return {
        field:           p.fieldAlias,
        typeName:        p.typeName,
        collection:      p.collection,
        format:          p.format,
        connection:      p.connection || false,
        limit:           p.limit,
        offset:          p.offset,
        ctsQuery:        xdmp.quote(p.ctsQuery),
        orderBy:         (p.orderBy || []).map(function(o) { return xdmp.quote(o); }),
        orderByWarnings: p.orderByWarnings || [],
        subPlans:        subPlanInfo,
      };
    });
    const schemaInfo = {};
    for (const name of Object.keys(registry.types)) {
      const def = registry.types[name];
      schemaInfo[name] = {
        collection: def.collection,
        format:     def.format,
        fieldCount: Object.keys(def.fields || {}).length,
        derived:    def.derived || false,
      };
    }
    return xdmp.toJSON({ plans: planInfos, schema: schemaInfo });
  }
  xdmp.log('[graphql] target db: ' + (db || '(default)'), 'fine');

  // ── Load schema (always in current DB — where schema/derive hints live) ──
  let registry;
  try {
    registry = loadRegistry();
  } catch (e) {
    return _gqlError('Schema load error: ' + e.message);
  }

  // ── Plan + Execute — both run in the content DB when db is supplied ──
  // cts.*Reference calls in the planner validate against range indexes, so
  // planning must happen in the same DB context as execution.
  try {
    if (db) {
      xdmp.log('[graphql] planning + executing against content db: ' + db, 'info');
      return xdmp.invokeFunction(function() {
        const plans = plan(operationDef, registry, variables);
        xdmp.log('[graphql] planning produced ' + plans.length + ' plan(s)', 'fine');
        const response = execute(plans, registry, document);
        xdmp.log('[graphql] db execution complete. errors: ' + (response.errors ? response.errors.length : 0), 'fine');
        return xdmp.toJSON(response);
      }, { database: xdmp.database(db) });
    } else {
      const plans = plan(operationDef, registry, variables);
      xdmp.log('[graphql] planning produced ' + plans.length + ' plan(s)', 'fine');
      const response = execute(plans, registry, document);
      xdmp.log('[graphql] execution complete. errors: ' + (response.errors ? response.errors.length : 0), 'fine');
      return xdmp.toJSON(response);
    }
  } catch (e) {
    xdmp.log('[graphql] execution error: ' + e.message, 'error');
    return _gqlError(e.message);
  }
};

// ---------------------------------------------------------------------------
// DELETE  — remove a schema type by name
// ---------------------------------------------------------------------------
exports.DELETE = function(context, params) {
  context.outputTypes = ['application/json'];
  const typeName = params['type'] || null;
  if (!typeName) {
    return _error(context, 400, 'DELETE requires rs:type param');
  }
  const hintUri   = '/graphql/derive/' + typeName + '.json';
  const schemaUri = '/graphql/schema/' + typeName + '.json';
  try {
    xdmp.invokeFunction(function() {
      if (fn.docAvailable(hintUri))   { xdmp.documentDelete(hintUri); }
      if (fn.docAvailable(schemaUri)) { xdmp.documentDelete(schemaUri); }
    }, { update: 'true' });
    invalidateRegistryCache();
    return xdmp.toJSON({ deleted: true, type: typeName });
  } catch (e) {
    xdmp.log('[graphql] DELETE error: ' + (e.stack || e.message), 'error');
    return _error(context, 500, e.message);
  }
};

// ---------------------------------------------------------------------------
// GET  — utility actions (schema inspection, derivation trigger)
// ---------------------------------------------------------------------------
exports.GET = function(context, params) {
  context.outputTypes = ['application/json'];

  const action = params['action'] || 'schema';

  // ── action=schema : return stored schema(s) ──
  if (action === 'schema') {
    const typeName = params['type'] || null;
    const registry = loadRegistry();

    if (typeName) {
      const typeDef = registry.types[typeName];
      if (!typeDef) {
        return _error(context, 404, `No schema found for type: ${typeName}`);
      }
      return xdmp.toJSON(typeDef);
    }
    // Return all types summary
    const summary = {};
    for (const [name, def] of Object.entries(registry.types)) {
      summary[name] = { collection: def.collection, format: def.format, fieldCount: Object.keys(def.fields || {}).length };
    }
    return xdmp.toJSON({ types: summary });
  }

  // ── action=introspect : return full introspection schema ──
  if (action === 'introspect') {
    const { buildIntrospectionSchema } = require('/lib/graphql/schema.sjs');
    const registry = loadRegistry();
    return xdmp.toJSON({ __schema: buildIntrospectionSchema(registry) });
  }

  return _error(context, 400, `Unknown action: ${action}. Valid actions: schema, derive, introspect`);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * _selectOperation(document, operationName)
 * Returns the OperationDefinition to execute.
 * Throws if ambiguous or not found.
 */
function _selectOperation(document, operationName) {
  const ops = document.definitions.filter(d => d.kind === 'OperationDefinition');

  if (ops.length === 0) {
    throw new Error('No operation found in document');
  }
  if (operationName) {
    const found = ops.find(o => o.name === operationName);
    if (!found) throw new Error(`Operation "${operationName}" not found in document`);
    return found;
  }
  if (ops.length > 1) {
    throw new Error('Multiple operations in document — provide operationName to disambiguate');
  }
  return ops[0];
}

/**
 * _gqlError(message)
 * Return a GraphQL-spec error response (200 OK with errors array).
 */
function _gqlError(message) {
  return xdmp.toJSON({ data: null, errors: [{ message }] });
}

/**
 * _error(context, status, message)
 * Return an HTTP error response.
 */
function _error(context, status, message) {
  context.outputStatus = [status, message];
  return xdmp.toJSON({ error: message });
}
