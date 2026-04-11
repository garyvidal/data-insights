
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Play, Wand2, Trash2, FolderX } from 'lucide-react'
import { useDatabase } from '../context/useDatabase'
import {
  clearAnalyses,
  deleteAnalysis,
  getAnalysisList,
  getAnalysisStructure,
  getAnalysisUris,
  getAnalysisValues,
  getDocStats,
  getNamespaces,
} from '../services/api'
import type { Analysis, AnalysisNode, DocStats, Namespace, PaginatedResult, UriRow, ValueRow } from '../types'
import AlertDialog from '../components/AlertDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingOverlay from '../components/LoadingOverlay'
import RunAnalysisModal from '../components/RunAnalysisModal'
import { SchemaGeneratorModal } from '../components/SchemaGeneratorModal'
import QueryPanel from '../components/QueryPanel'

type Tab = 'structure'

/**
 * Build the fn:collection() XPath scope expression for the Query Panel when a
 * node is selected in the analysis grid.
 *
 * XML:  fn:collection()[element-name]
 * JSON: fn:collection()[object-node("element-name")]
 *
 * documentType drives the choice; inferedTypes on the node is used as a
 * secondary signal when documentType is ambiguous.
 */
function toQueryPanelXPath(node: AnalysisNode, documentType: string): string {
  const localname = node.localname || ''
  const nodeKind  = (node.nodeKind || '').toLowerCase()
  const infered   = (node.inferedTypes || '').toLowerCase()

  // nodeKind from MarkLogic is the authoritative signal for JSON object/array
  if (nodeKind === 'array') {
    return `fn:collection()[array-node("${localname}")]`
  }
  if (nodeKind === 'object') {
    return `fn:collection()[object-node("${localname}")]`
  }

  // Fall back to documentType / inferedTypes heuristic for plain JSON fields
  const isJson = documentType === 'json'
              || infered.includes('object')
              || infered.includes('json-object')
              || infered.includes('array')
              || infered.includes('json-array')

  if (isJson) {
    return `fn:collection()[object-node("${localname}")]`
  }
  return `fn:collection()[${localname}]`
}

function fileSizeFormat(bytes: string | number): string {
  const n = Number(bytes)
  if (isNaN(n)) return String(bytes)
  if (n >= 1_073_741_824) return (n / 1_073_741_824).toFixed(2) + ' GB'
  if (n >= 1_048_576) return (n / 1_048_576).toFixed(2) + ' MB'
  if (n >= 1_024) return Math.round(n / 1_024) + ' KB'
  return n + ' bytes'
}

// Recursive tree row — indented by level
function TreeRow({
  node,
  selected,
  collapsed,
  onClick,
  onToggle,
}: {
  node: AnalysisNode
  selected: boolean
  collapsed: boolean
  onClick: (node: AnalysisNode) => void
  onToggle: (key: string) => void
}) {
  const depth = parseInt(node.level || '0') * 16
  const isAttr = node.localname?.startsWith('@')

  return (
    <tr
      className={selected ? 'selected' : ''}
      onClick={() => onClick(node)}
    >
      <td>
        <div style={{ paddingLeft: depth }} className="flex items-center gap-1">
          {!node.isLeaf && (
            <span
              className="text-gray-400 dark:text-gray-500 cursor-pointer hover:text-blue-500 dark:hover:text-blue-400 select-none"
              onClick={e => { e.stopPropagation(); onToggle(node.key) }}
            >
              {collapsed ? '▸' : '▾'}
            </span>
          )}
          {node.isLeaf && <span className="text-gray-300 dark:text-gray-600">–</span>}
          <span className={isAttr ? 'text-purple-600 dark:text-purple-400 font-mono text-xs' : 'font-mono text-xs'}>
            {node.localname}
          </span>
        </div>
      </td>
      <td className="text-xs text-gray-500 dark:text-gray-400">{node.inferedTypes}</td>
      <td className="text-right text-xs">{node.frequency}</td>
      <td className="text-right text-xs">{node.distinctValues}</td>
      <td className="text-right text-xs">{node.minLength}</td>
      <td className="text-right text-xs">{node.maxLength}</td>
    </tr>
  )
}

