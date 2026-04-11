import { useContext } from 'react'
import { DatabaseContext } from './DatabaseContext'

export function useDatabase() {
  const ctx = useContext(DatabaseContext)
  if (!ctx) throw new Error('useDatabase must be used within DatabaseProvider — check browser console for details')
  return ctx
}
