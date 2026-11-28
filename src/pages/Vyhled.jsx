// Výhled: co přinesou pravidelné revize v dalších letech, po měsících, s upozorněními
import { useMemo, useState } from 'react'
import { useData } from '../data'
import { TODAY, fmtDate, fmtKc } from '../lib'
import { rokPlan, postrehy, MESICE, DO_KONCE_ROKU } from '../vyhled'
import { rokPrijmu } from './Dane'

const tis = (n) => `${Math.round(n / 1000).toLocaleString('cs-CZ')} tis.`

export default function Vyhled() {
  const { db, idx } = useData()
  const Y0 = TODAY().getFullYear()
  const roky = [Y0 + 1, Y0 + 2, Y0 + 3, Y0 + 4]
  const [Y, setY] = useState(roky[0])
  const [otevreny, setOtevreny] = useState(null)
  const plany = useMemo(() => Object.fromEntries([Y0 + 1, ...roky].map((y) => [y, rokPlan(db, idx, y)])), [db, idx])
  const plan = plany[Y]
  const rady = useMemo(() => postrehy(plan, plany[Y - 1]), [plan])
  const fakturovano = (y) => db.faktury.filter((f) => rokPrijmu(f) === y).reduce((a, f) => a + Number(f.castka || 0), 0)
  const srovnani = [
    ...[Y0 - 2, Y0 - 1, Y0].map((y) => ({ y, kc: fakturovano(y), skutecne: true })),
    ...roky.map((y) => ({ y, kc: plany[y].celkem, skutecne: false })),
  ]
  const max = Math.max(...srovnani.map((s) => s.kc), 1)
  const maxM = Math.max(...plan.mesice.map((m) => m.kc), 1)

  return (
    <>
      <div className="head">
        <div>
          <h1>Výhled</h1>
          <p>Co přinesou pravidelné revize v dalších letech. Počítá se z poslední revize a lhůty u každé revize v aplikaci a z ceny u revize, takže se plán sám upraví, jak revize zapisuješ.</p>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2>Roky vedle sebe</h2>
        <div className="vh-roky">
          {srovnani.map((s) => (
            <button key={s.y} className={`vh-rok ${s.skutecne ? 'past' : ''} ${s.y === Y ? 'on' : ''}`} disabled={s.skutecne} onClick={() => setY(s.y)} aria-pressed={s.y === Y}>
              <span className="vh-bar"><span style={{ height: `${(s.kc / max) * 100}%` }} /></span>
              <b>{tis(s.kc)}</b>
              <span>{s.y}</span>
              <small>{s.skutecne ? (s.y === Y0 ? 'zatím zaplaceno' : 'zaplaceno') : 'z plánu'}</small>
            </button>
          ))}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Minulé roky jsou všechny zaplacené faktury, včetně jednorázových zakázek. Plán obsahuje jen pravidelné revize, zakázky navíc (staveniště MZP, DSS, soukromí) přijdou k tomu.</p>
      </section>

      <div className="dane-dlazdice" style={{ marginBottom: 16 }}>
        <div><b>{fmtKc(plan.celkem)}</b><span>pravidelné revize {Y}<br />{plan.v.length} revizí na {new Set(plan.v.map((x) => x.o?.id)).size} místech</span></div>
        {plan.klienti.slice(0, 3).map((k) => (
          <div key={k.nazev}><b>{fmtKc(k.kc)}</b><span>{k.nazev}{DO_KONCE_ROKU.includes(k.nazev) ? ', hotovo do 31. 12.' : ''}<br />{k.n} revizí, {k.objekty.size} {k.objekty.size === 1 ? 'místo' : 'míst'}</span></div>
        ))}
      </div>

      {rady.length > 0 && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2>Na co myslet v roce {Y}</h2>
          <ul className="dane-ul">{rady.map((r, i) => <li key={i} className={`vh-${r.typ}`}>{r.text}</li>)}</ul>
        </section>
      )}

      <section className="panel">
        <h2>{Y} po měsících</h2>
        <div className="vh-mesice">
          {plan.mesice.map((m) => {
            const kl = Object.entries(m.polozky.reduce((a, x) => { const n = x.k?.zkratka || x.k?.nazev; a[n] = (a[n] || 0) + (x.cena || 0); return a }, {}))
            const open = otevreny === m.m
            return (
              <div key={m.m} className={`vh-mesic ${m.kc === 0 ? 'prazdny' : ''}`}>
                <button className="vh-radek" onClick={() => setOtevreny(open ? null : m.m)} disabled={!m.polozky.length} aria-expanded={open}>
                  <span className="vh-nazev">{MESICE[m.m]}</span>
                  <span className="vh-pruh"><span style={{ width: `${(m.kc / maxM) * 100}%` }} /></span>
                  <span className="vh-kc">{m.polozky.length ? fmtKc(m.kc) : 'volno'}</span>
                  <span className="vh-kdo small muted">{kl.map(([n, kc]) => `${n} ${kc ? tis(kc) : 'bez ceny'}`).join(' · ')}</span>
                </button>
                {open && <Detail polozky={m.polozky} />}
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}

// položky měsíce po klientech; MOL stručně po stanicích
function Detail({ polozky }) {
  const po = {}
  polozky.forEach((x) => { const k = x.k?.zkratka || x.k?.nazev; ((po[k] ||= {})[x.o?.id] ||= { o: x.o, rev: [] }).rev.push(x) })
  return (
    <div className="vh-detail">
      {Object.entries(po).map(([k, objs]) => (
        <div key={k} style={{ marginBottom: 10 }}>
          <b>{k}</b>
          {Object.values(objs).sort((a, b) => a.rev[0].datum.localeCompare(b.rev[0].datum)).map(({ o, rev }) => (
            <div key={o?.id} className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{o?.nazev} <span className="faint">{fmtDate(rev[0].datum)}</span><br /><span className="muted">{rev.map((x) => x.r.typ).join(', ')}</span></span>
              <b style={{ whiteSpace: 'nowrap' }}>{rev.some((x) => x.cena == null) ? 'bez ceny' : fmtKc(rev.reduce((a, x) => a + x.cena, 0))}</b>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
