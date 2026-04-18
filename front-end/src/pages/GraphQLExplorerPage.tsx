import { useCallback, useEffect, useRef, useState } from 'react'
import {
  executeGraphQL,
  deriveGraphQLSchema,
  getAnalysisList,
} from '../services/api'
import { useDatabase } from '../context/useDatabase'
import type {
  Analysis,
  GraphQLError,
  GraphQLResponse,
  SavedGraphQLQuery,
} from '../types'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { foldAll, unfoldAll } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import type { EditorView as EditorViewType } from '@codemirror/view'

// ── Types for derived schema ──────────────────────────────────────────────────

interface DerivedField {
  type: string
  sourceKey: string
  index: string | null
  frequency?: number
}

interface DerivedType {
  type: string
  collection: string
  format: 'json' | 'xml'
  fields: Record<string, DerivedField>
  relations: Record<string, { type: string; via: string; foreignKey: string }>
  nestedTypes?: Record<string, DerivedType>
  derived?: boolean
}

interface DerivedSchema {
  derived: DerivedType
  savedAt: string
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
)
const SaveIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
)
const FolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
)
const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
  </svg>
)
const ChevronDownIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)
const ChevronRightIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)
const ClearIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)
const SparkleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
  </svg>
)
const ListIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
)
const FilterIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
)

// ── GQL query builder from derived schema ────────────────────────────────────

function buildNestedBlock(fieldName: string, nestedTypeName: string, nestedTypes: Record<string, DerivedType> | undefined, indent: string): string | null {
  const nestedDef = nestedTypes?.[nestedTypeName]
  if (!nestedDef) return null  // omit entirely — bare object field is a parse error
  const childFields = Object.keys(nestedDef.fields)
    .filter(f => !isObjectType(nestedDef.fields[f].type))
    .map(f => `${indent}  ${f}`)
    .join('\n')
  return childFields
    ? `${indent}${fieldName} {\n${childFields}\n${indent}}`
    : null  // no scalar children to select, omit
}

function buildListQuery(typeDef: DerivedType): string {
  const fieldName = lcFirst(typeDef.type) + 's'
  const scalarLines = Object.keys(typeDef.fields)
    .filter(f => !isObjectType(typeDef.fields[f].type))
    .map(f => `    ${f}`)
  const nestedLines = Object.entries(typeDef.fields)
    .filter(([, f]) => isObjectType(f.type))
    .map(([f, fd]) => buildNestedBlock(f, fd.type.replace(/[\[\]!]/g, ''), typeDef.nestedTypes, '    '))
    .filter((b): b is string => b !== null)
  const fieldLines = [...scalarLines, ...nestedLines].join('\n')
  return `# List all ${typeDef.type} documents (up to 50)\n{\n  ${fieldName}(limit: 50) {\n${fieldLines}\n  }\n}`
}

function buildFilterQuery(typeDef: DerivedType): string {
  const fieldName = lcFirst(typeDef.type) + 's'
  // Pick first value-indexed string field for the example filter
  const stringField = Object.entries(typeDef.fields).find(
    ([, f]) => f.index === 'value' && (f.type === 'String' || f.type === 'ID')
  )
  const rangeField = Object.entries(typeDef.fields).find(
    ([, f]) => f.index === 'range' && (f.type === 'Int' || f.type === 'Float')
  )

  const fieldLines = Object.keys(typeDef.fields)
    .filter(f => !isObjectType(typeDef.fields[f].type))
    .map(f => `    ${f}`)
    .join('\n')

  let whereClause = ''
  if (stringField) {
    whereClause = `where: { ${stringField[0]}: "example" }`
  } else if (rangeField) {
    whereClause = `where: { ${rangeField[0]}: { gt: 0 } }`
  } else {
    whereClause = `where: { }`
  }

  return `# Filter ${typeDef.type} by field value\n{\n  ${fieldName}(\n    ${whereClause}\n    limit: 25\n    offset: 0\n  ) {\n${fieldLines}\n  }\n}`
}

