# Search Page — Implementation Plan

## Goal
A new Search page where users visually build MarkLogic search options from an existing analysis, persist them as named option sets, and execute searches against them.

## User Flow
1. Select a database and analysis (reuse existing analysis selector)
2. Build constraints from the analysis structure tree — each field auto-typed from `nodeKind` + `inferedTypes`
3. Configure options (constraint name, type, facet on/off)
4. Save the option set (named, per database/analysis) as JSON in MarkLogic
5. Execute searches: enter a query string, get paginated results rendered via reused `ResultCard`

## Constraint Auto-typing (XML + JSON normalized)
| `nodeKind` / `inferedTypes`         | Default constraint type  |
|-------------------------------------|--------------------------|
| `object` / `array`                  | path range               |
| `xs:integer`, `xs:decimal`, etc.    | range                    |
| `xs:date`, `xs:dateTime`            | range                    |
| `xs:boolean`                        | value                    |
| `xs:string` / default               | word                     |
| attribute nodes                     | attribute range or value |

## Options Storage
- Stored as JSON documents in MarkLogic under a dedicated collection
- Named per database/analysis
- Loadable/deletable from the page
- Page shows generated JSON for copy/export

## New Backend Pieces

### MarkLogic Resource: `/search-options`
- `GET`  — list saved option sets for a db/analysis
- `POST` — save a new option set
- `PUT`  — update an existing option set
- `DELETE` — remove an option set

### MarkLogic Resource: `/search`  (or extend existing `/query-results`)
- Accepts: `optionsId` (or inline options JSON) + query string + page + pageSize
- Calls `search:search()` with built options
- Returns same shape as `/query-results`: `{ valid, estimate, results: [{ uri, type, content, collections }] }`

### Java Spring Controller + Service
- `SearchController` — REST endpoints mirroring the ML resources above
- `SearchService` — marshals options JSON, calls ML, parses response

## Frontend Pieces

### New Page: `SearchPage.tsx`
- Analysis selector (reuse pattern from `AnalyzePage`)
- **Options Builder** panel — list of constraints derived from analysis structure
  - Field picker (tree from `getAnalysisStructure`)
  - Per-constraint: name, type selector, facet toggle
- **Saved Options** selector — load/delete named sets
- **JSON Preview** panel — live-generated options JSON (collapsible)
- **Search bar** — query string input + Execute button
- **Results** — reuse `ResultCard` from `QueryPanel`
- Pagination (reuse pattern from `QueryPanel`)

### New API calls in `services/api.ts`
- `listSearchOptions(db, analysisId)`
- `saveSearchOptions(db, analysisId, name, options)`
- `deleteSearchOptions(id)`
- `executeSearch(db, optionsId, query, page, pageSize)`

### New Types in `types/index.ts`
- `SearchConstraint` — name, type, fieldPath, nodeKind, namespace, facet
- `SearchOptions` — id, name, database, analysisId, constraints, createdAt
- `SearchResult` — same shape as `QueryResult` (reuse or alias)

## Out of Scope (for now)
- Grammar / operator definitions
- Snippet configuration UI
- Schema export integration
