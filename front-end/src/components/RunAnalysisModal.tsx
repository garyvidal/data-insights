import { useEffect, useState } from 'react'
import { getRootElements, runAnalysis } from '../services/api'
import type { RootElement } from '../types'

interface Props {
  db: string
  onClose: () => void
  onStarted: () => void
}

export default function RunAnalysisModal({ db, onClose, onStarted }: Props) {
  const [rootElements, setRootElements] = useState<RootElement[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [name, setName] = useState(`Analysis: ${db}`)
  const [sample, setSample] = useState('100')
  const [constraint, setConstraint] = useState('cts:and-query(())')
  const [xpath, setXpath] = useState('')
  const [selectAll, setSelectAll] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getRootElements(db)
      .then(setRootElements)
      .catch(console.error)
  }, [db])

  function toggleId(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSubmit() {
    setSubmitting(true)
    runAnalysis({
      db,
      name,
      sample: parseInt(sample),
      constraint,
      xpath,
      all: selectAll,
      rootElements: selectAll ? [] : Array.from(selectedIds),
    })
      .then(onStarted)
      .catch(console.error)
      .finally(() => setSubmitting(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
        <div className="p-5 border-b flex justify-between items-center">
          <h2 className="text-lg font-semibold">Run Analysis — {db}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="overflow-auto p-5 space-y-4 flex-1">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Analysis Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sample Size (documents)
            </label>
            <input
              type="number"
              value={sample}
              onChange={e => setSample(e.target.value)}
              min={1}
              className="w-32 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              CTS Constraint (XQuery)
            </label>
            <textarea
              value={constraint}
              onChange={e => setConstraint(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">XPath Filter</label>
            <input
              type="text"
              value={xpath}
              onChange={e => setXpath(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500"
              placeholder="e.g. /root/element"
            />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-sm font-medium text-gray-700">Root Elements</label>
              <label className="flex items-center gap-1 text-sm text-gray-600 ml-4">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={e => setSelectAll(e.target.checked)}
                />
                Select All
              </label>
            </div>
            {!selectAll && (
              <div className="border border-gray-200 rounded max-h-48 overflow-auto">
                {rootElements.map(el => (
                  <label
                    key={el.id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(el.id)}
                      onChange={() => toggleId(el.id)}
                    />
                    <span className="font-mono">{el.localname}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{el.type}</span>
                    <span className="text-gray-400 text-xs ml-auto">{el.frequency.toLocaleString()}</span>
                  </label>
                ))}
                {rootElements.length === 0 && (
                  <div className="text-center text-gray-400 text-sm py-4">Loading...</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="p-5 border-t flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={submitting || (!selectAll && selectedIds.size === 0)}
          >
            {submitting ? 'Starting...' : 'Run Analysis'}
          </button>
        </div>
      </div>
    </div>
  )
}
