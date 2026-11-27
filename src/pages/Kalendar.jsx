import { useMemo, useState } from 'react'
import { useData } from '../data'
import { TODAY, addMonths, fmtDate, iso, parse } from '../lib'
import { Modal, useToast } from '../ui'

export const TYPY = [
  ['revize', 'Revize'],
  ['schuzka', 'Schůzka'],
  ['termin', 'Termín / úřad'],
  ['soukrome', 'Soukromé'],
  ['poznamka', 'Poznámka'],
]
const TYP = Object.fromEntries(TYPY)
const DNY = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne']
const MESICE = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec']

// všechno, co v daný den „visí“: vlastní události, termíny revizí, splatnosti faktur, platnost dokladů
export function useAgenda(from, to) {
  const { db, idx } = useData()
  return useMemo(() => {
    const out = {}
    const push = (d, it) => d && d >= from && d <= to && (out[d] ||= []).push(it)
    db.udalosti.forEach((u) => push(u.datum, { k: 'u' + u.id, kind: u.typ || 'poznamka', title: u.nazev, time: u.cas, done: u.hotovo, u }))
    const rv = {}
    db.revize
      .filter((r) => r.stav !== 'archiv' && r.pristi)
      .forEach((r) => ((rv[r.pristi + '|' + r.objekt_id] ||= []).push(r)))
    Object.entries(rv).forEach(([key, l]) => {
      const [d] = key.split('|')
      const o = idx.objekt[l[0].objekt_id]
      push(d, { k: 'r' + key, kind: 'due', title: o?.nazev || 'Revize', sub: l.map((r) => r.typ).join(', '), href: '#/revize' })
    })
    db.faktury
      .filter((f) => !f.zaplaceno && f.datum_splatnosti)
      .forEach((f) => push(f.datum_splatnosti, { k: 'f' + f.id, kind: 'faktura', title: `Splatnost ${f.cislo}`, sub: idx.klient[f.klient_id]?.zkratka, href: '#/faktury' }))
    db.doklady
      .filter((d) => d.platnost_do)
      .forEach((d) => push(d.platnost_do, { k: 'd' + d.id, kind: 'doklad', title: `Končí platnost: ${d.nazev}`, href: '#/doklady' }))
    db.pristroje
      .filter((p) => p.aktivni && p.kalibrace_dne)
      .forEach((p) => push(iso(addMonths(parse(p.kalibrace_dne), p.interval_mesicu || 24)), { k: 'p' + p.id, kind: 'doklad', title: `Kalibrace ${p.nazev}`, href: '#/doklady' }))
    Object.values(out).forEach((l) => l.sort((a, b) => (a.kind === 'due') - (b.kind === 'due') || (a.time || '99').localeCompare(b.time || '99')))
    return out
  }, [db, idx, from, to])
}

