export interface RootElement {
  id: string
  type: 'element' | 'json' | 'binary'
  database: string
  namespace: string
  localname: string
  frequency: number
}

export interface DatabaseStats {
  allDocuments: number
  xmlDocuments: number
  jsonDocuments: number
  binaryDocuments: number
  textDocuments: number
}

export interface AnalysisStatus {
  analyzed: number
  running: number
}

export interface Analysis {
  analysisId: string
  analysisName: string
  database: string
  localname: string
  documentType: 'json' | 'xml' | string
}

export interface AnalysisNode {
  key: string
  parentKey: string
  childKey: string
  parentChildKey: string
  type: 'element' | 'attribute'
  localname: string
  namespace: string
  xpath: string
  frequency: string
  distinctValues: string
  inferedTypes: string
  nodeKind: string
  minLength: string
  maxLength: string
  averageLength: string
  minValue: string
  maxValue: string
  level: string
  parent: string
  isLeaf: boolean
}

export interface ValueRow {
  key: string
  frequency: string
}

export interface UriRow {
  uri: string
  'document-size': string
}

export interface PaginatedResult<T> {
  page: number
  total: number
  records: number
  rows: T[]
}

export interface DocStats {
  avgDocumentSize: string
  minDocumentSize: string
  maxDocumentSize: string
  medianDocumentSize: string
}

export interface Namespace {
  prefix: string
  namespaceUri: string
}

export interface Expression {
  id: string
  name: string
  query?: string
  xpath?: string
  database?: string
}

export interface RunAnalysisRequest {
  db: string
  name: string
  sample: number
  constraint: string
  xpath: string
  all: boolean
  rootElements: string[]
}

export interface NotificationItem {
  title: string
  message: string
}

// ── Schema Types ──────────────────────────────────────────────────────────

export interface SchemaGenerationRequest {
  analysisId: string
  database: string
  schemaType: 'json-schema' | 'xsd'
  strict: boolean
  name?: string
  /** JSON Schema draft: "draft-07" (default) or "2019-09" */
  draft?: 'draft-07' | '2019-09'
}

export interface SchemaGenerationResponse {
  schemaId: string
  analysisId: string
  database: string
  schemaType: 'json-schema' | 'xsd'
  name?: string
  schema: string
  generatedAt: string
  documentCount: number
  status: 'success' | 'error' | 'partial'
  message: string
}

export interface ValidationError {
  path: string
  message: string
  severity: 'error' | 'warning'
  code: string
}

export interface ValidationResult {
  valid: boolean
  schemaId: string
  errors: ValidationError[]
  warnings: string[]
  validationTime: number
}

export interface ValidationRequest {
  schemaId: string
  database: string
  document: string
  documentType: 'json' | 'xml'
}

export interface SchemaInfo {
  schemaId: string
  name: string
  schemaType: string
  analysisId: string
  database: string
  documentCount: number
  createdAt: string
}

// ── Search Types ──────────────────────────────────────────────────────────

export type SearchConstraintType = 'word' | 'value' | 'range' | 'collection'

export interface SearchConstraint {
  id: string            // local uuid for react key
  name: string          // constraint name used in query string
  type: SearchConstraintType
  localname: string
  namespace: string
  nodeKind: string      // "object" | "array" | "" for XML
  inferedTypes: string
  facet: boolean
}

export interface SearchOptionsSet {
  id: string
  name: string
  database: string
  analysisId: string
  createdAt: string
  constraints?: SearchConstraint[]
}

export interface SearchFacetValue {
  name: string
  count: string
}

export interface SearchFacet {
  name: string
  values: SearchFacetValue[]
}

export interface SearchResultItem {
  uri: string
  type: string
  content: string
  collections?: string[]
}

export interface SearchResultSet {
  valid: boolean
  estimate: string
  page: number
  pageSize: number
  error?: string
  facets: SearchFacet[]
  results: SearchResultItem[]
}

// ── Upload Types ──────────────────────────────────────────────────────────

export interface UploadError {
  file: string
  error: string
}

export interface UploadResult {
  totalFiles: number
  inserted: number
  skipped: number
  failed: number
  byType: Record<string, number>
  errors: UploadError[]
}

export interface UploadPermission {
  role: string
  capability: 'read' | 'update' | 'insert' | 'execute'
}
