import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDatabase } from '../context/useDatabase'
import { uploadFiles } from '../services/api'
import type { UploadPermission, UploadResult } from '../types'
import { ChevronRight, ChevronLeft, Upload, X, Plus, UploadCloud, RefreshCw, LayoutDashboard, Eye } from 'lucide-react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

// ── Types ─────────────────────────────────────────────────────────────────

type Step = 'upload' | 'preview' | 'permissions' | 'summary' | 'results'
type Capability = 'read' | 'update' | 'insert' | 'execute'

// UI-only — one row per role, multiple capabilities selectable
interface PermissionRow {
  role: string
  capabilities: Set<Capability>
}

const ALL_CAPS: Capability[] = ['read', 'update', 'insert', 'execute']

const ACCEPTED_EXTS = new Set(['json', 'xml', 'csv', 'xlsx', 'xls', 'zip'])
const ACCEPT_ATTR = '.json,.xml,.csv,.xlsx,.xls,.zip'

// ── Helpers ───────────────────────────────────────────────────────────────

function getExt(name: string): string {
  const parts = name.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

function getAction(ext: string): 'insert' | 'convert' | 'zip' | 'skip' {
  if (ext === 'json' || ext === 'xml') return 'insert'
  if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') return 'convert'
  if (ext === 'zip') return 'zip'
  return 'skip'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Preview data types ────────────────────────────────────────────────────

type CsvPreview = { headers: string[]; rows: string[][] }
type SheetPreview = { sheet: string; headers: string[]; rows: string[][] }
type ZipEntry = { name: string; size: number; isDir: boolean }
type TextPreview = { text: string }

type FilePreview =
  | { kind: 'csv'; data: CsvPreview }
  | { kind: 'excel'; sheets: SheetPreview[] }
  | { kind: 'zip'; entries: ZipEntry[] }
  | { kind: 'text'; data: TextPreview }
  | { kind: 'error'; message: string }
  | { kind: 'loading' }

// ── Preview parsers ───────────────────────────────────────────────────────

const MAX_PREVIEW_ROWS = 20
const MAX_TEXT_CHARS = 3000

async function buildPreview(file: File): Promise<FilePreview> {
  const ext = getExt(file.name)

  if (ext === 'csv') {
    return new Promise(resolve => {
      Papa.parse(file, {
        preview: MAX_PREVIEW_ROWS + 1,
        complete(results) {
          const all = results.data as string[][]
          if (all.length === 0) return resolve({ kind: 'csv', data: { headers: [], rows: [] } })
          const [headers, ...rows] = all
          resolve({ kind: 'csv', data: { headers, rows: rows.slice(0, MAX_PREVIEW_ROWS) } })
        },
        error(err) {
          resolve({ kind: 'error', message: err.message })
        },
      })
    })
  }

  if (ext === 'xlsx' || ext === 'xls') {
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheets: SheetPreview[] = wb.SheetNames.slice(0, 5).map(name => {
        const ws = wb.Sheets[name]
        const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as string[][]
        const [headers = [], ...rows] = raw
        return {
          sheet: name,
          headers: headers.map(String),
          rows: rows.slice(0, MAX_PREVIEW_ROWS).map(r => r.map(String)),
        }
      })
      return { kind: 'excel', sheets }
    } catch (e: any) {
      return { kind: 'error', message: e.message }
    }
  }

  if (ext === 'zip') {
    try {
      const buf = await file.arrayBuffer()
      const zip = await JSZip.loadAsync(buf)
      const entries: ZipEntry[] = []
      zip.forEach((relativePath, zipEntry) => {
        entries.push({
          name: relativePath,
          size: zipEntry.dir ? 0 : (zipEntry as any)._data?.uncompressedSize ?? 0,
          isDir: zipEntry.dir,
        })
      })
      entries.sort((a, b) => a.name.localeCompare(b.name))
      return { kind: 'zip', entries }
    } catch (e: any) {
      return { kind: 'error', message: e.message }
    }
  }

  // JSON / XML — text preview
  try {
    const text = await file.text()
    return { kind: 'text', data: { text: text.slice(0, MAX_TEXT_CHARS) } }
  } catch (e: any) {
    return { kind: 'error', message: e.message }
  }
}

// ── Step indicator ────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'upload', label: '1. Upload' },
    { key: 'preview', label: '2. Preview' },
    { key: 'permissions', label: '3. Permissions' },
    { key: 'summary', label: '4. Summary' },
    { key: 'results', label: '5. Results' },
  ]
  const currentIdx = steps.findIndex(s => s.key === current)
  return (
    <div className="flex items-center gap-2 mb-6 flex-wrap">
      {steps.map((s, idx) => (
        <div key={s.key} className="flex items-center gap-2">
          {idx > 0 && <div className="w-6 h-px bg-gray-300 dark:bg-gray-600" />}
          <span className={`text-sm font-medium px-3 py-1 rounded-full whitespace-nowrap ${
            current === s.key
              ? 'bg-blue-600 text-white'
              : idx < currentIdx
              ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
          }`}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Preview panel components ──────────────────────────────────────────────

function CsvTable({ data }: { data: CsvPreview }) {
  if (data.headers.length === 0) return <p className="text-sm text-gray-400 italic p-4">Empty file</p>
  return (
    <div className="overflow-auto max-h-72 text-xs">
      <table className="min-w-full border-collapse">
        <thead className="sticky top-0 bg-gray-100 dark:bg-gray-700">
          <tr>
            {data.headers.map((h, i) => (
              <th key={i} className="px-3 py-1.5 text-left font-semibold text-gray-700 dark:text-gray-200 border-b border-gray-200 dark:border-gray-600 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-750'}>
              {data.headers.map((_, ci) => (
                <td key={ci} className="px-3 py-1 text-gray-800 dark:text-gray-200 border-b border-gray-100 dark:border-gray-700 whitespace-nowrap max-w-[200px] truncate">
                  {row[ci] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExcelPreview({ sheets }: { sheets: SheetPreview[] }) {
  const [activeSheet, setActiveSheet] = useState(0)
  const sheet = sheets[activeSheet]
  return (
    <div>
      {sheets.length > 1 && (
        <div className="flex gap-1 px-3 pt-2 flex-wrap">
          {sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveSheet(i)}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                i === activeSheet
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400'
              }`}
            >
              {s.sheet}
            </button>
          ))}
        </div>
      )}
      <CsvTable data={{ headers: sheet.headers, rows: sheet.rows }} />
    </div>
  )
}

function ZipTree({ entries }: { entries: ZipEntry[] }) {
  const dirs = entries.filter(e => e.isDir)
  const files = entries.filter(e => !e.isDir)
  return (
    <div className="overflow-auto max-h-72 p-3 text-xs font-mono space-y-0.5">
      {dirs.map((e, i) => (
        <div key={i} className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400">
          <span>📁</span>
          <span className="truncate">{e.name}</span>
        </div>
      ))}
      {files.map((e, i) => {
        const ext = getExt(e.name)
        const supported = ACCEPTED_EXTS.has(ext)
        return (
          <div key={i} className={`flex items-center gap-1.5 ${supported ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
            <span>{supported ? '📄' : '⬜'}</span>
            <span className="flex-1 truncate">{e.name}</span>
            <span className="flex-shrink-0 text-gray-400">{e.size ? formatBytes(e.size) : ''}</span>
            {!supported && <span className="text-gray-400 text-[10px]">(skip)</span>}
          </div>
        )
      })}
      <p className="text-gray-400 pt-1">{files.length} file{files.length !== 1 ? 's' : ''} · {dirs.length} folder{dirs.length !== 1 ? 's' : ''}</p>
    </div>
  )
}

function TextPreviewPanel({ data }: { data: TextPreview }) {
  return (
    <pre className="overflow-auto max-h-72 p-3 text-xs text-gray-800 dark:text-gray-200 font-mono whitespace-pre leading-relaxed">
      {data.text}
    </pre>
  )
}

function FilePreviewCard({ file, preview }: { file: File; preview: FilePreview }) {
  const ext = getExt(file.name)
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="bg-gray-100 dark:bg-gray-700 px-3 py-2 flex items-center gap-2">
        <span className="text-xs font-mono uppercase text-gray-500 dark:text-gray-400 w-8">{ext}</span>
        <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{file.name}</span>
        <span className="text-xs text-gray-400">{formatBytes(file.size)}</span>
      </div>
      <div className="bg-white dark:bg-gray-800">
        {preview.kind === 'loading' && (
          <div className="flex items-center gap-2 p-4 text-sm text-gray-400">
            <RefreshCw size={13} className="animate-spin" /> Parsing…
          </div>
        )}
        {preview.kind === 'error' && (
          <p className="p-3 text-sm text-red-600 dark:text-red-400">{preview.message}</p>
        )}
        {preview.kind === 'csv' && <CsvTable data={preview.data} />}
        {preview.kind === 'excel' && <ExcelPreview sheets={preview.sheets} />}
        {preview.kind === 'zip' && <ZipTree entries={preview.entries} />}
        {preview.kind === 'text' && <TextPreviewPanel data={preview.data} />}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function UploadPage() {
  const { databases, selectedDb } = useDatabase()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('upload')

  // Step 1: file selection
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 2: preview
  const [previews, setPreviews] = useState<Map<string, FilePreview>>(new Map())

  // Step 3: permissions
  const [database, setDatabase] = useState(selectedDb)
  const [collection, setCollection] = useState('')
  const [uriPrefix, setUriPrefix] = useState('/upload/')
  const [rootKey, setRootKey] = useState('')
  const [permissions, setPermissions] = useState<PermissionRow[]>([
    { role: 'data-insight-role', capabilities: new Set<Capability>(['read']) },
  ])

  // Step 4 / upload
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Step 5: results
  const [result, setResult] = useState<UploadResult | null>(null)

  // ── File helpers ──────────────────────────────────────────────────────

  function addFiles(incoming: FileList | File[]) {
    const list = Array.from(incoming)
    const valid = list.filter(f => ACCEPTED_EXTS.has(getExt(f.name)))
    const rejected = list.filter(f => !ACCEPTED_EXTS.has(getExt(f.name)))
    if (rejected.length > 0) {
      setFileError(`Unsupported file type${rejected.length > 1 ? 's' : ''}: ${rejected.map(f => f.name).join(', ')}`)
    } else {
      setFileError(null)
    }
    if (valid.length > 0) {
      setFiles(prev => {
        const names = new Set(prev.map(f => f.name))
        return [...prev, ...valid.filter(f => !names.has(f.name))]
      })
    }
  }

  function removeFile(idx: number) {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  // ── Preview helpers ───────────────────────────────────────────────────

  async function loadPreviews() {
    const map = new Map<string, FilePreview>()
    files.forEach(f => map.set(f.name, { kind: 'loading' }))
    setPreviews(new Map(map))
    await Promise.all(
      files.map(async f => {
        const p = await buildPreview(f)
        map.set(f.name, p)
        setPreviews(new Map(map))
      })
    )
  }

  function goToPreview() {
    setStep('preview')
    loadPreviews()
  }

  // ── Permission helpers ────────────────────────────────────────────────

  function addPermission() {
    setPermissions(p => [...p, { role: '', capabilities: new Set<Capability>(['read']) }])
  }

  function removePermission(idx: number) {
    setPermissions(p => p.filter((_, i) => i !== idx))
  }

  function updatePermissionRole(idx: number, role: string) {
    setPermissions(p => p.map((perm, i) => i === idx ? { ...perm, role } : perm))
  }

  function toggleCapability(idx: number, cap: Capability) {
    setPermissions(p => p.map((perm, i) => {
      if (i !== idx) return perm
      const next = new Set(perm.capabilities)
      next.has(cap) ? next.delete(cap) : next.add(cap)
      // keep at least one selected
      if (next.size === 0) next.add(cap)
      return { ...perm, capabilities: next }
    }))
  }

  // Flatten PermissionRows → UploadPermission[] (one entry per role+capability pair)
  function flattenPermissions(): UploadPermission[] {
    return permissions.flatMap(p =>
      p.role.trim()
        ? [...p.capabilities].map(cap => ({ role: p.role.trim(), capability: cap }))
        : []
    )
  }

  // ── Upload ────────────────────────────────────────────────────────────

  async function startUpload() {
    if (files.length === 0) return
    setUploading(true)
    setUploadError(null)
    try {
      const res = await uploadFiles(files, database, collection || undefined, uriPrefix, flattenPermissions(), rootKey || undefined)
      setResult(res)
      setStep('results')
    } catch (err: any) {
      setUploadError(err.message ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function reset() {
    setStep('upload')
    setFiles([])
    setPreviews(new Map())
    setResult(null)
    setFileError(null)
    setUploadError(null)
  }

  // ── Derived ───────────────────────────────────────────────────────────

  const insertCount = files.filter(f => getAction(getExt(f.name)) === 'insert').length
  const convertCount = files.filter(f => getAction(getExt(f.name)) === 'convert').length
  const zipCount = files.filter(f => getAction(getExt(f.name)) === 'zip').length
  const totalSize = files.reduce((acc, f) => acc + f.size, 0)

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Upload Documents</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Load JSON, XML, CSV, Excel, or ZIP files into MarkLogic.
      </p>

      <StepIndicator current={step} />

      {/* ── Step 1: Upload ────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors py-12 ${
              dragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 bg-white dark:bg-gray-800'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                Drop files here or click to browse
              </p>
              <p className="text-xs text-gray-400 mt-0.5">JSON · XML · CSV · XLSX · XLS · ZIP</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
            />
          </div>

          {fileError && <p className="text-sm text-red-600 dark:text-red-400">{fileError}</p>}

          {/* File list */}
          {files.length > 0 && (
            <div className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="bg-gray-100 dark:bg-gray-700 px-3 py-2 flex justify-between items-center">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                  {files.length} file{files.length !== 1 ? 's' : ''} · {formatBytes(totalSize)}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); setFiles([]) }}
                  className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  title="Remove all files"
                >
                  <X size={11} /> Remove all
                </button>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-64 overflow-y-auto">
                {files.map((f, idx) => {
                  const ext = getExt(f.name)
                  const action = getAction(ext)
                  return (
                    <div key={idx} className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-gray-800">
                      <span className="text-xs font-mono uppercase text-gray-400 w-8 flex-shrink-0">{ext}</span>
                      <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate">{f.name}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">{formatBytes(f.size)}</span>
                      <span className={`text-xs flex-shrink-0 ${
                        action === 'insert' ? 'text-green-600 dark:text-green-400'
                        : action === 'zip' ? 'text-purple-600 dark:text-purple-400'
                        : 'text-blue-600 dark:text-blue-400'
                      }`}>
                        {action === 'insert' ? 'Insert' : action === 'zip' ? 'Extract' : '→ JSON'}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); removeFile(idx) }}
                        className="flex items-center justify-center text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0"
                        title="Remove"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              disabled={files.length === 0}
              onClick={goToPreview}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-blue-400 dark:border-blue-400/40 bg-gray-100 dark:bg-transparent text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-400/10 hover:border-blue-500 dark:hover:border-blue-400/70 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              <Eye size={14} /> Preview <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Preview ───────────────────────────────────────────── */}
      {step === 'preview' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Showing a preview of each file's content before upload. CSV and Excel are limited to the first {MAX_PREVIEW_ROWS} rows.
          </p>

          <div className="space-y-4">
            {files.map(f => (
              <FilePreviewCard
                key={f.name}
                file={f}
                preview={previews.get(f.name) ?? { kind: 'loading' }}
              />
            ))}
          </div>

          <div className="flex justify-between pt-2">
            <button
              onClick={() => setStep('upload')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-gray-400 dark:border-white/25 bg-gray-100 dark:bg-transparent text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 hover:border-gray-500 dark:hover:border-white/50 transition-colors"
            >
              <ChevronLeft size={15} /> Back
            </button>
            <button
              onClick={() => setStep('permissions')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-blue-400 dark:border-blue-400/40 bg-gray-100 dark:bg-transparent text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-400/10 hover:border-blue-500 dark:hover:border-blue-400/70 text-sm font-medium transition-colors"
            >
              Permissions <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Permissions ───────────────────────────────────────── */}
      {step === 'permissions' && (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target Database</label>
            <select
              value={database}
              onChange={e => setDatabase(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {databases.map(db => <option key={db} value={db}>{db}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Collection <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={collection}
              onChange={e => setCollection(e.target.value)}
              placeholder="e.g. my-collection"
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">URI Prefix</label>
            <input
              type="text"
              value={uriPrefix}
              onChange={e => setUriPrefix(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Documents inserted as <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{uriPrefix}filename.ext</code>
            </p>
          </div>

          {convertCount > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                JSON Root Key <span className="text-gray-400 font-normal">(optional, CSV / Excel only)</span>
              </label>
              <input
                type="text"
                value={rootKey}
                onChange={e => setRootKey(e.target.value)}
                placeholder="e.g. record"
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Wraps each row: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{`{"${rootKey || 'record'}": { … }}`}</code>
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Document Security <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <div className="space-y-2">
              {permissions.map((perm, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={perm.role}
                    onChange={e => updatePermissionRole(idx, e.target.value)}
                    placeholder="Role name"
                    className="w-40 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden flex-shrink-0">
                    {ALL_CAPS.map(cap => (
                      <button
                        key={cap}
                        type="button"
                        onClick={() => toggleCapability(idx, cap)}
                        className={`px-2.5 py-1.5 text-xs font-medium border-r last:border-r-0 border-gray-300 dark:border-gray-600 transition-colors ${
                          perm.capabilities.has(cap)
                            ? 'bg-blue-600 text-white'
                            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {cap}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => removePermission(idx)} className="flex items-center justify-center w-7 h-7 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0" title="Remove permission"><X size={13} /></button>
                </div>
              ))}
            </div>
            <button onClick={addPermission} className="mt-2 flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors">
              <Plus size={13} /> Add permission
            </button>
          </div>

          <div className="flex justify-between pt-2">
            <button
              onClick={() => setStep('preview')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-gray-400 dark:border-white/25 bg-gray-100 dark:bg-transparent text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 hover:border-gray-500 dark:hover:border-white/50 transition-colors"
            >
              <ChevronLeft size={15} /> Back
            </button>
            <button
              disabled={!database}
              onClick={() => setStep('summary')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-blue-400 dark:border-blue-400/40 bg-gray-100 dark:bg-transparent text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-400/10 hover:border-blue-500 dark:hover:border-blue-400/70 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              Summary <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Summary ──────────────────────────────────────────── */}
      {step === 'summary' && (
        <div className="space-y-4">
          {/* Files */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
              Files ({files.length})
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
              {insertCount > 0 && (
                <div className="px-4 py-2.5 flex justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300">Direct insert (JSON / XML)</span>
                  <span className="font-medium text-green-600 dark:text-green-400">{insertCount}</span>
                </div>
              )}
              {convertCount > 0 && (
                <div className="px-4 py-2.5 flex justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300">Convert to JSON (CSV / Excel)</span>
                  <span className="font-medium text-blue-600 dark:text-blue-400">{convertCount}</span>
                </div>
              )}
              {zipCount > 0 && (
                <div className="px-4 py-2.5 flex justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300">Extract ZIP archive{zipCount > 1 ? 's' : ''}</span>
                  <span className="font-medium text-purple-600 dark:text-purple-400">{zipCount}</span>
                </div>
              )}
              <div className="px-4 py-2.5 flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Total size</span>
                <span className="text-gray-700 dark:text-gray-300">{formatBytes(totalSize)}</span>
              </div>
            </div>
          </div>

          {/* Destination */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
              Destination
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
              <Row label="Database" value={database} />
              <Row label="Collection" value={collection || '—'} />
              <Row label="URI Prefix" value={uriPrefix} mono />
              {convertCount > 0 && <Row label="JSON Root Key" value={rootKey || '—'} mono />}
            </div>
          </div>

          {/* Security */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
              Document Security
            </div>
            <div className="bg-white dark:bg-gray-800 px-4 py-3">
              {permissions.filter(p => p.role.trim()).length === 0 ? (
                <p className="text-sm text-gray-400 italic">No permissions set</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {permissions.filter(p => p.role.trim()).map((p, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-gray-700 px-2.5 py-1 text-xs text-gray-700 dark:text-gray-300">
                      <span className="font-medium">{p.role}</span>
                      <span className="text-gray-400">·</span>
                      <span>{[...p.capabilities].join(', ')}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {uploadError && <p className="text-sm text-red-600 dark:text-red-400">{uploadError}</p>}

          <div className="flex justify-between pt-2">
            <button
              onClick={() => setStep('permissions')}
              disabled={uploading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-gray-400 dark:border-white/25 bg-gray-100 dark:bg-transparent text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 hover:border-gray-500 dark:hover:border-white/50 disabled:opacity-40 transition-colors"
            >
              <ChevronLeft size={15} /> Back
            </button>
            <button
              onClick={startUpload}
              disabled={uploading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-blue-400 dark:border-blue-400/40 bg-gray-100 dark:bg-transparent text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-400/10 hover:border-blue-500 dark:hover:border-blue-400/70 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              {uploading ? (
                <><RefreshCw size={14} className="animate-spin" /> Uploading…</>
              ) : (
                <><UploadCloud size={14} /> Confirm & Upload</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 5: Results ──────────────────────────────────────────── */}
      {step === 'results' && result && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Files', value: result.totalFiles, color: 'text-gray-900 dark:text-gray-100' },
              { label: 'Inserted', value: result.inserted, color: 'text-green-600 dark:text-green-400' },
              { label: 'Skipped', value: result.skipped, color: 'text-yellow-600 dark:text-yellow-400' },
              { label: 'Failed', value: result.failed, color: 'text-red-600 dark:text-red-400' },
            ].map(card => (
              <div key={card.label} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 text-center">
                <div className={`text-3xl font-bold ${card.color}`}>{card.value}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          {Object.keys(result.byType).length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Inserted by type</h3>
              <div className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Type</th>
                      <th className="text-right px-3 py-2 font-medium">Documents</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {Object.entries(result.byType).map(([type, count]) => (
                      <tr key={type} className="bg-white dark:bg-gray-800">
                        <td className="px-3 py-2 text-gray-800 dark:text-gray-200 uppercase font-mono text-xs">{type}</td>
                        <td className="px-3 py-2 text-right text-gray-900 dark:text-gray-100 font-medium">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.errors.length > 0 && (
            <details className="rounded-md border border-red-200 dark:border-red-900 overflow-hidden">
              <summary className="cursor-pointer bg-red-50 dark:bg-red-950 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-400">
                {result.errors.length} error{result.errors.length !== 1 ? 's' : ''}
              </summary>
              <div className="divide-y divide-red-100 dark:divide-red-900">
                {result.errors.map((err, idx) => (
                  <div key={idx} className="px-3 py-2 bg-white dark:bg-gray-800">
                    <p className="text-xs font-mono text-gray-700 dark:text-gray-300">{err.file}</p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{err.error}</p>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <button onClick={reset} className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-blue-400 dark:border-blue-400/40 bg-gray-100 dark:bg-transparent text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-400/10 hover:border-blue-500 dark:hover:border-blue-400/70 text-sm font-medium transition-colors">
              <Upload size={14} /> Upload More
            </button>
            <button onClick={() => navigate('/home')} className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-gray-400 dark:border-white/25 bg-gray-100 dark:bg-transparent text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10 hover:border-gray-500 dark:hover:border-white/50 transition-colors">
              <LayoutDashboard size={14} /> Database Stats
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="px-4 py-2.5 flex justify-between gap-4 text-sm">
      <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">{label}</span>
      <span className={`text-gray-900 dark:text-gray-100 text-right ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}
