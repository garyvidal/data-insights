import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Play, ChevronDown, ChevronRight, Braces, ChevronLeft, ChevronRight as ChevronRightIcon } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { useDatabase } from '../context/useDatabase'
import { useTheme } from '../context/ThemeContext'
import {
  getAnalysisList,
  getAnalysisStructure,
  saveSearchOptions,
  updateSearchOptions,
  executeSearch,
} from '../services/api'
import type {
  Analysis,
  AnalysisNode,
  SearchConstraint,
  SearchConstraintType,
  SearchFacet,
  SearchResultItem,
} from '../types'
import LoadingOverlay from '../components/LoadingOverlay'
import AlertDialog from '../components/AlertDialog'
import ConfirmDialog from '../components/ConfirmDialog'

// ── Helpers ───────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2)
}

function inferConstraintType(node: AnalysisNode): SearchConstraintType {
  const kind    = (node.nodeKind    || '').toLowerCase()
  const infered = (node.inferedTypes || '').toLowerCase()
  if (kind === 'array' || kind === 'object') return 'range'
  if (infered.includes('integer') || infered.includes('decimal') ||
      infered.includes('float')   || infered.includes('double')  ||
      infered.includes('date'))                                   return 'range'
  if (infered.includes('boolean'))                                return 'value'
  return 'word'
}

function constraintTypeColor(type: SearchConstraintType): string {
  switch (type) {
    case 'range':      return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
    case 'word':       return 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
    case 'value':      return 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
    case 'collection': return 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300'
  }
}

function buildOptionsJson(constraints: SearchConstraint[]): string {
  return JSON.stringify({ constraints }, null, 2)
}

// ── Result card (reused pattern from QueryPanel) ──────────────────────────

function typeColor(type: string): string {
  switch (type) {
    case 'document': return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
    case 'object':   return 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
    case 'array':    return 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
    case 'element':  return 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
    default:         return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
  }
}

function ResultCard({
  result, index, expanded, onToggle, cmTheme,
}: {
  result: SearchResultItem; index: number; expanded: boolean
  onToggle: () => void; cmTheme: 'dark' | 'light'
}) {
  const lang = result.content.trimStart().startsWith('{') || result.content.trimStart().startsWith('[') ? 'json' : 'xml'
  const ext  = lang === 'json' ? [json()] : []

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 last:border-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-left select-none"
      >
        <span className="text-gray-400 dark:text-gray-500 text-xs w-3 flex-shrink-0">{expanded ? '▾' : '▸'}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 w-6 text-right">{index + 1}</span>
        <span className={`text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${typeColor(result.type)}`}>{result.type}</span>
        <span className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate flex-1" title={result.uri}>{result.uri}</span>
        {result.collections && result.collections.length > 0 && (
          <span className="flex items-center gap-1 flex-shrink-0">
            {result.collections.map((col, ci) => (
              <span key={ci} className="text-xs font-mono px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300" title={col}>
                {col.split('/').filter(Boolean).pop() ?? col}
              </span>
            ))}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <CodeMirror
            value={result.content}
            extensions={ext}
            theme={cmTheme}
            readOnly
            basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
            style={{ fontSize: '12px' }}
          />
        </div>
      )}
    </div>
  )
}

// ── Facet sidebar ─────────────────────────────────────────────────────────

