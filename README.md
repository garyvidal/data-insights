# Data Insights

A full-stack document analysis platform for exploring and profiling JSON and XML documents stored in MarkLogic. It provides structural analysis, element frequency statistics, schema generation and validation, interactive query execution, GraphQL querying with Relay-style pagination, and document upload — all through a modern React UI with full dark mode support.

## Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────┐        ┌────────────────────────────┐
│      React Frontend         │        │    Spring Boot Backend        │        │        MarkLogic           │
│  (TypeScript / Vite)        │ <----> │         (Java 23)            │ <----> │   (XQuery Services)        │
│       Port: 5175            │        │         Port: 8080            │        │       Port: 9090           │
└─────────────────────────────┘        └──────────────────────────────┘        └────────────────────────────┘
```

The backend acts as a broker, translating REST API calls from the frontend into MarkLogic REST service invocations, parsing XML responses, and returning JSON to the UI. Spring Boot also serves the compiled React app from `classpath:/static/`, with all non-API routes forwarded to `index.html` for React Router.

## Features

- **Database Statistics** — Document counts broken down by type (XML, JSON, binary, text)
- **Root Element Distribution** — Visualize distinct root elements across the database
- **Document Analysis** — Deep structural profiling of element/attribute hierarchies, inferred data types, value distributions, XPath expressions, document size stats, and namespace mappings
- **Interactive Query Panel** — Write and execute XQuery/XPath expressions directly against the database with validate, execute, pagination, pretty-print, and saved expressions
- **GraphQL Explorer** — Interactive GraphQL IDE with syntax highlighting, schema-aware autocomplete (cm6-graphql), query explain, and example query generation; backed by a MarkLogic-native GraphQL engine that translates queries into `cts.search()` calls
- **GraphQL Relay Pagination** — Full Relay-style connection pagination (`first`/`after`/`before`, opaque base64 cursors, `pageInfo`, `totalCount`) on root and relation fields
- **GraphQL Schema Management** — Derive schemas from document analyses, view/edit relation definitions inline, delete individual types, and invalidate server-side registry cache on mutation
- **GraphQL Query Explain** — Inspect the CTS query plan generated for any GraphQL query without executing it
- **Schema Generation** — Generate TDE or JSON schemas from analysis results
- **Schema Validation** — Validate documents against a generated schema and view coverage metrics
- **Schema Viewer** — Inspect the full content of any generated schema inline
- **Schema Coverage** — Measure how well documents conform to known schemas
- **File Upload Wizard** — 4-step wizard to upload JSON, XML, CSV, Excel, or ZIP files into MarkLogic with configurable URI prefix, collection, and document permissions
- **Async Analysis Jobs** — Long-running analyses run as background tasks with live SSE progress notifications
- **Authentication** — Login-protected access with session-aware routing
- **Dark Mode** — Full light/dark theme support across all pages and components

## Tech Stack

| Layer        | Technology                  | Version          |
| ------------ | --------------------------- | ---------------- |
| Frontend     | React + TypeScript          | 18.3.1 / 5.6.3   |
| Build        | Vite                        | 5.4.9            |
| Styling      | Tailwind CSS                | 3.4.14           |
| Icons        | Lucide React                | latest           |
| Code Editor  | CodeMirror 6                | latest           |
| GraphQL IDE  | cm6-graphql                 | latest           |
| GraphQL      | graphql-js                  | 16.x             |
| Charts       | Recharts                    | 2.13.0           |
| Data Grids   | TanStack Table              | 8.20.5           |
| HTTP Client  | Axios                       | 1.7.7            |
| Backend      | Spring Boot                 | 3.3.5            |
| Language     | Java                        | 23               |
| Database     | MarkLogic                   |                  |
| ML Deploy    | ml-gradle                   | 6.2.0            |

## Project Structure

```
data-insights/
├── front-end/                          # React/TypeScript UI
│   └── src/
│       ├── pages/                      # HomePage, DistributionPage, AnalyzePage,
│       │                               # CoveragePage, SchemaManagementPage, UploadPage,
│       │                               # GraphQLExplorerPage, SearchPage
│       ├── components/                 # QueryPanel, SchemaGeneratorModal,
│       │                               # SchemaValidatorModal, SchemaViewerModal,
│       │                               # RunAnalysisModal, AlertDialog, ConfirmDialog, ...
│       ├── services/                   # Axios API wrappers
│       ├── context/                    # DatabaseContext, AuthContext, ThemeContext
│       └── types/                      # TypeScript interfaces
├── back-end/                           # Spring Boot REST API + SPA host
│   └── src/main/java/com/datainsights/
│       ├── controller/                 # AnalysisController, SchemaController,
│       │                               # UploadController, DatabaseController, GraphQLController
│       ├── service/                    # MarkLogicService, SchemaService, UploadService
│       ├── config/                     # MarkLogicConfig, WebConfig
│       └── dto/                        # Data transfer objects
└── marklogic/                          # MarkLogic XQuery modules
    └── src/main/ml-modules/
        ├── root/lib/                   # Reusable XQuery libraries + async task framework
        │   └── graphql/                # GraphQL engine: schema.sjs, planner.sjs,
        │                               # executor.sjs, normalizer.sjs
        └── services/                   # REST resource extensions (endpoints + descriptors)
