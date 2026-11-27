import { useState } from 'react'
import { supabase } from '../lib'
import { useData } from '../data'

// Jednorázové nahrání dat ze souboru data-k-importu.json (soubor zůstává u uživatele, do webu se nepřibaluje)
async function ins(table, rows, log) {
  const out = []
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await supabase.from(table).insert(rows.slice(i, i + 200)).select('id')
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
  }
  log(`${table}: ${rows.length}`)
  return out.map((r) => r.id)
}

export default function Import() {
  const { db, reload } = useData()
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const add = (m) => setLog((l) => [...l, m])

  async function run(file) {
    setErr(null); setLog([]); setBusy(true)
    try {
      const d = JSON.parse(await file.text())
      const strip = ({ id, ...r }) => r
      const map = (rows, newIds) => Object.fromEntries(rows.map((r, i) => [r.id, newIds[i]]))
      const K = map(d.klienti, await ins('klienti', d.klienti.map(strip), add))
      const F = map(d.faktury, await ins('faktury', d.faktury.map((r) => ({ ...strip(r), klient_id: K[r.klient_id] ?? null })), add))
      const O = map(d.objekty, await ins('objekty', d.objekty.map((r) => ({ ...strip(r), klient_id: K[r.klient_id] ?? null })), add))
      await ins('revize', d.revize.map((r) => ({ ...strip(r), objekt_id: O[r.objekt_id] })), add)
      await ins('cenik', d.cenik.map((r) => ({ ...strip(r), klient_id: r.klient_id ? K[r.klient_id] : null })), add)
      await ins('doklady', d.doklady.map(strip), add)
      await ins('pristroje', d.pristroje.map(strip), add)
      await ins('polozky_faktur', (d.polozky_faktur || []).map((r) => ({ ...strip(r), faktura_id: F[r.faktura_id] })), add)
      add('Hotovo.')
      await reload()
      location.hash = '#/prehled'
    } catch (e) {
      setErr(e.message)
    }
    setBusy(false)
  }

  const empty = db.klienti.length === 0 && db.faktury.length === 0
  return (
    <>
      <div className="head"><div><h1>Nahrát data</h1><p>Jednorázový import klientů, faktur, revizí a ceníku ze souboru</p></div></div>
      <section className="panel" style={{ maxWidth: 620 }}>
        {empty ? (
          <>
            <p style={{ marginTop: 0 }}>Vyberte soubor <b>data-k-importu.json</b> ze složky CLAUDE\REVIZE APLIKACE. Nahrání trvá několik sekund.</p>
            <input type="file" accept=".json,application/json" disabled={busy} onChange={(e) => e.target.files[0] && run(e.target.files[0])} />
          </>
        ) : (
          <p style={{ margin: 0 }}>Databáze už data obsahuje, další import by vytvořil duplicity.</p>
        )}
        {log.length > 0 && <ul className="small muted">{log.map((l) => <li key={l}>{l}</li>)}</ul>}
        {err && <div className="err" style={{ marginTop: 10 }}>Nahrání selhalo: {err}</div>}
      </section>
    </>
  )
}
