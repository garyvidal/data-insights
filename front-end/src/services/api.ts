import axios from 'axios'
import type {
  Analysis,
  AnalysisNode,
  AnalysisStatus,
  DatabaseStats,
  DocStats,
  Expression,
  Namespace,
  PaginatedResult,
  RootElement,
  RunAnalysisRequest,
  UriRow,
  ValueRow,
  SchemaGenerationRequest,
  SchemaGenerationResponse,
  ValidationRequest,
  ValidationResult,
  SchemaInfo,
  UploadResult,
  UploadPermission,
  SearchOptionsSet,
  SearchResultSet,
  GraphQLRequest,
  GraphQLResponse,
} from '../types'

const api = axios.create({ baseURL: '/api', withCredentials: true })

// Set to true once a user has successfully authenticated so that 401s
// on subsequent requests are treated as session expiry, not initial load.
let _authenticated = false
export function setAuthenticated(value: boolean) { _authenticated = value }

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401 && _authenticated) {
      _authenticated = false
      window.dispatchEvent(new Event('session-expired'))
    }
    const message = err.response?.data?.error ?? err.message ?? 'Request failed'
    return Promise.reject(new Error(message))
  },
)

// ── Auth ──────────────────────────────────────────────────────────────────────

export const loginApi = (username: string, password: string): Promise<string> =>
  api.post<{ username: string }>('/auth/login', { username, password }).then(r => r.data.username)

export const logoutApi = (): Promise<void> =>
  api.post('/auth/logout').then(() => undefined)

export const getMe = (): Promise<string> =>
  api.get<{ username: string }>('/auth/me').then(r => r.data.username)

// ── Databases ─────────────────────────────────────────────────────────────────

export const getDatabases = (): Promise<string[]> =>
  api.get<string[]>('/databases').then(r => r.data)

export const getDatabaseStats = (db: string): Promise<DatabaseStats> =>
  api.get<DatabaseStats>('/statistics', { params: { db } }).then(r => r.data)

export const getAnalysisStatus = (db: string): Promise<AnalysisStatus> =>
  api.get<AnalysisStatus>('/analysis-status', { params: { db } }).then(r => r.data)

// ── Root Elements ─────────────────────────────────────────────────────────────

export const getRootElements = (db: string): Promise<RootElement[]> =>
  api.get<RootElement[]>('/root-elements', { params: { db } }).then(r => r.data)

// ── Analysis ──────────────────────────────────────────────────────────────────

export const getAnalysisList = (db: string): Promise<Analysis[]> =>
  api.get<Analysis[]>('/analysis-list', { params: { db } }).then(r => r.data)

export const getAnalysisStructure = (analysisId: string, db: string): Promise<AnalysisNode[]> =>
  api.get<AnalysisNode[]>('/analysis/structure', { params: { 'analysis-id': analysisId, db } }).then(r => r.data)

export const getAnalysisValues = (
  analysisId: string,
  nodeId: string,
  type: 'element-values' | 'attribute-values',
  page = 1,
  rows = 50,
  sidx = 'frequency',
  sord = 'desc',
): Promise<PaginatedResult<ValueRow>> =>
  api
    .get<PaginatedResult<ValueRow>>('/analysis/values', {
      params: { 'analysis-id': analysisId, id: nodeId, type, page, rows, sidx, sord },
    })
    .then(r => r.data)

export const getAnalysisUris = (
  analysisId: string,
  db: string,
  page = 1,
  rows = 50,
): Promise<PaginatedResult<UriRow>> =>
  api
    .get<PaginatedResult<UriRow>>('/analysis/uris', {
      params: { 'analysis-id': analysisId, db, page, rows },
    })
    .then(r => r.data)

export const getDocStats = (analysisId: string, db: string): Promise<DocStats> =>
  api
    .get<DocStats>('/analysis/doc-stats', { params: { 'analysis-id': analysisId, db } })
    .then(r => r.data)

export const getNamespaces = (analysisId: string): Promise<Namespace[]> =>
  api.get<Namespace[]>('/namespaces', { params: { 'analysis-id': analysisId } }).then(r => r.data)

