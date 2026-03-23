# jQuery to React Migration Analysis

Source file: `old/resources/js/app.js`

---

## Old Code Analysis

The file is ~1650+ lines of jQuery/jqGrid code with these key characteristics:

**Architecture problems:**
- Global mutable state (`var db`, `var rootElement`, `root_elements[]`, etc.)
- Imperative DOM manipulation (`$('#id').show()`, `.hide()`, `.html(...)`)
- Manual page "routing" — show/hide of `#home`, `#distribution`, `#analysis`, `#coverage_view`
- No separation of concerns — API calls, DOM updates, and business logic all interleaved

**Libraries in use:**

| Old | Role |
|---|---|
| jQuery `$.ajax` | HTTP calls (returns XML) |
| jqGrid | Data grids (analysis, namespaces, values, URIs, root elements) |
| jQuery UI dialogs | `confirmPretty`, `alertPretty`, `saveExpression` modal |
| `$.blockUI` | Full-page loading overlay |
| `$.ajaxPoll` | Polling for async job notifications |
| `$.gritter` | Toast notifications |
| Highcharts | Pie chart (distribution) + bar chart (coverage) |
| CodeMirror | XQuery constraint + XPath editors |

---

## Proposed React Architecture

### Pages (React Router)

```
/                 → HomePage (stats dashboard)
/distribution     → DistributionPage (root elements grid + pie chart)
/analyze          → AnalyzePage (analysis tree grid, values, xpath, expression editor)
/coverage         → CoveragePage (schema coverage bar chart)
```

### Component Tree

```
App
├── DatabaseSelector          ← global context: selected db
├── NotificationToaster       ← replaces $.gritter
└── Router
    ├── HomePage
    │   └── StatsPanel        ← updateStats(), updateAnalysisStatistics()
    ├── DistributionPage
    │   ├── RootElementsGrid  ← rootElementIndex() / jqGrid
    │   └── PieChart          ← renderChart() / Highcharts
    ├── AnalyzePage
    │   ├── AnalysisSelector  ← <select> #analysis_elements
    │   ├── AnalysisTreeGrid  ← initializeAnalysisGrid() / jqGrid treegrid
    │   ├── NamespacesTable   ← #namespace_table
    │   ├── ValuesTable       ← #analysis_values
    │   ├── XPathTable        ← #xpath_table
    │   ├── UrisTable         ← #uris_table
    │   ├── ExpressionEditor  ← CodeMirror (constraint + xpath)
    │   └── DocStats          ← getDocumentStatistics()
    └── CoveragePage
        ├── CoverageSelector  ← #coverage_source, #coverage_schemas
        └── CoverageChart     ← initializeCoverageChart() / Highcharts
```

### Library Replacements

| jQuery/Old | React Equivalent |
|---|---|
| `$.ajax` | `fetch` or `axios` with async/await |
| XML responses | Migrate API to JSON (recommended), or `DOMParser` utility |
| jqGrid | **TanStack Table v8** (tree grids need custom rendering) or **AG Grid Community** |
| jqGrid treegrid | AG Grid with `treeData: true` is closest match |
| jQuery UI dialog | **Radix UI `<Dialog>`** or shadcn/ui dialog |
| `$.blockUI` | Custom `<LoadingOverlay>` component |
| `$.ajaxPoll` | `useEffect` + `setInterval` + cleanup |
| `$.gritter` | **react-hot-toast** or **Sonner** |
| Highcharts | **Recharts** (simpler) or keep Highcharts with `highcharts-react-official` |
| CodeMirror | `@uiw/react-codemirror` |

### State Management

- **Selected database** → React Context (`DatabaseContext`) — replaces global `var db`
- **Per-page data** → local `useState` + `useEffect` for data fetching
- **Notifications** → Context or a toast library
- **Editor values** → `useRef` (CodeMirror) or controlled state

### API Service Layer

Replace scattered `$.ajax` calls with a typed service module:

```ts
// src/services/analysisService.ts
export async function getAnalysisList(db: string): Promise<Analysis[]> { ... }
export async function runAnalysis(params: AnalysisParams): Promise<void> { ... }
export async function getDocumentStats(db: string, analysisId: string): Promise<DocStats> { ... }
```

This also cleanly encapsulates the XML → JSON parsing if the backend isn't changed yet.

---

## Key Complexity Notes

1. **jqGrid treegrid** (`initializeAnalysisGrid`) is the hardest part — it uses adjacency model tree data with `parent`, `level`, `isLeaf` fields. AG Grid's tree data support is the closest modern equivalent.

2. **XML APIs** — the backend returns XML (`.xqy` XQuery services). The cleanest migration modernizes these to JSON on the Spring Boot side (which already exists in this project). Otherwise, a `parseXml()` utility using `DOMParser` must wrap every response.

3. **Notifications polling** (`notificationStart`) — translate to a `useRef`-based interval in `useEffect` with proper cleanup to avoid memory leaks.

4. **`analyzeDatabase` dialog with CodeMirror inside** — requires calling `editor.refresh()` after the dialog opens. The React equivalent is calling `.refresh()` on the CodeMirror instance ref in a `useEffect` triggered when the dialog `open` state changes.

---

## Recommended Migration Order

1. Set up routing + `DatabaseContext`
2. Convert `HomePage` + stats (simplest — no grids)
3. Convert `DistributionPage` (grid + chart)
4. Convert `AnalyzePage` (most complex — treegrid, multiple tabs, editors)
5. Convert `CoveragePage`
6. Replace jQuery UI dialogs last (touch every page)

Since this project already has a React/TypeScript frontend, the main question is whether the new UI reuses the existing components or starts fresh pages alongside them.
