import { createContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getDatabases } from '../services/api'

interface DatabaseContextValue {
  databases: string[]
  selectedDb: string
  setSelectedDb: (db: string) => void
  loading: boolean
}

export const DatabaseContext = createContext<DatabaseContextValue | null>(null)

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [databases, setDatabases] = useState<string[]>([])
  const [selectedDb, setSelectedDb] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDatabases()
      .then(dbs => {
        setDatabases(dbs)
        if (dbs.length > 0) {
          const saved = localStorage.getItem('selectedDb')
          setSelectedDb(saved && dbs.includes(saved) ? saved : dbs[0])
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  function setSelectedDbPersisted(db: string) {
    localStorage.setItem('selectedDb', db)
    setSelectedDb(db)
  }

  return (
    <DatabaseContext.Provider value={{ databases, selectedDb, setSelectedDb: setSelectedDbPersisted, loading }}>
      {children}
    </DatabaseContext.Provider>
  )
}

