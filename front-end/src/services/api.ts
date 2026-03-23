import axios from 'axios'
import type {
  Analysis,
  AnalysisNode,
  AnalysisStatus,
  DatabaseStats,
  DocStats,
  Expression,
  Namespace,
  NotificationItem,
  PaginatedResult,
  RootElement,
  RunAnalysisRequest,
  UriRow,
  ValueRow,
} from '../types'

const api = axios.create({ baseURL: '/api' })

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
): Promise<PaginatedResult<ValueRow>> =>
  api
    .get<PaginatedResult<ValueRow>>('/analysis/values', {
      params: { 'analysis-id': analysisId, id: nodeId, type, page, rows },
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

// ── Notifications ─────────────────────────────────────────────────────────────

export const getNotifications = (): Promise<NotificationItem[]> =>
  api.get<NotificationItem[]>('/notifications').then(r => r.data)
