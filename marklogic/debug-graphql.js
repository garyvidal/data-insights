'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// GraphQL Debug Script
// Paste into QConsole (http://localhost:8000/qconsole)
// Language: JavaScript  |  Database: data-insights  |  Server: data-insights
// Run each SECTION independently by selecting it and clicking Run.
// ─────────────────────────────────────────────────────────────────────────────

// ── CONFIG — edit these ───────────────────────────────────────────────────────
const CONTENT_DB  = 'insight-content';    // DB where the actual documents live
const TYPE_NAME   = 'Airport';            // GraphQL type you derived
const QUERY_STR   = '{ airports(limit: 3) { id } }';
// ─────────────────────────────────────────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Verify app server DB context
// ═══════════════════════════════════════════════════════════════════════════════
xdmp.databaseName(xdmp.database());
// Expected: "data-insights"


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Check derive hint exists
// ═══════════════════════════════════════════════════════════════════════════════
const hintUri = '/graphql/derive/' + TYPE_NAME + '.json';
const hint    = cts.doc(hintUri);
hint ? hint.toObject() : 'NOT FOUND — run Derive Schema in the UI first';


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Check analysis doc is readable
// ═══════════════════════════════════════════════════════════════════════════════
const h = cts.doc('/graphql/derive/' + TYPE_NAME + '.json').toObject();
const analysisDoc = cts.doc(h.analysisUri);
({
  analysisUri:  h.analysisUri,
  hintDb:       h.db,
  found:        !!analysisDoc,
  rootElement:  analysisDoc ? fn.string(analysisDoc.xpath('//*[fn:local-name(.)="root-element"]')[Symbol.iterator]().next().value || '') : null
});


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Load registry and check queryFields
// ═══════════════════════════════════════════════════════════════════════════════
const { loadRegistry } = require('/lib/graphql/schema.sjs');
const registry = loadRegistry();
({
  typeNames:   Object.keys(registry.types),
  queryFields: Object.keys(registry.queryFields)
});
// Expected: typeNames includes TYPE_NAME, queryFields includes "airports" / "airport"


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Parse query and build plan
// ═══════════════════════════════════════════════════════════════════════════════
const { parse }  = require('/lib/graphql/parser.sjs');
const { plan }   = require('/lib/graphql/planner.sjs');
const { loadRegistry: lr } = require('/lib/graphql/schema.sjs');

const reg   = lr();
const doc   = parse(QUERY_STR);
const op    = doc.definitions.find(d => d.kind === 'OperationDefinition');
const plans = plan(op, reg, {});

plans.map(p => ({
  fieldAlias:  p.fieldAlias,
  typeName:    p.typeName,
  collection:  p.collection,
  format:      p.format,
  limit:       p.limit,
  error:       p.error || null,
  ctsQuery:    p.error ? null : xdmp.quote(p.ctsQuery)
}));
// If error: "Unknown query field: airports" → queryFields mismatch — check SECTION 4
// If collection is null → hint doc missing collection field


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — Verify content DB has documents
// ═══════════════════════════════════════════════════════════════════════════════
xdmp.invokeFunction(function() {
  const h2         = cts.doc('/graphql/derive/' + TYPE_NAME + '.json').toObject();
  const collection = h2.collection;
  return xdmp.toJSON({
    dbName:      xdmp.databaseName(xdmp.database()),
    totalDocs:   cts.estimate(cts.trueQuery()),
    collections: [...cts.collections()].slice(0, 20),
    collectionCount: collection ? cts.estimate(cts.collectionQuery(collection)) : 'no collection on hint'
  });
}, { database: xdmp.database(CONTENT_DB) });
// Expected: dbName="insight-content", collectionCount > 0


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — Full end-to-end execute in content DB
// ═══════════════════════════════════════════════════════════════════════════════
const { parse: p2 }       = require('/lib/graphql/parser.sjs');
const { plan: pl2 }       = require('/lib/graphql/planner.sjs');
const { execute }         = require('/lib/graphql/executor.sjs');
const { loadRegistry: lr2 } = require('/lib/graphql/schema.sjs');

const reg2   = lr2();
const doc2   = p2(QUERY_STR);
const op2    = doc2.definitions.find(d => d.kind === 'OperationDefinition');
const plans2 = pl2(op2, reg2, {});

xdmp.invokeFunction(function() {
  return xdmp.toJSON(execute(plans2, reg2, doc2, {}));
}, { database: xdmp.database(CONTENT_DB) });
// Expected: { data: { airports: [ {...}, {...}, {...} ] } }
// If data.airports = [] → documents exist but collection name doesn't match
// If errors array    → check error message for field/type issues