export default function AnalyzePage() {
  const { selectedDb } = useDatabase()
  const [analyses, setAnalyses] = useState<Analysis[]>([])
  const [selectedAnalysis, setSelectedAnalysis] = useState<string>('')
  const [nodes, setNodes] = useState<AnalysisNode[]>([])
  const [selectedNode, setSelectedNode] = useState<AnalysisNode | null>(null)
  const [values, setValues] = useState<PaginatedResult<ValueRow> | null>(null)
  const [uris, setUris] = useState<PaginatedResult<UriRow> | null>(null)
  const [docStats, setDocStats] = useState<DocStats | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('structure')
  const [rightTab, setRightTab] = useState<'values' | 'xpaths' | 'uris' | 'namespaces'>('values')
  const [namespaces, setNamespaces] = useState<Namespace[]>([])
  const [valuesSort, setValuesSort] = useState<{ col: 'key' | 'frequency'; dir: 'asc' | 'desc' }>({ col: 'frequency', dir: 'desc' })
  const [valuesPage, setValuesPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [alert, setAlert] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onOk: () => void } | null>(null)
  const [showRunModal, setShowRunModal] = useState(false)
  const [showSchemaModal, setShowSchemaModal] = useState(false)
  const sseRef = useRef<EventSource | null>(null)
  const [rightPanelWidth, setRightPanelWidth] = useState(320)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set())

  function toggleCollapse(key: string) {
    setCollapsedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const visibleNodes = useMemo(() => {
    const hidden = new Set<string>()
    for (const node of nodes) {
      if (collapsedKeys.has(node.parentKey) || hidden.has(node.parentKey)) {
        hidden.add(node.key)
      }
    }
    return nodes.filter(n => !hidden.has(n.key))
  }, [nodes, collapsedKeys])
  const rightDragStart = useRef<{ x: number; w: number } | null>(null)

  const onRightResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    rightDragStart.current = { x: e.clientX, w: rightPanelWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(e: MouseEvent) {
      if (!rightDragStart.current) return
      const delta = rightDragStart.current.x - e.clientX
      setRightPanelWidth(Math.min(600, Math.max(200, rightDragStart.current.w + delta)))
    }
    function onUp() {
      rightDragStart.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [rightPanelWidth])

  // Load analysis list whenever DB changes
  useEffect(() => {
    if (!selectedDb) return
    setAnalyses([])
    setSelectedAnalysis('')
    setNodes([])
    setSelectedNode(null)
    setDocStats(null)
    setValues(null)
    getAnalysisList(selectedDb)
      .then(list => {
        setAnalyses(list)
        if (list.length > 0) setSelectedAnalysis(list[0].analysisId)
        else setSelectedAnalysis('')
      })
      .catch(() => setAlert('Failed to load analysis list'))
  }, [selectedDb])

  // Load structure when analysis selection changes
  useEffect(() => {
    if (!selectedAnalysis || !selectedDb) return
    setLoading(true)
    setNodes([])
    setSelectedNode(null)
    setValues(null)
    setCollapsedKeys(new Set())
    Promise.all([
      getAnalysisStructure(selectedAnalysis, selectedDb),
      getDocStats(selectedAnalysis, selectedDb),
      getNamespaces(selectedAnalysis),
    ])
      .then(([structure, stats, nss]) => {
        setNodes(structure)
        setDocStats(stats)
        setNamespaces(nss)
      })
      .catch(() => setAlert('Failed to load analysis data'))
      .finally(() => setLoading(false))
  }, [selectedAnalysis, selectedDb])

  // Load values when node, page, or sort changes; reset page when node changes
  const prevNodeRef = useRef<typeof selectedNode>(null)
  useEffect(() => {
    if (!selectedNode || !selectedAnalysis) return
    const nodeChanged = prevNodeRef.current !== selectedNode
    prevNodeRef.current = selectedNode
    const page = nodeChanged ? 1 : valuesPage
    if (nodeChanged) setValuesPage(1)
    const type = selectedNode.type === 'attribute' ? 'attribute-values' : 'element-values'
    getAnalysisValues(selectedAnalysis, selectedNode.parentChildKey, type, page, 50, valuesSort.col, valuesSort.dir)
      .then(setValues)
      .catch(console.error)
  }, [selectedNode, selectedAnalysis, valuesPage, valuesSort])

  // Load URIs when the uris tab is active
  useEffect(() => {
    if (rightTab !== 'uris' || !selectedAnalysis || !selectedDb) return
    getAnalysisUris(selectedAnalysis, selectedDb)
      .then(setUris)
      .catch(console.error)
  }, [rightTab, selectedAnalysis, selectedDb])

  function handleDeleteAnalysis() {
    setConfirm({
      message: 'Are you sure you want to delete this analysis?',
      onOk: () => {
        deleteAnalysis(selectedAnalysis)
          .then(() => {
            const remaining = analyses.filter(a => a.analysisId !== selectedAnalysis)
            setAnalyses(remaining)
            setSelectedAnalysis(remaining[0]?.analysisId ?? '')
          })
          .catch(() => setAlert('Failed to delete analysis'))
      },
    })
  }

  function handleClearAllAnalyses() {
    setConfirm({
      message: `Clear all analyses for "${selectedDb}"? This cannot be undone.`,
      onOk: () => {
        clearAnalyses(selectedDb)
          .then(() => {
            setAnalyses([])
            setSelectedAnalysis('')
            setNodes([])
            setSelectedNode(null)
            setDocStats(null)
          })
          .catch(() => setAlert('Failed to clear analyses'))
      },
    })
  }

  function startSse(db: string) {
    if (sseRef.current) {
      sseRef.current.close()
      sseRef.current = null
    }

    const es = new EventSource(`/api/notifications/stream?db=${encodeURIComponent(db)}`)
    sseRef.current = es

    es.addEventListener('update', (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { analyses: Analysis[]; complete: boolean }
      setAnalyses(data.analyses)
      setSelectedAnalysis(prev => prev || data.analyses[0]?.analysisId || '')
    })

    es.addEventListener('complete', () => {
      es.close()
      sseRef.current = null
    })

    es.onerror = () => {
      es.close()
      sseRef.current = null
    }
  }

  useEffect(() => () => {
    if (sseRef.current) sseRef.current.close()
  }, [])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'structure', label: 'Structure' },
  ]

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      <LoadingOverlay show={loading} message="Loading analysis..." />
      <AlertDialog
        open={!!alert}
        message={alert ?? ''}
        onClose={() => setAlert(null)}
      />
      <ConfirmDialog
        open={!!confirm}
        message={confirm?.message ?? ''}
        onConfirm={() => { confirm?.onOk(); setConfirm(null) }}
        onCancel={() => setConfirm(null)}
      />
      {showRunModal && (
        <RunAnalysisModal
          db={selectedDb}
          onClose={() => setShowRunModal(false)}
          onStarted={() => {
            setShowRunModal(false)
            setAlert('Analysis started. It will appear in the list when complete.')
            startSse(selectedDb)
          }}
        />
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mr-2">Analyze</h2>

        {analyses.length > 0 && (
          <select
            value={selectedAnalysis}
            onChange={e => setSelectedAnalysis(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          >
            {analyses.map(a => (
              <option key={a.analysisId} value={a.analysisId}>
                {a.documentType ? `[${a.documentType.toUpperCase()}] ` : ''}{a.localname} [{a.analysisName}]
              </option>
            ))}
          </select>
        )}

        <button className="btn-primary text-sm flex items-center gap-1.5" onClick={() => setShowRunModal(true)} title="Run Analysis">
          <Play size={14} /> Run Analysis
        </button>

        {selectedAnalysis && (
          <button className="btn-primary text-sm flex items-center gap-1.5" onClick={() => setShowSchemaModal(true)} title="Generate Schema">
            <Wand2 size={14} /> Generate Schema
          </button>
        )}

        {selectedAnalysis && (
          <button className="btn-danger text-sm flex items-center justify-center w-8 h-8 p-0" onClick={handleDeleteAnalysis} title="Delete analysis">
            <Trash2 size={15} />
          </button>
        )}

        {analyses.length > 0 && (
          <button className="btn-danger text-sm flex items-center justify-center w-8 h-8 p-0" onClick={handleClearAllAnalyses} title="Clear all analyses">
            <FolderX size={15} />
          </button>
        )}
      </div>

      {/* Doc Stats Bar */}
      {docStats && (
        <div className="flex gap-6 px-6 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400 flex-shrink-0">
          <span>Avg: {fileSizeFormat(docStats.avgDocumentSize)}</span>
          <span>Min: {fileSizeFormat(docStats.minDocumentSize)}</span>
          <span>Max: {fileSizeFormat(docStats.maxDocumentSize)}</span>
          <span>Median: {fileSizeFormat(docStats.medianDocumentSize)}</span>
        </div>
      )}

      {/* Content area */}
      <div className="flex flex-1 overflow-hidden bg-gray-50 dark:bg-gray-900">
        {/* Left — Structure tree */}
        <div className="flex-1 overflow-auto border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          {/* Tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex-shrink-0">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === t.id
                    ? 'border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === 'structure' && (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th className="text-right">Frequency</th>
                    <th className="text-right">Distinct</th>
                    <th className="text-right">Min Len</th>
                    <th className="text-right">Max Len</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleNodes.map(node => (
                    <TreeRow
                      key={node.key}
                      node={node}
                      selected={selectedNode?.key === node.key}
                      collapsed={collapsedKeys.has(node.key)}
                      onClick={setSelectedNode}
                      onToggle={toggleCollapse}
                    />
                  ))}
                  {nodes.length === 0 && !loading && (
                    <tr>
                      <td colSpan={6} className="text-center text-gray-400 dark:text-gray-500 py-8">
                        {analyses.length === 0
                          ? 'No analyses found. Click "Run Analysis" to start.'
                          : 'No structure data available.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right panel — Values */}
        {selectedNode && (
          <div className="flex flex-shrink-0 relative">
            {/* Resize + toggle strip */}
            <div className="relative flex-shrink-0 flex">
              {/* Resize handle */}
              {!rightCollapsed && (
                <div
                  className="w-1 h-full cursor-col-resize hover:bg-blue-500 transition-colors bg-transparent"
                  onMouseDown={onRightResizeMouseDown}
                />
              )}
              {/* Toggle button */}
              <button
                onClick={() => setRightCollapsed(v => !v)}
                title={rightCollapsed ? 'Expand panel' : 'Collapse panel'}
                className="absolute z-20 flex items-center justify-center w-5 h-5 rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-blue-600 hover:text-white hover:border-blue-500 transition-colors shadow-md text-xs"
                style={{ left: rightCollapsed ? '-10px' : '-10px', top: '12px' }}
              >
                {rightCollapsed ? '‹' : '›'}
              </button>
            </div>

            {/* Panel content */}
            {!rightCollapsed && (
              <div
                className="flex-shrink-0 flex flex-col border-l border-gray-200 dark:border-gray-700"
                style={{ width: rightPanelWidth }}
              >
                {/* Sub-tabs */}
                <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex-shrink-0">
                  {(['values', 'xpaths', 'uris', 'namespaces'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setRightTab(tab)}
                      className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors capitalize ${
                        rightTab === tab
                          ? 'border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-400'
                          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                      }`}
                    >
                      {tab === 'xpaths' ? 'XPaths' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>

                <div className="overflow-hidden flex flex-col flex-1 bg-white dark:bg-gray-900">
                  {rightTab === 'values' && (() => {
                    const rows = values?.rows ?? []
                    const toggleSort = (col: 'key' | 'frequency') =>
                      setValuesSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))
                    const arrow = (col: 'key' | 'frequency') =>
                      valuesSort.col === col ? (valuesSort.dir === 'asc' ? ' ▲' : ' ▼') : ''
                    const totalPages = values ? Math.ceil(values.records / 50) : 1
                    return (
                      <div className="flex flex-col h-full">
                        {values && values.records > 50 && (
                          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex-shrink-0">
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Page {valuesPage} of {totalPages} ({values.records} total)
                            </span>
                            <div className="flex gap-1">
                              <button
                                disabled={valuesPage <= 1}
                                onClick={() => setValuesPage(p => p - 1)}
                                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                              >
                                ‹ Prev
                              </button>
                              <button
                                disabled={valuesPage >= totalPages}
                                onClick={() => setValuesPage(p => p + 1)}
                                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                              >
                                Next ›
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="table-container flex-1 overflow-auto">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th className="cursor-pointer select-none" onClick={() => toggleSort('key')}>
                                  Value{arrow('key')}
                                </th>
                                <th className="text-right cursor-pointer select-none" onClick={() => toggleSort('frequency')}>
                                  Count{arrow('frequency')}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((v, i) => (
                                <tr key={i}>
                                  <td className="font-mono text-xs truncate max-w-48">{v.key}</td>
                                  <td className="text-right text-xs">{v.frequency}</td>
                                </tr>
                              ))}
                              {rows.length === 0 && (
                                <tr>
                                  <td colSpan={2} className="text-center text-gray-400 dark:text-gray-500 py-4 text-xs">
                                    No values
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })()}

                  {rightTab === 'xpaths' && (
                    <div className="p-3 bg-white dark:bg-gray-900">
                      <p className="font-mono text-xs break-all text-gray-800 dark:text-gray-200">
                        {selectedNode.xpath || <span className="text-gray-400 dark:text-gray-500">No XPath available</span>}
                      </p>
                    </div>
                  )}

                  {rightTab === 'uris' && (
                    <div className="table-container">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>URI</th>
                            <th className="text-right">Size</th>
                          </tr>
                        </thead>
                        <tbody>
                          {uris?.rows.map((u, i) => (
                            <tr key={i}>
                              <td className="font-mono text-xs truncate max-w-48">{u.uri}</td>
                              <td className="text-right text-xs">{fileSizeFormat(u['document-size'])}</td>
                            </tr>
                          ))}
                          {(!uris || uris.rows.length === 0) && (
                            <tr>
                              <td colSpan={2} className="text-center text-gray-400 dark:text-gray-500 py-4 text-xs">
                                No URIs
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {rightTab === 'namespaces' && (
                    <div className="table-container">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Prefix</th>
                            <th>Namespace URI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {namespaces.map((ns, i) => (
                            <tr key={i}>
                              <td className="font-mono text-xs">{ns.prefix || <span className="text-gray-400 dark:text-gray-500 italic">default</span>}</td>
                              <td className="font-mono text-xs truncate max-w-64">{ns.namespaceUri}</td>
                            </tr>
                          ))}
                          {namespaces.length === 0 && (
                            <tr>
                              <td colSpan={2} className="text-center text-gray-400 dark:text-gray-500 py-4 text-xs">
                                No namespaces
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {showSchemaModal && (
          <SchemaGeneratorModal
            analysisId={selectedAnalysis}
            database={selectedDb}
            nodes={nodes}
            isOpen={showSchemaModal}
            onClose={() => setShowSchemaModal(false)}
            onSuccess={(schema) => {
              setShowSchemaModal(false)
              setAlert(`✓ Schema generated successfully! Schema ID: ${schema.schemaId}`)
            }}
          />
        )}
      </div>

      {/* Query Panel — collapsible bottom drawer */}
      {selectedDb && (
        <QueryPanel
          db={selectedDb}
          analysisId={selectedAnalysis}
          selectedXPath={selectedNode ? toQueryPanelXPath(
          selectedNode,
          analyses.find(a => a.analysisId === selectedAnalysis)?.documentType ?? ''
        ) : undefined}
        />
      )}
    </div>
  )
}