function buildOrderQuery(typeDef: DerivedType): string {
  const fieldName = lcFirst(typeDef.type) + 's'
  const rangeField = Object.entries(typeDef.fields).find(
    ([, f]) => f.index === 'range'
  )
  const orderBy = rangeField
    ? `orderBy: { field: "${rangeField[0]}", direction: "desc" }`
    : `orderBy: { field: "${Object.keys(typeDef.fields)[0] ?? 'id'}", direction: "asc" }`

  const fieldLines = Object.keys(typeDef.fields)
    .filter(f => !isObjectType(typeDef.fields[f].type))
    .map(f => `    ${f}`)
    .join('\n')

  return `# Sort ${typeDef.type} by a range-indexed field\n{\n  ${fieldName}(\n    ${orderBy}\n    limit: 25\n  ) {\n${fieldLines}\n  }\n}`
}

/**
 * buildSmartQuery — generates a focused query using the most meaningful fields:
 *  • Picks ID field first, then high-frequency scalars, then indexed fields
 *  • Limits selection to ≤8 fields to keep the query readable
 *  • Adds an orderBy on the best range field if one exists
 *  • Expands one relation (if any) with its own scalar fields
 */
function buildSmartQuery(typeDef: DerivedType): string {
  const queryField = lcFirst(typeDef.type) + 's'

  // Rank scalar fields: ID first, then by frequency desc, then named fields last
  const scalarEntries = Object.entries(typeDef.fields)
    .filter(([, f]) => !isObjectType(f.type))
    .sort(([aName, a], [bName, b]) => {
      if (a.type === 'ID') return -1
      if (b.type === 'ID') return 1
      if ((b.frequency ?? 0) !== (a.frequency ?? 0)) return (b.frequency ?? 0) - (a.frequency ?? 0)
      return aName.localeCompare(bName)
    })

  // Pick top 8 scalars
  const selectedFields = scalarEntries.slice(0, 8).map(([name]) => name)

  // Best range field for orderBy
  const rangeField = scalarEntries.find(([, f]) => f.index === 'range')

  // Best indexed string field for an example filter
  const idField = scalarEntries.find(([, f]) => f.type === 'ID')
  const valueField = scalarEntries.find(([, f]) => f.index === 'value' && f.type === 'String')

  // One relation to expand
  const relations = Object.entries(typeDef.relations ?? {})
  const firstRelation = relations[0]

  // Nested type blocks
  const nestedEntries = Object.entries(typeDef.fields).filter(([, f]) => isObjectType(f.type))

  // Build field selection lines
  const fieldLines = selectedFields.map(f => `    ${f}`).join('\n')

  // Nested type sub-selections
  const nestedBlocks = nestedEntries
    .map(([f, fd]) => buildNestedBlock(f, fd.type.replace(/[\[\]!]/g, ''), typeDef.nestedTypes, '    '))
    .filter((b): b is string => b !== null)
    .join('\n')

  // Relation block
  const relationBlock = firstRelation
    ? `\n    ${firstRelation[0]} {\n      ${firstRelation[1].via}\n    }`
    : ''

  // Compose args
  const args: string[] = []
  if (idField) {
    args.push(`where: { ${idField[0]}: "example-id" }`)
  } else if (valueField) {
    args.push(`where: { ${valueField[0]}: "example" }`)
  }
  if (rangeField) {
    args.push(`orderBy: { field: "${rangeField[0]}", direction: "desc" }`)
  }
  args.push('limit: 25')

  const argsStr = args.map(a => `    ${a}`).join('\n')
  const comment = [
    `# Smart query for ${typeDef.type}`,
    `# Fields selected by frequency; adjust where/orderBy as needed`,
    ...(!idField && !valueField ? ['# No indexed string field found — add a where clause manually'] : []),
  ].join('\n')

  const nestedSection = nestedBlocks ? `\n${nestedBlocks}` : ''
  return `${comment}\n{\n  ${queryField}(\n${argsStr}\n  ) {\n${fieldLines}${nestedSection}${relationBlock}\n  }\n}`
}

function buildSingleFieldQuery(typeDef: DerivedType, fieldName: string, field: DerivedField): string {
  const queryField = lcFirst(typeDef.type) + 's'
  let whereClause = ''
  if (field.index === 'value') {
    whereClause = `where: { ${fieldName}: "example" }`
  } else if (field.index === 'range') {
    whereClause = `where: { ${fieldName}: { gt: 0 } }`
  } else {
    whereClause = `where: { ${fieldName}: "example" }`
  }
  return `# Filter by ${fieldName}\n{\n  ${queryField}(\n    ${whereClause}\n    limit: 25\n  ) {\n    ${fieldName}\n  }\n}`
}

