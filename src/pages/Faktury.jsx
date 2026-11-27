import { useMemo, useState } from 'react'
import { useData } from '../data'
import { TODAY, daysTo, fmtDate, fmtKc, iso, norm } from '../lib'
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
        <button
          className="btn"
          onClick={() => setNova({ cislo: nextNumber(), rok: TODAY().getFullYear(), datum_vystaveni: iso(TODAY()), datum_splatnosti: iso(new Date(TODAY().getTime() + 14 * 864e5)), zaplaceno: false })}
        >
          Zapsat fakturu
        </button>
      </div>
      <div className="bar">
        <input className="input" placeholder="Hledat číslo, zakázku nebo klienta" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={kl} onChange={(e) => setKl(e.target.value)} aria-label="Klient">
          <option value="">Všichni klienti</option>
          {db.klienti.map((k) => (
            <option key={k.id} value={k.id}>{k.zkratka || k.nazev}</option>
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
                  <td className="num" style={{ fontWeight: 650 }}>{f.cislo}</td>
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
                        await save('faktury', { id: f.id, zaplaceno: !f.zaplaceno })
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
      {nova && <FakturaForm initial={nova} onClose={() => setNova(null)} onSaved={(c) => say(`Faktura ${c} zapsána`)} />}
      {toast}
    </>
  )
}

function FakturaForm({ initial, onClose, onSaved }) {
  const { db, save } = useData()
  const [f, setF] = useState(initial)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal title="Zapsat fakturu" onClose={onClose}>
      <div className="muted small">Zápis do evidence. Tvorbu PDF faktury přidáme ve verzi 2.</div>
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
        <label>Vystaveno<input className="input" type="date" value={f.datum_vystaveni} onChange={set('datum_vystaveni')} /></label>
        <label>Splatnost<input className="input" type="date" value={f.datum_splatnosti} onChange={set('datum_splatnosti')} /></label>
      </div>
      <div className="two">
        <label>Částka (Kč)<input className="input" type="number" min="0" value={f.castka || ''} onChange={set('castka')} /></label>
        <label>Zakázka<input className="input" value={f.zakazka || ''} onChange={set('zakazka')} /></label>
      </div>
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>Zrušit</button>
        <button
          className="btn"
          disabled={!f.klient_id || !f.castka || !f.cislo}
          onClick={async () => {
            await save('faktury', { ...f, klient_id: Number(f.klient_id), castka: Number(f.castka), rok: Number(f.datum_vystaveni.slice(0, 4)) })
            onSaved(f.cislo)
            onClose()
          }}
        >
          Zapsat fakturu
        </button>
      </div>
    </Modal>
  )
}

