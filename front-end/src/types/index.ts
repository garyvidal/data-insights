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
