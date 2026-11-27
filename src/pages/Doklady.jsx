import { useState } from 'react'
import { useData } from '../data'
import { addMonths, fmtDate, iso, parse } from '../lib'
import { Due, Modal, useToast } from '../ui'

const nextCal = (p) => (p.kalibrace_dne ? iso(addMonths(parse(p.kalibrace_dne), p.interval_mesicu || 24)) : null)

export default function Doklady() {
  const { db } = useData()
  const [d, setD] = useState(null)
  const [p, setP] = useState(null)
  const [toast, say] = useToast()
  const pr = [...db.pristroje].sort((a, b) => Number(b.aktivni) - Number(a.aktivni))
  return (
    <>
      <div className="head">
        <div>
          <h1>Doklady a přístroje</h1>
          <p>Osvědčení, oprávnění a kalibrace měřicích přístrojů</p>
        </div>
      </div>
      <div className="grid g-two">
        <section className="panel">
          <h2>Osvědčení a oprávnění<button className="link small" onClick={() => setD({})}>Přidat doklad</button></h2>
          <div className="rows">
            {db.doklady.map((x) => (
              <button key={x.id} className="row rowbtn" onClick={() => setD(x)}>
                <div>
                  <div className="t">{x.nazev}</div>
                  <div className="s">{[x.cislo, x.vydano && `vydáno ${fmtDate(x.vydano)}`, x.platnost_do && `platí do ${fmtDate(x.platnost_do)}`].filter(Boolean).join(', ')}</div>
                </div>
                {x.platnost_do ? <Due date={x.platnost_do} showDate={false} /> : <span className="faint small">bez omezení</span>}
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Měřicí přístroje<button className="link small" onClick={() => setP({ interval_mesicu: 24, aktivni: true })}>Přidat přístroj</button></h2>
          <div className="rows">
            {pr.map((x) => (
              <button key={x.id} className="row rowbtn" onClick={() => setP(x)} style={{ opacity: x.aktivni ? 1 : 0.55 }}>
                <div>
                  <div className="t">{x.nazev}{!x.aktivni && <span className="faint small"> (vyřazený)</span>}</div>
                  <div className="s">
                    v. č. {x.vyrobni_cislo || '–'}
                    {x.kalibracni_list && `, KL ${x.kalibracni_list}`}
                    {x.kalibrace_dne ? `, kalibrace ${fmtDate(x.kalibrace_dne)}` : ', datum kalibrace chybí'}
                  </div>
                </div>
                {x.aktivni && nextCal(x) ? <Due date={nextCal(x)} showDate={false} /> : <span className="faint small">–</span>}
              </button>
            ))}
          </div>
        </section>
      </div>
      {d && <DokladForm initial={d} onClose={() => setD(null)} onSaved={() => say('Doklad uložen')} />}
      {p && <PristrojForm initial={p} onClose={() => setP(null)} onSaved={() => say('Přístroj uložen')} />}
      {toast}
    </>
  )
}

function DokladForm({ initial, onClose, onSaved }) {
  const { save } = useData()
  const [x, setX] = useState(initial)
  const f = (k, l, t = 'text') => <label>{l}<input className="input" type={t} value={x[k] || ''} onChange={(e) => setX({ ...x, [k]: e.target.value })} /></label>
  return (
    <Modal title={x.id ? 'Upravit doklad' : 'Nový doklad'} onClose={onClose}>
      {f('nazev', 'Název')}
      <div className="two">{f('typ', 'Typ')}{f('cislo', 'Číslo')}</div>
      <div className="two">{f('vydano', 'Vydáno', 'date')}{f('platnost_do', 'Platí do', 'date')}</div>
      {f('poznamka', 'Poznámka')}
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>Zrušit</button>
        <button className="btn" disabled={!x.nazev} onClick={async () => {
          const { created_at, ...row } = x
          await save('doklady', { ...row, vydano: row.vydano || null, platnost_do: row.platnost_do || null })
          onSaved(); onClose()
        }}>Uložit doklad</button>
      </div>
    </Modal>
  )
}

function PristrojForm({ initial, onClose, onSaved }) {
  const { save } = useData()
  const [x, setX] = useState(initial)
  const f = (k, l, t = 'text') => <label>{l}<input className="input" type={t} value={x[k] ?? ''} onChange={(e) => setX({ ...x, [k]: e.target.value })} /></label>
  return (
    <Modal title={x.id ? 'Upravit přístroj' : 'Nový přístroj'} onClose={onClose}>
      {f('nazev', 'Název')}
      <div className="two">{f('vyrobni_cislo', 'Výrobní číslo')}{f('kalibracni_list', 'Kalibrační list')}</div>
      <div className="two">{f('kalibrace_dne', 'Kalibrace dne', 'date')}{f('interval_mesicu', 'Interval (měsíce)', 'number')}</div>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, display: 'flex' }}>
        <input type="checkbox" checked={!!x.aktivni} onChange={(e) => setX({ ...x, aktivni: e.target.checked })} /> Přístroj používám
      </label>
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>Zrušit</button>
        <button className="btn" disabled={!x.nazev} onClick={async () => {
          const { created_at, ...row } = x
          await save('pristroje', { ...row, kalibrace_dne: row.kalibrace_dne || null, interval_mesicu: Number(row.interval_mesicu) || 24 })
          onSaved(); onClose()
        }}>Uložit přístroj</button>
      </div>
    </Modal>
  )
}