function isObjectType(gqlType: string): boolean {
  const scalars = ['String', 'Int', 'Float', 'Boolean', 'ID']
  const unwrapped = gqlType.replace(/[\[\]!]/g, '')
  return !scalars.includes(unwrapped)
}

function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

function gqlTypeColor(gqlType: string): string {
  const t = gqlType.replace(/[\[\]!]/g, '')
  if (t === 'ID') return 'text-yellow-500 dark:text-yellow-400'
  if (t === 'String') return 'text-green-600 dark:text-green-400'
  if (t === 'Int' || t === 'Float') return 'text-blue-500 dark:text-blue-400'
  if (t === 'Boolean') return 'text-orange-500 dark:text-orange-400'
  return 'text-purple-600 dark:text-purple-400' // object/relation types
}

function NestedTypeSection({
  fieldName,
  field,
  nestedDef,
  onInsertQuery,
  parentTypeDef,
}: {
  fieldName: string
  field: DerivedField
  nestedDef: DerivedType | undefined
  onInsertQuery: (q: string) => void
  parentTypeDef: DerivedType
}) {
  const [open, setOpen] = useState(true)
  const nestedTypeName = field.type.replace(/[\[\]!]/g, '')

  return (
    <>
      <div
        className="flex items-center gap-1.5 px-3 py-1 bg-gray-50 dark:bg-gray-800/50 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 select-none"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <span className="font-mono text-gray-700 dark:text-gray-200 flex-1">{fieldName}</span>
        <span className={`font-mono flex-shrink-0 ${gqlTypeColor(field.type)}`}>{field.type}</span>
        <button
          onClick={e => { e.stopPropagation(); const b = buildNestedBlock(fieldName, nestedTypeName, parentTypeDef.nestedTypes, '    '); if (b) onInsertQuery(b) }}
          title={`Insert ${fieldName} sub-selection`}
          className="flex-shrink-0 text-gray-400 hover:text-blue-500 ml-1"
        >
          <FilterIcon />
        </button>
      </div>
      {open && nestedDef && Object.entries(nestedDef.fields).map(([name, f]) => (
        <FieldRow key={name} name={name} field={f} nested indent />
      ))}
      {open && !nestedDef && (
        <div className="px-6 py-1 text-gray-400 dark:text-gray-500 italic">
          Re-derive schema to see fields
        </div>
      )}
    </>
  )
}

// ── Introspection queries ─────────────────────────────────────────────────────

const INTROSPECTION_QUERIES: { label: string; query: string }[] = [
  {
    label: 'List all types',
    query: `{\n  __schema {\n    types {\n      name\n      kind\n      description\n    }\n  }\n}`,
  },
  {
    label: 'Type fields',
    query: `{\n  __type(name: "YourType") {\n    name\n    fields {\n      name\n      type {\n        name\n        kind\n        ofType {\n          name\n          kind\n        }\n      }\n    }\n  }\n}`,
  },
  {
    label: 'All queries',
    query: `{\n  __schema {\n    queryType {\n      name\n      fields {\n        name\n        description\n        args {\n          name\n          type {\n            name\n            kind\n          }\n        }\n      }\n    }\n  }\n}`,
  },
  {
    label: 'Full introspection',
    query: `{\n  __schema {\n    types {\n      name\n      kind\n      description\n      fields {\n        name\n        type {\n          name\n          kind\n        }\n      }\n      inputFields {\n        name\n        type {\n          name\n          kind\n        }\n      }\n    }\n  }\n}`,
  },
]

// ── Schema panel ──────────────────────────────────────────────────────────────

interface SchemaPanelProps {
  db: string
  onInsertQuery: (q: string) => void
}

