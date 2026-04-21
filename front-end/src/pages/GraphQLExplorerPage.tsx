import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  executeGraphQL,
  explainGraphQL,
  deriveGraphQLSchema,
  getGraphQLSchema,
  deleteGraphQLType,
  saveGraphQLRelations,
  getAnalysisList,
} from '../services/api'
import { useDatabase } from '../context/useDatabase'
import { useTheme } from '../context/ThemeContext'
import type {
  Analysis,
  GraphQLError,
  GraphQLResponse,
  SavedGraphQLQuery,
} from '../types'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { foldAll, unfoldAll } from '@codemirror/language'
import { Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { tokyoNight } from '@uiw/codemirror-theme-tokyo-night'
import type { EditorView as EditorViewType } from '@codemirror/view'
import { graphql } from 'cm6-graphql'
import { buildClientSchema, getIntrospectionQuery } from 'graphql'
import type { GraphQLSchema, IntrospectionQuery } from 'graphql'
import { autocompletion, completeFromList } from '@codemirror/autocomplete'
import type { CompletionContext } from '@codemirror/autocomplete'

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
}

interface DerivedSchema {
  derived: DerivedType
  savedAt: string
}

interface TypeSummary {
  name: string
  collection: string | null
  format: 'json' | 'xml'
  fieldCount: number
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
const LinkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
)
const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)
const PaginationIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <polyline points="3 6 4 6" /><polyline points="3 12 4 12" /><polyline points="3 18 4 18" />
    <polyline points="15 9 18 6 15 3" />
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
  const fieldName = toQueryFieldName(typeDef.type)
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
  const fieldName = toQueryFieldName(typeDef.type)
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
  const fieldName = toQueryFieldName(typeDef.type)
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

function buildPaginationQuery(typeDef: DerivedType): string {
  const fieldName = toQueryFieldName(typeDef.type)
  const scalarFields = Object.keys(typeDef.fields)
    .filter(f => !isObjectType(typeDef.fields[f].type))
    .slice(0, 6)
    .map(f => `        ${f}`)
    .join('\n')
  const orderField = Object.entries(typeDef.fields).find(([, f]) => f.index === 'range')?.[0]
    ?? Object.keys(typeDef.fields)[0]
    ?? 'id'

  return [
    `# Connection pagination — first page`,
    `# Copy endCursor from the response and paste into the next-page query`,
    `{`,
    `  ${fieldName}(`,
    `    first: 10`,
    `    orderBy: { field: "${orderField}", direction: "asc" }`,
    `  ) {`,
    `    totalCount`,
    `    pageInfo {`,
    `      hasNextPage`,
    `      endCursor`,
    `    }`,
    `    edges {`,
    `      cursor`,
    `      node {`,
    scalarFields,
    `      }`,
    `    }`,
    `  }`,
    `}`,
  ].join('\n')
}

function buildNextPageQuery(typeDef: DerivedType): string {
  const fieldName = toQueryFieldName(typeDef.type)
  const scalarFields = Object.keys(typeDef.fields)
    .filter(f => !isObjectType(typeDef.fields[f].type))
    .slice(0, 6)
    .map(f => `        ${f}`)
    .join('\n')
  const orderField = Object.entries(typeDef.fields).find(([, f]) => f.index === 'range')?.[0]
    ?? Object.keys(typeDef.fields)[0]
    ?? 'id'

  return [
    `# Connection pagination — next page`,
    `# Replace PASTE_END_CURSOR_HERE with the endCursor from the previous response`,
    `{`,
    `  ${fieldName}(`,
    `    first: 10`,
    `    after: "PASTE_END_CURSOR_HERE"`,
    `    orderBy: { field: "${orderField}", direction: "asc" }`,
    `  ) {`,
    `    pageInfo {`,
    `      hasNextPage`,
    `      hasPreviousPage`,
    `      endCursor`,
    `    }`,
    `    edges {`,
    `      cursor`,
    `      node {`,
    scalarFields,
    `      }`,
    `    }`,
    `  }`,
    `}`,
  ].join('\n')
}

/**
 * buildSmartQuery — generates a focused query using the most meaningful fields:
 *  • Picks ID field first, then high-frequency scalars, then indexed fields
 *  • Limits selection to ≤8 fields to keep the query readable
 *  • Adds an orderBy on the best range field if one exists
 *  • Expands one relation (if any) with its own scalar fields
 */
