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
      if (d.aktualizace || d.smazat || d.vlozit) {
        // smazání a vložení řádků: { smazat: [{ tabulka, kde: {sloupec: hodnota} }], vlozit: [{ tabulka, radky: [...] }] }
        for (const x of d.smazat || []) {
          let q = supabase.from(x.tabulka).delete()
          for (const [k, v] of Object.entries(x.kde)) q = q.eq(k, v)
          const { error } = await q
          if (error) throw new Error(`${x.tabulka}: ${error.message}`)
          add(`Smazáno: ${x.popis || x.tabulka}`)
        }
        for (const x of d.vlozit || []) await ins(x.tabulka, x.radky, add)
      }
      if (d.aktualizace) {
        // dávka úprav připravená Claudem: [{ tabulka, id, zmeny }]
        for (const u of d.aktualizace) {
          const { error } = await supabase.from(u.tabulka).update(u.zmeny).eq('id', u.id)
          if (error) throw new Error(`${u.tabulka} ${u.id}: ${error.message}`)
        }
        add(`Upraveno záznamů: ${d.aktualizace.length}`)
        add('Hotovo.')
        await reload()
        setBusy(false)
        return
      }
      if (d.smazat || d.vlozit) {
        add('Hotovo.')
        await reload()
        setBusy(false)
        return
      }
      if (!empty) throw new Error('Databáze už data obsahuje, celý import by vytvořil duplicity.')
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
      <div className="head"><div><h1>Nahrát data</h1><p>Import dat nebo dávky úprav ze souboru</p></div></div>
      <section className="panel" style={{ maxWidth: 620 }}>
        <p style={{ marginTop: 0 }}>
          {empty
            ? <>Vyberte soubor <b>data-k-importu.json</b> ze složky CLAUDE\REVIZE APLIKACE. Nahrání trvá několik sekund.</>
            : <>Vyberte soubor s úpravami, který vám připravil Claude (ve složce CLAUDE\REVIZE APLIKACE, název začíná „uprava-“).</>}
        </p>
        <input type="file" accept=".json,application/json" disabled={busy} onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; f && run(f) }} />
        {log.length > 0 && <ul className="small muted">{log.map((l) => <li key={l}>{l}</li>)}</ul>}
        {err && <div className="err" style={{ marginTop: 10 }}>Nahrání selhalo: {err}</div>}
      </section>
    </>
  )
}
