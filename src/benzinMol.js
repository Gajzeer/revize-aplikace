// Kolik stál benzín na výjezdy k MOL: dny výjezdů → nejlogičtější okruh z domova a zpět → km × spotřeba × průměrná cena.
// Informativní výpočet, do daní nevstupuje (paušál 80 % už výdaje pokrývá).

// průměr týdenních cen Natural 95 za celou ČR podle ČSÚ (prostý průměr týdnů z grafů v PDF)
export const PRUMERY = { 2023: 37.81, 2024: 37.45, 2025: 34.79, 2026: 37.85 }
export const ZDROJE = {
  2023: 'https://csu.gov.cz/vys/ceny-pohonnych-hmot-v-roce-2023',
  2024: 'https://csu.gov.cz/vys/ceny-pohonnych-hmot-v-roce-2024',
  2025: 'https://csu.gov.cz/vys/ceny-pohonnych-hmot-v-roce-2025',
  2026: 'https://csu.gov.cz/vys/ceny-pohonnych-hmot-v-1-pololeti-2026-dramaticky-rust-kvuli-nestabilni-situaci-na-blizkem-a-strednim-vychodu',
}
export const POZNAMKA_CEN = { 2025: 'bez 4. týdne', 2026: 'jen 1. pololetí' }
export const ROKY = [2023, 2024, 2025, 2026]
const OD_ZPRAV = 2025 // od tohoto roku jsou v aplikaci zprávy s datem revize; dřív se dny berou z faktur

export const jeMol = (o) => /^MOL\s*\d+/i.test(o?.nazev || '')

const vzduch = (a, b) => {
  const R = 6371, r = Math.PI / 180
  const x = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
function permutace(a) {
  if (a.length <= 1) return [a]
  return a.flatMap((x, i) => permutace([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]))
}
// nejkratší okruh domov → stanice → domov (do 7 stanic zkusí všechna pořadí), po silnici zhruba × 1,3
export function odhadKm(body, domov) {
  if (!body.length) return 0
  const delka = (p) => p.reduce((a, g, i) => a + vzduch(i ? p[i - 1] : domov, g), 0) + vzduch(p[p.length - 1], domov)
  const kandidati = body.length <= 7 ? permutace(body) : [body]
  return Math.round(Math.min(...kandidati.map(delka)) * 1.3)
}
// skutečná trasa po silnicích (OSRM, OpenStreetMap): okruh z domova s nejlepším pořadím zastávek
export async function silniceKm(body, domov) {
  const ll = [domov, ...body].map((g) => `${g[1]},${g[0]}`).join(';')
  const r = await fetch(`https://router.project-osrm.org/trip/v1/driving/${ll}?roundtrip=true&source=first&overview=false`)
  if (!r.ok) throw new Error(`OSRM ${r.status}`)
  const j = await r.json()
  if (j.code !== 'Ok' || !j.trips?.[0]) throw new Error(j.code || 'bez trasy')
  return Math.round(j.trips[0].distance / 1000)
}
export const klicDne = (ids) => [...ids].sort((a, b) => a - b).join('-')

// dny výjezdů: { datum, rok, ids: [objekt_id], zdroj: 'zpravy' | 'faktura', cislo }
export function dnyVyjezdu(db, idx) {
  const vyj = idx.nast['mol-vyjezdy'] || {}
  const dny = []
  const podleDne = {}
  for (const z of db.zpravy || []) {
    const o = idx.objekt[z.objekt_id]
    if (!jeMol(o) || !z.datum_revize || Number(z.datum_revize.slice(0, 4)) < OD_ZPRAV) continue
    ;(podleDne[z.datum_revize] ||= new Set()).add(o.id)
  }
  for (const [datum, s] of Object.entries(podleDne)) dny.push({ datum, rok: Number(datum.slice(0, 4)), ids: [...s], zdroj: 'zpravy' })
  const faktury = (vyj.faktury || []).map((f) => ({ datum: f.datum, rok: Number(f.datum.slice(0, 4)), ids: f.ids, zdroj: 'faktura', cislo: f.cislo }))
  return { zprav: dny.sort((a, b) => a.datum.localeCompare(b.datum)), faktury }
}

// výsledek po letech; km z mezipaměti tras (nastaveni 'mol-km'), jinak odhad vzdušnou čarou
export function benzinPoLetech(db, idx, { spotreba = 11, ceny = {} } = {}) {
  const geo = idx.nast.geo || {}
  const domov = geo.domov
  const cache = idx.nast['mol-km'] || {}
  const { zprav, faktury } = dnyVyjezdu(db, idx)
  const chybi = new Set()
  const kmDne = (d) => {
    const body = d.ids.map((id) => geo[id]).filter(Boolean)
    d.ids.forEach((id) => { if (!geo[id]) chybi.add(id) })
    const k = klicDne(d.ids)
    if (cache[k] != null && body.length === d.ids.length) return { km: cache[k], silnice: true }
    return { km: domov ? odhadKm(body, domov) : 0, silnice: false }
  }
  const spocitej = (dny) => dny.map((d) => ({ ...d, ...kmDne(d) }))
  const zZprav = spocitej(zprav)
  const zFaktur = spocitej(faktury)
  // kontrola: v roce 2025 jsou známé skutečné dny i faktury → o kolik faktury km podhodnocují
  const kmZ = zZprav.filter((d) => d.rok === OD_ZPRAV).reduce((a, d) => a + d.km, 0)
  const kmF = zFaktur.filter((d) => d.rok === OD_ZPRAV).reduce((a, d) => a + d.km, 0)
  // jen rozumná korekce; když jsou data za 2025 neúplná, faktury se berou tak, jak jsou
  const k0 = kmZ && kmF ? kmZ / kmF : 1
  const koef = k0 >= 0.8 && k0 <= 2 ? k0 : 1
  const roky = ROKY.map((rok) => {
    const zeZprav = rok >= OD_ZPRAV
    const dny = (zeZprav ? zZprav : zFaktur).filter((d) => d.rok === rok)
    const kmSurove = dny.reduce((a, d) => a + d.km, 0)
    const km = Math.round(zeZprav ? kmSurove : kmSurove * koef)
    const cena = Number(ceny[rok]) || PRUMERY[rok]
    const litry = (km * spotreba) / 100
    return { rok, dny, pocetDni: zeZprav || koef === 1 ? dny.length : Math.round(dny.length * zZprav.filter((d) => d.rok === OD_ZPRAV).length / Math.max(1, zFaktur.filter((d) => d.rok === OD_ZPRAV).length)), faktur: zeZprav ? null : dny.length, km, litry, cena, kc: Math.round(litry * cena), zdroj: zeZprav ? 'zpravy' : 'faktury', silnice: dny.length > 0 && dny.every((d) => d.silnice) }
  })
  return { roky, koef, kmZ, kmF, chybi: [...chybi], domov, vsechnyDny: [...zZprav, ...zFaktur], celkem: roky.reduce((a, r) => a + r.kc, 0) }
}
