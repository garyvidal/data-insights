import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getDatabases } from '../services/api'

interface DatabaseContextValue {
  databases: string[]
  selectedDb: string
  setSelectedDb: (db: string) => void
  loading: boolean
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null)

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [databases, setDatabases] = useState<string[]>([])
  const [selectedDb, setSelectedDb] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDatabases()
      .then(dbs => {
        setDatabases(dbs)
        if (dbs.length > 0) setSelectedDb(dbs[0])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return (
    <DatabaseContext.Provider value={{ databases, selectedDb, setSelectedDb, loading }}>
      {children}
    </DatabaseContext.Provider>
  )
}

export function useDatabase() {
  const ctx = useContext(DatabaseContext)
  if (!ctx) throw new Error('useDatabase must be used within DatabaseProvider')
  return ctx
}
