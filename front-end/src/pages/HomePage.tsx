import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDatabase } from '../context/useDatabase'
import { getAnalysisStatus, getDatabaseStats } from '../services/api'
import type { AnalysisStatus, DatabaseStats } from '../types'

function StatCard({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="card">
      <div className="stat-value">{Number(value).toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

export default function HomePage() {
  const { selectedDb } = useDatabase()
  const navigate = useNavigate()
  const [stats, setStats] = useState<DatabaseStats | null>(null)
  const [status, setStatus] = useState<AnalysisStatus | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedDb) return
    setLoading(true)
    Promise.all([getDatabaseStats(selectedDb), getAnalysisStatus(selectedDb)])
      .then(([s, a]) => {
        setStats(s)
        setStatus(a)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedDb])

  return (
    <div className="p-6 bg-gray-50 dark:bg-gray-950 min-h-screen">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          {selectedDb ? `Database: ${selectedDb}` : 'Select a database'}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Document statistics and analysis overview</p>
      </div>

      {loading && (
        <div className="text-sm text-gray-400 dark:text-gray-500 animate-pulse">Loading statistics...</div>
      )}

      {stats && (
        <>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Document Counts
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8 bg-gray-50 dark:bg-gray-950">
            <StatCard value={stats.allDocuments} label="All Documents" />
            <StatCard value={stats.xmlDocuments} label="XML" />
            <StatCard value={stats.jsonDocuments} label="JSON" />
            <StatCard value={stats.binaryDocuments} label="Binary" />
            <StatCard value={stats.textDocuments} label="Text" />
          </div>
        </>
      )}

      {status && (
        <>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Analysis Status
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-8">
            <StatCard value={status.analyzed} label="Analyses Completed" />
            <StatCard value={status.running} label="Running" />
          </div>
        </>
      )}

      <div className="flex gap-3 mt-4">
        <button className="btn-primary" onClick={() => navigate('/distribution')}>
          View Distribution
        </button>
        <button className="btn-secondary" onClick={() => navigate('/analyze')}>
          Run Analysis
        </button>
      </div>
    </div>
  )
}
