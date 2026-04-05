import { useEffect, useState } from 'react'
import { useDatabase } from '../context/DatabaseContext'
import { getAnalysisList } from '../services/api'
import type { Analysis } from '../types'

export default function CoveragePage() {
  const { selectedDb } = useDatabase()
  const [analyses, setAnalyses] = useState<Analysis[]>([])

  useEffect(() => {
    if (!selectedDb) return
    getAnalysisList(selectedDb).then(setAnalyses).catch(console.error)
  }, [selectedDb])

  return (
    <div className="p-6 bg-gray-50 dark:bg-gray-950 min-h-screen">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Coverage</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Schema coverage analysis — compare structure against XSD schemas
        </p>
      </div>

      {analyses.length === 0 ? (
        <div className="card text-gray-400 dark:text-gray-500 text-sm">
          No analyses available for {selectedDb}. Run an analysis first from the Analyze page.
        </div>
      ) : (
        <div className="card">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Analysis</label>
          <select className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded px-3 py-2 text-sm w-full max-w-sm focus:outline-none focus:border-blue-500">
            {analyses.map(a => (
              <option key={a.analysisId} value={a.analysisId}>
                {a.localname} [{a.analysisName}]
              </option>
            ))}
          </select>

          <div className="mt-8 text-center text-gray-400 dark:text-gray-500 py-16 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <p className="font-medium">Coverage chart coming soon</p>
            <p className="text-xs mt-1">
              Will compare analysis structure against XSD schemas stored in MarkLogic
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
