import { useDatabase } from '../context/DatabaseContext'

export default function DatabaseSelector() {
  const { databases, selectedDb, setSelectedDb, loading } = useDatabase()

  if (loading) {
    return <div className="text-xs text-gray-400 dark:text-gray-300 animate-pulse">Loading databases...</div>
  }

  return (
    <div>
      <label className="block text-xs text-gray-400 dark:text-gray-300 mb-1">Database</label>
      <select
        value={selectedDb}
        onChange={e => setSelectedDb(e.target.value)}
        className="w-full bg-gray-800 dark:bg-gray-800 text-white dark:text-white text-sm rounded px-2 py-1.5 border border-gray-600 dark:border-gray-600 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400"
      >
        {databases.map(db => (
          <option key={db} value={db}>
            {db}
          </option>
        ))}
      </select>
    </div>
  )
}
