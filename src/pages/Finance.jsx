import { useMemo, useState } from 'react'
import { useData } from '../data'
import { TODAY, daysTo, fmtKc, iso } from '../lib'

const MES = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec']

// Parametry OSVČ – vedlejší činnost, paušál 80 %, sleva na poplatníka uplatněna u zaměstnavatele.
// rozhodna = rozhodná částka pro účast na sociálním pojištění, vz = podíl zisku jako vyměřovací základ SP.
const PARAM = {
  2022: { rozhodna: 93387, vz: 0.5 },
  2023: { rozhodna: 98997, vz: 0.5 },
  2024: { rozhodna: 105520, vz: 0.55 },
  2025: { rozhodna: 111736, vz: 0.55 },
  2026: { rozhodna: 117521, vz: 0.55 },
}
const par = (y) => PARAM[y] || PARAM[Math.max(...Object.keys(PARAM).map(Number))]

export function odvody(prijmy, y) {
  const zisk = prijmy * 0.2
  const dan = Math.floor(zisk / 100) * 100 * 0.15
  const zp = zisk * 0.5 * 0.135
  const p = par(y)
  const sp = zisk > p.rozhodna ? zisk * p.vz * 0.292 : 0
  return { zisk, dan, zp, sp, cisty: prijmy - dan - zp - sp, spPod: zisk <= p.rozhodna, rozhodna: p.rozhodna }
}

const kc0 = (n) => Math.round(n).toLocaleString('cs-CZ').replace(/\s/g, ' ')
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null)

