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
const { loadRegistry, deriveFromAnalysis } = require('/lib/graphql/schema.sjs');
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

      // Write the full derived schema as the hint doc — self-contained, no analysis re-read at query time
      const hintUri = '/graphql/derive/' + typeName + '.json';
      const hintDoc = Object.assign({}, derived, { db: deriveDb });
      xdmp.invokeFunction(function() {
        xdmp.documentInsert(hintUri, hintDoc, { collections: ['graphql-derive'] });
      }, { update: 'true' });

      return xdmp.toJSON({ derived, savedAt: hintUri });
    } catch (e) {
      xdmp.log('[graphql] derive error: ' + (e.stack || e.message), 'error');
      return _error(context, 500, e.message);
    }
  }

  const queryStr      = body.query;
  const variables     = body.variables || {};
  const operationName = body.operationName || null;

  xdmp.log('[graphql] POST query received: "' + (queryStr || '').substring(0, 200) + '" operationName=' + operationName, 'debug');

  if (!queryStr) {
    return _error(context, 400, 'Missing required field: query');
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
  xdmp.log('[graphql] target db: ' + (db || '(default)'), 'info');

  // ── Load schema (always in current DB — where schema/derive hints live) ──
  let registry;
  try {
    registry = loadRegistry();
  } catch (e) {
    return _gqlError('Schema load error: ' + e.message);
  }

  // ── Plan (pure AST + registry, no DB access) ──
  let plans;
  try {
    plans = plan(operationDef, registry, variables);
    xdmp.log('[graphql] planning produced ' + plans.length + ' plan(s)', 'info');
  } catch (e) {
    xdmp.log('[graphql] planning error: ' + e.message, 'error');
    return _gqlError('Planning error: ' + e.message);
  }

  // ── Execute (cts.search runs in content DB if db param supplied) ──
  try {
    if (db) {
      xdmp.log('[graphql] executing against content db: ' + db, 'info');
      return xdmp.invokeFunction(function() {
        const response = execute(plans, registry, document, variables);
        xdmp.log('[graphql] db execution complete. data keys: ' + JSON.stringify(Object.keys(response.data || {})) + ' errors: ' + (response.errors ? response.errors.length : 0), 'info');
        return xdmp.toJSON(response);
      }, { database: xdmp.database(db) });
    } else {
      const response = execute(plans, registry, document, variables);
      xdmp.log('[graphql] execution complete. data keys: ' + JSON.stringify(Object.keys(response.data || {})) + ' errors: ' + (response.errors ? response.errors.length : 0), 'info');
      return xdmp.toJSON(response);
    }
  } catch (e) {
    xdmp.log('[graphql] execution error: ' + e.message, 'error');
    return _gqlError(e.message);
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
