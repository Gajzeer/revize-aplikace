import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, daysTo } from './lib'

const Ctx = createContext(null)
const TABLES = ['klienti', 'objekty', 'revize', 'faktury', 'cenik', 'doklady', 'pristroje']

async function loadAll() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
    const f = Object.values(import.meta.glob('./demo.json'))[0]
    if (f) return (await f()).default
  }
  const out = {}
  await Promise.all(
    TABLES.map(async (t) => {
      const { data, error } = await supabase.from(t).select('*').order('id').range(0, 4999)
      if (error) throw error
      out[t] = data
    })
  )
  return out
}

export function DataProvider({ children }) {
  const [db, setDb] = useState(null)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      setDb(await loadAll())
      setError(null)
    } catch (e) {
      setError(e.message || String(e))
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // zápis: aktualizuje řádek v DB i v paměti
  const save = useCallback(async (table, row) => {
    const { id, ...rest } = row
    const q = id
      ? supabase.from(table).update(rest).eq('id', id).select().single()
      : supabase.from(table).insert(rest).select().single()
    const { data, error } = await q
    if (error) throw error
    setDb((cur) => {
      const list = cur[table]
      const next = id ? list.map((r) => (r.id === id ? data : r)) : [...list, data]
      return { ...cur, [table]: next }
    })
    return data
  }, [])

  const remove = useCallback(async (table, id) => {
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) throw error
    setDb((cur) => ({ ...cur, [table]: cur[table].filter((r) => r.id !== id) }))
  }, [])

  const idx = useMemo(() => {
    if (!db) return null
    const by = (list) => Object.fromEntries(list.map((r) => [r.id, r]))
    return { klient: by(db.klienti), objekt: by(db.objekty) }
  }, [db])

  const lateCount = useMemo(
    () => (db ? db.revize.filter((r) => r.stav !== 'archiv' && daysTo(r.pristi) != null && daysTo(r.pristi) < 0).length : 0),
    [db]
  )

  return <Ctx.Provider value={{ db, idx, error, reload, save, remove, lateCount }}>{children}</Ctx.Provider>
}

export const useData = () => useContext(Ctx)