export default function Finance() {
  const { db, idx } = useData()
  const t = TODAY()
  const Y = t.getFullYear()
  const md = iso(t).slice(5)
  const [rokK, setRokK] = useState('all')

  const d = useMemo(() => {
    const years = [...new Set(db.faktury.map((f) => f.rok))].filter(Boolean).sort()
    const byY = {}
    years.forEach((y) => {
      const l = db.faktury.filter((f) => f.rok === y)
      const sum = l.reduce((a, f) => a + Number(f.castka || 0), 0)
      const m = Array(12).fill(0)
      const mc = Array(12).fill(0)
      l.forEach((f) => {
        const mi = Number((f.datum_vystaveni || '').slice(5, 7)) - 1
        if (mi >= 0) { m[mi] += Number(f.castka || 0); mc[mi]++ }
      })
      const toDate = l.filter((f) => (f.datum_vystaveni || '').slice(5) <= md).reduce((a, f) => a + Number(f.castka || 0), 0)
      const unpaid = l.filter((f) => !f.zaplaceno && daysTo(f.datum_splatnosti) != null)
      const perK = {}
      l.forEach((f) => (perK[f.klient_id] = (perK[f.klient_id] || 0) + Number(f.castka || 0)))
      byY[y] = {
        y, n: l.length, sum, m, mc, toDate, perK,
        avg: l.length ? sum / l.length : 0,
        max: l.reduce((a, f) => (Number(f.castka) > Number(a?.castka || 0) ? f : a), null),
        unpaid: unpaid.reduce((a, f) => a + Number(f.castka || 0), 0),
        mesicu: y === Y ? t.getMonth() + 1 : 12 - (y === years[0] ? Math.max(0, Number((l.map((f) => f.datum_vystaveni || '').filter(Boolean).sort()[0] || '').slice(5, 7)) - 1) : 0),
        ...odvody(sum, y),
      }
    })
    const all = years.reduce((a, y) => a + byY[y].sum, 0)
    const klienti = [...new Set(db.faktury.map((f) => f.klient_id))]
      .map((k) => ({ k, total: years.reduce((a, y) => a + (byY[y].perK[k] || 0), 0), per: Object.fromEntries(years.map((y) => [y, byY[y].perK[k] || 0])) }))
      .sort((a, b) => b.total - a.total)
    return { years, byY, all, klienti }
  }, [db, md, Y])

  const { years, byY } = d
  const start = db.faktury.map((f) => (f.datum_vystaveni || '').slice(0, 7)).filter(Boolean).sort()[0] || ''
  if (!years.length) return null
  const cur = byY[Y]
  const prev = byY[Y - 1]
  const odhad = cur && prev ? cur.sum + Math.max(0, prev.sum - prev.toDate) : null
  const maxY = Math.max(...years.map((y) => byY[y].sum))
  const maxM = Math.max(1, ...years.flatMap((y) => byY[y].m))
  const best = years.reduce((a, y) => (byY[y].sum > byY[a].sum ? y : a), years[0])
  const allMonths = years.flatMap((y) => byY[y].m.map((v, i) => ({ y, i, v }))).filter((x) => x.v > 0)
  const bestM = allMonths.reduce((a, x) => (x.v > (a?.v || 0) ? x : a), null)
  const odvodyAll = years.reduce((a, y) => a + byY[y].dan + byY[y].zp + byY[y].sp, 0)

  return (
    <section className="fin">
      <div className="fin-head">
        <h2>Finance {years[0]}–{years[years.length - 1]}</h2>
        <p className="muted small">Ze všech faktur v evidenci. Odvody jsou orientační odhad pro vedlejší činnost s paušálem 80 %.</p>
      </div>

      <div className="fin-kpi">
        <div><span>Celkem vyfakturováno</span><b className="num">{fmtKc(d.all)}</b><em>{years.length} let, {db.faktury.length} faktur</em></div>
        <div><span>Odhad čistého po odvodech</span><b className="num">{fmtKc(d.all - odvodyAll)}</b><em>daň a pojištění celkem asi {fmtKc(odvodyAll)}</em></div>
        <div><span>Nejlepší rok</span><b className="num">{best}</b><em>{fmtKc(byY[best].sum)}</em></div>
        <div><span>Nejlepší měsíc</span><b className="num">{bestM ? `${MES[bestM.i]} ${bestM.y}` : '–'}</b><em>{bestM ? fmtKc(bestM.v) : ''}</em></div>
        {odhad != null && <div><span>Výhled {Y} podle loňska</span><b className="num">{fmtKc(odhad)}</b><em>letos {fmtKc(cur.sum)} + zbytek loňského roku {fmtKc(prev.sum - prev.toDate)}</em></div>}
      </div>

      <div className="panel">
        <h2 style={{ marginBottom: 6 }}>Roky</h2>
        <div className="yrbars">
          {years.map((y) => {
            const r = byY[y]
            return (
              <div key={y} className="yrbar">
                <span className="yr num">{y}</span>
                <div className="yrtrack">
                  <div className="yrfill" style={{ width: `${(r.sum / maxY) * 100}%` }} />
                  {y !== Y && byY[y].toDate > 0 && <div className="yrmark" style={{ left: `${(r.toDate / maxY) * 100}%` }} title={`Ke dni ${t.getDate()}. ${t.getMonth() + 1}.: ${fmtKc(r.toDate)}`} />}
                </div>
                <span className="num yrsum">{fmtKc(r.sum)}</span>
              </div>
            )
          })}
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>Svislá čárka ukazuje, kolik bylo v daném roce vyfakturováno ke dnešnímu dni.</div>

        <div className="tablewrap fin-table" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Rok</th>
                <th className="r">Faktur</th>
                <th className="r">Příjmy</th>
                <th className="r" title="U letoška proti loňsku ke stejnému dni">Změna</th>
                <th className="r">Ke dnešku</th>
                <th className="r">Průměr / měsíc</th>
                <th className="r">Průměr / fakturu</th>
                <th className="r">Zisk (20 %)</th>
                <th className="r">Daň 15 %</th>
                <th className="r">Zdravotní</th>
                <th className="r">Sociální</th>
                <th className="r">Čisté</th>
                <th className="r">Nezaplaceno</th>
              </tr>
            </thead>
            <tbody>
              {[...years].reverse().map((y) => {
                const r = byY[y]
                const ch = byY[y - 1] ? pct(r.sum, y === Y ? byY[y - 1].toDate : byY[y - 1].sum) : null
                return (
                  <tr key={y}>
                    <td className="num" style={{ fontWeight: 700 }}>{y}{y === Y && <span className="small muted"> (zatím)</span>}</td>
                    <td className="r num">{r.n}</td>
                    <td className="r num" style={{ fontWeight: 650 }}>{kc0(r.sum)}</td>
                    <td className={`r num ${ch == null ? '' : ch >= 0 ? 'delta-up' : 'delta-down'}`}>{ch == null ? '–' : `${ch >= 0 ? '+' : ''}${ch} %`}</td>
                    <td className="r num">{kc0(r.toDate)}</td>
                    <td className="r num">{kc0(r.sum / r.mesicu)}</td>
                    <td className="r num">{kc0(r.avg)}</td>
                    <td className="r num">{kc0(r.zisk)}</td>
                    <td className="r num">{kc0(r.dan)}</td>
                    <td className="r num">{kc0(r.zp)}</td>
                    <td className="r num" title={r.spPod ? `Zisk pod rozhodnou částkou ${kc0(r.rozhodna)} Kč – sociální se neplatí` : ''}>{r.spPod ? '0*' : kc0(r.sp)}</td>
                    <td className="r num" style={{ fontWeight: 650 }}>{kc0(r.cisty)}</td>
                    <td className="r num">{r.unpaid ? kc0(r.unpaid) : '–'}</td>
                  </tr>
                )
              })}
              <tr className="fin-total">
                <td>Celkem</td>
                <td className="r num">{db.faktury.length}</td>
                <td className="r num">{kc0(d.all)}</td>
                <td colSpan="4" />
                <td className="r num">{kc0(years.reduce((a, y) => a + byY[y].zisk, 0))}</td>
                <td className="r num">{kc0(years.reduce((a, y) => a + byY[y].dan, 0))}</td>
                <td className="r num">{kc0(years.reduce((a, y) => a + byY[y].zp, 0))}</td>
                <td className="r num">{kc0(years.reduce((a, y) => a + byY[y].sp, 0))}</td>
                <td className="r num">{kc0(years.reduce((a, y) => a + byY[y].cisty, 0))}</td>
                <td className="r num">{kc0(years.reduce((a, y) => a + byY[y].unpaid, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Zisk = 20 % příjmů (paušál 80 %). Daň 15 % ze zisku, slevu na poplatníka uplatňuje zaměstnavatel. Zdravotní 13,5 % z poloviny zisku.
          Sociální 29,2 % z {Math.round(par(Y).vz * 100)} % zisku, jen když zisk přesáhne rozhodnou částku pro vedlejší činnost (* = pod ní, neplatí se).
          Skutečné částky určí daňové přiznání a přehledy pro ČSSZ a pojišťovnu.
        </p>
      </div>

      <div className="panel">
        <h2>Měsíce po letech</h2>
        <div className="tablewrap fin-table">
          <table className="heat">
            <thead>
              <tr>
                <th>Měsíc</th>
                {years.map((y) => <th key={y} className="r">{y}</th>)}
                <th className="r">Průměr</th>
              </tr>
            </thead>
            <tbody>
              {MES.map((m, i) => {
                const vals = years.map((y) => byY[y].m[i])
                const full = years.filter((y) => (y < Y || i < t.getMonth()) && `${y}-${String(i + 1).padStart(2, '0')}` >= start)
                const avg = full.length ? full.reduce((a, y) => a + byY[y].m[i], 0) / full.length : 0
                return (
                  <tr key={m}>
                    <td>{m}</td>
                    {vals.map((v, j) => (
                      <td key={years[j]} className="r num" style={{ background: v ? `color-mix(in srgb, var(--ochre) ${Math.round(8 + (v / maxM) * 55)}%, transparent)` : undefined }}>
                        {v ? kc0(v) : years[j] === Y && i > t.getMonth() ? '' : '–'}
                        {byY[years[j]].mc[i] > 0 && <span className="fin-cnt">{byY[years[j]].mc[i]}×</span>}
                      </td>
                    ))}
                    <td className="r num muted">{avg ? kc0(avg) : '–'}</td>
                  </tr>
                )
              })}
              <tr className="fin-total">
                <td>Celkem</td>
                {years.map((y) => <td key={y} className="r num">{kc0(byY[y].sum)}</td>)}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Číslo za částkou = počet faktur v měsíci. Čím tmavší, tím silnější měsíc.</p>
      </div>

      <div className="panel">
        <h2>
          Klienti po letech
          <select className="select" style={{ height: 32, fontSize: 13 }} value={rokK} onChange={(e) => setRokK(e.target.value)} aria-label="Podíl za rok">
            <option value="all">podíl za všechny roky</option>
            {years.map((y) => <option key={y} value={y}>podíl v roce {y}</option>)}
          </select>
        </h2>
        <div className="tablewrap fin-table">
          <table>
            <thead>
              <tr>
                <th>Klient</th>
                {years.map((y) => <th key={y} className="r">{y}</th>)}
                <th className="r">Celkem</th>
                <th className="r">Podíl</th>
              </tr>
            </thead>
            <tbody>
              {d.klienti.map((c) => {
                const k = idx.klient[c.k]
                const base = rokK === 'all' ? d.all : byY[rokK].sum
                const v = rokK === 'all' ? c.total : c.per[rokK]
                return (
                  <tr key={c.k ?? 'x'}>
                    <td style={{ fontWeight: 600 }}>{k ? k.zkratka || k.nazev : 'bez klienta'}</td>
                    {years.map((y) => <td key={y} className="r num">{c.per[y] ? kc0(c.per[y]) : '–'}</td>)}
                    <td className="r num" style={{ fontWeight: 650 }}>{kc0(c.total)}</td>
                    <td className="r num">
                      <span className="sharebar"><span style={{ width: `${base ? (v / base) * 100 : 0}%` }} /></span>
                      {base ? Math.round((v / base) * 100) : 0} %
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