function SchemaPanel({ db, onInsertQuery }: SchemaPanelProps) {
  const [analyses, setAnalyses]           = useState<Analysis[]>([])
  const [analysisId, setAnalysisId]       = useState('')
  const [typeName, setTypeName]           = useState('')
  const [collection, setCollection]       = useState('')
  const [format, setFormat]               = useState<'json' | 'xml'>('json')
  const [derivedType, setDerivedType]     = useState<DerivedType | null>(null)
  const [loadingAnalyses, setLoadingAnalyses] = useState(false)
  const [deriving, setDeriving]           = useState(false)
  const [deriveError, setDeriveError]     = useState<string | null>(null)
  const [expandedFields, setExpandedFields] = useState(false)
  const [examplesOpen, setExamplesOpen]   = useState(true)
  const [introspectionOpen, setIntrospectionOpen] = useState(true)

  // Load analyses when db changes
  useEffect(() => {
    if (!db) return
    setLoadingAnalyses(true)
    setDerivedType(null)
    setDeriveError(null)
    getAnalysisList(db)
      .then(list => {
        setAnalyses(list)
        if (list.length > 0) {
          setAnalysisId(list[0].analysisId)
          // Pre-fill type name from analysis localname
          setTypeName(toTypeName(list[0].localname))
          setCollection(list[0].localname)
        }
      })
      .catch(() => setAnalyses([]))
      .finally(() => setLoadingAnalyses(false))
  }, [db])

  // When analysis selection changes, pre-fill type/collection from it
  function handleAnalysisChange(id: string) {
    setAnalysisId(id)
    setDerivedType(null)
    setDeriveError(null)
    const a = analyses.find(a => a.analysisId === id)
    if (a) {
      setTypeName(toTypeName(a.localname))
      setCollection(a.localname)
      setFormat(a.documentType === 'xml' ? 'xml' : 'json')
    }
  }

  async function handleDerive() {
    if (!analysisId || !typeName.trim() || !collection.trim()) return
    setDeriving(true)
    setDeriveError(null)
    setDerivedType(null)

    // Use the real URI returned by the backend (stored in MarkLogic)
    const selectedAnalysis = analyses.find(a => a.analysisId === analysisId)
    const analysisUri = selectedAnalysis?.analysisUri ?? ''
    if (!analysisUri) {
      setDeriveError('Analysis URI not available — please re-run the analysis.')
      setDeriving(false)
      return
    }

    try {
      const result = await deriveGraphQLSchema(typeName.trim(), collection.trim(), analysisUri, format, db) as unknown as DerivedSchema & { error?: string }
      if (result?.error) {
        setDeriveError(result.error)
        return
      }
      if (!result?.derived) {
        setDeriveError('Unexpected response from server — no schema derived. Check that the analysis document exists.')
        return
      }
      setDerivedType(result.derived)
      setExamplesOpen(true)
      setExpandedFields(true)
      // Auto-insert best query into editor
      onInsertQuery(buildSmartQuery(result.derived))
    } catch (e: unknown) {
      setDeriveError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeriving(false)
    }
  }

  function toTypeName(s: string): string {
    return s.split(/[-_ .]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  }

  const scalarFields = derivedType
    ? Object.entries(derivedType.fields).filter(([, f]) => !isObjectType(f.type))
    : []
  const objectFields = derivedType
    ? Object.entries(derivedType.fields).filter(([, f]) => isObjectType(f.type))
    : []

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs">

      {/* ── Analysis picker ── */}
      <div className="p-2 space-y-2 border-b border-gray-200 dark:border-gray-700">
        <div>
          <label className="block text-gray-500 dark:text-gray-400 mb-1">Analysis</label>
          {loadingAnalyses ? (
            <p className="text-gray-400 italic">Loading…</p>
          ) : analyses.length === 0 ? (
            <p className="text-gray-400 italic">No analyses found for this database.</p>
          ) : (
            <select
              value={analysisId}
              onChange={e => handleAnalysisChange(e.target.value)}
              className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {analyses.map(a => (
                <option key={a.analysisId} value={a.analysisId}>
                  {a.documentType ? `[${a.documentType.toUpperCase()}] ` : ''}{a.localname} [{a.analysisName}]
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="block text-gray-500 dark:text-gray-400 mb-1">Type name</label>
            <input
              type="text"
              value={typeName}
              onChange={e => setTypeName(e.target.value)}
              placeholder="e.g. Order"
              className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-gray-500 dark:text-gray-400 mb-1">Collection</label>
            <input
              type="text"
              value={collection}
              onChange={e => setCollection(e.target.value)}
              placeholder="e.g. orders"
              className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-gray-500 dark:text-gray-400">Format</label>
          <select
            value={format}
            onChange={e => setFormat(e.target.value as 'json' | 'xml')}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="json">JSON</option>
            <option value="xml">XML</option>
          </select>
          <button
            onClick={handleDerive}
            disabled={deriving || !analysisId || !typeName.trim() || !collection.trim()}
            className="ml-auto btn-primary text-xs px-2 py-1 flex items-center gap-1 disabled:opacity-40"
          >
            <SparkleIcon />
            {deriving ? 'Deriving…' : 'Generate'}
          </button>
        </div>

        {deriveError && (
          <p className="text-red-500 dark:text-red-400 text-xs break-words">{deriveError}</p>
        )}
      </div>

      {/* ── Derived type tree ── */}
      {derivedType && (
        <div className="flex-1 overflow-auto">

          {/* Type header */}
          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <span className="font-semibold text-blue-600 dark:text-blue-400">{derivedType.type}</span>
            <span className="text-gray-400 dark:text-gray-500">·</span>
            <span className="text-gray-500 dark:text-gray-400">{derivedType.collection}</span>
            <span className={`ml-auto px-1.5 py-0.5 rounded text-xs font-medium ${
              derivedType.format === 'xml'
                ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
            }`}>
              {derivedType.format.toUpperCase()}
            </span>
          </div>

          {/* Introspection queries section */}
          <div className="border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setIntrospectionOpen(v => !v)}
              className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium"
            >
              {introspectionOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
              Introspection
            </button>
            {introspectionOpen && (
              <div className="space-y-0.5 pb-1">
                {INTROSPECTION_QUERIES.map(({ label, query }) => (
                  <ExampleQueryButton key={label} icon={<ListIcon />} label={label} onClick={() => onInsertQuery(query)} />
                ))}
              </div>
            )}
          </div>

          {/* Example queries section */}
          <div className="border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setExamplesOpen(v => !v)}
              className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium"
            >
              {examplesOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
              Example Queries
            </button>
            {examplesOpen && (
              <div className="space-y-0.5 pb-1">
                <ExampleQueryButton
                  icon={<SparkleIcon />}
                  label={`Smart query for ${derivedType.type}`}
                  onClick={() => onInsertQuery(buildSmartQuery(derivedType))}
                  highlight
                />
                <ExampleQueryButton
                  icon={<ListIcon />}
                  label={`List all ${derivedType.type}`}
                  onClick={() => onInsertQuery(buildListQuery(derivedType))}
                />
                <ExampleQueryButton
                  icon={<FilterIcon />}
                  label={`Filter ${derivedType.type}`}
                  onClick={() => onInsertQuery(buildFilterQuery(derivedType))}
                />
                <ExampleQueryButton
                  icon={<FilterIcon />}
                  label={`Sort ${derivedType.type}`}
                  onClick={() => onInsertQuery(buildOrderQuery(derivedType))}
                />
              </div>
            )}
          </div>

          {/* Field list */}
          <div>
            <button
              onClick={() => setExpandedFields(v => !v)}
              className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium border-b border-gray-200 dark:border-gray-700"
            >
              {expandedFields ? <ChevronDownIcon /> : <ChevronRightIcon />}
              Fields
              <span className="ml-auto text-gray-400 dark:text-gray-500 font-normal">
                {Object.keys(derivedType.fields).length}
                {Object.keys(derivedType.nestedTypes ?? {}).length > 0 && (
                  <span className="ml-1 text-purple-500 dark:text-purple-400">
                    +{Object.values(derivedType.nestedTypes!).reduce((s, t) => s + Object.keys(t.fields).length, 0)} nested
                  </span>
                )}
              </span>
            </button>

            {expandedFields && (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {scalarFields.map(([name, field]) => (
                  <FieldRow
                    key={name}
                    name={name}
                    field={field}
                    onFilter={() => onInsertQuery(buildSingleFieldQuery(derivedType, name, field))}
                  />
                ))}
                {objectFields.map(([name, field]) => {
                  const nestedTypeName = field.type.replace(/[\[\]!]/g, '')
                  const nestedDef = derivedType.nestedTypes?.[nestedTypeName]
                  return (
                    <NestedTypeSection
                      key={name}
                      fieldName={name}
                      field={field}
                      nestedDef={nestedDef}
                      onInsertQuery={onInsertQuery}
                      parentTypeDef={derivedType}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!derivedType && !deriving && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 text-gray-400 dark:text-gray-500 gap-2">
          <SparkleIcon />
          <p>Select an analysis and click <strong>Generate</strong> to derive a GraphQL schema and example queries.</p>
        </div>
      )}
    </div>
  )
}

function ExampleQueryButton({ icon, label, onClick, highlight = false }: { icon: React.ReactNode; label: string; onClick: () => void; highlight?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 w-full px-4 py-1 text-left transition-colors ${
        highlight
          ? 'text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 font-medium'
          : 'text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-700 dark:hover:text-blue-300'
      }`}
    >
      <span className={`flex-shrink-0 ${highlight ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>{icon}</span>
      {label}
    </button>
  )
}

function FieldRow({
  name,
  field,
  nested = false,
  indent = false,
  onFilter,
}: {
  name: string
  field: DerivedField
  nested?: boolean
  indent?: boolean
  onFilter?: () => void
}) {
  return (
    <div className={`flex items-center gap-2 py-1 group hover:bg-gray-50 dark:hover:bg-gray-800 ${indent ? 'pl-7 pr-3' : 'px-3'}`}>
      <span className="font-mono text-gray-700 dark:text-gray-200 truncate flex-1">{name}</span>
      <span className={`font-mono flex-shrink-0 ${gqlTypeColor(field.type)}`}>{field.type}</span>
      {field.index && (
        <span className={`text-xs px-1 rounded flex-shrink-0 ${
          field.index === 'range'
            ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
        }`}>
          {field.index}
        </span>
      )}
      {!nested && onFilter && (
        <button
          onClick={onFilter}
          title={`Filter by ${name}`}
          className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-gray-400 hover:text-blue-500 transition-opacity"
        >
          <FilterIcon />
        </button>
      )}
    </div>
  )
}

// ── Saved queries (localStorage) ──────────────────────────────────────────────

const STORAGE_KEY = 'gql-saved-queries'

function loadSavedQueries(): SavedGraphQLQuery[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}

function persistSavedQueries(queries: SavedGraphQLQuery[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queries))
}

// ── JSON result viewer ────────────────────────────────────────────────────────

const jsonViewerTheme = EditorView.theme({
  '&': { fontSize: '12px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, monospace' },
  '.cm-content': { padding: '8px 0' },
})

function JsonResultViewer({ value }: { value: unknown }) {
  const viewRef = useRef<EditorViewType | null>(null)
  const text = JSON.stringify(value, null, 2)
  const isDark = document.documentElement.classList.contains('dark')

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <button
          onClick={() => viewRef.current && foldAll(viewRef.current)}
          className="text-xs text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          Collapse all
        </button>
        <button
          onClick={() => viewRef.current && unfoldAll(viewRef.current)}
          className="text-xs text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          Expand all
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <CodeMirror
          value={text}
          extensions={[json(), jsonViewerTheme]}
          theme={isDark ? oneDark : undefined}
          readOnly
          onCreateEditor={view => { viewRef.current = view }}
          basicSetup={{ highlightActiveLine: false, autocompletion: false }}
        />
      </div>
    </div>
  )
}

// ── Save dialog ───────────────────────────────────────────────────────────────

function SaveDialog({ onSave, onCancel }: { onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-80 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Save Query</h3>
        <input
          autoFocus
          type="text"
          placeholder="Query name"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()) }}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary text-xs px-3 py-1.5">Cancel</button>
          <button onClick={() => name.trim() && onSave(name.trim())} disabled={!name.trim()} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40">Save</button>
        </div>
      </div>
    </div>
  )
}

// ── Saved queries panel ───────────────────────────────────────────────────────

function SavedQueriesPanel({
  queries, onLoad, onDelete,
}: { queries: SavedGraphQLQuery[]; onLoad: (q: SavedGraphQLQuery) => void; onDelete: (id: string) => void }) {
  if (queries.length === 0) {
    return <p className="text-xs text-gray-400 p-3">No saved queries yet.</p>
  }
  return (
    <div className="overflow-auto h-full divide-y divide-gray-100 dark:divide-gray-700">
      {queries.map(q => (
        <div key={q.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 group">
          <button onClick={() => onLoad(q)} className="flex-1 text-left text-xs text-gray-700 dark:text-gray-200 truncate hover:text-blue-600 dark:hover:text-blue-400">
            {q.name}
          </button>
          <button onClick={() => onDelete(q.id)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity">
            <TrashIcon />
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Vertical resize handle ────────────────────────────────────────────────────

function useVerticalResize(initial: number) {
  const [height, setHeight] = useState(initial)
  const dragRef = useRef<{ y: number; h: number } | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { y: e.clientY, h: height }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    function onMove(e: MouseEvent) {
      if (!dragRef.current) return
      const delta = e.clientY - dragRef.current.y
      setHeight(Math.max(80, Math.min(600, dragRef.current.h + delta)))
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
  }, [height])

  return { height, onMouseDown }
}

// ── Starter query ─────────────────────────────────────────────────────────────

const STARTER_QUERY = `# GraphQL Explorer — MarkLogic
# Select an analysis in the Schema panel and click Generate
# to derive a schema and see example queries.
#
# Or run this introspection query to see what types are available:

{
  __schema {
    types {
      name
      kind
    }
  }
}`

// ── Main page ─────────────────────────────────────────────────────────────────

type SideTab = 'schema' | 'saved'

export default function GraphQLExplorerPage() {
  const { selectedDb }  = useDatabase()
  const [query, setQuery]           = useState(STARTER_QUERY)
  const [variables, setVariables]   = useState('{}')
  const [showVars, setShowVars]     = useState(false)
  const [response, setResponse]     = useState<GraphQLResponse | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [savedQueries, setSavedQueries] = useState<SavedGraphQLQuery[]>(loadSavedQueries)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [sideTab, setSideTab]       = useState<SideTab>('schema')
  const [copyLabel, setCopyLabel]   = useState('Copy')

  const { height: editorHeight, onMouseDown: onEditorResizeDown } = useVerticalResize(280)

  // ── Insert a generated query into the editor ──
  function handleInsertQuery(q: string) {
    setQuery(q)
    setResponse(null)
    setError(null)
  }

  // ── Execute ──
  async function handleExecute() {
    setLoading(true)
    setError(null)
    setResponse(null)

    let parsedVars: Record<string, unknown> = {}
    if (showVars && variables.trim() && variables.trim() !== '{}') {
      try {
        parsedVars = JSON.parse(variables)
      } catch {
        setError('Variables is not valid JSON')
        setLoading(false)
        return
      }
    }

    try {
      const res = await executeGraphQL({ query, variables: parsedVars, db: selectedDb })
      setResponse(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // ── Saved queries ──
  function handleSave(name: string) {
    const saved: SavedGraphQLQuery = {
      id: crypto.randomUUID(),
      name,
      query,
      variables,
      createdAt: new Date().toISOString(),
    }
    const updated = [saved, ...savedQueries]
    setSavedQueries(updated)
    persistSavedQueries(updated)
    setShowSaveDialog(false)
  }

  function handleLoadSaved(q: SavedGraphQLQuery) {
    setQuery(q.query)
    setVariables(q.variables)
    if (q.variables && q.variables.trim() !== '{}') setShowVars(true)
  }

  function handleDeleteSaved(id: string) {
    const updated = savedQueries.filter(q => q.id !== id)
    setSavedQueries(updated)
    persistSavedQueries(updated)
  }

  // ── Copy response ──
  function handleCopy() {
    if (!response) return
    navigator.clipboard.writeText(JSON.stringify(response, null, 2))
    setCopyLabel('Copied!')
    setTimeout(() => setCopyLabel('Copy'), 2000)
  }

  // ── Ctrl+Enter to run ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleExecute()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [query, variables, showVars])

  const hasErrors = response?.errors && response.errors.length > 0

  return (
    <div className="flex h-full overflow-hidden bg-gray-50 dark:bg-gray-950">

      {/* ── Left sidebar ── */}
      <aside className="w-60 flex-shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          {(['schema', 'saved'] as SideTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setSideTab(tab)}
              className={`flex-1 text-xs py-2 font-medium capitalize transition-colors ${
                sideTab === tab
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {tab === 'schema' ? 'Schema' : 'Saved'}
            </button>
          ))}
        </div>

        {/* Saved tab header */}
        {sideTab === 'saved' && (
          <div className="px-2 py-2 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
            <button
              onClick={() => setShowSaveDialog(true)}
              className="btn-primary w-full text-xs py-1 flex items-center justify-center gap-1.5"
            >
              <SaveIcon />
              Save Current Query
            </button>
          </div>
        )}

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {sideTab === 'schema' ? (
            <SchemaPanel db={selectedDb} onInsertQuery={handleInsertQuery} />
          ) : (
            <SavedQueriesPanel queries={savedQueries} onLoad={handleLoadSaved} onDelete={handleDeleteSaved} />
          )}
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0">
          <h1 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mr-2">GraphQL Explorer</h1>

          <button
            onClick={handleExecute}
            disabled={loading || !query.trim()}
            className="btn-primary flex items-center gap-1.5 text-xs px-3 py-1.5 disabled:opacity-40"
            title="Run query (Ctrl+Enter)"
          >
            <PlayIcon />
            {loading ? 'Running…' : 'Run'}
          </button>

          <button
            onClick={() => setShowVars(v => !v)}
            className={`btn-secondary text-xs px-3 py-1.5 ${showVars ? 'ring-1 ring-blue-400' : ''}`}
          >
            Variables
          </button>

          <button
            onClick={() => { setQuery(''); setResponse(null); setError(null) }}
            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
          >
            <ClearIcon />
            Clear
          </button>

          <div className="flex-1" />

          <button
            onClick={() => setShowSaveDialog(true)}
            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <SaveIcon />
            Save
          </button>

          <button
            onClick={() => setSideTab('saved')}
            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <FolderIcon />
            Saved
          </button>
        </div>

        {/* Editor + results */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Query editor */}
          <div className="flex flex-col border-b border-gray-200 dark:border-gray-700" style={{ height: editorHeight }}>
            <div className="flex items-center px-3 py-1 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Query</span>
              <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">Ctrl+Enter to run</span>
            </div>
            <textarea
              value={query}
              onChange={e => setQuery(e.target.value)}
              spellCheck={false}
              className="flex-1 resize-none p-3 text-sm font-mono bg-white dark:bg-gray-950 text-gray-800 dark:text-gray-100 focus:outline-none"
              placeholder="Enter your GraphQL query here…"
            />
          </div>

          {/* Resize handle */}
          <div
            onMouseDown={onEditorResizeDown}
            className="h-1.5 bg-gray-200 dark:bg-gray-700 cursor-row-resize hover:bg-blue-400 dark:hover:bg-blue-600 transition-colors flex-shrink-0"
          />

          {/* Variables */}
          {showVars && (
            <div className="flex flex-col border-b border-gray-200 dark:border-gray-700 flex-shrink-0" style={{ height: 120 }}>
              <div className="px-3 py-1 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Variables (JSON)</span>
              </div>
              <textarea
                value={variables}
                onChange={e => setVariables(e.target.value)}
                spellCheck={false}
                className="flex-1 resize-none p-3 text-sm font-mono bg-white dark:bg-gray-950 text-gray-800 dark:text-gray-100 focus:outline-none"
                placeholder='{ "myVar": "value" }'
              />
            </div>
          )}

          {/* Results */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center px-3 py-1 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Response
                {hasErrors && (
                  <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400">
                    {response!.errors!.length} error{response!.errors!.length > 1 ? 's' : ''}
                  </span>
                )}
              </span>
              {response && (
                <button onClick={handleCopy} className="ml-auto text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                  {copyLabel}
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto p-3 text-xs font-mono">
              {error && (
                <div className="rounded border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-red-700 dark:text-red-300">
                  <strong>Error:</strong> {error}
                </div>
              )}

              {hasErrors && (
                <div className="mb-3 space-y-2">
                  {response!.errors!.map((err: GraphQLError, i: number) => (
                    <div key={i} className="rounded border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-red-700 dark:text-red-300">
                      <strong>GraphQL Error:</strong> {err.message}
                      {err.locations && (
                        <span className="ml-2 text-red-400">
                          (line {err.locations[0].line}, col {err.locations[0].column})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {response?.data !== undefined && response.data !== null && (
                <div className="h-full -m-3">
                  <JsonResultViewer value={response.data} />
                </div>
              )}

              {!error && !response && !loading && (
                <p className="text-gray-400 dark:text-gray-500">Run a query to see results here.</p>
              )}

              {loading && (
                <p className="text-gray-400 dark:text-gray-500 animate-pulse">Executing…</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {showSaveDialog && (
        <SaveDialog onSave={handleSave} onCancel={() => setShowSaveDialog(false)} />
      )}
    </div>
  )
}