```

## Getting Started

### Prerequisites

- Node.js 18+
- Java 23
- MarkLogic 10+ running on port 9090
- Gradle (or use the `gradlew` wrapper)

### 1. Deploy MarkLogic Modules

```bash
cd marklogic
./gradlew mlDeploy
```

### 2. Start the Backend

```bash
cd back-end
./mvnw spring-boot:run
```

Connects to MarkLogic at `localhost:9090` with `admin/admin` credentials (configurable in `application.yml`).

### 3. Start the Frontend

```bash
cd front-end
npm install
npm run dev
```

Open [http://localhost:5175](http://localhost:5175) in your browser.

> **Note:** In production, build the frontend (`npm run build`) and copy `dist/` to `back-end/src/main/resources/static/`. Spring Boot will serve the app directly — no separate frontend server needed.

## Key API Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/databases` | List MarkLogic databases |
| `GET` | `/api/statistics` | Document counts by type |
| `GET` | `/api/root-elements` | Distinct root elements |
| `POST` | `/api/analyze` | Trigger a new analysis job |
| `GET` | `/api/analysis/list` | List saved analyses |
| `GET` | `/api/analysis/structure` | Hierarchical element tree |
| `GET` | `/api/analysis/values` | Paginated element values |
| `GET` | `/api/analysis/uris` | Document URIs for an analysis |
| `GET` | `/api/analysis/namespaces` | Namespace mappings |
| `GET` | `/api/analysis/doc-stats` | Document size statistics |
| `DELETE` | `/api/analysis/{id}` | Delete an analysis |
| `DELETE` | `/api/analysis/clear` | Clear all analyses for a database |
| `GET` | `/api/notifications/stream` | SSE stream for async job progress |
| `POST` | `/api/validate-expression` | Validate an XQuery expression |
| `POST` | `/api/execute-query` | Execute an XQuery/XPath query |
| `GET` | `/api/expressions` | List saved query expressions |
| `POST` | `/api/expressions` | Save a query expression |
| `DELETE` | `/api/expressions/{id}` | Delete a saved expression |
| `POST` | `/api/schemas/generate` | Generate a schema from analysis |
| `GET` | `/api/schemas` | List schemas for a database |
| `GET` | `/api/schemas/{id}` | Get schema content |
| `DELETE` | `/api/schemas/{id}` | Delete a schema |
| `POST` | `/api/schemas/validate` | Validate documents against a schema |
| `GET` | `/api/coverage` | Schema coverage metrics |
| `POST` | `/api/upload` | Upload files into MarkLogic |
| `POST` | `/v1/resources/graphql` | Execute a GraphQL query (or `action=explain` for query plan, `action=derive` to derive schema, `action=saveRelations` to persist relation definitions) |
| `GET` | `/v1/resources/graphql?action=schema` | List all derived GraphQL types (or `&type=X` for a single type) |
| `DELETE` | `/v1/resources/graphql?type=X` | Delete a derived GraphQL type and invalidate the registry cache |
