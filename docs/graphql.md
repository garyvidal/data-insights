# GraphQL Engine for MarkLogic

A server-side GraphQL query engine implemented as a MarkLogic REST resource extension. Translates GraphQL queries into native CTS queries and executes them against MarkLogic collections.

---

## Architecture

```
Client  →  POST /v1/resources/graphql
              ↓
         ext/graphql.sjs          (entry point / routing)
              ↓
         lib/graphql/parser.sjs   (GraphQL tokenizer + AST parser)
              ↓
         lib/graphql/planner.sjs  (AST → CTS query plan)
              ↓
         lib/graphql/executor.sjs (execute plan, shape response)
              ↓
         lib/graphql/normalizer.sjs (XML/JSON → plain JS object)
              ↓
         lib/graphql/schema.sjs   (schema registry + derivation)
```

**Query flow:**
1. Parse the GraphQL document into an AST
2. Load the schema registry (cached in server fields)
3. Plan: translate each root field + arguments into a `cts.search()` plan with sub-plans for related/embedded types
4. Execute: run CTS searches, normalise documents, resolve relations, project fields
5. Return a standard `{ data, errors }` JSON envelope

---

## Endpoint Reference

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/resources/graphql` | Execute a GraphQL query |
| `POST` | `/v1/resources/graphql` (body: `action=derive`) | Derive a schema from an analysis document |
| `POST` | `/v1/resources/graphql` (body: `action=saveRelations`) | Persist relation definitions into a schema |
| `POST` | `/v1/resources/graphql` (body: `action=explain`) | Return the query plan without executing |
| `GET`  | `/v1/resources/graphql?rs:action=schema` | List all registered schemas |
| `GET`  | `/v1/resources/graphql?rs:action=schema&rs:type=Order` | Return schema for one type |
| `GET`  | `/v1/resources/graphql?rs:action=introspect` | Return full introspection `__schema` |
| `DELETE` | `/v1/resources/graphql?rs:type=Order` | Delete schema for a type |

### POST request body

```json
{
  "query":         "{ orders(where:{ status:\"shipped\" }) { id status amount } }",
  "variables":     { "myVar": "value" },
  "operationName": "MyOperation",
  "db":            "northwind-content"
}
```

- `query` — GraphQL query string (required)
- `variables` — variable map for `$variable` references (optional)
- `operationName` — selects one operation when the document has multiple (optional)
- `db` — target content database name; plan + execution run in this DB context (optional; omit to use the current app-server database)

---

## Schema System

### Schema document locations

| Collection | URI pattern | Purpose |
|------------|-------------|---------|
| `graphql-schema` | `/graphql/schema/{TypeName}.json` | Hand-authored / promoted schemas (authoritative) |
| `graphql-derive` | `/graphql/derive/{TypeName}.json` | Auto-derived hint docs (overwritten on re-derive) |

Hand-authored schemas always take precedence over derived hints. Relations saved via `saveRelations` are written to `/graphql/schema/` so they survive re-derivation.

### Schema document format

```json
{
  "type":       "Order",
  "collection": "orders",
  "format":     "json",
  "namespaces": { "o": "https://example.com/orders" },
  "fields": {
    "id":          { "type": "ID",          "sourceKey": "id",          "index": "value" },
    "status":      { "type": "String",      "sourceKey": "status",      "index": "value" },
    "amount":      { "type": "Float",       "sourceKey": "amount",      "index": "range" },
    "orderDate":   { "type": "String",      "sourceKey": "orderDate",   "index": "range" },
    "orderDetails":{ "type": "[OrderDetail]","sourceKey": "orderDetail", "embedded": true }
  },
  "relations": {
    "customer": { "type": "Customer", "via": "customerId", "foreignKey": "id" }
  }
}
```

**Field definition properties:**

| Property | Values | Description |
|----------|--------|-------------|
| `type` | `String`, `Int`, `Float`, `Boolean`, `ID`, `[TypeName]`, `TypeName` | GraphQL scalar or object type |
| `sourceKey` | string | Key in the normalised document object (defaults to field name) |
| `index` | `"value"`, `"range"`, `null` | MarkLogic index type used for CTS queries |
| `namespace` | URI string | XML element namespace (XML schemas only) |
| `embedded` | `true` | Marks a field as an inline embedded sub-object (resolved from the same document, not a secondary search) |

### Schema derivation

The engine can auto-derive a schema from the output of the `analyze-documents.xqy` task:

```json
POST /v1/resources/graphql
{
  "action":      "derive",
  "type":        "Order",
  "collection":  "orders",
  "analysisUri": "/analysis/results/abc123.xml",
  "format":      "json"
}
```

Derived schemas detect:
- Field names and inferred GraphQL types from MarkLogic type inference
- Nested object/array structures (set `embedded: true` automatically)
- XML namespaces
- Appropriate index hints (`value` for strings, `range` for numbers/dates)

---

## Query Language

### Basic query

```graphql
{
  orders {
    id
    status
    amount
  }
}
```

### Filtering with `where`

```graphql
{
  orders(where: { status: "shipped", amount: { gte: 100 } }) {
    id
    status
    amount
  }
}
```

**Supported operators:**

| Syntax | Behaviour |
|--------|-----------|
| `field: "value"` | Equality |
| `field: { eq: "value" }` | Equality (explicit) |
| `field: { ne: "value" }` | Not equal |
| `field: { gt: 100 }` | Greater than |
| `field: { gte: 100 }` | Greater than or equal |
| `field: { lt: 100 }` | Less than |
| `field: { lte: 100 }` | Less than or equal |
| `field: { contains: "foo" }` | Word/substring match |
| `field: { notContains: "foo" }` | Negated word match |
| `field: { startsWith: "foo" }` | Prefix match (wildcarded) |
| `field: { in: ["a","b"] }` | Value in list |
| `field: { notIn: ["a","b"] }` | Value not in list |
| `field: { exists: true }` | Field is present |
| `field: { exists: false }` | Field is absent |
| `AND: [ {...}, {...} ]` | All conditions must match |
| `OR:  [ {...}, {...} ]` | Any condition must match |
| `NOT: { ... }` | Negates the inner condition |
| `_collection: "name"` | Override the collection constraint (root only) |
| `_uri: { startsWith: "/orders/" }` | Directory-scoped search (root only) |

### Sorting with `orderBy`

```graphql
{
  orders(orderBy: { field: "orderDate", dir: "desc" }) {
    id
    orderDate
  }
}
```

Sorting requires a MarkLogic range index on the field. If no index exists, the engine returns the results unsorted and includes a warning in the explain plan with remediation instructions (namespace, collation, and index type needed).

### Pagination

**Offset-based (legacy):**
```graphql
{
  orders(limit: 25, offset: 50) {
    id
    status
  }
}
```

**Relay Cursor Connection (recommended):**

Automatically activated when the selection set contains `edges`, `pageInfo`, or `totalCount`.

```graphql
# First page
{
  orders(first: 10, orderBy: { field: "orderDate", dir: "desc" }) {
    totalCount
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
    edges {
      cursor
      node {
        id
        status
        orderDate
      }
    }
  }
}
```

```graphql
# Next page — pass endCursor from the previous response as after:
{
  orders(first: 10, after: "eyJvZmZzZXQiOjEwLCJ1cmkiOiIvb3JkZXJzLzEwIn0=") {
    pageInfo { hasNextPage endCursor }
    edges {
      cursor
      node { id status orderDate }
    }
  }
}
```

**Pagination arguments:**

| Argument | Description |
|----------|-------------|
| `first: N` | Return the first N results (Connection-style) |
| `last: N` | Return the last N results (alias for `first` in offset pagination) |
| `after: $cursor` | Start after this cursor (decoded to an absolute offset) |
| `before: $cursor` | End before this cursor |
| `limit: N` | Legacy page size |
| `offset: N` | Legacy skip count |

`first`/`after` take precedence over `limit`/`offset` when both are supplied.

**Cursor format:** opaque base64-encoded JSON `{ offset, uri }`. The `uri` is the last document URI seen on the page; it is used to detect stale cursors.

---

## Relations

Relations define how types join to each other. They are stored in the schema under the `relations` key.

```json
"relations": {
  "customer": { "type": "Customer", "via": "customerId", "foreignKey": "id" }
}
```

| Property | Description |
|----------|-------------|
| `type` | The related GraphQL type name |
| `via` | The FK field on the **parent** document |
| `foreignKey` | The matching field on the **child** document |

Relations are resolved as a **batched secondary search**: all parent FK values are collected, then a single `cts.search()` with an OR clause fetches all related documents in one round trip (avoids N+1 queries).

### Child-level arguments

Relations and embedded fields support the same `where`, `orderBy`, `first`, `last`, `after`, `before`, `limit`, `offset` arguments as root fields:

```graphql
{
  orders {
    id
    orderDetails(where: { lineTotal: { gte: 100 } }, orderBy: { field: "lineTotal", dir: "desc" }) {
      productId
      qty
      lineTotal
    }
    customer(where: { country: "USA" }) {
      name
      country
    }
  }
}
```

---

## Embedded (Inline) Fields

Fields marked `embedded: true` (or whose type resolves to a registered nested type) are resolved from the **same parent document** — no secondary search. They support in-memory `where` filtering, `orderBy` sorting, and `limit`/`offset` pagination.

```graphql
{
  orders {
    id
    orderDetails(where: { lineTotal: { gte: 50 } }, first: 5) {
      productId
      qty
      lineTotal
    }
  }
}
```

Inline filtering is pure JavaScript (no CTS index required), so any field can be filtered regardless of whether it has a MarkLogic range index.

---

## Relay Connection on Embedded Fields

Embedded fields also support Relay Connection pagination:

```graphql
{
  orders {
    id
    orderDetails(first: 3) {
      pageInfo { hasNextPage endCursor }
      edges {
        cursor
        node { productId qty lineTotal }
      }
    }
  }
}
```

---

## Introspection

The engine supports GraphQL introspection:

```graphql
{ __schema { types { name kind } } }
{ __type(name: "Order") { fields { name type { name } } } }
```

Or via the GET endpoint:
```
GET /v1/resources/graphql?rs:action=introspect
```

---

## Explain Plan

Send `action: "explain"` alongside any query to see the compiled plan without executing it:

```json
POST /v1/resources/graphql
{
  "action": "explain",
  "query":  "{ orders(where:{status:\"shipped\"}) { id customer { name } } }",
  "db":     "northwind-content"
}
```

Response includes:
- `plans[]` — one entry per root field:
  - `typeName`, `collection`, `format`
  - `ctsQuery` — the compiled CTS query string
  - `orderBy[]` — compiled index order expressions
  - `orderByWarnings[]` — missing index warnings with namespace, collation, and remediation guidance
  - `limit`, `offset`, `connection`
  - `subPlans{}` — per-relation/embedded-field plan details including validation warnings
- `schema{}` — summary of all registered types

### Sub-plan validation warnings

If a relation is misconfigured, the explain plan surfaces actionable warnings:
- Related type not registered in the schema
- Missing `via` or `foreignKey` properties
- Child type has no collection (search will scan all documents)
- `foreignKey` value not found in child type's field definitions

---

## Database Context

When the content data lives in a different MarkLogic database than the app server (the common production pattern), pass `db` in the request body. The planner **and** executor both run inside `xdmp.invokeFunction({ database: xdmp.database(db) })` so that:

- `cts.*Reference` index validation happens against the correct database
- `cts.search()` queries execute against the correct database
- Sorting and range index lookups resolve correctly

Schema documents (`/graphql/schema/`, `/graphql/derive/`) always live in the app-server database (data-insights), not the content database.

---

## XML Support

The engine handles both JSON and XML MarkLogic documents. XML documents are normalised by `normalizer.sjs` using `fn.localName()` as object keys (namespace-agnostic). Namespace-aware CTS queries use `cts.elementValueQuery` and `cts.elementRangeQuery` with explicit QNames built from the `namespaces` map in the schema.

For XML schemas, include a `namespaces` map and ensure each field definition carries the `namespace` URI:

```json
{
  "type":       "Customer",
  "collection": "customers",
  "format":     "xml",
  "namespaces": { "c": "https://northwind.com/customers" },
  "fields": {
    "customerId": { "type": "ID",     "sourceKey": "CustomerID", "index": "value",  "namespace": "https://northwind.com/customers" },
    "companyName":{ "type": "String", "sourceKey": "CompanyName","index": "value",  "namespace": "https://northwind.com/customers" }
  }
}
```

---

## Caching

The schema registry is cached in a MarkLogic server field (`graphql-registry-v2`). The cache is invalidated automatically after:
- Schema derivation (`action=derive`)
- Relation save (`action=saveRelations`)
- Schema deletion (`DELETE`)

To manually bust the cache, call any of the above actions or restart the app server.

---

## Limitations

- **Query-only** — mutations and subscriptions are not supported
- **Sorting requires a range index** — fields without a range index will be returned in natural cts.search() score order; a warning is included in the explain plan
- **Inline where-filtering is post-retrieval** — for embedded fields, all items are loaded from the document before in-memory filtering, so it is less efficient than a root-level CTS predicate on large embedded arrays
- **No variables in `where` object keys** — variable substitution is supported for argument values but not for field names inside `where` clauses