export default function Kalendar() {
  const { db } = useData()
  const [m, setM] = useState(() => { const d = TODAY(); d.setDate(1); return d })
  const [edit, setEdit] = useState(null)
  const [den, setDen] = useState(null)
  const [skryt, setSkryt] = useState(false)
  const [toast, say] = useToast()

  const first = new Date(m)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
  const last = days[41]
  const weeks = days[35].getMonth() !== m.getMonth() ? 5 : 6
  const agenda = useAgenda(iso(days[0]), iso(last))
  const today = iso(TODAY())
  const filt = (l) => (skryt ? l.filter((x) => x.kind !== 'due') : l)
  const monthKeys = Object.keys(agenda).filter((d) => d.slice(0, 7) === iso(m).slice(0, 7)).sort()
  const nove = (d) => setEdit({ datum: d || today, nazev: '', typ: 'revize', cas: '' })

  return (
    <>
      <div className="head">
        <div>
          <h1>Kalendář</h1>
          <p>Vlastní zápisy spolu s termíny revizí, splatnostmi faktur a platností dokladů</p>
        </div>
        <button className="btn" onClick={() => nove(den)}>Zapsat do kalendáře</button>
      </div>
      <div className="bar cal-bar">
        <div className="seg">
          <button onClick={() => setM(addMonths(m, -1))} aria-label="Předchozí měsíc">‹</button>
          <button onClick={() => { const d = TODAY(); d.setDate(1); setM(d) }}>Dnes</button>
          <button onClick={() => setM(addMonths(m, 1))} aria-label="Další měsíc">›</button>
        </div>
        <h2 className="cal-title">{MESICE[m.getMonth()]} {m.getFullYear()}</h2>
        <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          <input type="checkbox" checked={skryt} onChange={(e) => setSkryt(e.target.checked)} /> Skrýt termíny revizí
        </label>
      </div>

      <div className="cal hide-m" style={{ gridTemplateRows: `auto repeat(${weeks}, minmax(104px, auto))` }}>
        {DNY.map((d) => <div key={d} className="cal-dn">{d}</div>)}
        {days.slice(0, weeks * 7).map((d) => {
          const k = iso(d)
          const l = filt(agenda[k] || [])
          return (
            <div
              key={k}
              className={`cal-day ${d.getMonth() !== m.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''} ${d.getDay() % 6 === 0 ? 'we' : ''}`}
              onClick={() => setDen(k)}
            >
              <span className="cal-num">{d.getDate()}</span>
              {l.slice(0, 4).map((x) => (
                <span key={x.k} className={`ev ev-${x.kind} ${x.done ? 'done' : ''}`} title={[x.title, x.sub].filter(Boolean).join(' – ')}>
                  {x.time && <b>{x.time} </b>}{x.title}
                </span>
              ))}
              {l.length > 4 && <span className="small faint">a další {l.length - 4}</span>}
            </div>
          )
        })}
      </div>

      <div className="show-m">
        {monthKeys.filter((k) => filt(agenda[k]).length).length === 0 && <div className="panel muted">V tomto měsíci nic není.</div>}
        <div className="stack">
          {monthKeys.map((k) => {
            const l = filt(agenda[k])
            if (!l.length) return null
            return (
              <section key={k} className={`panel cal-agenda ${k === today ? 'today' : ''}`} onClick={() => setDen(k)}>
                <div className="small" style={{ fontWeight: 650, marginBottom: 6 }}>{parse(k).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric' })}</div>
                {l.map((x) => (
                  <div key={x.k} className={`ev ev-${x.kind} ${x.done ? 'done' : ''}`}>{x.time && <b>{x.time} </b>}{x.title}{x.sub ? <span className="faint"> · {x.sub}</span> : ''}</div>
                ))}
              </section>
            )
          })}
        </div>
      </div>

      <div className="cal-legend small muted">
        <span className="ev ev-revize">Revize</span>
        <span className="ev ev-schuzka">Schůzka</span>
        <span className="ev ev-termin">Termín</span>
        <span className="ev ev-soukrome">Soukromé</span>
        <span className="ev ev-due">Termín revize podle lhůty</span>
        <span className="ev ev-faktura">Splatnost faktury</span>
        <span className="ev ev-doklad">Doklad / kalibrace</span>
      </div>

      {den && !edit && (
        <Modal title={parse(den).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} onClose={() => setDen(null)}>
          {(agenda[den] || []).length === 0 && <div className="muted">Na tento den nic není.</div>}
          <div className="rows">
            {(agenda[den] || []).map((x) => (
              <div className="row" key={x.k}>
                <div>
                  <div className="t">
                    <span className={`dot dot-${x.kind}`} />
                    {x.time && <>{x.time} </>}
                    <span style={x.done ? { textDecoration: 'line-through', color: 'var(--ink-3)' } : null}>{x.title}</span>
                  </div>
                  <div className="s">{[x.u ? TYP[x.u.typ] : x.sub, x.u?.objekt_id && db.objekty.find((o) => o.id === x.u.objekt_id)?.nazev, x.u?.poznamka].filter(Boolean).join(' · ')}</div>
                </div>
                {x.u ? (
                  <button className="btn ghost sm" onClick={() => setEdit(x.u)}>Upravit</button>
                ) : (
                  <a className="small" href={x.href} onClick={() => setDen(null)}>Otevřít</a>
                )}
              </div>
            ))}
          </div>
          <div className="actions">
            <button className="btn ghost" onClick={() => setDen(null)}>Zavřít</button>
            <button className="btn" onClick={() => nove(den)}>Zapsat na tento den</button>
          </div>
        </Modal>
      )}
      {edit && <UdalostForm initial={edit} onClose={() => setEdit(null)} onSaved={say} />}
      {toast}
    </>
  )
}

export function UdalostForm({ initial, onClose, onSaved }) {
  const { db, save, remove } = useData()
  const [u, setU] = useState(initial)
  const [confirm, setConfirm] = useState(false)
  const set = (k) => (e) => setU({ ...u, [k]: e.target.value })
  const objekty = [...db.objekty].sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs'))
  return (
    <Modal title={u.id ? 'Upravit zápis' : 'Zapsat do kalendáře'} onClose={onClose}>
      <label>Co<input className="input" autoFocus value={u.nazev} onChange={set('nazev')} placeholder="např. Revize MOL 513, zubař, odevzdat zprávy" /></label>
      <div className="two">
        <label>Den<input className="input" type="date" value={u.datum} onChange={set('datum')} /></label>
        <label>Čas<input className="input" type="time" value={u.cas || ''} onChange={set('cas')} /></label>
      </div>
      <div className="two">
        <label>
          Druh
          <select className="select" value={u.typ || 'poznamka'} onChange={set('typ')}>
            {TYPY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>
          Objekt (nepovinné)
          <select className="select" value={u.objekt_id || ''} onChange={set('objekt_id')}>
            <option value="">–</option>
            {objekty.map((o) => <option key={o.id} value={o.id}>{o.nazev}</option>)}
          </select>
        </label>
      </div>
      <label>Poznámka<input className="input" value={u.poznamka || ''} onChange={set('poznamka')} /></label>
      {u.id && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={!!u.hotovo} onChange={(e) => setU({ ...u, hotovo: e.target.checked })} /> Hotovo
        </label>
      )}
      <div className="actions">
        {u.id && (confirm ? (
          <button className="btn danger" style={{ marginRight: 'auto' }} onClick={async () => { await remove('udalosti', u.id); onSaved('Zápis smazán'); onClose() }}>Opravdu smazat</button>
        ) : (
          <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => setConfirm(true)}>Smazat</button>
        ))}
        <button className="btn ghost" onClick={onClose}>Zrušit</button>
        <button
          className="btn"
          disabled={!u.nazev || !u.datum}
          onClick={async () => {
            try {
              await save('udalosti', {
                ...(u.id ? { id: u.id } : {}),
                datum: u.datum, cas: u.cas || null, nazev: u.nazev, typ: u.typ || 'poznamka',
                objekt_id: u.objekt_id ? Number(u.objekt_id) : null, poznamka: u.poznamka || null, hotovo: !!u.hotovo,
              })
              onSaved(u.id ? 'Zápis uložen' : `Zapsáno na ${fmtDate(u.datum)}`)
              onClose()
            } catch (e) {
              onSaved('Uložení selhalo: ' + e.message)
            }
          }}
        >
          {u.id ? 'Uložit' : 'Zapsat'}
        </button>
      </div>
    </Modal>
  )
}
