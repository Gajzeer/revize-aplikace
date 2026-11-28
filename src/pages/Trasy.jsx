// Plánovač tras: revize, které jsou na řadě, seskupí do výjezdů po blízkých stanicích
import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data'
import { TODAY, addMonths, fmtDate, fmtKc, iso, supabase } from '../lib'
import { useToast } from '../ui'

// vzdušná vzdálenost v km; po silnici počítáme zhruba × 1,3
const km = (a, b) => {
  const R = 6371, r = Math.PI / 180
  const x = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
const silnice = (d) => Math.round(d * 1.3)

// cena revize, když u ní chybí: z ceníku klienta (stejný název položky), jinak z obecného ceníku
const nrm = (t) => (t || '').toLowerCase().replace(/\s+/g, ' ').trim()
function cenaZCeniku(cenik, klientId, typ) {
  const c = cenik.find((x) => x.klient_id === klientId && nrm(x.polozka) === nrm(typ)) || cenik.find((x) => x.klient_id == null && nrm(x.polozka) === nrm(typ))
  return Number(c?.cena) || 0
}

// souřadnice adresy z OpenStreetMap (Nominatim), postupně přesněji → hruběji
async function najit(adresa) {
  const casti = adresa.split(',').map((s) => s.trim()).filter(Boolean)
  const psc = (adresa.match(/\b(\d{3})\s?(\d{2})\b/) || []).slice(1).join('')
  const pokusy = [adresa, casti.slice(1).join(', '), psc && `postalcode=${psc}`].filter(Boolean)
  for (const q of pokusy) {
    const u = q.startsWith('postalcode=')
      ? `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&country=cz&${q}`
      : `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=cz&q=${encodeURIComponent(q)}`
    const r = await fetch(u, { headers: { 'Accept-Language': 'cs' } })
    if (r.ok) { const j = await r.json(); if (j[0]) return [Number(j[0].lat), Number(j[0].lon)] }
    await new Promise((res) => setTimeout(res, 1100)) // pravidla Nominatimu: nejvýš 1 dotaz za sekundu
  }
  return null
}

// shlukování: začne nejvzdálenější stanicí od domova a přibírá nejbližší, dokud je výjezd v dosahu a není plný
function naplanovat(mista, domov, { maxStanic, maxKm }) {
  const zbyva = [...mista]
  const vyjezdy = []
  while (zbyva.length) {
    zbyva.sort((a, b) => km(domov, b.geo) - km(domov, a.geo))
    const prvni = zbyva.shift()
    const v = [prvni]
    while (v.length < maxStanic && zbyva.length) {
      let best = -1, bd = Infinity
      zbyva.forEach((m, i) => { const d = Math.min(...v.map((x) => km(x.geo, m.geo))); if (d < bd) { bd = d; best = i } })
      if (bd > maxKm) break
      v.push(zbyva.splice(best, 1)[0])
    }
    // pořadí jízdy: od domova vždy k nejbližší další
    const poradi = []
    let pos = domov
    const tmp = [...v]
    while (tmp.length) {
      let i = 0
      tmp.forEach((m, j) => { if (km(pos, m.geo) < km(pos, tmp[i].geo)) i = j })
      pos = tmp[i].geo
      poradi.push(tmp.splice(i, 1)[0])
    }
    let pred = domov
    const mista = poradi.map((m) => { const k = silnice(km(pred, m.geo)); pred = m.geo; return { ...m, kmZ: k } })
    const kmDomu = silnice(km(pred, domov))
    vyjezdy.push({ mista, km: mista.reduce((a, m) => a + m.kmZ, 0) + kmDomu, kmDomu, cena: poradi.reduce((a, m) => a + m.cena, 0), termin: poradi.map((m) => m.termin).sort()[0] })
  }
  return vyjezdy.sort((a, b) => a.termin.localeCompare(b.termin))
}

const mapy = (domov, mista) => {
  const ll = (g) => `${g[1]},${g[0]}`
  return `https://mapy.cz/fnc/v1/route?mapset=traffic&start=${ll(domov)}&end=${ll(domov)}&routeType=car_fast_traffic&waypoints=${mista.map((m) => ll(m.geo)).join(';')}`
}
const google = (domov, mista) => {
  const g = (x) => `${x[0]},${x[1]}`
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${g(domov)}&destination=${g(domov)}&waypoints=${mista.map((m) => g(m.geo)).join('%7C')}`
}

export default function Trasy() {
  const { db, idx, save, reload } = useData()
  const [toast, say] = useToast()
  const [opt, setOpt] = useState({ horizont: 'rok', maxStanic: 5, maxKm: 40, klient: '' })
  const [geoStav, setGeoStav] = useState(null)
  const [den, setDen] = useState({})
  // benzín: průměrná cena ČR (stahuje se jednou denně), ruční cena má přednost; spotřeba l/100 km
  const benzinRow = (db.nastaveni || []).find((r) => r.klic === 'benzin')
  const bz = benzinRow?.hodnota || {}
  const [bzEdit, setBzEdit] = useState(null)
  const [bzStav, setBzStav] = useState(null)
  const spotreba = Number(bz.spotreba) || 11
  const cenaL = Number(bz.rucne) || Number(bz.auto?.cena) || 0
  const benzinKc = (k) => Math.round((k * spotreba) / 100 * cenaL)
  useEffect(() => {
    if (bz.aktualizovano === iso(TODAY()) && bz.auto) return
    supabase.functions.invoke('benzin', { body: {} }).then(({ data }) => {
      if (data?.ok && data.cerstve) reload()
      else if (data && !data.ok) setBzStav(`Cenu benzínu se nepodařilo stáhnout (${data.chyba || 'neznámá chyba'}). Zadejte ji ručně.`)
    }).catch(() => {})
  }, [])
  async function ulozitBenzin() {
    const { data } = await supabase.from('nastaveni').select('id,hodnota').eq('klic', 'benzin').maybeSingle()
    const hodnota = { ...(data?.hodnota || bz), spotreba: Number(bzEdit.spotreba) || 11, rucne: bzEdit.rucne === '' ? null : Number(String(bzEdit.rucne).replace(',', '.')) || null }
    await save('nastaveni', data ? { id: data.id, hodnota } : { klic: 'benzin', hodnota })
    setBzEdit(null)
    say('Uloženo')
  }
  const geo = idx.nast.geo || {}
  const dod = idx.nast.dodavatel || {}
  const adresaDomu = [dod.ulice, dod.mesto].filter(Boolean).join(', ')

  const hranice = opt.horizont === 'rok' ? `${TODAY().getFullYear()}-12-31` : iso(addMonths(TODAY(), Number(opt.horizont)))
  const rok = String(TODAY().getFullYear())
  const naRade = useMemo(() => {
    const m = {}
    for (const r of db.revize) {
      if (r.stav === 'archiv' || r.stav === 'ceka_fakturace' || !r.pristi || r.pristi > hranice) continue
      if (opt.horizont === 'rok' && (r.posledni || '').startsWith(rok)) continue
      const o = idx.objekt[r.objekt_id]
      if (!o || (opt.klient && o.klient_id !== Number(opt.klient))) continue
      const x = (m[o.id] ||= { o, typy: [], polozky: [], cena: 0, termin: r.pristi })
      const cena = Number(r.cena) || cenaZCeniku(db.cenik, o.klient_id, r.typ)
      x.typy.push(r.typ)
      x.polozky.push({ typ: r.typ, cena })
      x.cena += cena
      if (r.pristi < x.termin) x.termin = r.pristi
    }
    return Object.values(m)
  }, [db, hranice, opt.klient])

  const chybi = [...naRade.map((x) => x.o).filter((o) => o.adresa && !geo[o.id]), ...(adresaDomu && !geo.domov ? [{ id: 'domov', adresa: adresaDomu }] : [])]
  const bezAdresy = naRade.filter((x) => !x.o.adresa)
  const domov = geo.domov

  async function dohledat() {
    const nove = { ...geo }
    const nenalezeno = []
    for (let i = 0; i < chybi.length; i++) {
      setGeoStav(`Hledám polohu ${i + 1} z ${chybi.length}: ${chybi[i].nazev || 'domov'}`)
      try { const g = await najit(chybi[i].adresa); if (g) nove[chybi[i].id] = g; else nenalezeno.push(chybi[i].nazev || chybi[i].adresa) } catch { nenalezeno.push(chybi[i].nazev || chybi[i].adresa) }
      await new Promise((res) => setTimeout(res, 1100))
    }
    const row = (db.nastaveni || []).find((r) => r.klic === 'geo')
    await save('nastaveni', row ? { id: row.id, hodnota: nove } : { klic: 'geo', hodnota: nove })
    setGeoStav(nenalezeno.length ? `Hotovo. Nenašel jsem: ${nenalezeno.join(', ')}. Opravte adresu u objektu v Klientech.` : null)
  }

  const vyjezdy = useMemo(() => (domov ? naplanovat(naRade.filter((x) => geo[x.o.id]).map((x) => ({ ...x, geo: geo[x.o.id] })), domov, opt) : []), [naRade, geo, domov, opt.maxStanic, opt.maxKm])

  async function doKalendare(v, i) {
    const datum = den[i]
    if (!datum) return say('Vyberte den výjezdu.')
    for (const m of v.mista) await save('udalosti', { datum, nazev: `Revize ${m.typy.join(', ')}`, typ: 'revize', objekt_id: m.o.id, hotovo: false })
    say(`Výjezd je v kalendáři na ${fmtDate(datum)}.`)
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Plán tras</h1>
          <p>Revize, které jsou na řadě, seskupené do výjezdů po blízkých stanicích. Výjezdy začínají a končí doma{adresaDomu ? ` (${adresaDomu})` : ''}.</p>
        </div>
      </div>
      <div className="bar">
        <select className="select" value={opt.horizont} onChange={(e) => setOpt({ ...opt, horizont: e.target.value })} aria-label="Období">
          <option value="rok">Do konce roku (co letos chybí)</option>
          <option value="1">Termín do 1 měsíce</option>
          <option value="3">Termín do 3 měsíců</option>
          <option value="6">Termín do 6 měsíců</option>
        </select>
        <select className="select" value={opt.klient} onChange={(e) => setOpt({ ...opt, klient: e.target.value })} aria-label="Klient">
          <option value="">Všichni klienti</option>
          {[...new Set(db.revize.filter((r) => r.stav !== 'archiv').map((r) => idx.objekt[r.objekt_id]?.klient_id).filter(Boolean))].map((id) => db.klienti.find((k) => k.id === id)).filter(Boolean).sort((a, b) => (a.zkratka || a.nazev).localeCompare(b.zkratka || b.nazev, 'cs')).map((k) => <option key={k.id} value={k.id}>{k.zkratka || k.nazev}</option>)}
        </select>
        <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Stanic na výjezd
          <input className="input" type="number" min="1" max="12" style={{ width: 70 }} value={opt.maxStanic} onChange={(e) => setOpt({ ...opt, maxStanic: Math.max(1, Number(e.target.value)) })} />
        </label>
        <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Max. km mezi stanicemi
          <input className="input" type="number" min="5" max="200" style={{ width: 80 }} value={opt.maxKm} onChange={(e) => setOpt({ ...opt, maxKm: Math.max(1, Number(e.target.value)) })} />
        </label>
      </div>

      {(chybi.length > 0 || geoStav) && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2>Poloha stanic</h2>
          <p style={{ marginTop: 0 }}>{chybi.length ? `U ${chybi.length} míst ještě neznám polohu. Dohledám ji jednou z adres (OpenStreetMap, asi ${Math.ceil(chybi.length * 1.2)} s) a uložím.` : ''}</p>
          {geoStav && <div className="small">{geoStav}</div>}
          {chybi.length > 0 && <button className="btn" disabled={!!geoStav && geoStav.startsWith('Hledám')} onClick={dohledat}>Dohledat polohu</button>}
        </section>
      )}
      {!adresaDomu && <div className="panel err">Chybí vaše adresa (údaje dodavatele), odkud výjezdy začínají.</div>}
      {bezAdresy.length > 0 && <div className="small muted" style={{ marginBottom: 12 }}>Bez adresy (nejsou v plánu): {bezAdresy.map((x) => x.o.nazev).join(', ')}</div>}

      <section className="panel" style={{ marginBottom: 16 }}>
        {!bzEdit ? (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span>Benzín <b>{cenaL ? `${cenaL.toLocaleString('cs-CZ', { minimumFractionDigits: 2 })} Kč/l` : 'cena zatím není'}</b>
              {' '}<span className="small muted">{bz.rucne ? '(zadaná ručně)' : bz.auto ? `(průměr ČR ${fmtDate(bz.auto.datum)}, ${bz.auto.zdroj}, aktualizuje se denně)` : ''}</span></span>
            <span>Spotřeba <b>{spotreba.toLocaleString('cs-CZ')} l/100 km</b></span>
            <button className="link small" onClick={() => setBzEdit({ rucne: bz.rucne ?? '', spotreba })}>Změnit</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="small">Vlastní cena benzínu (Kč/l)<input className="input" style={{ width: 150 }} inputMode="decimal" placeholder={bz.auto ? `automaticky ${bz.auto.cena}` : 'např. 38,50'} value={bzEdit.rucne} onChange={(e) => setBzEdit({ ...bzEdit, rucne: e.target.value })} /></label>
            <label className="small">Spotřeba (l/100 km)<input className="input" style={{ width: 110 }} type="number" step="0.1" value={bzEdit.spotreba} onChange={(e) => setBzEdit({ ...bzEdit, spotreba: e.target.value })} /></label>
            <button className="btn sm" onClick={ulozitBenzin}>Uložit</button>
            <button className="btn ghost sm" onClick={() => setBzEdit(null)}>Zrušit</button>
            <span className="small muted" style={{ flexBasis: '100%' }}>Když vlastní cenu necháte prázdnou, počítá se s průměrnou cenou v ČR, která se stahuje každý den.</span>
          </div>
        )}
        {bzStav && <div className="small err" style={{ marginTop: 6 }}>{bzStav}</div>}
      </section>

      {naRade.length === 0 && <div className="panel muted">V tomto období není žádná revize na řadě.</div>}
      {domov && vyjezdy.length > 0 && (
        <p className="small muted">{vyjezdy.length} výjezdů, {vyjezdy.reduce((a, v) => a + v.mista.length, 0)} stanic, celkem asi {vyjezdy.reduce((a, v) => a + v.km, 0).toLocaleString('cs-CZ')} km, revize za {fmtKc(vyjezdy.reduce((a, v) => a + v.cena, 0))}{cenaL ? `, benzín asi ${fmtKc(benzinKc(vyjezdy.reduce((a, v) => a + v.km, 0)))}` : ''}.</p>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        {vyjezdy.map((v, i) => (
          <section key={v.mista.map((m) => m.o.id).join('-')} className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <h2 style={{ margin: 0 }}>Výjezd {i + 1}: {v.mista.length} {v.mista.length === 1 ? 'stanice' : v.mista.length < 5 ? 'stanice' : 'stanic'}</h2>
              <span className="small muted">nejbližší termín {fmtDate(v.termin)}</span>
            </div>
            <div className="trasa-cisla">
              <div><b>{v.km} km</b><span>za den, tam i zpět</span></div>
              <div><b>{fmtKc(v.cena)}</b><span>za revize</span></div>
              {cenaL > 0 && <div><b>{fmtKc(benzinKc(v.km))}</b><span>benzín ({((v.km * spotreba) / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} l)</span></div>}
              {cenaL > 0 && <div className="ok"><b>{fmtKc(v.cena - benzinKc(v.km))}</b><span>zbude po benzínu</span></div>}
            </div>
            <ol style={{ margin: '10px 0', paddingLeft: 20 }}>
              {v.mista.map((m, j) => (
                <li key={m.o.id} className="small" style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span><b>{m.o.nazev}</b> <span className="faint">· {j === 0 ? 'z domova' : 'od předchozí'} {m.kmZ} km · termín {fmtDate(m.termin)}</span></span>
                    <b style={{ whiteSpace: 'nowrap' }}>{fmtKc(m.cena)}</b>
                  </div>
                  {m.polozky.map((p, k) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }} className="muted"><span>{p.typ}</span><span style={{ whiteSpace: 'nowrap' }}>{p.cena ? fmtKc(p.cena) : 'bez ceny'}</span></div>
                  ))}
                  <div className="faint">{m.o.adresa}{m.o.telefon ? ` · ${m.o.telefon}` : ''}</div>
                </li>
              ))}
              <li className="small faint" style={{ listStyle: 'none', marginLeft: -20 }}>Domů {v.kmDomu} km</li>
            </ol>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <a className="btn ghost sm" href={mapy(domov, v.mista)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Trasa v Mapy.cz</a>
              <a className="btn ghost sm" href={google(domov, v.mista)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Trasa v Google Mapách</a>
              <input className="input" type="date" style={{ width: 160 }} value={den[i] || ''} onChange={(e) => setDen({ ...den, [i]: e.target.value })} aria-label="Den výjezdu" />
              <button className="btn sm" onClick={() => doKalendare(v, i)}>Dát do kalendáře</button>
            </div>
          </section>
        ))}
      </div>
      {toast}
    </>
  )
}