function buildSmartQuery(typeDef: DerivedType): string {
  const queryField = toQueryFieldName(typeDef.type)

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
  const queryField = toQueryFieldName(typeDef.type)
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

function buildRelationQuery(typeDef: DerivedType, relName: string, rel: { type: string; via: string; foreignKey: string }, relFields: Record<string, DerivedField>): string {
  const queryField = toQueryFieldName(typeDef.type)
  const parentScalars = Object.entries(typeDef.fields)
    .filter(([, f]) => !isObjectType(f.type))
    .slice(0, 5)
    .map(([n]) => `    ${n}`)
    .join('\n')
  const childFields = Object.entries(relFields)
    .filter(([, f]) => !isObjectType(f.type))
    .slice(0, 6)
    .map(([n]) => `      ${n}`)
    .join('\n')
  return `# ${typeDef.type} with ${relName} (${rel.type})\n` +
    `{\n  ${queryField}(limit: 25) {\n${parentScalars}\n    ${relName} {\n${childFields}\n    }\n  }\n}`
}

function isObjectType(gqlType: string): boolean {
  const scalars = ['String', 'Int', 'Float', 'Boolean', 'ID']
  const unwrapped = gqlType.replace(/[\[\]!]/g, '')
  return !scalars.includes(unwrapped)
}

function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

function toQueryFieldName(typeName: string): string {
  const lower = lcFirst(typeName)
  return lower.endsWith('s') ? lower : lower + 's'  // "Orders" → "orders", "Order" → "orders"
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

// ── Relation section — shows related type's fields inline ────────────────────

function RelationSection({
  name,
  rel,
  relFieldEntries,
  onInsertQuery,
  onRemove,
}: {
  name: string
  rel: { type: string; via: string; foreignKey: string }
  relFieldEntries: [string, DerivedField][]
  onInsertQuery: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="border-b border-gray-100 dark:border-gray-800">
      {/* Relation header row */}
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 select-none group"
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <span className="font-mono text-purple-600 dark:text-purple-400 flex-1 truncate">{name}</span>
        <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">→</span>
        <span className="font-mono text-blue-600 dark:text-blue-400 flex-shrink-0 truncate">{rel.type}</span>
        <div className="flex items-center gap-1 ml-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {relFieldEntries.length > 0 && (
            <button
              onClick={onInsertQuery}
              title={`Insert query with ${name}`}
              className="text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <FilterIcon />
            </button>
          )}
          <button
            onClick={onRemove}
            title="Remove relation"
            className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* via / fk line */}
      <div className="px-6 py-0.5 text-gray-400 dark:text-gray-500 font-mono">
        via <span className="text-gray-600 dark:text-gray-300">{rel.via}</span>
        <span className="mx-1">·</span>
        fk <span className="text-gray-600 dark:text-gray-300">{rel.foreignKey}</span>
      </div>

      {/* Related type's fields */}
      {open && relFieldEntries.length > 0 && (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {relFieldEntries.map(([fieldName, field]) => (
            <FieldRow key={fieldName} name={fieldName} field={field} nested indent />
          ))}
        </div>
      )}
      {open && relFieldEntries.length === 0 && (
        <div className="px-6 py-1 text-gray-400 dark:text-gray-500 italic">
          Fields not loaded yet
        </div>
      )}
    </div>
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

type SchemaPanelMode = 'list' | 'detail' | 'generate'

interface SchemaPanelProps {
  db: string
  onInsertQuery: (q: string) => void
  onSuggestQuery: (q: string) => void  // only replaces editor when it's at the starter/blank state
}

function SchemaPanel({ db, onInsertQuery, onSuggestQuery }: SchemaPanelProps) {
  const [mode, setMode]                   = useState<SchemaPanelMode>('list')
  const [allTypes, setAllTypes]           = useState<TypeSummary[]>([])
  const [loadingTypes, setLoadingTypes]   = useState(false)
  const [typesError, setTypesError]       = useState<string | null>(null)
  const [deletingType, setDeletingType]   = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Detail view state
  const [derivedType, setDerivedType]     = useState<DerivedType | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [expandedFields, setExpandedFields] = useState(true)
  const [examplesOpen, setExamplesOpen]   = useState(true)
  const [introspectionOpen, setIntrospectionOpen] = useState(false)
  const [relationsOpen, setRelationsOpen] = useState(true)
  const [relations, setRelations] = useState<Record<string, { type: string; via: string; foreignKey: string }>>({})
  const [savingRelations, setSavingRelations] = useState(false)
  const [relationsSaved, setRelationsSaved] = useState(false)
  const [relationsError, setRelationsError] = useState<string | null>(null)
  const [addingRelation, setAddingRelation] = useState(false)
  const [newRel, setNewRel] = useState({ name: '', type: '', via: '', foreignKey: '' })
  const [knownTypeFields, setKnownTypeFields] = useState<Record<string, Record<string, DerivedField>>>({})

  // Generate form state
  const [analyses, setAnalyses]           = useState<Analysis[]>([])
  const [analysisId, setAnalysisId]       = useState('')
  const [genTypeName, setGenTypeName]     = useState('')
  const [genCollection, setGenCollection] = useState('')
  const [genFormat, setGenFormat]         = useState<'json' | 'xml'>('json')
  const [loadingAnalyses, setLoadingAnalyses] = useState(false)
  const [deriving, setDeriving]           = useState(false)
  const [deriveError, setDeriveError]     = useState<string | null>(null)

  async function handleDeleteType(name: string) {
    setDeletingType(name)
    setConfirmDelete(null)
    try {
      await deleteGraphQLType(name)
      setAllTypes(prev => prev.filter(t => t.name !== name))
      if (derivedType?.type === name) {
        setDerivedType(null)
        setMode('list')
      }
    } catch {
      // leave list unchanged — user can retry
    } finally {
      setDeletingType(null)
    }
  }

  function toTypeName(s: string): string {
    return s.split(/[-_ .]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  }

  // Load all registered types on mount / db change
  useEffect(() => {
    if (!db) return
    setLoadingTypes(true)
    setTypesError(null)
    setDerivedType(null)
    getGraphQLSchema()
      .then((r: Record<string, unknown>) => {
        const typesMap = (r.types ?? {}) as Record<string, { collection?: string | null; format?: string; fieldCount?: number }>
        const summaries: TypeSummary[] = Object.entries(typesMap).map(([name, def]) => ({
          name,
          collection: def.collection ?? null,
          format: (def.format === 'xml' ? 'xml' : 'json') as 'json' | 'xml',
          fieldCount: def.fieldCount ?? 0,
        }))
        setAllTypes(summaries)
        setMode(summaries.length > 0 ? 'list' : 'generate')
      })
      .catch(() => {
        setAllTypes([])
        setMode('generate')
        setTypesError(null) // silently fall through to generate mode
      })
      .finally(() => setLoadingTypes(false))
  }, [db])

  // Load analyses when generate mode opens
  useEffect(() => {
    if (mode !== 'generate' || !db) return
    if (analyses.length > 0) return // already loaded
    setLoadingAnalyses(true)
    getAnalysisList(db)
      .then(list => {
        setAnalyses(list)
        if (list.length > 0) {
          setAnalysisId(list[0].analysisId)
          setGenTypeName(toTypeName(list[0].localname))
          setGenCollection(list[0].localname)
        }
      })
      .catch(() => setAnalyses([]))
      .finally(() => setLoadingAnalyses(false))
  }, [mode, db])

  function handleAnalysisChange(id: string) {
    setAnalysisId(id)
    setDeriveError(null)
    const a = analyses.find(a => a.analysisId === id)
    if (a) {
      setGenTypeName(toTypeName(a.localname))
      setGenCollection(a.localname)
      setGenFormat(a.documentType === 'xml' ? 'xml' : 'json')
    }
  }

  async function handleDerive() {
    if (!analysisId || !genTypeName.trim() || !genCollection.trim()) return
    setDeriving(true)
    setDeriveError(null)

    const selectedAnalysis = analyses.find(a => a.analysisId === analysisId)
    const analysisUri = selectedAnalysis?.analysisUri ?? ''
    if (!analysisUri) {
      setDeriveError('Analysis URI not available — please re-run the analysis.')
      setDeriving(false)
      return
    }

    try {
      const result = await deriveGraphQLSchema(genTypeName.trim(), genCollection.trim(), analysisUri, genFormat, db) as unknown as DerivedSchema & { error?: string }
      if (result?.error) { setDeriveError(result.error); return }
      if (!result?.derived) {
        setDeriveError('Unexpected response from server — no schema derived.')
        return
      }
      // Add / update in type list
      const newSummary: TypeSummary = {
        name: result.derived.type,
        collection: result.derived.collection,
        format: result.derived.format,
        fieldCount: Object.keys(result.derived.fields).length,
      }
      setAllTypes(prev => {
        const without = prev.filter(t => t.name !== newSummary.name)
        return [newSummary, ...without]
      })
      // Open detail view for the newly generated type
      openDetail(result.derived)
      onSuggestQuery(buildSmartQuery(result.derived))
    } catch (e: unknown) {
      setDeriveError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeriving(false)
    }
  }

  async function openDetail(typeDef: DerivedType) {
    setDerivedType(typeDef)
    setRelations(typeDef.relations ?? {})
    setRelationsSaved(false)
    setRelationsError(null)
    setAddingRelation(false)
    setExpandedFields(true)
    setExamplesOpen(true)
    setMode('detail')

    // Pre-fetch full field definitions for all known types (for relation display + dropdowns)
    const fieldMap: Record<string, Record<string, DerivedField>> = {}
    const fetches = allTypes
      .filter(t => t.name !== typeDef.type)
      .map(t =>
        getGraphQLSchema(t.name)
          .then((td: Record<string, unknown>) => {
            fieldMap[t.name] = (td.fields ?? {}) as Record<string, DerivedField>
          })
          .catch(() => {})
      )
    Promise.all(fetches).then(() => setKnownTypeFields(fieldMap))
  }

  async function handleSelectType(name: string) {
    setLoadingDetail(true)
    try {
      const td = await getGraphQLSchema(name) as unknown as { fields?: Record<string, DerivedField>; collection?: string; format?: string; relations?: Record<string, { type: string; via: string; foreignKey: string }>; nestedTypes?: Record<string, DerivedType> }
      const typeDef: DerivedType = {
        type: name,
        collection: td.collection ?? '',
        format: (td.format === 'xml' ? 'xml' : 'json') as 'json' | 'xml',
        fields: td.fields ?? {},
        relations: td.relations ?? {},
        nestedTypes: td.nestedTypes,
      }
      await openDetail(typeDef)
      onSuggestQuery(buildSmartQuery(typeDef))
    } catch {
      // silently stay on list if load fails
    } finally {
      setLoadingDetail(false)
    }
  }

  async function handleSaveRelations() {
    if (!derivedType) return
    setSavingRelations(true)
    setRelationsSaved(false)
    setRelationsError(null)
    try {
      await saveGraphQLRelations(derivedType.type, relations)
      setRelationsSaved(true)
      const updated = { ...derivedType, relations }
      onInsertQuery(buildSmartQuery(updated))
      setTimeout(() => setRelationsSaved(false), 3000)
    } catch (e: unknown) {
      setRelationsError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingRelations(false)
    }
  }

  function handleAddRelation() {
    const { name, type: relType, via, foreignKey } = newRel
    if (!name.trim() || !relType.trim() || !via.trim() || !foreignKey.trim()) return
    setRelations(prev => ({ ...prev, [name.trim()]: { type: relType.trim(), via: via.trim(), foreignKey: foreignKey.trim() } }))
    setNewRel({ name: '', type: '', via: '', foreignKey: '' })
    setAddingRelation(false)
    setRelationsSaved(false)
  }

  function handleRemoveRelation(name: string) {
    setRelations(prev => { const next = { ...prev }; delete next[name]; return next })
    setRelationsSaved(false)
  }

  const scalarFields = derivedType
    ? Object.entries(derivedType.fields).filter(([, f]) => !isObjectType(f.type))
    : []
  const objectFields = derivedType
    ? Object.entries(derivedType.fields).filter(([, f]) => isObjectType(f.type))
    : []
  const knownTypes = allTypes.map(t => t.name)

  // ── LIST MODE ──────────────────────────────────────────────────────────────

  if (mode === 'list') {
    return (
      <div className="flex flex-col h-full overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <span className="font-medium text-gray-600 dark:text-gray-300">
            Types
            {allTypes.length > 0 && (
              <span className="ml-1.5 text-gray-400 dark:text-gray-500 font-normal">({allTypes.length})</span>
            )}
          </span>
          <button
            onClick={() => setMode('generate')}
            className="ml-auto flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
            title="Generate a new schema type from an analysis"
          >
            <PlusIcon /> New Type
          </button>
        </div>

        {loadingTypes && (
          <div className="flex-1 flex items-center justify-center text-gray-400 animate-pulse">Loading types…</div>
        )}

        {!loadingTypes && typesError && (
          <div className="p-3 text-red-500 dark:text-red-400">{typesError}</div>
        )}

        {!loadingTypes && allTypes.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-3 text-gray-400 dark:text-gray-500">
            <SparkleIcon />
            <p>No schema types found.</p>
            <button
              onClick={() => setMode('generate')}
              className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
            >
              <SparkleIcon /> Generate from analysis
            </button>
          </div>
        )}

        {!loadingTypes && allTypes.length > 0 && (
          <div className="flex-1 overflow-auto divide-y divide-gray-100 dark:divide-gray-800">
            {loadingDetail && (
              <div className="px-3 py-2 text-gray-400 animate-pulse">Loading…</div>
            )}
            {allTypes.map(t => (
              <div key={t.name} className="group relative flex items-center hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                {confirmDelete === t.name ? (
                  <div className="flex items-center gap-1.5 w-full px-3 py-2">
                    <span className="flex-1 text-gray-600 dark:text-gray-300 truncate">Delete <span className="font-mono font-medium">{t.name}</span>?</span>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                    >Cancel</button>
                    <button
                      onClick={() => handleDeleteType(t.name)}
                      disabled={deletingType === t.name}
                      className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40"
                    >
                      {deletingType === t.name ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => handleSelectType(t.name)}
                      className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 text-left"
                    >
                      <span className="font-mono font-medium text-gray-800 dark:text-gray-100 flex-1 truncate group-hover:text-blue-700 dark:group-hover:text-blue-300">
                        {t.name}
                      </span>
                      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded font-medium ${
                        t.format === 'xml'
                          ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      }`}>
                        {t.format.toUpperCase()}
                      </span>
                      <span className="flex-shrink-0 text-gray-400 dark:text-gray-500">
                        {t.fieldCount}f
                      </span>
                      <ChevronRightIcon />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmDelete(t.name) }}
                      title={`Delete ${t.name}`}
                      className="opacity-0 group-hover:opacity-100 flex-shrink-0 px-2 py-2 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-opacity"
                    >
                      <TrashIcon />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Introspection footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="px-3 py-1.5 text-gray-500 dark:text-gray-400 font-medium">Introspection</div>
          <div className="space-y-0.5 pb-1">
            {INTROSPECTION_QUERIES.map(({ label, query }) => (
              <ExampleQueryButton key={label} icon={<ListIcon />} label={label} onClick={() => onInsertQuery(query)} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── GENERATE MODE ──────────────────────────────────────────────────────────

  if (mode === 'generate') {
    return (
      <div className="flex flex-col h-full overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          {allTypes.length > 0 && (
            <button
              onClick={() => setMode('list')}
              className="flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <ChevronRightIcon />
              <span className="rotate-180 inline-block">‹</span> Types
            </button>
          )}
          <span className="font-medium text-gray-600 dark:text-gray-300 ml-1">New Type</span>
        </div>

        <div className="p-3 space-y-2 overflow-auto flex-1">
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
                value={genTypeName}
                onChange={e => setGenTypeName(e.target.value)}
                placeholder="e.g. Order"
                className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-gray-500 dark:text-gray-400 mb-1">Collection</label>
              <input
                type="text"
                value={genCollection}
                onChange={e => setGenCollection(e.target.value)}
                placeholder="e.g. orders"
                className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-gray-500 dark:text-gray-400">Format</label>
            <select
              value={genFormat}
              onChange={e => setGenFormat(e.target.value as 'json' | 'xml')}
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="json">JSON</option>
              <option value="xml">XML</option>
            </select>
            <button
              onClick={handleDerive}
              disabled={deriving || !analysisId || !genTypeName.trim() || !genCollection.trim()}
              className="ml-auto btn-primary text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-40"
            >
              <SparkleIcon />
              {deriving ? 'Generating…' : 'Generate'}
            </button>
          </div>

          {deriveError && (
            <p className="text-red-500 dark:text-red-400 text-xs break-words">{deriveError}</p>
          )}

          {allTypes.length > 0 && (
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
              <p className="text-gray-400 dark:text-gray-500 italic">
                Existing types will be overwritten if you use the same type name.
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── DETAIL MODE ────────────────────────────────────────────────────────────

  if (!derivedType) return null

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs">

      {/* Type header with back nav */}
      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => setMode('list')}
          className="flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex-shrink-0 mr-1"
          title="Back to type list"
        >
          ‹
        </button>
        <span className="font-semibold text-blue-600 dark:text-blue-400 truncate">{derivedType.type}</span>
        {derivedType.collection && (
          <>
            <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">·</span>
            <span className="text-gray-500 dark:text-gray-400 truncate">{derivedType.collection}</span>
          </>
        )}
        <span className={`ml-auto flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
          derivedType.format === 'xml'
            ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
        }`}>
          {derivedType.format.toUpperCase()}
        </span>
      </div>

      <div className="flex-1 overflow-auto">

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
              <ExampleQueryButton
                icon={<PaginationIcon />}
                label={`Paginate ${derivedType.type} (first page)`}
                onClick={() => onInsertQuery(buildPaginationQuery(derivedType))}
              />
              <ExampleQueryButton
                icon={<PaginationIcon />}
                label={`Paginate ${derivedType.type} (next page)`}
                onClick={() => onInsertQuery(buildNextPageQuery(derivedType))}
              />
            </div>
          )}
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

        {/* Relations */}
        <div className="border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setRelationsOpen(v => !v)}
            className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium border-b border-gray-200 dark:border-gray-700"
          >
            {relationsOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
            <LinkIcon />
            Relations
            <span className="ml-auto text-gray-400 dark:text-gray-500 font-normal">{Object.keys(relations).length}</span>
          </button>

          {relationsOpen && (
            <div className="pb-2">
              {Object.entries(relations).map(([name, rel]) => {
                const relFields = knownTypeFields[rel.type] ?? {}
                const relFieldEntries = Object.entries(relFields).filter(([, f]) => !isObjectType(f.type))
                return (
                  <RelationSection
                    key={name}
                    name={name}
                    rel={rel}
                    relFieldEntries={relFieldEntries}
                    onInsertQuery={() => onInsertQuery(buildRelationQuery(derivedType, name, rel, relFields))}
                    onRemove={() => handleRemoveRelation(name)}
                  />
                )
              })}

              {addingRelation ? (
                <div className="px-3 py-2 space-y-1.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Field name (e.g. customer)"
                    value={newRel.name}
                    onChange={e => setNewRel(r => ({ ...r, name: e.target.value }))}
                    className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <div className="flex gap-1">
                    {knownTypes.length > 0 ? (
                      <select
                        value={newRel.type}
                        onChange={e => setNewRel(r => ({ ...r, type: e.target.value }))}
                        className="flex-1 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">Target type…</option>
                        {knownTypes.filter(t => t !== derivedType.type).map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder="Target type (e.g. Customer)"
                        value={newRel.type}
                        onChange={e => setNewRel(r => ({ ...r, type: e.target.value }))}
                        className="flex-1 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-gray-400 dark:text-gray-500 mb-0.5">Local field (via)</label>
                    {scalarFields.length > 0 ? (
                      <select
                        value={newRel.via}
                        onChange={e => setNewRel(r => ({ ...r, via: e.target.value }))}
                        className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">Select field…</option>
                        {scalarFields.map(([name]) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder="e.g. customerId"
                        value={newRel.via}
                        onChange={e => setNewRel(r => ({ ...r, via: e.target.value }))}
                        className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-gray-400 dark:text-gray-500 mb-0.5">Foreign key (on target)</label>
                    {newRel.type && Object.keys(knownTypeFields[newRel.type] ?? {}).length > 0 ? (
                      <select
                        value={newRel.foreignKey}
                        onChange={e => setNewRel(r => ({ ...r, foreignKey: e.target.value }))}
                        className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">Select field…</option>
                        {Object.keys(knownTypeFields[newRel.type] ?? {}).map(f => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder={newRel.type ? 'Loading fields…' : 'Select a target type first'}
                        value={newRel.foreignKey}
                        onChange={e => setNewRel(r => ({ ...r, foreignKey: e.target.value }))}
                        disabled={!!newRel.type && !knownTypeFields[newRel.type]}
                        className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                      />
                    )}
                  </div>
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={() => { setAddingRelation(false); setNewRel({ name: '', type: '', via: '', foreignKey: '' }) }}
                      className="btn-secondary text-xs px-2 py-1"
                    >Cancel</button>
                    <button
                      onClick={handleAddRelation}
                      disabled={!newRel.name.trim() || !newRel.type.trim() || !newRel.via.trim() || !newRel.foreignKey.trim()}
                      className="btn-primary text-xs px-2 py-1 disabled:opacity-40"
                    >Add</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setAddingRelation(true)}
                  className="flex items-center gap-1.5 w-full px-3 py-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800"
                >
                  <PlusIcon /> Add relation
                </button>
              )}

              <div className="px-3 pt-2 space-y-1">
                {relationsError && (
                  <p className="text-red-500 dark:text-red-400 text-xs break-words">{relationsError}</p>
                )}
                <button
                  onClick={handleSaveRelations}
                  disabled={savingRelations}
                  className="btn-primary w-full text-xs py-1 flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  <SaveIcon />
                  {savingRelations ? 'Saving…' : relationsSaved ? 'Saved!' : 'Save Relations'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Regenerate link */}
        <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={() => { setDeriveError(null); setMode('generate') }}
            className="text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1"
          >
            <SparkleIcon /> Regenerate from analysis
          </button>
        </div>
      </div>
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
  const { theme } = useTheme()
  const isDark = theme === 'dark'

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
          theme={isDark ? tokyoNight : undefined}
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

// ── GraphQL keyword fallback completer (no schema required) ──────────────────

const GQL_KEYWORDS = completeFromList([
  // Operation types
  { label: 'query',        type: 'keyword' },
  { label: 'mutation',     type: 'keyword' },
  { label: 'subscription', type: 'keyword' },
  { label: 'fragment',     type: 'keyword' },
  { label: 'on',           type: 'keyword' },
  // Directives
  { label: '@skip',        type: 'keyword', detail: 'directive' },
  { label: '@include',     type: 'keyword', detail: 'directive' },
  { label: '@deprecated',  type: 'keyword', detail: 'directive' },
  // Introspection roots
  { label: '__schema',     type: 'property', detail: 'introspection' },
  { label: '__type',       type: 'property', detail: 'introspection' },
  { label: '__typename',   type: 'property', detail: 'introspection' },
  // Common scalar types (useful inside inline fragments / variable defs)
  { label: 'String',   type: 'type' },
  { label: 'Int',      type: 'type' },
  { label: 'Float',    type: 'type' },
  { label: 'Boolean',  type: 'type' },
  { label: 'ID',       type: 'type' },
  // Common argument names used in this project's schema
  { label: 'limit',    type: 'variable', detail: 'arg' },
  { label: 'offset',   type: 'variable', detail: 'arg' },
  { label: 'where',       type: 'variable', detail: 'arg' },
  { label: 'orderBy',     type: 'variable', detail: 'arg' },
  { label: 'field',       type: 'variable', detail: 'arg' },
  { label: 'direction',   type: 'variable', detail: 'arg' },
  // Field operators (used inside where: { field: { <op>: value } })
  { label: 'contains',    type: 'property', detail: 'operator · word match' },
  { label: 'notContains', type: 'property', detail: 'operator · word exclusion' },
  { label: 'startsWith',  type: 'property', detail: 'operator · prefix match' },
  { label: 'in',          type: 'property', detail: 'operator · value list' },
  { label: 'notIn',       type: 'property', detail: 'operator · value exclusion list' },
  { label: 'exists',      type: 'property', detail: 'operator · field presence' },
  { label: 'eq',          type: 'property', detail: 'operator · equals' },
  { label: 'ne',          type: 'property', detail: 'operator · not equals' },
  { label: 'gt',          type: 'property', detail: 'operator · greater than' },
  { label: 'gte',         type: 'property', detail: 'operator · greater than or equal' },
  { label: 'lt',          type: 'property', detail: 'operator · less than' },
  { label: 'lte',         type: 'property', detail: 'operator · less than or equal' },
  { label: 'true',     type: 'keyword' },
  { label: 'false',    type: 'keyword' },
  { label: 'null',     type: 'keyword' },
])

function gqlKeywordCompleter(ctx: CompletionContext) {
  const word = ctx.matchBefore(/[@\w][\w]*/)
  if (!word && !ctx.explicit) return null
  if (!word) return { from: ctx.pos, options: [], validFor: /^[@\w]*$/ }
  return GQL_KEYWORDS(ctx)
}

// ── STARTER_QUERY ─────────────────────────────────────────────────────────────

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

// ── Execution Plan Panel ──────────────────────────────────────────────────────

interface OrderByWarning {
  field: string
  sourceKey: string | null
  type: string | null
  namespace: string | null
  collation: string | null
  requestedSpec: string | null
  reason: string
  remediation: string
}

interface SubPlanInfo {
  inline: boolean
  sourceKey: string | null
  type: string | null
  via: string | null
  foreignKey: string | null
  connection: boolean
  limit: number | null
  offset: number | null
  ctsQuery: string | null
  orderBy: string[]
  orderByWarnings: OrderByWarning[]
  warnings: string[]
}

interface QueryPlanInfo {
  field: string
  typeName: string
  collection: string | null
  format: string
  connection: boolean
  limit: number
  offset: number
  ctsQuery: string
  orderBy: string[]
  orderByWarnings: OrderByWarning[]
  subPlans: Record<string, SubPlanInfo>
}

interface ExplainResult {
  plans: QueryPlanInfo[]
  schema: Record<string, { collection: string | null; format: string; fieldCount: number }>
}

function OrderByWarningCard({ w, prefix }: { w: OrderByWarning; prefix?: string }) {
  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded p-2 space-y-1">
      <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-sans font-medium">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        {prefix ? `${prefix} ` : ''}orderBy "{w.field}" — index missing
      </div>
      <div className="text-amber-600 dark:text-amber-500 font-sans text-xs">{w.reason}</div>
      {w.requestedSpec && (
        <pre className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1 rounded text-xs whitespace-pre-wrap break-all">
          {w.requestedSpec}
        </pre>
      )}
      {(w.namespace || w.collation) && (
        <div className="flex flex-wrap gap-2 font-sans text-xs">
          {w.namespace && (
            <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded">
              namespace: {w.namespace}
            </span>
          )}
          {w.collation && (
            <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
              collation: {w.collation}
            </span>
          )}
        </div>
      )}
      <div className="text-gray-600 dark:text-gray-300 font-sans text-xs">
        <span className="font-medium">Fix: </span>{w.remediation}
      </div>
    </div>
  )
}

function ExecutionPlanPanel({ plan, onClose }: { plan: ExplainResult; onClose: () => void }) {
  const [openPlans, setOpenPlans] = useState<Record<number, boolean>>({ 0: true })
  const [schemaOpen, setSchemaOpen] = useState(false)

  function toggle(i: number) {
    setOpenPlans(p => ({ ...p, [i]: !p[i] }))
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col" style={{ maxHeight: 320 }}>
      <div className="flex items-center px-3 py-1 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Execution Plan
          <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
            {plan.plans.length} operation{plan.plans.length !== 1 ? 's' : ''}
          </span>
        </span>
        <button onClick={onClose} className="ml-auto text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          Close
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-2 text-xs font-mono">
        {plan.plans.map((p, i) => (
          <div key={i} className="border border-gray-200 dark:border-gray-700 rounded">
            <button
              onClick={() => toggle(i)}
              className="flex items-center gap-2 w-full px-3 py-2 text-left bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 rounded-t"
            >
              {openPlans[i] ? <ChevronDownIcon /> : <ChevronRightIcon />}
              <span className="text-blue-600 dark:text-blue-400 font-semibold">{p.field}</span>
              <span className="text-gray-400">→</span>
              <span className="text-purple-600 dark:text-purple-400">{p.typeName}</span>
              {p.collection && <span className="text-gray-400 dark:text-gray-500">· {p.collection}</span>}
              <span className={`ml-auto px-1.5 py-0.5 rounded text-xs ${
                p.format === 'xml'
                  ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                  : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
              }`}>{p.format.toUpperCase()}</span>
            </button>

            {openPlans[i] && (
              <div className="px-3 py-2 space-y-2 bg-white dark:bg-gray-900 rounded-b divide-y divide-gray-100 dark:divide-gray-800">

                {/* Pagination */}
                <div className="flex gap-4 py-1 text-gray-600 dark:text-gray-300">
                  <span><span className="text-gray-400">limit </span>{p.limit}</span>
                  <span><span className="text-gray-400">offset </span>{p.offset}</span>
                </div>

                {/* CTS Query */}
                <div className="pt-2">
                  <div className="text-gray-400 dark:text-gray-500 mb-1">cts query</div>
                  <pre className="text-green-700 dark:text-green-400 whitespace-pre-wrap break-all bg-gray-50 dark:bg-gray-800 p-2 rounded text-xs">{p.ctsQuery}</pre>
                </div>

                {/* OrderBy */}
                {p.orderBy.length > 0 && (
                  <div className="pt-2">
                    <div className="text-gray-400 dark:text-gray-500 mb-1">order by</div>
                    {p.orderBy.map((o, j) => (
                      <pre key={j} className="text-yellow-700 dark:text-yellow-400 whitespace-pre-wrap break-all bg-gray-50 dark:bg-gray-800 p-2 rounded text-xs">{o}</pre>
                    ))}
                  </div>
                )}

                {/* OrderBy warnings */}
                {p.orderByWarnings?.length > 0 && (
                  <div className="pt-2 space-y-2">
                    {p.orderByWarnings.map((w, j) => (
                      <OrderByWarningCard key={j} w={w} />
                    ))}
                  </div>
                )}

                {/* SubPlans */}
                {Object.keys(p.subPlans).length > 0 && (
                  <div className="pt-2">
                    <div className="text-gray-400 dark:text-gray-500 mb-1">relations</div>
                    <div className="space-y-2">
                      {Object.entries(p.subPlans).map(([name, sp]) => (
                        <div key={name} className="bg-gray-50 dark:bg-gray-800 px-2 py-1.5 rounded space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-purple-600 dark:text-purple-400">{name}</span>
                            <span className={`px-1.5 py-0.5 rounded text-xs font-sans ${
                              sp.inline
                                ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400'
                                : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                            }`}>
                              {sp.inline ? 'inline' : 'join'}
                            </span>
                            {sp.connection && (
                              <span className="px-1.5 py-0.5 rounded text-xs font-sans bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">connection</span>
                            )}
                            {sp.inline && sp.sourceKey && (
                              <span className="text-gray-500 dark:text-gray-400">sourceKey: <span className="text-gray-700 dark:text-gray-200">{sp.sourceKey}</span></span>
                            )}
                            {!sp.inline && sp.via && (
                              <span className="text-gray-500 dark:text-gray-400">via: <span className="text-gray-700 dark:text-gray-200">{sp.via}</span> → <span className="text-gray-700 dark:text-gray-200">{sp.foreignKey}</span></span>
                            )}
                            {sp.type && <span className="text-gray-400 dark:text-gray-500">({sp.type})</span>}
                          </div>
                          {sp.warnings?.length > 0 && (
                            <div className="mt-1 space-y-1">
                              {sp.warnings.map((w, j) => (
                                <div key={j} className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded p-2 flex gap-1.5 font-sans text-xs text-red-700 dark:text-red-400">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                                  </svg>
                                  {w}
                                </div>
                              ))}
                            </div>
                          )}
                          {sp.orderByWarnings?.length > 0 && sp.orderByWarnings.map((w, j) => (
                            <OrderByWarningCard key={j} w={w} prefix={name} />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Registry summary */}
        <div className="border border-gray-200 dark:border-gray-700 rounded">
          <button
            onClick={() => setSchemaOpen(v => !v)}
            className="flex items-center gap-2 w-full px-3 py-2 text-left bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 rounded"
          >
            {schemaOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
            <span className="text-gray-600 dark:text-gray-300 font-semibold">Registry</span>
            <span className="text-gray-400 ml-auto">{Object.keys(plan.schema).length} types</span>
          </button>
          {schemaOpen && (
            <div className="px-3 py-2 space-y-1 bg-white dark:bg-gray-900 rounded-b">
              {Object.entries(plan.schema).map(([name, def]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-purple-600 dark:text-purple-400 w-32 truncate">{name}</span>
                  <span className="text-gray-400">{def.collection ?? 'embedded'}</span>
                  <span className="text-gray-400">· {def.fieldCount} fields</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type SideTab = 'schema' | 'saved'

export default function GraphQLExplorerPage() {
  const { selectedDb }  = useDatabase()
  const [query, setQuery]           = useState(STARTER_QUERY)
  const [gqlSchema, setGqlSchema]       = useState<GraphQLSchema | undefined>(undefined)
  const [schemaStatus, setSchemaStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const executeRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!selectedDb) return
    setSchemaStatus('loading')
    setGqlSchema(undefined)
    executeGraphQL({ query: getIntrospectionQuery(), variables: {}, db: selectedDb })
      .then(res => {
        if (res?.data) {
          setGqlSchema(buildClientSchema(res.data as unknown as IntrospectionQuery))
          setSchemaStatus('ready')
        } else {
          setSchemaStatus('unavailable')
        }
      })
      .catch(() => setSchemaStatus('unavailable'))
  }, [selectedDb])
  const [variables, setVariables]   = useState('{}')
  const [showVars, setShowVars]     = useState(false)
  const [response, setResponse]     = useState<GraphQLResponse | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [savedQueries, setSavedQueries] = useState<SavedGraphQLQuery[]>(loadSavedQueries)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [sideTab, setSideTab]       = useState<SideTab>('schema')
  const [copyLabel, setCopyLabel]   = useState('Copy')
  const [explainResult, setExplainResult] = useState<ExplainResult | null>(null)
  const [responseMs, setResponseMs]     = useState<number | null>(null)
  const [explaining, setExplaining] = useState(false)

  const { height: editorHeight, onMouseDown: onEditorResizeDown } = useVerticalResize(280)

  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const gqlExtensions = useMemo(() => [
    graphql(gqlSchema),
    // Single autocompletion() instance — basicSetup's must be disabled.
    // When schema is loaded, language-data completers (registered by cm6-graphql) fire automatically.
    // When schema is absent, fall back to keyword completions via override.
    autocompletion({
      activateOnTyping: true,
      icons: true,
      ...(gqlSchema ? {} : { override: [gqlKeywordCompleter] }),
    }),
    Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { executeRef.current(); return true } }])),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
      '.cm-tooltip-autocomplete': { maxHeight: '280px' },
    }),
  ], [gqlSchema])

  // ── Insert a generated query into the editor (always replaces) ──
  function handleInsertQuery(q: string) {
    setQuery(q)
    setResponse(null)
    setError(null)
    setExplainResult(null)
  }

  // ── Suggest a query — only replaces when editor is blank or at the starter template ──
  function handleSuggestQuery(q: string) {
    const trimmed = query.trim()
    if (trimmed === '' || trimmed === STARTER_QUERY.trim()) {
      setQuery(q)
      setResponse(null)
      setError(null)
      setExplainResult(null)
    }
  }

  // ── Explain ──
  async function handleExplain() {
    if (!query.trim()) return
    setExplaining(true)
    setExplainResult(null)
    let parsedVars: Record<string, unknown> = {}
    if (showVars && variables.trim() && variables.trim() !== '{}') {
      try { parsedVars = JSON.parse(variables) } catch { /* ignore */ }
    }
    try {
      const res = await explainGraphQL({ query, variables: parsedVars, db: selectedDb })
      setExplainResult(res as unknown as ExplainResult)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExplaining(false)
    }
  }

  // ── Execute ──
  async function handleExecute() {
    setLoading(true)
    setError(null)
    setResponse(null)
    setResponseMs(null)

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

    const t0 = performance.now()
    try {
      const res = await executeGraphQL({ query, variables: parsedVars, db: selectedDb })
      setResponseMs(Math.round(performance.now() - t0))
      setResponse(res)
    } catch (e: unknown) {
      setResponseMs(Math.round(performance.now() - t0))
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  executeRef.current = handleExecute

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
            <SchemaPanel db={selectedDb} onInsertQuery={handleInsertQuery} onSuggestQuery={handleSuggestQuery} />
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
            onClick={handleExplain}
            disabled={explaining || !query.trim()}
            className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
            title="Show execution plan without running the query"
          >
            {explaining ? 'Planning…' : 'Explain'}
          </button>

          <button
            onClick={() => { setQuery(''); setResponse(null); setError(null); setExplainResult(null) }}
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
            <div className="flex items-center px-3 py-1 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Query</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                schemaStatus === 'ready'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : schemaStatus === 'loading'
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 animate-pulse'
                    : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-500'
              }`}>
                {schemaStatus === 'ready' ? 'schema loaded' : schemaStatus === 'loading' ? 'loading schema…' : 'no schema'}
              </span>
              <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">Ctrl+Enter to run · Ctrl+Space for completions</span>
            </div>
            <div className="flex-1 overflow-auto" style={{ height: '100%' }}>
              <CodeMirror
                value={query}
                onChange={setQuery}
                extensions={gqlExtensions}
                theme={isDark ? tokyoNight : undefined}
                basicSetup={{ lineNumbers: true, foldGutter: true, autocompletion: false }}
                height="100%"
                style={{ fontSize: '12px' }}
              />
            </div>
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
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-2">
                Response
                {responseMs !== null && (
                  <span className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-normal">
                    {responseMs < 1000 ? `${responseMs}ms` : `${(responseMs / 1000).toFixed(2)}s`}
                  </span>
                )}
                {hasErrors && (
                  <span className="px-1.5 py-0.5 rounded text-xs bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400">
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
        {explainResult && (
          <ExecutionPlanPanel plan={explainResult} onClose={() => setExplainResult(null)} />
        )}
        </div>
      </div>

      {showSaveDialog && (
        <SaveDialog onSave={handleSave} onCancel={() => setShowSaveDialog(false)} />
      )}
    </div>
  )
}
