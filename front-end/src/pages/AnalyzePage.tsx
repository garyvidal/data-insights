import { useEffect, useRef, useState, useCallback } from 'react'
import { useDatabase } from '../context/DatabaseContext'
import {
  deleteAnalysis,
  getAnalysisList,
  getAnalysisStructure,
  getAnalysisUris,
  getAnalysisValues,
  getDocStats,
} from '../services/api'
import type { Analysis, AnalysisNode, DocStats, PaginatedResult, UriRow, ValueRow } from '../types'
import AlertDialog from '../components/AlertDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import LoadingOverlay from '../components/LoadingOverlay'
import RunAnalysisModal from '../components/RunAnalysisModal'

type Tab = 'structure'

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
  onClick,
}: {
  node: AnalysisNode
  selected: boolean
  onClick: (node: AnalysisNode) => void
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
          {!node.isLeaf && <span className="text-gray-400">▸</span>}
          {node.isLeaf && <span className="text-gray-300">–</span>}
          <span className={isAttr ? 'text-purple-600 font-mono text-xs' : 'font-mono text-xs'}>
            {node.localname}
          </span>
        </div>
      </td>
      <td className="text-xs text-gray-500">{node.inferedTypes}</td>
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
  const [rightTab, setRightTab] = useState<'values' | 'xpaths' | 'uris'>('values')
  const [valuesSort, setValuesSort] = useState<{ col: 'key' | 'frequency'; dir: 'asc' | 'desc' }>({ col: 'frequency', dir: 'desc' })
  const [loading, setLoading] = useState(false)
  const [alert, setAlert] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onOk: () => void } | null>(null)
  const [showRunModal, setShowRunModal] = useState(false)
  const notificationTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [rightPanelWidth, setRightPanelWidth] = useState(320)
  const [rightCollapsed, setRightCollapsed] = useState(false)
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
    Promise.all([
      getAnalysisStructure(selectedAnalysis, selectedDb),
      getDocStats(selectedAnalysis, selectedDb),
    ])
      .then(([structure, stats]) => {
        setNodes(structure)
        setDocStats(stats)
      })
      .catch(() => setAlert('Failed to load analysis data'))
      .finally(() => setLoading(false))
  }, [selectedAnalysis, selectedDb])

  // Load values when a node is selected
  useEffect(() => {
    if (!selectedNode || !selectedAnalysis) return
    const type = selectedNode.type === 'attribute' ? 'attribute-values' : 'element-values'
    getAnalysisValues(selectedAnalysis, selectedNode.parentChildKey, type)
      .then(setValues)
      .catch(console.error)
  }, [selectedNode, selectedAnalysis])

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

  function startNotificationPolling() {
    if (notificationTimer.current) clearInterval(notificationTimer.current)
    let elapsed = 0
    notificationTimer.current = setInterval(() => {
      elapsed += 5000
      if (elapsed > 300_000) clearInterval(notificationTimer.current!) // stop after 5 min
      getAnalysisList(selectedDb).then(list => {
        setAnalyses(list)
        if (list.length > 0 && !selectedAnalysis) setSelectedAnalysis(list[0].analysisId)
      }).catch(() => {})
    }, 5000)
  }

  useEffect(() => () => {
    if (notificationTimer.current) clearInterval(notificationTimer.current)
  }, [])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'structure', label: 'Structure' },
  ]

  return (
    <div className="flex flex-col h-full">
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
            startNotificationPolling()
          }}
        />
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-900 mr-2">Analyze</h2>

        {analyses.length > 0 && (
          <select
            value={selectedAnalysis}
            onChange={e => setSelectedAnalysis(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          >
            {analyses.map(a => (
              <option key={a.analysisId} value={a.analysisId}>
                {a.localname} [{a.analysisName}]
              </option>
            ))}
          </select>
        )}

        <button className="btn-primary text-sm" onClick={() => setShowRunModal(true)}>
          Run Analysis
        </button>

        {selectedAnalysis && (
          <button className="btn-danger text-sm" onClick={handleDeleteAnalysis}>
            Delete
          </button>
        )}
      </div>

      {/* Doc Stats Bar */}
      {docStats && (
        <div className="flex gap-6 px-6 py-2 bg-gray-50 border-b text-xs text-gray-600 flex-shrink-0">
          <span>Avg: {fileSizeFormat(docStats.avgDocumentSize)}</span>
          <span>Min: {fileSizeFormat(docStats.minDocumentSize)}</span>
          <span>Max: {fileSizeFormat(docStats.maxDocumentSize)}</span>
          <span>Median: {fileSizeFormat(docStats.medianDocumentSize)}</span>
        </div>
      )}

      {/* Content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left — Structure tree */}
        <div className="flex-1 overflow-auto border-r border-gray-200">
          {/* Tabs */}
          <div className="flex border-b border-gray-200 bg-white flex-shrink-0">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === t.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
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
                  {nodes.map(node => (
                    <TreeRow
                      key={node.key}
                      node={node}
                      selected={selectedNode?.key === node.key}
                      onClick={setSelectedNode}
                    />
                  ))}
                  {nodes.length === 0 && !loading && (
                    <tr>
                      <td colSpan={6} className="text-center text-gray-400 py-8">
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
                className="absolute z-20 flex items-center justify-center w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-600 hover:bg-blue-600 hover:text-white hover:border-blue-500 transition-colors shadow-md text-xs"
                style={{ left: rightCollapsed ? '-10px' : '-10px', top: '12px' }}
              >
                {rightCollapsed ? '‹' : '›'}
              </button>
            </div>

            {/* Panel content */}
            {!rightCollapsed && (
              <div
                className="flex-shrink-0 flex flex-col border-l border-gray-200"
                style={{ width: rightPanelWidth }}
              >
                {/* Sub-tabs */}
                <div className="flex border-b border-gray-200 bg-white flex-shrink-0">
                  {(['values', 'xpaths', 'uris'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setRightTab(tab)}
                      className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors capitalize ${
                        rightTab === tab
                          ? 'border-blue-600 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab === 'xpaths' ? 'XPaths' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>

                <div className="overflow-auto flex-1">
                  {rightTab === 'values' && (() => {
                    const sorted = [...(values?.rows ?? [])].sort((a, b) => {
                      const mul = valuesSort.dir === 'asc' ? 1 : -1
                      if (valuesSort.col === 'frequency')
                        return mul * (Number(a.frequency) - Number(b.frequency))
                      return mul * a.key.localeCompare(b.key)
                    })
                    const toggleSort = (col: 'key' | 'frequency') =>
                      setValuesSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))
                    const arrow = (col: 'key' | 'frequency') =>
                      valuesSort.col === col ? (valuesSort.dir === 'asc' ? ' ▲' : ' ▼') : ''
                    return (
                      <div className="table-container">
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
                            {sorted.map((v, i) => (
                              <tr key={i}>
                                <td className="font-mono text-xs truncate max-w-48">{v.key}</td>
                                <td className="text-right text-xs">{v.frequency}</td>
                              </tr>
                            ))}
                            {sorted.length === 0 && (
                              <tr>
                                <td colSpan={2} className="text-center text-gray-400 py-4 text-xs">
                                  No values
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )
                  })()}

                  {rightTab === 'xpaths' && (
                    <div className="p-3">
                      <p className="font-mono text-xs break-all text-gray-800">
                        {selectedNode.xpath || <span className="text-gray-400">No XPath available</span>}
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
                              <td colSpan={2} className="text-center text-gray-400 py-4 text-xs">
                                No URIs
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
      </div>
    </div>
  )
}
