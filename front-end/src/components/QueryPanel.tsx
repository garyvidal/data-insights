import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, ShieldCheck, Bookmark, BookmarkPlus, X, Trash2, ChevronLeft, ChevronRight, Braces, ChevronsUpDown, ChevronsDownUp } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { StreamLanguage } from '@codemirror/language'
import { xQuery } from '@codemirror/legacy-modes/mode/xquery'
import { xml } from '@codemirror/lang-xml'
import { json } from '@codemirror/lang-json'
import { useTheme } from '../context/ThemeContext'
import * as api from '../services/api'
import type { QueryResult } from '../services/api'
import type { Expression } from '../types'

interface QueryPanelProps {
  db: string
  analysisId: string
  selectedXPath?: string
}

const MIN_HEIGHT = 140
const DEFAULT_HEIGHT = 320
const MAX_HEIGHT_VH = 0.65

function detectLanguage(text: string): 'json' | 'xml' | 'unknown' {
  const t = text.trimStart()
  if (t.startsWith('{') || t.startsWith('[')) return 'json'
  if (t.startsWith('<')) return 'xml'
  return 'unknown'
}

function prettyPrintContent(content: string, lang: 'json' | 'xml' | 'unknown'): string {
  try {
    if (lang === 'json') {
      return JSON.stringify(JSON.parse(content), null, 2)
    }
    if (lang === 'xml') {
      // Use DOMParser + XMLSerializer for indented XML
      const doc = new DOMParser().parseFromString(content, 'application/xml')
      const err = doc.querySelector('parsererror')
      if (err) return content
      return indentXml(doc.documentElement, 0)
    }
  } catch {
    // fall through to raw
  }
  return content
}

function indentXml(node: Element, depth: number): string {
  const pad = '  '.repeat(depth)
  const childPad = '  '.repeat(depth + 1)
  const children = Array.from(node.childNodes)
  const hasElementChildren = children.some(c => c.nodeType === Node.ELEMENT_NODE)

  const attrs = Array.from(node.attributes)
    .map(a => ` ${a.name}="${a.value}"`)
    .join('')

  if (!hasElementChildren) {
    const text = node.textContent ?? ''
    return text.trim()
      ? `${pad}<${node.tagName}${attrs}>${text.trim()}</${node.tagName}>`
      : `${pad}<${node.tagName}${attrs}/>`
  }

  const inner = children
    .filter(c => c.nodeType === Node.ELEMENT_NODE)
    .map(c => indentXml(c as Element, depth + 1))
    .join('\n')

  return `${pad}<${node.tagName}${attrs}>\n${inner}\n${pad}</${node.tagName}>`
}

function typeColor(type: string): string {
  switch (type) {
    case 'document': return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
    case 'object':   return 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
    case 'array':    return 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
    case 'element':  return 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
    default:         return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
  }
}

