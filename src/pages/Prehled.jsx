import { useMemo } from 'react'
import { useData } from '../data'
import { TODAY, addMonths, daysTo, fmtDate, fmtKc, iso, parse } from '../lib'
import { Due } from '../ui'

const MES = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro']

function MonthChart({ cur, prev, year }) {
  const max = Math.max(1, ...cur, ...prev)
  const W = 640, H = 190, y0 = 14, base = 160, bw = 18
  const step = (W - 40) / 12
  const nowM = TODAY().getFullYear() === year ? TODAY().getMonth() : 11
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Fakturace po měsících ${year} a ${year - 1}`}>
        <line x1="20" x2={W - 10} y1={base} y2={base} stroke="#cfd3cf" />
        {cur.map((v, i) => {
          const x = 28 + i * step
          const hp = (prev[i] / max) * (base - y0)
          const hc = (v / max) * (base - y0)
          return (
            <g key={i}>
              <rect x={x} y={base - hp} width={bw} height={hp} rx="2" fill="#d9dcd8">
                <title>{`${MES[i]} ${year - 1}: ${fmtKc(prev[i])}`}</title>
              </rect>
              {i <= nowM && (
                <rect x={x + bw - 6} y={base - hc} width={bw} height={hc} rx="2" fill="#a9761a">
                  <title>{`${MES[i]} ${year}: ${fmtKc(v)}`}</title>
                </rect>
              )}
              <text x={x + bw / 2 + 3} y={base + 18} textAnchor="middle" fontSize="12" fill="#59616a">
                {MES[i]}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="small muted" style={{ display: 'flex', gap: 16, marginTop: 4 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#a9761a', borderRadius: 2, marginRight: 6 }} />{year}</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#d9dcd8', borderRadius: 2, marginRight: 6 }} />{year - 1}</span>
      </div>
    </div>
  )
}

export default function Prehled() {
  const { db, idx } = useData()
  const t = TODAY()
  const Y = t.getFullYear()

  const s = useMemo(() => {
    const md = iso(t).slice(5)
    const fy = (y) => db.faktury.filter((f) => f.rok === y)
    const cur = fy(Y)
    const prev = fy(Y - 1)
    const sum = (l) => l.reduce((a, f) => a + Number(f.castka || 0), 0)
    const prevToDate = prev.filter((f) => (f.datum_vystaveni || '').slice(5) <= md && f.datum_vystaveni?.startsWith(String(Y - 1)))
    const months = (l, y) => {
      const m = Array(12).fill(0)
      l.forEach((f) => {
        const d = parse(f.datum_vystaveni)
        if (d && d.getFullYear() === y) m[d.getMonth()] += Number(f.castka || 0)
      })
      return m
    }
    const unpaid = db.faktury.filter((f) => f.zaplaceno === false || (f.zaplaceno == null && daysTo(f.datum_splatnosti) >= 0))
    const perK = {}
    cur.forEach((f) => (perK[f.klient_id] = (perK[f.klient_id] || 0) + Number(f.castka)))
    return {
      total: sum(cur), count: cur.length, prevTotal: sum(prev), prevToDate: sum(prevToDate),
      mCur: months(cur, Y), mPrev: months(prev, Y - 1), unpaid, perK: Object.entries(perK).sort((a, b) => b[1] - a[1]),
    }
  }, [db, Y])

  const due = useMemo(() => {
    const lim = iso(addMonths(t, 1))
    return db.revize
      .filter((r) => r.pristi && r.pristi <= lim)
      .sort((a, b) => a.pristi.localeCompare(b.pristi))
  }, [db])

  const docs = useMemo(() => {
    const items = [
      ...db.doklady.filter((d) => d.platnost_do).map((d) => ({ k: 'd' + d.id, name: d.nazev, sub: d.cislo, date: d.platnost_do })),
      ...db.pristroje
        .filter((p) => p.aktivni && p.kalibrace_dne)
        .map((p) => ({ k: 'p' + p.id, name: `Kalibrace ${p.nazev}`, sub: `v. č. ${p.vyrobni_cislo}`, date: iso(addMonths(parse(p.kalibrace_dne), p.interval_mesicu || 24)) })),
    ]
    return items.sort((a, b) => a.date.localeCompare(b.date))
  }, [db])

  const delta = s.prevToDate ? Math.round(((s.total - s.prevToDate) / s.prevToDate) * 100) : null
  const late = due.filter((r) => daysTo(r.pristi) < 0).length

  return (
    <>
      <div className="head">
        <div>
          <h1>Přehled</h1>
          <p>{t.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>

      {db.klienti.length === 0 && (
        <section className="panel" style={{ marginBottom: 18 }}>
          <h2>Databáze je zatím prázdná</h2>
          <p style={{ margin: '0 0 12px' }}>Nahrajte jednorázově klienty, faktury, revize a ceník ze souboru, který jsem připravil.</p>
          <a className="btn" href="#/import" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Nahrát data</a>
        </section>
      )}
      <div className="grid g-dash">
        <div className="stack">
          <section className="panel">
            <h2>Fakturace {Y}<a href="#/faktury">Faktury</a></h2>
            <div className="earn">
              <div>
                <div className="big num">{Math.round(s.total).toLocaleString('cs-CZ')}<small>Kč</small></div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  {s.count} faktur
                  {delta != null && (
                    <> · <span className={delta >= 0 ? 'delta-up' : 'delta-down'}>{delta >= 0 ? '+' : ''}{delta} %</span> proti stejnému období loni</>
                  )}
                </div>
              </div>
              <dl>
                <dt>Základ daně (20 % po paušálu)</dt><dd className="num">{fmtKc(s.total * 0.2)}</dd>
                <dt>Loni ke stejnému dni</dt><dd className="num">{fmtKc(s.prevToDate)}</dd>
                <dt>Loni celkem</dt><dd className="num">{fmtKc(s.prevTotal)}</dd>
                <dt>Čeká na zaplacení</dt><dd className="num">{fmtKc(s.unpaid.reduce((a, f) => a + Number(f.castka), 0))}</dd>
              </dl>
            </div>
            <div style={{ marginTop: 18 }}>
              <MonthChart cur={s.mCur} prev={s.mPrev} year={Y} />
            </div>
          </section>

          <section className="panel">
            <h2>Podle klientů {Y}<a href="#/klienti">Klienti</a></h2>
            <div className="rows">
              {s.perK.map(([kid, v]) => {
                const k = idx.klient[kid]
                const pct = s.total ? (v / s.total) * 100 : 0
                return (
                  <div className="row" key={kid}>
                    <div>
                      <div className="t">{k?.zkratka || k?.nazev}</div>
                      <div style={{ height: 6, background: 'var(--line-2)', borderRadius: 3, marginTop: 6 }}>
                        <div style={{ width: `${pct}%`, height: 6, background: k?.zkratka === 'PIK' ? 'var(--ochre)' : '#8c949a', borderRadius: 3 }} />
                      </div>
                    </div>
                    <div className="num" style={{ textAlign: 'right' }}>
                      {fmtKc(v)}
                      <div className="small muted">{Math.round(pct)} %</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <h2>
              Revize do měsíce{late > 0 && <span className="pill late" style={{ marginLeft: 'auto', marginRight: 8 }}>{late} po termínu</span>}
              <a href="#/revize">Všechny</a>
            </h2>
            {due.length === 0 && <div className="empty">Do měsíce nic nehoří.</div>}
            <div className="rows">
              {due.slice(0, 9).map((r) => {
                const o = idx.objekt[r.objekt_id]
                return (
                  <div className="row" key={r.id}>
                    <div>
                      <div className="t">{o?.nazev}</div>
                      <div className="s">{r.typ}</div>
                    </div>
                    <Due date={r.pristi} showDate={false} />
                  </div>
                )
              })}
              {due.length > 9 && <div className="row"><a className="small" href="#/revize">a dalších {due.length - 9}</a></div>}
            </div>
          </section>

          <section className="panel">
            <h2>Doklady a kalibrace<a href="#/doklady">Detail</a></h2>
            <div className="rows">
              {docs.map((d) => (
                <div className="row" key={d.k}>
                  <div>
                    <div className="t">{d.name}</div>
                    <div className="s">{d.sub} · platí do {fmtDate(d.date)}</div>
                  </div>
                  <Due date={d.date} showDate={false} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
