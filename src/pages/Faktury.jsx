import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data'
import { TODAY, daysTo, fmtDate, fmtKc, iso, norm, supabase } from '../lib'
import { Modal, useToast } from '../ui'

function stavF(f) {
  if (f.zaplaceno) return ['paid', 'zaplaceno']
  const d = daysTo(f.datum_splatnosti)
  if (d != null && d < 0) return ['late', 'po splatnosti']
  return ['due', 'čeká na platbu']
}

export default function Faktury({ sub }) {
  const { db, idx, save } = useData()
  const years = [...new Set(db.faktury.map((f) => f.rok))].sort((a, b) => b - a)
  const [rok, setRok] = useState(String(years[0] || TODAY().getFullYear()))
  const [kl, setKl] = useState(sub?.[0] || '')
  const [q, setQ] = useState('')
  const [nova, setNova] = useState(null)
  const [toast, say] = useToast()

  const rows = useMemo(() => {
    const t = norm(q)
    return db.faktury
      .filter((f) => rok === 'all' || String(f.rok) === rok)
      .filter((f) => !kl || String(f.klient_id) === kl)
      .filter((f) => !t || norm(`${f.cislo} ${f.zakazka} ${idx.klient[f.klient_id]?.nazev}`).includes(t))
      .sort((a, b) => (b.datum_vystaveni || '').localeCompare(a.datum_vystaveni || '') || b.cislo.localeCompare(a.cislo))
  }, [db, rok, kl, q])
  const total = rows.reduce((a, f) => a + Number(f.castka), 0)

  function nextNumber() {
    const y = TODAY().getFullYear()
    const n = Math.max(0, ...db.faktury.filter((f) => f.rok === y).map((f) => parseInt(f.cislo)))
    return `${String(n + 1).padStart(3, '0')}/${String(y).slice(2)}`
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Faktury</h1>
          <p>{rows.length} faktur · celkem {fmtKc(total)} · základ daně {fmtKc(total * 0.2)}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a className="btn" href="#/faktura/nova" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Vystavit fakturu</a>
        <button
          className="btn ghost"
          title="Zapsat do evidence fakturu vystavenou jinde"
          onClick={() => setNova({ cislo: nextNumber(), rok: TODAY().getFullYear(), datum_vystaveni: iso(TODAY()), datum_splatnosti: iso(new Date(TODAY().getTime() + 14 * 864e5)), zaplaceno: false })}
        >
          Zapsat existující
        </button>
        </div>
      </div>
      <div className="bar">
        <input className="input" placeholder="Hledat číslo, zakázku nebo klienta" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={kl} onChange={(e) => setKl(e.target.value)} aria-label="Klient">
          <option value="">Všichni klienti</option>
          {db.klienti.map((k) => (
            <option key={k.id} value={k.id}>{idx.label[k.id]}</option>
          ))}
        </select>
        <select className="select" value={rok} onChange={(e) => setRok(e.target.value)} aria-label="Rok">
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
          <option value="all">Všechny roky</option>
        </select>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Číslo</th>
              <th>Vystaveno</th>
              <th>Klient</th>
              <th className="hide-m">Zakázka</th>
              <th className="r">Částka</th>
              <th>Stav</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="6" className="muted">V tomto výběru žádné faktury nejsou.</td></tr>}
            {rows.map((f) => {
              const [k, l] = stavF(f)
              return (
                <tr key={f.id}>
                  <td className="num"><button className="link" style={{ fontWeight: 650, color: 'var(--ink)' }} title="Otevřít fakturu" onClick={() => setNova(f)}>{f.cislo}</button></td>
                  <td className="num">{fmtDate(f.datum_vystaveni)}</td>
                  <td>{idx.klient[f.klient_id]?.zkratka || idx.klient[f.klient_id]?.nazev}</td>
                  <td className="hide-m small muted">{f.zakazka}</td>
                  <td className="r num">{fmtKc(f.castka)}</td>
                  <td>
                    <button
                      className={`pill ${k}`}
                      style={{ border: 0, cursor: 'pointer' }}
                      title={f.zaplaceno ? 'Označit jako nezaplacenou' : 'Označit jako zaplacenou'}
                      onClick={async () => {
                        await save('faktury', { id: f.id, zaplaceno: !f.zaplaceno, datum_zaplaceni: f.zaplaceno ? null : iso(TODAY()) })
                        say(f.zaplaceno ? `Faktura ${f.cislo} vrácena mezi nezaplacené` : `Faktura ${f.cislo} zaplacena`)
                      }}
                    >
                      {l}
                    </button>
                    {!f.zaplaceno && <div className="small faint">splatnost {fmtDate(f.datum_splatnosti)}</div>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {nova && <FakturaForm initial={nova} onClose={() => setNova(null)} onSaved={(m) => say(m)} />}
      {toast}
    </>
  )
}

function FakturaForm({ initial, onClose, onSaved }) {
  const { db, save, remove } = useData()
  const [f, setF] = useState(initial)
  const [items, setItems] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  useEffect(() => {
    if (!initial.id) return
    supabase.from('polozky_faktur').select('*').eq('faktura_id', initial.id).order('id').then(({ data, error }) => setItems(error ? 'err' : data || []))
  }, [initial.id])
  return (
    <Modal title={f.id ? `Faktura ${f.cislo}` : 'Zapsat fakturu'} onClose={onClose}>
      {!f.id && <div className="muted small">Zápis do evidence. Tvorbu PDF faktury přidáme v další verzi.</div>}
      <div className="two">
        <label>Číslo<input className="input" value={f.cislo} onChange={set('cislo')} /></label>
        <label>
          Klient
          <select className="select" value={f.klient_id || ''} onChange={set('klient_id')}>
            <option value="">Vyberte</option>
            {db.klienti.map((k) => <option key={k.id} value={k.id}>{k.zkratka || k.nazev}</option>)}
          </select>
        </label>
      </div>
      <div className="two">
        <label>Vystaveno<input className="input" type="date" value={f.datum_vystaveni || ''} onChange={set('datum_vystaveni')} /></label>
        <label>Splatnost<input className="input" type="date" value={f.datum_splatnosti || ''} onChange={set('datum_splatnosti')} /></label>
      </div>
      <div className="two">
        <label>Částka (Kč)<input className="input" type="number" min="0" value={f.castka ?? ''} onChange={set('castka')} /></label>
        <label>Zakázka<input className="input" value={f.zakazka || ''} onChange={set('zakazka')} /></label>
      </div>
      {f.id && (
        <div className="two">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end', paddingBottom: 10 }}>
            <input type="checkbox" checked={!!f.zaplaceno} onChange={(e) => setF({ ...f, zaplaceno: e.target.checked, datum_zaplaceni: e.target.checked ? f.datum_zaplaceni || iso(TODAY()) : null })} /> Zaplaceno
          </label>
          {f.zaplaceno && <label>Peníze přišly dne<input className="input" type="date" value={f.datum_zaplaceni || ''} onChange={set('datum_zaplaceni')} /></label>}
        </div>
      )}
      {f.id && (
        <div>
          <div className="small" style={{ fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>Položky</div>
          {items === null && <div className="small muted">Načítám…</div>}
          {items === 'err' && <div className="small muted">Položky se nepodařilo načíst.</div>}
          {items?.length === 0 && <div className="small muted">Faktura nemá rozepsané položky.</div>}
          {Array.isArray(items) && items.length > 0 && (
            <div className="rows">
              {items.map((it) => (
                <div className="row" key={it.id} style={{ fontSize: 14 }}>
                  <div>
                    <div>{it.popis}</div>
                    <div className="s">{[it.mnozstvi, it.cena_ks != null && `${fmtKc(it.cena_ks)}/ks`].filter(Boolean).join(' × ')}</div>
                  </div>
                  <div className="num">{it.celkem != null ? fmtKc(it.celkem) : ''}</div>
                </div>
              ))}
            </div>
          )}
          {f.soubor && <div className="small faint" style={{ marginTop: 8 }}>Soubor: {f.soubor}</div>}
          {Array.isArray(items) && items.length > 0 && <a className="small" href={`#/faktura/${f.id}`} style={{ display: 'inline-block', marginTop: 8 }}>Zobrazit fakturu k tisku / PDF</a>}
        </div>
      )}
      <div className="actions">
        {f.id && (confirm ? (
          <button className="btn danger" style={{ marginRight: 'auto' }} onClick={async () => { await remove('faktury', f.id); onSaved(`Faktura ${f.cislo} smazána`); onClose() }}>Opravdu smazat</button>
        ) : (
          <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => setConfirm(true)}>Smazat</button>
        ))}
        <button className="btn ghost" onClick={onClose}>Zrušit</button>
        <button
          className="btn"
          disabled={!f.klient_id || f.castka === '' || f.castka == null || !f.cislo || !f.datum_vystaveni}
          onClick={async () => {
            const { created_at, ...row } = f
            await save('faktury', { ...row, datum_zaplaceni: row.datum_zaplaceni || null, klient_id: Number(row.klient_id), castka: Number(row.castka), rok: Number(row.datum_vystaveni.slice(0, 4)) })
            onSaved(f.id ? `Faktura ${f.cislo} uložena` : `Faktura ${f.cislo} zapsána`)
            onClose()
          }}
        >
          {f.id ? 'Uložit fakturu' : 'Zapsat fakturu'}
        </button>
      </div>
    </Modal>
  )
}