// ── Collapsible result card ───────────────────────────────────────────────────
function ResultCard({
  result,
  index,
  expanded,
  onToggle,
  cmTheme,
  prettyPrint,
}: {
  result: QueryResult
  index: number
  expanded: boolean
  onToggle: () => void
  cmTheme: 'dark' | 'light'
  prettyPrint: boolean
}) {
  const lang = detectLanguage(result.content)
  const ext = lang === 'json' ? [json()] : lang === 'xml' ? [xml()] : []
  const content = prettyPrint ? prettyPrintContent(result.content, lang) : result.content

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 last:border-0">
      {/* Result bar */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-left select-none"
      >
        <span className="text-gray-400 dark:text-gray-500 text-xs w-3 flex-shrink-0">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 w-6 text-right">
          {index + 1}
        </span>
        <span className={`text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${typeColor(result.type)}`}>
          {result.type}
        </span>
        <span className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate flex-1" title={result.uri}>
          {result.uri}
        </span>
        {result.collections && result.collections.length > 0 && (
          <span className="flex items-center gap-1 flex-shrink-0 flex-wrap">
            {result.collections.map((col, ci) => (
              <span
                key={ci}
                className="text-xs font-mono px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300"
                title={col}
              >
                {col.split('/').filter(Boolean).pop() ?? col}
              </span>
            ))}
          </span>
        )}
      </button>

      {/* Result content */}
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <CodeMirror
            value={content}
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

// ── Main panel ────────────────────────────────────────────────────────────────
export default function QueryPanel({ db, analysisId, selectedXPath }: QueryPanelProps) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const cmTheme = isDark ? 'dark' : 'light'

  // ── Panel state ───────────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState(false)
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  // ── Query state ───────────────────────────────────────────────────────────
  const [constraint, setConstraint] = useState('cts:and-query(())')
  const [xpath, setXpath] = useState('fn:collection()')
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)

  // ── Result state ──────────────────────────────────────────────────────────
  const [validating, setValidating] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [validState, setValidState] = useState<'idle' | 'valid' | 'invalid'>('idle')
  const [validError, setValidError] = useState('')
  const [estimate, setEstimate] = useState<number | null>(null)
  const [results, setResults] = useState<QueryResult[]>([])
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [prettyPrint, setPrettyPrint] = useState(true)
  const [execError, setExecError] = useState('')
  const [totalPages, setTotalPages] = useState(1)

  // ── Saved expressions ─────────────────────────────────────────────────────
  const [expressions, setExpressions] = useState<Expression[]>([])
  const [showSaved, setShowSaved] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)

  // Pre-fill xpath from selected node
  useEffect(() => {
    if (selectedXPath) setXpath(selectedXPath)
  }, [selectedXPath])

  // Load saved expressions when panel opens
  useEffect(() => {
    if (!collapsed && db) {
      api.listExpressions(db).then(setExpressions).catch(console.error)
    }
  }, [collapsed, db])

  // ── Resize drag ───────────────────────────────────────────────────────────
  const onDragMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startH: panelHeight }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return
      const delta = dragRef.current.startY - ev.clientY
      const maxH = window.innerHeight * MAX_HEIGHT_VH
      setPanelHeight(Math.min(maxH, Math.max(MIN_HEIGHT, dragRef.current.startH + delta)))
    }
    function onUp() {
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [panelHeight])

  // ── Expand / collapse all ─────────────────────────────────────────────────
  const allExpanded = results.length > 0 && expandedRows.size === results.length
  const toggleAll = () => {
    setExpandedRows(allExpanded ? new Set() : new Set(results.map((_, i) => i)))
  }
  const toggleRow = (i: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleValidate = async () => {
    setValidating(true)
    setValidState('idle')
    setValidError('')
    try {
      const res = await api.validateExpression(db, constraint, xpath)
      setValidState(res.valid ? 'valid' : 'invalid')
      setValidError(res.error || '')
    } catch (e) {
      setValidState('invalid')
      setValidError(e instanceof Error ? e.message : 'Validation failed')
    } finally {
      setValidating(false)
    }
  }

  const handleExecute = async (p = 1) => {
    const isNewQuery = p === 1
    setExecuting(true)
    setExecError('')
    setResults([])
    setPage(p)
    // Only reset expanded state on a fresh query execution, not pagination
    if (isNewQuery) setExpandedRows(new Set())
    try {
      const res = await api.executeQueryResults(db, constraint, xpath, analysisId, p, pageSize)
      if (res.valid) {
        const est = parseInt(res.estimate, 10) || 0
        setEstimate(est)
        setResults(res.results)
        setTotalPages(Math.max(1, Math.ceil(est / pageSize)))
        setValidState('valid')
        // Auto-expand only on initial execution with few results
        if (isNewQuery && res.results.length <= 5) {
          setExpandedRows(new Set(res.results.map((_, i) => i)))
        }
      } else {
        setExecError(res.error || 'Query failed')
        setEstimate(null)
        setValidState('invalid')
      }
    } catch (e) {
      setExecError(e instanceof Error ? e.message : 'Execution failed')
      setEstimate(null)
    } finally {
      setExecuting(false)
    }
  }

  const handleSave = async () => {
    if (!saveName.trim()) return
    try {
      await api.saveExpression(db, saveName.trim(), constraint, xpath)
      setSaveName('')
      setShowSaveInput(false)
      setExpressions(await api.listExpressions(db))
    } catch (e) {
      console.error('Save failed', e)
    }
  }

  const handleDeleteExpression = async (id: string) => {
    try {
      await api.deleteExpression(id)
      setExpressions(prev => prev.filter(e => e.id !== id))
    } catch (e) {
      console.error('Delete failed', e)
    }
  }

  const loadExpression = async (id: string) => {
    try {
      const expr = await api.getExpression(id)
      if (expr.query) setConstraint(expr.query)
      if (expr.xpath) setXpath(expr.xpath)
      setShowSaved(false)
      setResults([])
      setExpandedRows(new Set())
      setEstimate(null)
      setValidState('idle')
    } catch (e) {
      console.error('Load expression failed', e)
    }
  }

  const xqueryExt = [StreamLanguage.define(xQuery)]

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex-shrink-0 flex flex-col border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">

      {/* Drag handle */}
      {!collapsed && (
        <div
          className="h-1.5 w-full cursor-row-resize hover:bg-blue-500 transition-colors bg-transparent flex-shrink-0"
          onMouseDown={onDragMouseDown}
        />
      )}

      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-200 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 flex-shrink-0 select-none">
        <button
          onClick={() => setCollapsed(v => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400"
        >
          <span className="text-xs">{collapsed ? '▸' : '▾'}</span>
          Query
        </button>

        {!collapsed && (
          <>
            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />
            <button
              onClick={handleValidate}
              disabled={validating}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-gray-400 dark:border-white/25 bg-gray-100 dark:bg-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 hover:border-gray-500 dark:hover:border-white/50 disabled:opacity-50 transition-colors"
              title="Validate query"
            >
              <ShieldCheck size={12} />
              {validating ? 'Validating…' : 'Validate'}
            </button>
            <button
              onClick={() => handleExecute(1)}
              disabled={executing}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-blue-400 dark:border-blue-400/40 bg-gray-100 dark:bg-transparent text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-400/10 hover:border-blue-500 dark:hover:border-blue-400/70 disabled:opacity-50 transition-colors"
              title="Execute query"
            >
              <Play size={12} />
              {executing ? 'Running…' : 'Execute'}
            </button>

            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setResults([]); setEstimate(null) }}
              className="ml-1 text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
            </select>

            {/* Inline status */}
            {validState === 'valid' && !execError && (
              <span className="text-xs text-green-600 dark:text-green-400 ml-1">
                ✓ Valid{estimate !== null ? ` · ${estimate.toLocaleString()} matched` : ''}
              </span>
            )}
            {validState === 'invalid' && (
              <span className="text-xs text-red-500 dark:text-red-400 ml-1 truncate max-w-xs" title={validError || execError}>
                ✗ {validError || execError}
              </span>
            )}

            <div className="flex-1" />

            {/* Saved expressions */}
            <div className="relative">
              <button
                onClick={() => setShowSaved(v => !v)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-gray-400 dark:border-white/25 bg-gray-100 dark:bg-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 hover:border-gray-500 dark:hover:border-white/50 transition-colors"
                title="Saved queries"
              >
                <Bookmark size={12} />
                Saved{expressions.length > 0 ? ` (${expressions.length})` : ''}
              </button>
              {showSaved && (
                <div className="absolute bottom-full right-0 mb-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg z-30 max-h-60 overflow-y-auto">
                  {expressions.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">No saved queries</p>
                  ) : expressions.map(expr => (
                    <div key={expr.id} className="flex items-center justify-between px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0">
                      <button
                        onClick={() => loadExpression(expr.id)}
                        className="text-xs text-left text-gray-800 dark:text-gray-200 flex-1 truncate hover:text-blue-600 dark:hover:text-blue-400"
                        title={expr.name}
                      >
                        {expr.name}
                      </button>
                      <button
                        onClick={() => handleDeleteExpression(expr.id)}
                        className="ml-2 flex items-center text-red-400 hover:text-red-600 dark:hover:text-red-300 flex-shrink-0 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {showSaveInput ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  type="text"
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowSaveInput(false) }}
                  placeholder="Query name…"
                  className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white w-32"
                />
                <button onClick={handleSave} className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-green-500 dark:border-green-400/30 bg-gray-100 dark:bg-transparent text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-400/10 transition-colors">
                  <BookmarkPlus size={12} /> Save
                </button>
                <button onClick={() => setShowSaveInput(false)} className="flex items-center justify-center w-6 h-6 rounded border border-gray-400 dark:border-white/20 bg-gray-100 dark:bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSaveInput(true)}
                className="flex items-center justify-center w-7 h-7 rounded border border-gray-400 dark:border-white/25 bg-gray-100 dark:bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10 hover:border-gray-500 dark:hover:border-white/50 transition-colors"
                title="Save query"
              >
                <BookmarkPlus size={13} />
              </button>
            )}
          </>
        )}
      </div>

      {/* Expanded body */}
      {!collapsed && (
        <div className="flex flex-col overflow-hidden" style={{ height: panelHeight }}>

          {/* Editors row */}
          <div className="flex flex-shrink-0 border-b border-gray-200 dark:border-gray-700" style={{ height: 80 }}>
            <div className="flex-1 flex flex-col border-r border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 flex-shrink-0">
                cts: Constraint
              </div>
              <div className="flex-1 overflow-hidden">
                <CodeMirror
                  value={constraint}
                  onChange={v => { setConstraint(v); setValidState('idle') }}
                  extensions={xqueryExt}
                  theme={cmTheme}
                  basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
                  style={{ height: '100%', fontSize: '12px' }}
                  height="100%"
                />
              </div>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 flex-shrink-0">
                XPath Scope
              </div>
              <div className="flex-1 overflow-hidden">
                <CodeMirror
                  value={xpath}
                  onChange={v => { setXpath(v); setValidState('idle') }}
                  extensions={xqueryExt}
                  theme={cmTheme}
                  basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
                  style={{ height: '100%', fontSize: '12px' }}
                  height="100%"
                />
              </div>
            </div>
          </div>

          {/* Results area */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {execError && (
              <div className="px-3 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 flex-shrink-0">
                {execError}
              </div>
            )}

            {results.length > 0 ? (
              <>
                {/* Results toolbar — pagination + expand/collapse all */}
                <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {estimate?.toLocaleString()} results
                      {totalPages > 1 && ` · page ${page} of ${totalPages}`}
                    </span>
                    <button
                      onClick={toggleAll}
                      className="flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-gray-400 dark:border-white/20 bg-gray-100 dark:bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                      title={allExpanded ? 'Collapse all' : 'Expand all'}
                    >
                      {allExpanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
                      {allExpanded ? 'Collapse' : 'Expand'}
                    </button>
                    <button
                      onClick={() => setPrettyPrint(v => !v)}
                      className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${
                        prettyPrint
                          ? 'border-blue-500 dark:border-blue-400/50 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-400/10'
                          : 'border-gray-400 dark:border-white/20 bg-gray-100 dark:bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'
                      }`}
                      title="Toggle pretty-print indentation"
                    >
                      <Braces size={12} /> Pretty
                    </button>
                  </div>
                  {totalPages > 1 && (
                    <div className="flex gap-1">
                      <button
                        disabled={page <= 1 || executing}
                        onClick={() => handleExecute(page - 1)}
                        className="flex items-center justify-center w-6 h-6 rounded border border-gray-400 dark:border-white/20 bg-gray-100 dark:bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        title="Previous page"
                      ><ChevronLeft size={13} /></button>
                      <button
                        disabled={page >= totalPages || executing}
                        onClick={() => handleExecute(page + 1)}
                        className="flex items-center justify-center w-6 h-6 rounded border border-gray-400 dark:border-white/20 bg-gray-100 dark:bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        title="Next page"
                      ><ChevronRight size={13} /></button>
                    </div>
                  )}
                </div>

                {/* Result cards */}
                <div className="flex-1 overflow-y-auto">
                  {results.map((r, i) => (
                    <ResultCard
                      key={`${page}-${i}`}
                      result={r}
                      index={i}
                      expanded={expandedRows.has(i)}
                      onToggle={() => toggleRow(i)}
                      cmTheme={cmTheme}
                      prettyPrint={prettyPrint}
                    />
                  ))}
                </div>
              </>
            ) : (
              !executing && !execError && (
                <div className="flex items-center justify-center flex-1 text-xs text-gray-400 dark:text-gray-500">
                  {estimate === 0 ? 'No documents matched.' : 'Enter a query and click Execute.'}
                </div>
              )
            )}

            {executing && (
              <div className="flex items-center justify-center flex-1 text-xs text-gray-500 dark:text-gray-400">
                Running…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
