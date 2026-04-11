# File Upload Feature Implementation Plan

## Overview

A wizard-based file upload feature for ingesting ZIP archives of JSON/XML/CSV documents directly into a selected MarkLogic database. No analysis is triggered post-ingest — this is purely a data loading utility.

---

## User Flow (Wizard)

```
Step 1: Configure  →  Step 2: Upload & Read  →  Step 3: Results
  Database               Select ZIP file            Stats summary
  Collection/URI         Preview contents           Counts by type
  Security perms         Confirm & ingest           Errors list
```

---

## Supported File Types (inside ZIP)

| Extension | Ingested As | Notes |
|-----------|-------------|-------|
| `.json`   | JSON        | Direct insert |
| `.xml`    | XML         | Direct insert |
| `.csv`    | JSON        | Converted row-by-row to JSON objects |
| Others    | Skipped     | Logged in results, not inserted |

---

## Backend

### New Controller: `UploadController.java`

**Endpoint:** `POST /api/upload`

**Request:** `multipart/form-data`
- `file` — ZIP archive (MultipartFile)
- `database` — target MarkLogic database name
- `collection` — (optional) MarkLogic collection to assign documents to
- `permissions` — (optional) JSON array of `{role, capability}` pairs, e.g. `[{"role":"data-insight-role","capability":"read"}]`
- `uriPrefix` — (optional) URI prefix for inserted documents, defaults to `/upload/`

**Response:** `UploadResultDTO`
```json
{
  "totalFiles": 42,
  "inserted": 38,
  "skipped": 2,
  "failed": 2,
  "byType": { "json": 25, "xml": 10, "csv": 3 },
  "errors": [
    { "file": "bad.xml", "error": "XML parse error: ..." }
  ]
}
```

**Processing Logic:**
1. Receive ZIP via MultipartFile (held in memory/temp, never persisted to disk)
2. Open with `java.util.zip.ZipInputStream`
3. For each entry:
   - Detect type by file extension
   - For CSV: parse with OpenCSV, convert each row to a JSON object keyed by header
   - For JSON/XML: pass content through as-is
   - POST document to MarkLogic `PUT /v1/documents` with:
     - URI: `{uriPrefix}{filename}` (or `{uriPrefix}{name}.json` for CSV rows)
     - Collection header (if provided)
     - Permissions (if provided)
   - Track success/failure per file
4. Return aggregated UploadResultDTO
5. Temp data is GC'd — no disk writes

### New DTO: `UploadResultDTO.java`
- Fields: totalFiles, inserted, skipped, failed, byType (Map<String,Integer>), errors (List<UploadError>)
- Inner class `UploadError`: fileName, message

### MarkLogicService additions
- `insertDocument(String uri, String content, String contentType, String database, String collection, List<Permission> permissions)` — wraps PUT /v1/documents

---

## Frontend

### New Page: `UploadPage.tsx`

Route: `/upload`

**Step 1 — Configure**
- DatabaseSelector (reuse existing context, pre-populated)
- Collection input (text field, optional)
- URI Prefix input (text field, default `/upload/`)
- Permissions table: add rows of `{role, capability}` pairs
  - Role: text input
  - Capability: dropdown (read, update, insert, execute)
  - Add/remove rows

**Step 2 — Upload & Read**
- Drag-and-drop or click-to-browse for ZIP file
- On file selected: parse ZIP client-side (using JSZip library) to show preview:
  - Table: filename | detected type | size | status (ready/skip/convert)
  - CSV files flagged as "will convert to JSON"
  - Unknown extensions flagged as "will skip"
- "Start Upload" button triggers POST to `/api/upload`
- Progress indicator (indeterminate spinner — no chunked streaming for now)

**Step 3 — Results**
- Summary cards: Total / Inserted / Skipped / Failed
- Breakdown table by type (JSON / XML / CSV→JSON)
- Error list (collapsible) showing filename + error message
- "Upload Another" button (resets to Step 1)
- "View Database Stats" link to HomePage

### New API method in `api.ts`
```typescript
uploadZip(
  file: File,
  database: string,
  collection?: string,
  uriPrefix?: string,
  permissions?: Array<{role: string, capability: string}>
): Promise<UploadResult>
```
Sends as `multipart/form-data`.

### New types in `types/`
```typescript
interface UploadResult {
  totalFiles: number
  inserted: number
  skipped: number
  failed: number
  byType: Record<string, number>
  errors: Array<{ file: string; error: string }>
}
```

---

## Navigation

Add "Upload" link to the main navigation alongside existing pages.

---

## Dependencies

**Backend:**
- `opencsv` (CSV parsing) — add to pom.xml

**Frontend:**
- `jszip` — client-side ZIP preview before upload
- `@types/jszip` — types

---

## MarkLogic Document Security

MarkLogic permissions are passed as query parameters on `PUT /v1/documents`:
- `perm:rolename=capability` for each permission pair
- Example: `perm:data-insight-role=read&perm:data-insight-role=update`

The existing `MarkLogicService` authentication pattern (session credentials) is reused.

---

## Out of Scope (for now)

- Progress streaming per-document (would need SSE or WebSocket)
- Analysis trigger post-upload
- Non-ZIP single file upload
- Folder/collection browsing of uploaded docs
- Duplicate URI handling strategy (currently overwrites)
