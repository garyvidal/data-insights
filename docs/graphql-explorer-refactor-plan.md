# GraphQL Explorer UI Refactor Plan

## Goals

1. **Show all existing schema types on load** — no action required from the user to see what's available.
2. **"Generate" is only for creating new types from an analysis** — not the only way to browse schemas.
3. **Derived models = schema models** — no conceptual or UI distinction between the two; treat them identically.

---

## Current Problems

| Problem | Root cause |
|---|---|
| Types are invisible until Generate is clicked | `SchemaPanel` only shows a type after `deriveGraphQLSchema` is called; `getGraphQLSchema()` is only called inside `handleDerive` to populate relation dropdowns |
| Generate is destructive on existing types | Re-running derive overwrites the saved schema for that type name — no warning |
| "Derived" badge creates false distinction | `ExecutionPlanPanel` labels types with a yellow "derived" badge; the code has a `derived` boolean flag in `DerivedType`; users perceive these as different from "real" schema types |
| Empty state encourages Generate | The empty panel says "click Generate to derive a schema" with no option to browse existing types first |

---

## Proposed Architecture

### Phase 1 — Load and browse all existing types on mount

**New behavior on `SchemaPanel` mount (when `db` changes):**
1. Call `getGraphQLSchema()` (no type arg) → returns `{ types: { TypeName: { collection, format, fieldCount } } }`
2. Display a **type list** at the top of the panel — each type is a clickable row.
3. Clicking a type calls `getGraphQLSchema(typeName)` → loads that type's full field definition into the detail view (same view currently shown after Generate).
4. No Generate required to browse types.

**Empty state (no types exist):**
- Show a call-to-action: "No schema types found. Generate one from an analysis."
- Clicking it opens the Generate form (currently always visible at the top).

### Phase 2 — Separate "Browse" from "Generate"

**Two modes in `SchemaPanel`:**

| Mode | Trigger | Behavior |
|---|---|---|
| **Browse** | Default on load | Type list → click to view fields, example queries, relations |
| **Generate** | "+ New Type" button, or empty-state prompt | Shows analysis picker + type name/collection/format form → derive |

The Generate form currently sits permanently at the top. Move it behind a button (e.g., `+ New Type` in the panel header), visible as a slide-in or inline expansion.

### Phase 3 — Remove "derived" distinction

- Remove the `derived?: boolean` field from `DerivedType` and all UI that references it.
- Remove the yellow "derived" badge from `ExecutionPlanPanel` registry.
- Remove the `derived` label/concept from all user-facing strings.
- Schema loaded from storage and schema freshly derived are shown identically.

---

## Detailed Component Changes

### `SchemaPanel`

**New state:**
```ts
type PanelMode = 'list' | 'detail' | 'generate'
const [mode, setMode] = useState<PanelMode>('list')
const [allTypes, setAllTypes] = useState<TypeSummary[]>([])   // from getGraphQLSchema()
const [loadingTypes, setLoadingTypes] = useState(false)
```

**TypeSummary shape** (from existing API response):
```ts
interface TypeSummary {
  name: string
  collection: string | null
  format: 'json' | 'xml'
  fieldCount: number
}
```

**On mount / db change:**
- Fetch `getGraphQLSchema()` → populate `allTypes`
- If `allTypes.length > 0`: `setMode('list')`
- If `allTypes.length === 0`: `setMode('generate')` (with empty-state messaging)

**List mode UI:**
- Header row: `"Types (N)"` + `"+ New Type"` button (opens generate mode)
- Each type row: `TypeName · collection · JSON/XML badge · field count`
- Click → load full type via `getGraphQLSchema(typeName)` → `setDerivedType(...)` → `setMode('detail')`

**Detail mode UI:**
- Back button `"← Types"` → returns to list
- Everything currently shown after Generate: introspection queries, example queries, fields, relations
- "Regenerate from analysis" link/button in a subtle position — not the primary CTA

**Generate mode UI:**
- Same form as today (analysis picker, type name, collection, format, Generate button)
- On success: add new type to `allTypes`, switch to detail mode for the new type
- "Back to types" link if types already exist

### `ExecutionPlanPanel` (registry section)

- Remove `derived` boolean check and yellow badge entirely.
- Simplify row to: `TypeName · collection · N fields`

---

## API Changes Required

None — `getGraphQLSchema()` already returns the full type registry. The new UI just calls it on mount instead of only inside `handleDerive`.

**Optional improvement (not blocking):** Add a `getGraphQLSchema()` call after a successful `deriveGraphQLSchema()` to refresh the type list (currently only `allTypes` state needs updating — can be done client-side by appending the new type).

---

## Implementation Order

1. Add `allTypes` loading on mount in `SchemaPanel`
2. Build `TypeListView` sub-component (type rows)
3. Wire click → `getGraphQLSchema(typeName)` → detail view
4. Move Generate form behind `+ New Type` button / empty-state CTA
5. Add back navigation from detail → list
6. Remove `derived` badge from `ExecutionPlanPanel`
7. Remove `derived` field references in types/interfaces

---

## Non-goals / Out of scope

- Deleting types from the UI (separate feature)
- Editing field definitions manually
- Pagination of the type list (unlikely to have >50 types)
