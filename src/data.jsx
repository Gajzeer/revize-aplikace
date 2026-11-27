import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, daysTo, norm } from './lib'

const Ctx = createContext(null)
const TABLES = ['klienti', 'objekty', 'revize', 'faktury', 'cenik', 'doklady', 'pristroje']
const OPTIONAL = ['udalosti', 'nastaveni', 'zpravy', 'nabidky', 'prilohy']
// u zpráv se obsah (bloky) načítá až při otevření
const COLS = { zpravy: 'id,objekt_id,revize_id,typ,nazev,ev_cislo,datum_revize,datum_vypracovani,datum_predani,stav,vzor,zdroj,updated_at' } // novější tabulky: když chybí, aplikace běží dál

async function loadAll() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
    const f = Object.values(import.meta.glob('./demo.json'))[0]
    if (f) return { udalosti: [], nastaveni: [], zpravy: [], nabidky: [], prilohy: [], ...(await f()).default }
  }
  const out = {}
  await Promise.all([
    ...TABLES.map(async (t) => {
      const { data, error } = await supabase.from(t).select('*').order('id').range(0, 4999)
      if (error) throw error
      out[t] = data
    }),
    ...OPTIONAL.map(async (t) => {
      const { data, error } = await supabase.from(t).select(COLS[t] || '*').order('id').range(0, 4999)
      out[t] = error ? [] : data
    }),
  ])
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
    // popisek klienta: zkratka + převažující značka objektů (např. „PIK – ČS MOL“)
    const label = {}
    db.klienti.forEach((k) => {
      const base = k.zkratka || k.nazev
      const words = db.objekty.filter((o) => o.klient_id === k.id).map((o) => (o.nazev || '').split(/\s+/)[0])
      const top = words.sort().reduce((a, w, i, arr) => (arr.filter((x) => x === w).length > (a ? arr.filter((x) => x === a).length : 0) ? w : a), null)
      const n = top ? words.filter((w) => w === top).length : 0
      label[k.id] = n >= 3 && n / words.length > 0.6 && !norm(base).includes(norm(top)) ? `${base} – ${top}` : base
    })
    const nast = Object.fromEntries((db.nastaveni || []).map((r) => [r.klic, r.hodnota]))
    return { klient: by(db.klienti), objekt: by(db.objekty), label, nast }
  }, [db])

  const lateCount = useMemo(
    () => (db ? db.revize.filter((r) => r.stav !== 'archiv' && daysTo(r.pristi) != null && daysTo(r.pristi) < 0).length : 0),
    [db]
  )

  return <Ctx.Provider value={{ db, idx, error, reload, save, remove, lateCount }}>{children}</Ctx.Provider>
}

export const useData = () => useContext(Ctx)
