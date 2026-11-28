// Benzín za výjezdy k MOL 2023–2026: tabulka po letech (informativní, do daní nevstupuje)
import { useMemo, useState } from 'react'
import { useData } from '../data'
import { fmtDate, fmtKc } from '../lib'
import { benzinPoLetech, silniceKm, klicDne, ZDROJE, POZNAMKA_CEN } from '../benzinMol'

const n1 = (x) => x.toLocaleString('cs-CZ', { maximumFractionDigits: 0 })

export default function MolBenzin({ spotreba, najit }) {
  const { db, idx, save } = useData()
  const [stav, setStav] = useState(null)
  const [detail, setDetail] = useState(null)
  const v = useMemo(() => benzinPoLetech(db, idx, { spotreba }), [db, idx, spotreba])
  const geo = idx.nast.geo || {}
  const cache = idx.nast['mol-km'] || {}
  if (!(idx.nast['mol-vyjezdy']?.faktury?.length) && !v.vsechnyDny.length) return null

  const chybiObj = v.chybi.map((id) => idx.objekt[id]).filter((o) => o && o.adresa)
  const bezSilnic = [...new Map(v.vsechnyDny.filter((d) => !d.silnice && d.ids.every((id) => geo[id])).map((d) => [klicDne(d.ids), d])).values()]
  const vse = v.roky.reduce((a, r) => ({ km: a.km + r.km, litry: a.litry + r.litry, kc: a.kc + r.kc, dni: a.dni + r.pocetDni }), { km: 0, litry: 0, kc: 0, dni: 0 })

  async function dohledat() {
    const nove = { ...geo }
    const nenalezeno = []
    for (let i = 0; i < chybiObj.length; i++) {
      setStav(`Hledám polohu ${i + 1} z ${chybiObj.length}: ${chybiObj[i].nazev}`)
      try { const g = await najit(chybiObj[i].adresa); if (g) nove[chybiObj[i].id] = g; else nenalezeno.push(chybiObj[i].nazev) } catch { nenalezeno.push(chybiObj[i].nazev) }
      await new Promise((res) => setTimeout(res, 1100))
    }
    const row = (db.nastaveni || []).find((r) => r.klic === 'geo')
    await save('nastaveni', row ? { id: row.id, hodnota: nove } : { klic: 'geo', hodnota: nove })
    setStav(nenalezeno.length ? `Nenašel jsem: ${nenalezeno.join(', ')}. Opravte adresu u stanice v Klientech.` : null)
  }

  async function poSilnicich() {
    const nove = { ...cache }
    let chyb = 0
    for (let i = 0; i < bezSilnic.length; i++) {
      setStav(`Počítám trasu po silnicích ${i + 1} z ${bezSilnic.length}`)
      try { nove[klicDne(bezSilnic[i].ids)] = await silniceKm(bezSilnic[i].ids.map((id) => geo[id]), v.domov) } catch { chyb++ }
      await new Promise((res) => setTimeout(res, 1100))
      if ((i + 1) % 25 === 0 || i === bezSilnic.length - 1) {
        const row = (db.nastaveni || []).find((r) => r.klic === 'mol-km')
        await save('nastaveni', row ? { id: row.id, hodnota: nove } : { klic: 'mol-km', hodnota: nove })
      }
    }
    setStav(chyb ? `Hotovo, ${chyb} tras se nepodařilo spočítat, u nich zůstává odhad vzdušnou čarou × 1,3.` : null)
  }

  const rokDetail = v.roky.find((r) => r.rok === detail)

  return (
    <section className="panel" style={{ marginTop: 24 }}>
      <h2 style={{ marginTop: 0 }}>Benzín za výjezdy k MOL 2023–2026</h2>
      <p className="small" style={{ marginTop: 0 }}>
        Každý den výjezdu: z domova po stanicích v nejkratším pořadí a zpět, {String(spotreba).replace('.', ',')} l/100 km, průměrná cena Natural 95 za daný rok.
        Jen pro přehled, na dani to nic nemění (paušál 80 % výdaje už zahrnuje).
      </p>

      {!v.domov && <div className="small err" style={{ marginBottom: 8 }}>Chybí poloha domova. Nahoře klikni na Dohledat polohu.</div>}
      {(chybiObj.length > 0 || bezSilnic.length > 0 || stav) && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0 12px' }}>
          {chybiObj.length > 0 && <button className="btn sm" disabled={!!stav} onClick={dohledat}>Dohledat polohu {chybiObj.length} stanic (asi {Math.ceil(chybiObj.length * 1.3 / 60)} min)</button>}
          {chybiObj.length === 0 && bezSilnic.length > 0 && v.domov && <button className="btn sm" disabled={!!stav} onClick={poSilnicich}>Spočítat {bezSilnic.length} tras po silnicích (asi {Math.ceil(bezSilnic.length * 1.4 / 60)} min)</button>}
          {stav && <span className="small">{stav}</span>}
          {!stav && chybiObj.length > 0 && <span className="small muted">U {chybiObj.length} stanic neznám polohu, km jsou zatím neúplné.</span>}
          {!stav && chybiObj.length === 0 && bezSilnic.length > 0 && <span className="small muted">Zatím odhad vzdušnou čarou × 1,3. Po silnicích (OpenStreetMap) to bude přesnější.</span>}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="dane-t">
          <thead><tr><th>Rok</th><th className="r">Dní výjezdů</th><th className="r">Km</th><th className="r">Litrů</th><th className="r">Kč/l (ČSÚ)</th><th className="r">Benzín</th><th></th></tr></thead>
          <tbody>
            {v.roky.map((r) => (
              <tr key={r.rok}>
                <td>{r.rok}</td>
                <td className="r">{r.zdroj === 'faktury' ? `asi ${r.pocetDni}` : r.pocetDni}</td>
                <td className="r">{n1(r.km)}</td>
                <td className="r">{n1(r.litry)}</td>
                <td className="r"><a href={ZDROJE[r.rok]} target="_blank" rel="noreferrer">{r.cena.toLocaleString('cs-CZ', { minimumFractionDigits: 2 })}</a>{POZNAMKA_CEN[r.rok] ? <span className="faint">*</span> : null}</td>
                <td className="r b">{fmtKc(r.kc)}</td>
                <td><button className="link small" onClick={() => setDetail(detail === r.rok ? null : r.rok)}>{detail === r.rok ? 'skrýt' : 'dny'}</button></td>
              </tr>
            ))}
            <tr className="sum"><td>Celkem</td><td className="r">{vse.dni}</td><td className="r">{n1(vse.km)}</td><td className="r">{n1(vse.litry)}</td><td></td><td className="r">{fmtKc(vse.kc)}</td><td></td></tr>
          </tbody>
        </table>
      </div>

      {rokDetail && (
        <div style={{ marginTop: 10 }}>
          <h3 style={{ margin: '0 0 6px' }}>{rokDetail.rok}: {rokDetail.zdroj === 'faktury' ? 'výjezdy podle faktur' : 'dny podle revizních zpráv'}</h3>
          <table className="dane-t list">
            <tbody>
              {rokDetail.dny.map((d) => (
                <tr key={d.datum + (d.cislo || '')}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(d.datum)}{d.cislo ? <span className="faint"> fa {d.cislo}</span> : null}</td>
                  <td>{d.ids.map((id) => idx.objekt[id]?.nazev?.match(/MOL\s*\d+/i)?.[0] || id).join(', ')}</td>
                  <td className="r">{d.km} km{d.silnice ? '' : <span className="faint"> odhad</span>}</td>
                  <td className="r">{fmtKc(Math.round((d.km * spotreba) / 100 * rokDetail.cena))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="dane-note" style={{ marginTop: 10 }}>
        2025 a 2026: dny a stanice podle data revize ve zprávách. 2023 a 2024 zprávy v aplikaci nejsou, proto beru stanice z faktur (jedna faktura ≈ jeden výjezd)
        {v.kmF > 0 && Math.abs(v.koef - 1) > 0.02 ? ` a km násobím ${v.koef.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })}×, protože v roce 2025 vyšlo podle zpráv ${n1(v.kmZ)} km a podle faktur jen ${n1(v.kmF)} km (víc dní než faktur)` : ''}.
        Ceny jsou průměrem týdenních cen Natural 95 za celou ČR z ročních zpráv ČSÚ (odkazy v tabulce){Object.keys(POZNAMKA_CEN).length ? `; * ${Object.entries(POZNAMKA_CEN).map(([r, t]) => `${r} ${t}`).join(', ')}` : ''}.
      </p>
    </section>
  )
}
