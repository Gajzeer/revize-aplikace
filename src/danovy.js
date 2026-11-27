// Celková daň z příjmů fyzických osob: zaměstnání (§ 6) + podnikání (§ 7, paušál 80 %).
// Parametry jsou veřejné zákonné částky, osobní údaje se drží jen v databázi (nastaveni 'dane-RRRR').

const P = {
  2023: { strop: 1935552, deti: [15204, 22320, 27840], spZam: 0.065, rozhodna: 98997, spKoef: 0.5 },
  2024: { strop: 1582812, deti: [15204, 22320, 27840], spZam: 0.071, rozhodna: 105520, spKoef: 0.55 },
  2025: { strop: 1676052, deti: [15204, 22320, 27840], spZam: 0.071, rozhodna: 111736, spKoef: 0.55 },
  2026: { strop: 1762812, deti: [15204, 22320, 27840], spZam: 0.071, rozhodna: 117521, spKoef: 0.55 },
}
export const parRok = (y) => P[y] || P[Math.max(...Object.keys(P).map(Number))]
const SLEVA_POPLATNIK = 30840
const SLEVA_MANZELKA = 24840
const MAX_UROKY = 150000

// d: { zam_prijem, zam_zaloha, osvc_prijmy, uroky, deti: [měsíce 1., 2., 3. dítěte], manzelka, ucetni }
export function celkovaDan(y, d) {
  const p = parRok(y)
  const zam = Number(d.zam_prijem) || 0
  const osvc = Number(d.osvc_prijmy) || 0
  const vydaje = Math.min(osvc * 0.8, 1600000)
  const dzd7 = osvc - vydaje
  const uroky = Math.min(Number(d.uroky) || 0, MAX_UROKY)
  const zaklad = Math.max(0, Math.floor((zam + dzd7 - uroky) / 100) * 100)
  const dan = Math.round(Math.min(zaklad, p.strop) * 0.15 + Math.max(0, zaklad - p.strop) * 0.23)
  const slevy = SLEVA_POPLATNIK + (d.manzelka ? SLEVA_MANZELKA : 0)
  const poSlevach = Math.max(0, dan - slevy)
  const deti = (d.deti || []).map((m, i) => Math.round(((p.deti[Math.min(i, 2)]) * (Number(m) || 0)) / 12))
  const zvyhodneni = deti.reduce((a, x) => a + x, 0)
  const danKonecna = poSlevach - zvyhodneni // záporná = daňový bonus
  const zalohy = Number(d.zam_zaloha) || 0
  const vysledek = danKonecna - zalohy // + doplatek, − přeplatek

  // pojistné z podnikání (vedlejší činnost)
  const spVZ = dzd7 > p.rozhodna ? Math.ceil(dzd7 * p.spKoef) : 0
  const sp = Math.ceil(spVZ * 0.292)
  const zp = Math.ceil(Math.ceil(dzd7 * 0.5) * 0.135)
  // odvody zaměstnance (strhává zaměstnavatel z hrubé mzdy)
  const zamOdvody = Math.round(zam * (p.spZam + 0.045))
  const ucetni = Number(d.ucetni) || 0
  const hrube = zam + osvc
  const danCelkem = Math.max(0, danKonecna)
  const cisty = hrube - danKonecna - zamOdvody - sp - zp - ucetni
  // daň, která připadá na podnikání: rozdíl proti stavu bez něj
  const bez = celkovaDanBezOsvc(y, d)
  const danZPodnikani = danKonecna - bez
  return {
    zam, osvc, vydaje, dzd7, uroky, zaklad, dan, slevy, poSlevach, deti, zvyhodneni, danKonecna, zalohy, vysledek,
    sp, zp, zamOdvody, ucetni, hrube, danCelkem, cisty, danZPodnikani,
    cistyOsvc: osvc - danZPodnikani - sp - zp - ucetni,
    usporaUroky: Math.round(uroky * 0.15),
    sazba: hrube ? danCelkem / hrube : 0,
    odvodySazba: hrube ? (hrube - cisty) / hrube : 0,
  }
}
function celkovaDanBezOsvc(y, d) {
  const p = parRok(y)
  const zam = Number(d.zam_prijem) || 0
  const uroky = Math.min(Number(d.uroky) || 0, MAX_UROKY)
  const zaklad = Math.max(0, Math.floor((zam - uroky) / 100) * 100)
  const dan = Math.round(Math.min(zaklad, p.strop) * 0.15 + Math.max(0, zaklad - p.strop) * 0.23)
  const poSlevach = Math.max(0, dan - SLEVA_POPLATNIK - (d.manzelka ? SLEVA_MANZELKA : 0))
  const zv = (d.deti || []).reduce((a, m, i) => a + Math.round((p.deti[Math.min(i, 2)] * (Number(m) || 0)) / 12), 0)
  return poSlevach - zv
}

// kolik si z každé zaplacené faktury odložit na daň a pojistné (paušál 80 %, nad rozhodnou částkou)
export function odlozit(y) {
  const p = parRok(y)
  return 0.2 * (0.15 + p.spKoef * 0.292 + 0.5 * 0.135)
}