// ── Run Analysis ──────────────────────────────────────────────────────────────

export const runAnalysis = (request: RunAnalysisRequest): Promise<void> =>
  api.post('/analyze', request).then(() => undefined)

export const deleteAnalysis = (id: string): Promise<void> =>
  api.delete('/analysis', { params: { id } }).then(() => undefined)

export const clearAnalyses = (db: string): Promise<void> =>
  api.delete('/analyses', { params: { db } }).then(() => undefined)

export const clearDatabase = (db: string): Promise<void> =>
  api.post('/clear-db', null, { params: { db } }).then(() => undefined)

// ── Expressions ───────────────────────────────────────────────────────────────

export const listExpressions = (db: string): Promise<Expression[]> =>
  api.get<Expression[]>('/expressions', { params: { db } }).then(r => r.data)

export const validateExpression = (
  db: string,
  constraint: string,
  xpath: string,
): Promise<{ valid: boolean; error: string }> =>
  api.post('/validate-expression', { db, constraint, xpath }).then(r => r.data)

export const executeQuery = (
  db: string,
  query: string,
  xpath: string,
): Promise<{ valid: boolean; count: string; error: string }> =>
  api.post('/execute-query', { db, query, xpath }).then(r => r.data)

export interface QueryResult {
  uri: string
  type: string
  content: string
  collections?: string[]
}

export const executeQueryResults = (
  db: string,
  query: string,
  xpath: string,
  analysisId: string,
  page: number,
  pageSize: number,
): Promise<{ valid: boolean; estimate: string; page: number; pageSize: number; results: QueryResult[]; error: string }> =>
  api.post('/query-results', { db, query, xpath, analysisId, page, pageSize }).then(r => r.data)

export const saveExpression = (
  db: string,
  name: string,
  query: string,
  xpath: string,
): Promise<{ id: string }> =>
  api.post('/expressions', { db, name, query, xpath }).then(r => r.data)

export const deleteExpression = (id: string): Promise<void> =>
  api.delete(`/expressions/${id}`).then(() => undefined)

export const getExpression = (id: string): Promise<Expression & { query: string; xpath: string }> =>
  api.get(`/expressions/${id}`).then(r => r.data)

// ── Schema Operations ─────────────────────────────────────────────────────────

export const generateJsonSchema = (
  request: SchemaGenerationRequest,
): Promise<SchemaGenerationResponse> =>
  api.post<SchemaGenerationResponse>('/schema/generate/json-schema', request).then(r => r.data)

export const generateXmlSchema = (
  request: SchemaGenerationRequest,
): Promise<SchemaGenerationResponse> =>
  api.post<SchemaGenerationResponse>('/schema/generate/xsd', request).then(r => r.data)

export const getSchema = (schemaId: string): Promise<string> =>
  api.get<string>(`/schema/${schemaId}`, { responseType: 'text' }).then(r => r.data)

export const listSchemas = (database: string): Promise<SchemaInfo[]> =>
  api.get<SchemaInfo[]>('/schema/list', { params: { database } }).then(r => r.data)

export const deleteSchema = (schemaId: string): Promise<void> =>
  api.delete(`/schema/${schemaId}`).then(() => undefined)

// ── Validation Operations ─────────────────────────────────────────────────────

export const validateDocument = (request: ValidationRequest): Promise<ValidationResult> =>
  api.post<ValidationResult>('/schema/validate', request).then(r => r.data)

export const validateBatch = (
  schemaId: string,
  documents: string[],
  documentType?: string,
): Promise<ValidationResult[]> =>
  api
    .post<ValidationResult[]>('/schema/validate/batch', documents, {
      params: { schemaId, documentType: documentType ?? 'json' },
    })
    .then(r => r.data)

export const analyzeAnomalies = (
  schemaId: string,
  documents: string[],
): Promise<Record<string, any>> =>
  api
    .post<Record<string, any>>('/schema/analyze-anomalies', documents, {
      params: { schemaId },
    })
    .then(r => r.data)