function FacetPanel({ facets, onAddFilter }: { facets: SearchFacet[]; onAddFilter: (name: string, value: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set(facets.map(f => f.name)))
  const toggle = (name: string) => setOpen(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })

  if (facets.length === 0) return null

  return (
    <div className="w-48 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-y-auto bg-white dark:bg-gray-900">
      <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700">
        Facets
      </div>
      {facets.map(f => (
        <div key={f.name} className="border-b border-gray-100 dark:border-gray-800">
          <button
            onClick={() => toggle(f.name)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <span className="truncate">{f.name}</span>
            {open.has(f.name) ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
          {open.has(f.name) && (
            <div className="pb-1">
              {f.values.map(v => (
                <button
                  key={v.name}
                  onClick={() => onAddFilter(f.name, v.name)}
                  className="w-full flex items-center justify-between px-4 py-0.5 text-xs text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                  title={`Filter: ${f.name}:"${v.name}"`}
                >
                  <span className="truncate">{v.name || '(empty)'}</span>
                  <span className="text-gray-400 dark:text-gray-500 flex-shrink-0 ml-1">{v.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function SearchPage() {
  const { selectedDb } = useDatabase()
  const { theme } = useTheme()
  const cmTheme = theme === 'dark' ? 'dark' : 'light'

  // ── Analysis picker ───────────────────────────────────────────────────
  const [analyses, setAnalyses]             = useState<Analysis[]>([])
  const [selectedAnalysis, setSelectedAnalysis] = useState('')
  const [structureNodes, setStructureNodes] = useState<AnalysisNode[]>([])
  const [showFieldPicker, setShowFieldPicker] = useState(false)

  // ── Constraints / options builder ─────────────────────────────────────
  const [constraints, setConstraints]       = useState<SearchConstraint[]>([])
  const [selectedOptionsId, setSelectedOptionsId] = useState('')
  const selectedOptionsIdRef = useRef('')
  const [showJsonPreview, setShowJsonPreview] = useState(false)
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set())

  // ── Search ────────────────────────────────────────────────────────────
  const [queryStr, setQueryStr]             = useState('')
  const [executing, setExecuting]           = useState(false)
  const [results, setResults]               = useState<SearchResultItem[]>([])
  const [facets, setFacets]                 = useState<SearchFacet[]>([])
  const [estimate, setEstimate]             = useState<number | null>(null)
  const [page, setPage]                     = useState(1)
  const [pageSize]                          = useState(25)
  const [totalPages, setTotalPages]         = useState(1)
  const [execError, setExecError]           = useState('')
  const [expandedRows, setExpandedRows]     = useState<Set<number>>(new Set())

  // ── UI state ──────────────────────────────────────────────────────────
  const [loading, setLoading]               = useState(false)
  const [alert, setAlert]                   = useState<string | null>(null)
  const [confirm, setConfirm]               = useState<{ message: string; onOk: () => void } | null>(null)

  // ── Load analyses ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedDb) return
    setAnalyses([])
    setSelectedAnalysis('')
    setStructureNodes([])
    setConstraints([])
    setResults([])
    setFacets([])
    getAnalysisList(selectedDb)
      .then(list => { setAnalyses(list); if (list.length > 0) setSelectedAnalysis(list[0].analysisId) })
      .catch(() => setAlert('Failed to load analysis list'))
  }, [selectedDb])

  // ── Load structure when analysis changes ──────────────────────────────
  useEffect(() => {
    if (!selectedAnalysis || !selectedDb) return
    setLoading(true)
    getAnalysisStructure(selectedAnalysis, selectedDb)
      .then(setStructureNodes)
      .catch(() => setAlert('Failed to load analysis structure'))
      .finally(() => setLoading(false))
  }, [selectedAnalysis, selectedDb])

  // ── Add constraints from field picker ────────────────────────────────
  function nodeToConstraint(node: AnalysisNode): SearchConstraint {
    const name = node.localname.replace(/^@/, '').replace(/[^a-zA-Z0-9_-]/g, '-')
    return {
      id:           uid(),
      name,
      type:         inferConstraintType(node),
      localname:    node.localname.replace(/^@/, ''),
      namespace:    node.namespace ?? '',
      nodeKind:     node.nodeKind ?? '',
      inferedTypes: node.inferedTypes ?? '',
      facet:        false,
    }
  }

  function togglePickerNode(key: string) {
    setPickerSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function addSelectedConstraints() {
    const nodes = structureNodes.filter(n => pickerSelected.has(n.key))
    if (nodes.length === 0) return
    setConstraints(prev => [...prev, ...nodes.map(nodeToConstraint)])
    setPickerSelected(new Set())
    setShowFieldPicker(false)
  }

  function removeConstraint(id: string) {
    setConstraints(prev => prev.filter(c => c.id !== id))
  }

  function updateConstraint(id: string, patch: Partial<SearchConstraint>) {
    setConstraints(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  function setOptionsId(id: string) {
    selectedOptionsIdRef.current = id
    setSelectedOptionsId(id)
  }

  // ── Execute search ────────────────────────────────────────────────────
  const handleSearch = useCallback(async (p = 1) => {
    if (constraints.length === 0) {
      setAlert('Add at least one constraint before searching.')
      return
    }
    setExecuting(true)
    setExecError('')
    setResults([])
    setFacets([])
    setPage(p)
    if (p === 1) setExpandedRows(new Set())
    try {
      // Auto-save/update the options silently so the backend always has a current copy
      let optId = selectedOptionsIdRef.current
      const optionsJson = buildOptionsJson(constraints)
      if (optId) {
        await updateSearchOptions(optId, 'default', optionsJson)
      } else {
        const saved = await saveSearchOptions(selectedDb, selectedAnalysis, 'default', optionsJson)
        optId = saved.id
        setOptionsId(optId)
      }
      const res = await executeSearch(selectedDb, optId, queryStr, p, pageSize)
      if (res.valid) {
        const est = parseInt(res.estimate, 10) || 0
        setEstimate(est)
        setResults(res.results)
        setFacets(res.facets ?? [])
        setTotalPages(Math.max(1, Math.ceil(est / pageSize)))
        if (p === 1 && res.results.length <= 5)
          setExpandedRows(new Set(res.results.map((_, i) => i)))
      } else {
        setExecError(res.error ?? 'Search failed')
        setEstimate(null)
      }
    } catch (e) {
      setExecError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setExecuting(false)
    }
  }, [selectedDb, selectedAnalysis, queryStr, pageSize, constraints])

  function addFilter(constraintName: string, value: string) {
    const addition = ` ${constraintName}:"${value}"`
    setQueryStr(prev => (prev + addition).trim())
  }

  const optionsJson = buildOptionsJson(constraints)
  const hasResults  = results.length > 0

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      <LoadingOverlay show={loading} message="Loading structure..." />
      <AlertDialog open={!!alert} message={alert ?? ''} onClose={() => setAlert(null)} />
      <ConfirmDialog
        open={!!confirm}
        message={confirm?.message ?? ''}
        onConfirm={() => { confirm?.onOk(); setConfirm(null) }}
        onCancel={() => setConfirm(null)}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mr-2">Search</h2>

        {/* Analysis selector */}
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

        <div className="flex-1" />
      </div>

      {/* Body: 3-column layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Constraints builder */}
        <div className="w-72 flex-shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Constraints</span>
            <button
              onClick={() => { setShowFieldPicker(v => !v); setPickerSelected(new Set()) }}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400"
              title="Add constraints from analysis fields"
            >
              <Plus size={12} /> Add Field
            </button>
          </div>

          {/* Field picker */}
          {showFieldPicker && (
            <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 flex flex-col">
              <div className="flex-1 overflow-y-auto max-h-48">
                {structureNodes.filter(n => n.type !== 'complex' as string).map(n => (
                  <label
                    key={n.key}
                    className={`w-full flex items-center gap-2 py-1 text-xs cursor-pointer select-none hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
                      pickerSelected.has(n.key) ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'
                    }`}
                    style={{ paddingLeft: `${12 + parseInt(n.level || '0') * 12}px`, paddingRight: '12px' }}
                  >
                    <input
                      type="checkbox"
                      checked={pickerSelected.has(n.key)}
                      onChange={() => togglePickerNode(n.key)}
                      className="rounded flex-shrink-0"
                    />
                    <span className="font-mono truncate flex-1">{n.localname}</span>
                    <span className="ml-auto text-gray-400 dark:text-gray-500 flex-shrink-0">
                      {n.nodeKind || n.inferedTypes || ''}
                    </span>
                  </label>
                ))}
                {structureNodes.length === 0 && (
                  <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">No fields — run an analysis first.</p>
                )}
              </div>
              {/* Footer: Add button */}
              <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0">
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {pickerSelected.size > 0 ? `${pickerSelected.size} selected` : 'Select fields'}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setShowFieldPicker(false); setPickerSelected(new Set()) }}
                    className="text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addSelectedConstraints}
                    disabled={pickerSelected.size === 0}
                    className="text-xs px-2 py-0.5 rounded border border-blue-400 dark:border-blue-400/50 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-400/10 hover:bg-blue-100 dark:hover:bg-blue-400/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Add {pickerSelected.size > 0 ? `(${pickerSelected.size})` : ''}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Constraint list */}
          <div className="flex-1 overflow-y-auto">
            {constraints.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-400 dark:text-gray-500 text-center">
                No constraints yet. Add fields above.
              </p>
            ) : (
              constraints.map(c => (
                <div key={c.id} className="border-b border-gray-100 dark:border-gray-800 px-3 py-2 space-y-1.5">
                  {/* Name */}
                  <div className="flex items-center gap-2">
                    <input
                      value={c.name}
                      onChange={e => updateConstraint(c.id, { name: e.target.value })}
                      className="flex-1 text-xs border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono"
                      placeholder="constraint name"
                    />
                    <button onClick={() => removeConstraint(c.id)} className="text-red-400 hover:text-red-600 dark:hover:text-red-300 flex-shrink-0">
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {/* Field + type */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate flex-1" title={c.localname}>{c.localname}</span>
                    <select
                      value={c.type}
                      onChange={e => updateConstraint(c.id, { type: e.target.value as SearchConstraintType })}
                      className={`text-xs rounded px-1.5 py-0.5 border-0 font-medium ${constraintTypeColor(c.type)}`}
                    >
                      <option value="word">word</option>
                      <option value="value">value</option>
                      <option value="range">range</option>
                      <option value="collection">collection</option>
                    </select>
                  </div>
                  {/* Facet toggle */}
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={c.facet}
                      onChange={e => updateConstraint(c.id, { facet: e.target.checked })}
                      className="rounded"
                    />
                    Return facet counts
                  </label>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Centre: search bar + results */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Search bar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex-shrink-0">
            <input
              type="text"
              value={queryStr}
              onChange={e => setQueryStr(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch(1) }}
              placeholder='Enter query… e.g.  fieldName:"value"  or  term'
              className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => handleSearch(1)}
              disabled={executing}
              className="btn-primary text-sm flex items-center gap-1.5 px-3 py-1.5"
            >
              <Play size={13} />
              {executing ? 'Searching…' : 'Search'}
            </button>
            {estimate !== null && !execError && (
              <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                {estimate.toLocaleString()} result{estimate !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Results area */}
          <div className="flex flex-1 overflow-hidden">
            {/* Facets */}
            <FacetPanel facets={facets} onAddFilter={addFilter} />

            {/* Result cards */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {execError && (
                <div className="px-3 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 flex-shrink-0">
                  {execError}
                </div>
              )}

              {hasResults && (
                <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex-shrink-0">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {estimate?.toLocaleString()} results{totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''}
                  </span>
                  {totalPages > 1 && (
                    <div className="flex gap-1">
                      <button
                        disabled={page <= 1 || executing}
                        onClick={() => handleSearch(page - 1)}
                        className="flex items-center justify-center w-6 h-6 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                      ><ChevronLeft size={13} /></button>
                      <button
                        disabled={page >= totalPages || executing}
                        onClick={() => handleSearch(page + 1)}
                        className="flex items-center justify-center w-6 h-6 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                      ><ChevronRightIcon size={13} /></button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                {hasResults ? results.map((r, i) => (
                  <ResultCard
                    key={`${page}-${i}`}
                    result={r}
                    index={i}
                    expanded={expandedRows.has(i)}
                    onToggle={() => setExpandedRows(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })}
                    cmTheme={cmTheme}
                  />
                )) : (
                  !executing && !execError && (
                    <div className="flex items-center justify-center h-full text-xs text-gray-400 dark:text-gray-500">
                      {estimate === 0 ? 'No results matched.' : 'Build constraints, save, then search.'}
                    </div>
                  )
                )}
                {executing && (
                  <div className="flex items-center justify-center h-full text-xs text-gray-500 dark:text-gray-400">
                    Searching…
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right: JSON preview */}
        {showJsonPreview && (
          <div className="w-80 flex-shrink-0 border-l border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-900">
            <div className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide border-b border-gray-200 dark:border-gray-700">
              Options JSON
            </div>
            <div className="flex-1 overflow-auto">
              <CodeMirror
                value={optionsJson}
                extensions={[json()]}
                theme={cmTheme}
                readOnly
                basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
                style={{ fontSize: '12px' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
