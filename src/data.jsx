import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, daysTo, norm } from './lib'
import { docasneId, frontaPridat, frontaSmazat, frontaVse, jeSitovaChyba, kvGet, kvSet } from './offline'

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

const DEMO = import.meta.env.DEV && new URLSearchParams(location.search).has('demo')
const bezBloku = (table, row) => (table === 'zpravy' && row ? (({ bloky, ...r }) => r)(row) : row)
const FK = ['klient_id', 'objekt_id', 'revize_id', 'faktura_id']

// odeslání jedné změny do databáze
async function provest(op, ids) {
  const mapuj = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, FK.includes(k) && v < 0 && ids[v] ? ids[v] : v]))
  if (op.typ === 'upload') {
    const objekt_id = op.row.objekt_id < 0 ? ids[op.row.objekt_id] : op.row.objekt_id
    const { error } = await supabase.storage.from('prilohy').upload(op.row.cesta, op.blob, { contentType: op.row.typ || 'application/octet-stream' })
    if (error && !/exists/i.test(error.message)) throw error
    const { id, ...r } = op.row
    const { data, error: e2 } = await supabase.from('prilohy').insert({ ...r, objekt_id }).select().single()
    if (e2) throw e2
    ids[id] = data.id
    return
  }
  const id = op.id < 0 ? ids[op.id] : op.id
  if (op.typ === 'delete') {
    if (op.id < 0 && !id) return
    const { error } = await supabase.from(op.table).delete().eq('id', id)
    if (error) throw error
  } else if (op.typ === 'update') {
    const { error } = await supabase.from(op.table).update(mapuj(op.row)).eq('id', id)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from(op.table).insert(mapuj(op.row)).select().single()
    if (error) throw error
    ids[op.id] = data.id
  }
}

export function DataProvider({ children }) {
  const [db, setDb] = useState(null)
  const [error, setError] = useState(null)
  const [stav, setStav] = useState({ online: navigator.onLine, z: null, cekajici: 0, chyba: null })

  const ulozitSnimek = useCallback((d) => { if (!DEMO && d) kvSet('snimek', { db: d, at: new Date().toISOString() }) }, [])

  const reload = useCallback(async () => {
    try {
      const d = await loadAll()
      setDb(d)
      ulozitSnimek(d)
      setError(null)
      setStav((s) => ({ ...s, online: true, z: null }))
    } catch (e) {
      // bez signálu: pracuje se s posledními staženými daty
      const sn = await kvGet('snimek')
      if (sn?.db && jeSitovaChyba(e)) {
        setDb((cur) => cur || sn.db)
        setStav((s) => ({ ...s, online: false, z: sn.at }))
      } else setError(e.message || String(e))
    }
  }, [])

  const synchronizovat = useCallback(async () => {
    const fronta = await frontaVse()
    if (!fronta.length) return reload()
    const ids = (await kvGet('ids')) || {}
    for (const op of fronta) {
      try {
        await provest(op, ids)
        await kvSet('ids', ids)
        await frontaSmazat(op.n)
      } catch (e) {
        setStav((s) => ({ ...s, cekajici: fronta.length, chyba: jeSitovaChyba(e) ? null : `${op.table || 'příloha'}: ${e.message}` }))
        if (jeSitovaChyba(e)) return
        await frontaSmazat(op.n) // chybnou změnu databáze nepřijala, nesmí blokovat ostatní
      }
    }
    await kvSet('ids', {})
    setStav((s) => ({ ...s, cekajici: 0 }))
    await reload()
  }, [reload])

  useEffect(() => {
    if (DEMO) return void reload()
    // rychlý start z posledních dat, pak čerstvá data ze sítě
    kvGet('snimek').then((sn) => sn?.db && setDb((cur) => cur || sn.db))
    frontaVse().then((f) => (f.length ? (setStav((s) => ({ ...s, cekajici: f.length })), synchronizovat()) : reload()))
    const on = () => { setStav((s) => ({ ...s, online: true })); synchronizovat() }
    const off = () => setStav((s) => ({ ...s, online: false, z: s.z || new Date().toISOString() }))
    addEventListener('online', on)
    addEventListener('offline', off)
    return () => { removeEventListener('online', on); removeEventListener('offline', off) }
  }, [reload, synchronizovat])

  // změna jen v paměti a ve snímku
  const lokalne = useCallback((fn) => setDb((cur) => { const n = fn(cur); ulozitSnimek(n); return n }), [])

  const doFronty = useCallback(async (op, apply) => {
    await frontaPridat(op)
    lokalne(apply)
    setStav((s) => ({ ...s, online: false, z: s.z || new Date().toISOString(), cekajici: s.cekajici + 1 }))
  }, [])

  // zápis: aktualizuje řádek v DB i v paměti; bez signálu ho uloží do fronty
  const save = useCallback(async (table, row) => {
    const { id, ...rest } = row
    if (table === 'zpravy' && rest.bloky && id) kvSet(`zprava-${id}`, { ...row })
    if (navigator.onLine && !(id < 0)) {
      try {
        const q = id
          ? supabase.from(table).update(rest).eq('id', id).select().single()
          : supabase.from(table).insert(rest).select().single()
        const { data, error } = await q
        if (error) throw error
        lokalne((cur) => {
          const list = cur[table] || []
          const v = bezBloku(table, data)
          return { ...cur, [table]: id ? list.map((r) => (r.id === id ? v : r)) : [...list, v] }
        })
        return data
      } catch (e) {
        if (!jeSitovaChyba(e)) throw e
      }
    }
    if (id) {
      const old = db?.[table]?.find((r) => r.id === id) || {}
      const v = { ...old, ...row }
      await doFronty({ typ: 'update', table, id, row: rest }, (cur) => ({ ...cur, [table]: cur[table].map((r) => (r.id === id ? bezBloku(table, v) : r)) }))
      return v
    }
    const nid = docasneId()
    const v = { ...rest, id: nid, created_at: new Date().toISOString() }
    await doFronty({ typ: 'insert', table, id: nid, row: rest }, (cur) => ({ ...cur, [table]: [...(cur[table] || []), bezBloku(table, v)] }))
    return v
  }, [db])

  const remove = useCallback(async (table, id) => {
    if (navigator.onLine && id > 0) {
      try {
        const { error } = await supabase.from(table).delete().eq('id', id)
        if (error) throw error
        lokalne((cur) => ({ ...cur, [table]: cur[table].filter((r) => r.id !== id) }))
        return
      } catch (e) {
        if (!jeSitovaChyba(e)) throw e
      }
    }
    await doFronty({ typ: 'delete', table, id }, (cur) => ({ ...cur, [table]: cur[table].filter((r) => r.id !== id) }))
  }, [])

  // fotka nafocená bez signálu: soubor počká v telefonu
  const nahratPozdeji = useCallback(async (row, blob) => {
    const nid = docasneId()
    const v = { ...row, id: nid, created_at: new Date().toISOString(), ceka: true }
    await doFronty({ typ: 'upload', row: { ...row, id: nid }, blob }, (cur) => ({ ...cur, prilohy: [...(cur.prilohy || []), v] }))
    return v
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

  return <Ctx.Provider value={{ db, idx, error, reload, save, remove, lateCount, stav, synchronizovat, nahratPozdeji }}>{children}</Ctx.Provider>
}

export const useData = () => useContext(Ctx)