// ── Search Options ────────────────────────────────────────────────────────

export const listSearchOptions = (db: string, analysisId?: string): Promise<SearchOptionsSet[]> =>
  api.get('/search-options', { params: { db, 'analysis-id': analysisId ?? '' } }).then(r => r.data)

export const getSearchOptions = (id: string): Promise<SearchOptionsSet> =>
  api.get(`/search-options/${id}`).then(r => r.data)

export const saveSearchOptions = (
  db: string,
  analysisId: string,
  name: string,
  options: string,
): Promise<{ id: string }> =>
  api.post('/search-options', { db, analysisId, name, options }).then(r => r.data)

export const updateSearchOptions = (
  id: string,
  name: string,
  options: string,
): Promise<{ id: string }> =>
  api.put(`/search-options/${id}`, { name, options }).then(r => r.data)

export const deleteSearchOptions = (id: string): Promise<void> =>
  api.delete(`/search-options/${id}`).then(() => undefined)

export const syncIndexes = (
  db: string,
  constraints: string,
  dropMissing = false,
): Promise<{ status: string; message: string; indexed?: number }> =>
  api.post('/indexes/sync', { db, constraints, dropMissing }).then(r => r.data)

export const exportSearchOptionsXml = (id: string, name: string): Promise<string> =>
  api.get(`/search-options/${id}/export`, { params: { name }, responseType: 'text' }).then(r => r.data)

export const executeSearch = (
  db: string,
  optionsId: string,
  query: string,
  page: number,
  pageSize: number,
): Promise<SearchResultSet> =>
  api.post('/search', { db, optionsId, query, page, pageSize }).then(r => r.data)

// ── GraphQL ───────────────────────────────────────────────────────────────

export const executeGraphQL = (request: GraphQLRequest): Promise<GraphQLResponse> =>
  api.post<GraphQLResponse>('/v1/resources/graphql', request).then(r => r.data)

export const deriveGraphQLSchema = (
  typeName: string,
  collection: string,
  analysisUri: string,
  format: 'json' | 'xml' = 'json',
  db?: string,
): Promise<Record<string, unknown>> =>
  api
    .post('/v1/resources/graphql', { action: 'derive', type: typeName, collection, analysisUri, format, db })
    .then(r => r.data)

export const getGraphQLSchema = (typeName?: string): Promise<Record<string, unknown>> =>
  api
    .get('/v1/resources/graphql', { params: { action: 'schema', ...(typeName ? { type: typeName } : {}) } })
    .then(r => r.data)

export const explainGraphQL = (request: GraphQLRequest): Promise<Record<string, unknown>> =>
  api.post<Record<string, unknown>>('/v1/resources/graphql', { ...request, action: 'explain' }).then(r => r.data)

export const deleteGraphQLType = (typeName: string): Promise<{ deleted: boolean; type: string }> =>
  api
    .delete('/v1/resources/graphql', { params: { type: typeName } })
    .then(r => r.data)

export const saveGraphQLRelations = (
  typeName: string,
  relations: Record<string, { type: string; via: string; foreignKey: string }>,
): Promise<{ saved: boolean; type: string; uri: string }> =>
  api
    .post('/v1/resources/graphql', { action: 'saveRelations', type: typeName, relations })
    .then(r => r.data)

// ── Upload ────────────────────────────────────────────────────────────────

export const uploadFiles = (
  files: File[],
  database: string,
  collection?: string,
  uriPrefix?: string,
  permissions?: UploadPermission[],
  rootKey?: string,
): Promise<UploadResult> => {
  const form = new FormData()
  files.forEach(f => form.append('files', f))
  form.append('database', database)
  if (collection) form.append('collection', collection)
  if (uriPrefix) form.append('uriPrefix', uriPrefix)
  if (permissions && permissions.length > 0) {
    form.append('permissions', JSON.stringify(permissions))
  }
  if (rootKey && rootKey.trim()) form.append('rootKey', rootKey.trim())
  return api.post<UploadResult>('/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}
