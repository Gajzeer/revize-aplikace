// Výhled na další roky: opakující se revize (poslední + lhůta) promítnuté dopředu, s cenami u revizí.
import { addMonths, iso, parse } from './lib'

export const DO_KONCE_ROKU = ['PIK', 'SVS'] // revize musí být hotové do 31. 12. daného roku

// výskyty revizí v rozmezí od–do (ISO). Co je dřív než „od“, bere jako udělané včas a posune o lhůtu.
export function vyskyty(db, idx, od, doDne) {
  const out = []
  for (const r of db.revize) {
    if (r.stav === 'archiv' || !r.pristi || !(Number(r.lhuta_mesicu) > 0)) continue
    const o = idx.objekt[r.objekt_id]
    const k = o && idx.klient[o.klient_id]
    let d = parse(r.pristi)
    let i = 0
    while (iso(d) < od && i++ < 100) d = addMonths(d, Number(r.lhuta_mesicu))
    while (iso(d) <= doDne && i++ < 200) {
      out.push({ r, o, k, datum: iso(d), cena: r.cena == null ? null : Number(r.cena) })
      d = addMonths(d, Number(r.lhuta_mesicu))
    }
  }
  return out.sort((a, b) => a.datum.localeCompare(b.datum))
}

const zkr = (k) => k?.zkratka || k?.nazev || '?'

export function rokPlan(db, idx, Y) {
  const v = vyskyty(db, idx, `${Y}-01-01`, `${Y}-12-31`)
  const mesice = Array.from({ length: 12 }, (_, m) => ({ m, polozky: [], kc: 0 }))
  const klienti = {}
  for (const x of v) {
    const m = Number(x.datum.slice(5, 7)) - 1
    mesice[m].polozky.push(x)
    mesice[m].kc += x.cena || 0
    const kk = (klienti[zkr(x.k)] ||= { nazev: zkr(x.k), kc: 0, n: 0, objekty: new Set() })
    kk.kc += x.cena || 0
    kk.n++
    kk.objekty.add(x.o?.id)
  }
  const celkem = v.reduce((a, x) => a + (x.cena || 0), 0)
  const bezCeny = v.filter((x) => x.cena == null)
  return { Y, v, mesice, klienti: Object.values(klienti).sort((a, b) => b.kc - a.kc), celkem, bezCeny }
}

// chytré poznámky k roku: přetížené a prázdné měsíce, revize bez ceny, rozdíly proti jiným rokům
export function postrehy(plan, predchozi) {
  const p = []
  const prumer = plan.celkem / 12
  const plne = plan.mesice.filter((m) => m.kc > prumer * 1.7)
  const prazdne = plan.mesice.filter((m) => m.kc === 0)
  plne.forEach((m) => {
    const kl = [...new Set(m.polozky.map((x) => zkr(x.k)))]
    const mimo = kl.filter((k) => !DO_KONCE_ROKU.includes(k))
    p.push({ typ: 'pozor', text: `${MESICE[m.m]} je nejnabitější (${Math.round(m.kc / 1000)} tis. Kč, ${new Set(m.polozky.map((x) => x.o?.id)).size} míst).${mimo.length && prazdne.length ? ` Část ${mimo.join(', ')} jde udělat dřív, volno je v měsících ${prazdne.map((x) => MESICE[x.m].toLowerCase()).join(', ')}.` : ''}` })
  })
  if (plan.bezCeny.length) {
    const po = {}
    plan.bezCeny.forEach((x) => { (po[zkr(x.k)] ||= new Set()).add(x.r.id) })
    const prvni = plan.bezCeny[0]
    p.push({ typ: 'chyba', text: `Bez ceny (nejsou v součtu): ${Object.entries(po).map(([k, s]) => `${k} ${s.size}×`).join(', ')}, např. ${prvni.o?.nazev}: ${prvni.r.typ}. Cenu doplň u revize, plán se hned přepočítá.` })
  }
  if (predchozi) {
    const rozdil = plan.celkem - predchozi.celkem
    if (Math.abs(rozdil) > 20000) {
      const pricina = plan.klienti.map((k) => ({ k, d: k.kc - (predchozi.klienti.find((x) => x.nazev === k.nazev)?.kc || 0) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0]
      p.push({ typ: rozdil > 0 ? 'ok' : 'info', text: `Proti roku ${predchozi.Y} ${rozdil > 0 ? 'o' : 'o'} ${Math.round(Math.abs(rozdil) / 1000)} tis. Kč ${rozdil > 0 ? 'víc' : 'míň'}, hlavně ${pricina.k.nazev} (${pricina.d > 0 ? '+' : '−'}${Math.round(Math.abs(pricina.d) / 1000)} tis.: ${vysvetli(plan, predchozi, pricina.k.nazev)}).` })
    }
  }
  const konec = plan.v.filter((x) => DO_KONCE_ROKU.includes(zkr(x.k)) && x.datum.slice(5, 7) === '12')
  if (konec.length) p.push({ typ: 'pozor', text: `${konec.length} revizí MOL/SVS má termín až v prosinci. Musí být hotové do 31. 12., nenechávat na poslední týden.` })
  return p
}
// které druhy revizí přibyly / ubyly u klienta (podle lhůt delších než rok)
function vysvetli(plan, predchozi, klient) {
  const druhy = (pl) => {
    const m = {}
    pl.v.filter((x) => zkr(x.k) === klient).forEach((x) => { const t = Number(x.r.lhuta_mesicu) > 12 ? `${Number(x.r.lhuta_mesicu)}měsíční` : 'roční'; m[t] = (m[t] || 0) + (x.cena || 0) })
    return m
  }
  const a = druhy(plan), b = druhy(predchozi)
  const kl = Object.keys({ ...a, ...b }).filter((t) => t !== 'roční' && (a[t] || 0) !== (b[t] || 0))
  return kl.length ? kl.map((t) => `${(a[t] || 0) > (b[t] || 0) ? 'přibývají' : 'odpadají'} ${t} revize`).join(', ') : 'jiný počet revizí'
}

export const MESICE = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec']
