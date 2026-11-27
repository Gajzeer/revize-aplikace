// Přepis dat v textu revizní zprávy podle toho, co u data stojí (štítek), ne jen podle hodnoty.
// Role: revize (zahájení/ukončení/provedení), vyp (vypracování/vyhotovení), pred (předání/převzetí),
// minula (předložená předchozí revizní zpráva – „vyhotovena …, ev.č: …“).

export const RE_DATUM = /\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\b/g
const toIso = (d, m, y) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
export const czDatum = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '')

// podle textu těsně před datem určí, o jaké datum jde
export function roleData(pred) {
  const t = pred.slice(-90).toLowerCase()
  if (/protokol\s*č[^|\n]{0,40}$/.test(t) || /\d+\/\d{4}\s*ze dne\s*:?\s*$/.test(t)) return null
  const kus = t.slice(Math.max(t.lastIndexOf('|'), t.lastIndexOf('\n'), t.lastIndexOf('/'), t.lastIndexOf(';')) + 1)
  if (/předal|převzetí|předání/.test(kus)) return 'pred'
  if (/vypracování|vyhotoveno dne|zpracování/.test(kus)) return /protokol\s*č/.test(kus) ? null : 'vyp'
  if (/zahájení|počátku|ukončení|provedení (zkoušky|revize)|revize provedena/.test(kus)) return 'revize'
  if (/vyhotovena|mycí linky ze dne|předchozí[^.]*ze dne/.test(kus)) return 'minula'
  return null
}

// projde všechny texty zprávy; u buněk tabulky bere jako kontext i předchozí buňku v řádku
function proText(bloky, fn) {
  return bloky.map((b) => {
    if (b.t === 'p') return { ...b, x: fn(b.x, '') }
    return { ...b, r: b.r.map((row) => row.map((c, i) => ({ ...c, x: fn(c.x, i ? row[i - 1].x : '') }))) }
  })
}

// „ev.č: …“ / „Ev.č. revizní zprávy: …“, ne číslo osvědčení
const RE_EV = /(ev\.\s*č(?![.\s:]*osvědčení)\.?(?:\s*revizní zprávy)?\s*:?\s*)([^\s,;]*\d[^\s,;]*)/i
function nahraditEv(x, ev) {
  if (!RE_EV.test(x)) return null
  return x.replace(RE_EV, (m, a, old) => {
    const kon = old.match(/[/.]+$/)?.[0] || ''
    return a + ev.replace(/\s+/g, '-') + kon
  })
}

// stara/nova: { revize, vyp, pred } (ISO); minula: { datum, ev } předchozí zprávy; jen: přepsat jen tyto role
export function prepisData(bloky, { stara = {}, nova = {}, minula = null, jen = null }) {
  const smi = (r) => !jen || jen.includes(r)
  let cekaEv = 0 // ev. č. předchozí zprávy bývá i na následujícím řádku
  return proText(bloky, (x, kontext) => {
    if (!x) return x
    let bylaMinula = false
    let out = x.replace(RE_DATUM, (m, d, mo, y, pos) => {
      const iso = toIso(d, mo, y)
      const pred = x.slice(0, pos)
      let role = roleData(pred)
      if (!role && kontext && !/\S/.test(pred)) role = roleData(kontext)
      if (role === 'minula') bylaMinula = true
      if (role === 'minula') return minula?.datum && smi('minula') ? czDatum(minula.datum) : m
      if (!role) {
        // bez štítku: podle toho, které staré datum to bylo (při shodě platí datum revize jako dřív)
        const shoda = ['revize', 'vyp', 'pred'].filter((r) => stara[r] === iso)
        if (shoda.length) role = shoda[0]
      }
      return role && smi(role) && nova[role] ? czDatum(nova[role]) : m
    })
    if (minula?.ev && smi('minula')) {
      if (bylaMinula) cekaEv = 2
      if (cekaEv > 0) {
        cekaEv--
        const n = nahraditEv(out, minula.ev)
        if (n !== null) { out = n; cekaEv = 0 }
      }
    }
    return out
  })
}

// evidenční číslo ve tvaru „2026-17-09-MOL417 E-ML-R“: datum (rok-den-měsíc) podle data revize
export function evSDatem(ev, iso) {
  if (!ev || !iso) return ev
  return ev.replace(/\b\d{4}-\d{2}-\d{2}(?=[-\s])/, `${iso.slice(0, 4)}-${iso.slice(8, 10)}-${iso.slice(5, 7)}`)
}
// přepíše v textu staré ev. č. na nové (i když je v textu místo mezery pomlčka)
export function prepisEv(bloky, stare, nove) {
  if (!stare || !nove || stare === nove) return bloky
  const varianty = [[stare, nove], [stare.replace(/\s+/g, '-'), nove.replace(/\s+/g, '-')]]
  return proText(bloky, (x) => varianty.reduce((t, [a, b]) => t.split(a).join(b), x || ''))
}
