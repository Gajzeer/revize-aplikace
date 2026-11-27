import { useMemo, useState } from 'react'
import { useData } from '../data'
import { TODAY, fmtDate, fmtKc } from '../lib'
import { useToast } from '../ui'
import { celkovaDan, odlozit } from '../danovy'

// Parametry pro OSVČ – vedlejší činnost, paušální výdaje 80 %
const PARAM = {
  2022: { rozhodna: 93387, vz: 0.5 },
  2023: { rozhodna: 98997, vz: 0.5 },
  2024: { rozhodna: 105520, vz: 0.55 },
  2025: { rozhodna: 111736, vz: 0.55 },
  2026: { rozhodna: 117521, vz: 0.55 },
}
const par = (y) => PARAM[y] || PARAM[Math.max(...Object.keys(PARAM).map(Number))]
const up = (n) => Math.ceil(n)
const kc = (n) => `${Math.round(n).toLocaleString('cs-CZ').replace(/\s/g, ' ')} Kč`

// Do kterého roku příjem patří: rozhoduje den, kdy peníze přišly
export function rokPrijmu(f) {
  if (f.datum_zaplaceni) return Number(f.datum_zaplaceni.slice(0, 4))
  if (f.zaplaceno === false) return null
  return Number((f.datum_vystaveni || '').slice(0, 4)) || f.rok
}

export function vypocet(prijmy, y, zal = {}) {
  const vydaje = Math.min(prijmy * 0.8, 1600000)
  const zisk = prijmy - vydaje
  const zakladDane = Math.floor(zisk / 100) * 100
  const dan = zakladDane * 0.15
  const p = par(y)
  const spPovinne = zisk > p.rozhodna
  const spVZ = spPovinne ? up(zisk * p.vz) : 0
  const sp = up(spVZ * 0.292)
  const zpVZ = up(zisk * 0.5)
  const zp = up(zpVZ * 0.135)
  return {
    prijmy, vydaje, zisk, zakladDane, dan, rozhodna: p.rozhodna, koef: p.vz,
    spPovinne, spVZ, sp, spDoplatek: sp - (Number(zal.sp) || 0), spZaloha: spPovinne ? up((spVZ / 12) * 0.292) : 0,
    zpVZ, zp, zpDoplatek: zp - (Number(zal.zp) || 0), zpZaloha: up((zpVZ / 12) * 0.135),
  }
}

export default function Dane() {
  const { db, idx, save } = useData()
  const [toast, say] = useToast()
  const Y0 = TODAY().getFullYear()
  const roky = [...new Set(db.faktury.map(rokPrijmu).filter(Boolean))].sort((a, b) => b - a)
  // v první polovině roku je aktuální přiznání za loňský rok
  const [y, setY] = useState(() => (TODAY().getMonth() < 6 ? Y0 - 1 : Y0))
  const klic = `dane-${y}`
  const nrow = (db.nastaveni || []).find((r) => r.klic === klic)
  const [zal, setZal] = useState(null)
  const z = zal?.y === y ? zal : { y, ...(nrow?.hodnota || {}) }

  const f = useMemo(() => {
    const prij = db.faktury.filter((x) => rokPrijmu(x) === y).sort((a, b) => (a.datum_vystaveni || '').localeCompare(b.datum_vystaveni || ''))
    const nezapl = db.faktury.filter((x) => x.zaplaceno === false && Number((x.datum_vystaveni || '').slice(0, 4)) === y)
    const prevedene = db.faktury.filter((x) => x.datum_zaplaceni && Number(x.datum_vystaveni?.slice(0, 4)) === y && rokPrijmu(x) !== y)
    return { prij, nezapl, prevedene, sum: prij.reduce((a, x) => a + Number(x.castka || 0), 0) }
  }, [db, y])
  const v = vypocet(f.sum, y, z)
  const probiha = y >= Y0

  async function ulozit() {
    try {
      const { y: _y, ...rest } = z
      const num = (x) => (x === '' || x == null ? undefined : Number(x))
      const hodnota = {
        ...(nrow?.hodnota || {}), ...rest,
        sp: Number(z.sp) || 0, zp: Number(z.zp) || 0, poznamka: z.poznamka || '',
        zam_prijem: num(z.zam_prijem), zam_zaloha: num(z.zam_zaloha), uroky: num(z.uroky), ucetni: num(z.ucetni), osvc_prijmy: num(z.osvc_prijmy),
        deti: (z.deti || []).map((m) => Number(m) || 0).filter((m, i, a) => m || i < a.length - 1),
      }
      await save('nastaveni', nrow ? { id: nrow.id, hodnota } : { klic, hodnota })
      say('Uloženo')
    } catch (e) {
      say('Uložení selhalo: ' + e.message)
    }
  }

  return (
    <>
      <div className="head no-print">
        <div>
          <h1>Daňové podklady</h1>
          <p>Čísla do daňového přiznání a do přehledů pro ČSSZ a zdravotní pojišťovnu. Vedlejší činnost, výdaje paušálem 80 %.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="select" value={y} onChange={(e) => setY(Number(e.target.value))} aria-label="Rok">
            {[...new Set([Y0, ...roky])].sort((a, b) => b - a).map((r) => <option key={r} value={r}>za rok {r}</option>)}
          </select>
          <button className="btn" onClick={() => { const t = document.title; document.title = `Daňové podklady ${y}`; print(); document.title = t }}>Tisk / PDF</button>
        </div>
      </div>

      {probiha && <div className="panel small no-print" style={{ marginBottom: 14 }}>Rok {y} ještě běží, čísla jsou průběžná. Přiznání a přehledy za něj se podávají až v roce {y + 1}.</div>}

      <section className="panel no-print" style={{ marginBottom: 16 }}>
        <h2>Zálohy zaplacené za rok {y}</h2>
        <div className="g-four" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <label>Sociální pojištění (ČSSZ)<input className="input" type="number" min="0" value={z.sp ?? ''} onChange={(e) => setZal({ ...z, sp: e.target.value })} placeholder="0" /></label>
          <label>Zdravotní pojištění<input className="input" type="number" min="0" value={z.zp ?? ''} onChange={(e) => setZal({ ...z, zp: e.target.value })} placeholder="0" /></label>
          <label style={{ gridColumn: 'span 2' }}>Poznámka<input className="input" value={z.poznamka || ''} onChange={(e) => setZal({ ...z, poznamka: e.target.value })} /></label>
        </div>
        <div className="actions" style={{ marginTop: 10 }}><button className="btn sm" onClick={ulozit}>Uložit zálohy</button></div>
      </section>

      <Celkem y={y} z={z} setZal={setZal} ulozit={ulozit} prijmyFaktury={f.sum} db={db} />

      <style>{'@media print { @page { size: A4; margin: 14mm 14mm 16mm; } }'}</style>
      <div className="sheet-wrap">
        <article className="sheet dane">
          <h1 className="dane-h">Podklady pro přiznání a přehledy za rok {y}</h1>
          <p className="dane-sub">{idx.nast.dodavatel?.jmeno}, IČO {idx.nast.dodavatel?.ico} · samostatná činnost vedlejší (při zaměstnání) · výdaje 80 % z příjmů · neplátce DPH</p>

          <h2>Příjmy ze samostatné činnosti</h2>
          <table className="dane-t">
            <tbody>
              <tr><td>Příjmy (peníze přijaté v roce {y}, {f.prij.length} faktur)</td><td className="r b">{kc(v.prijmy)}</td></tr>
              <tr><td>Výdaje paušálem 80 %</td><td className="r">{kc(v.vydaje)}</td></tr>
              <tr><td>Rozdíl příjmů a výdajů (zisk)</td><td className="r b">{kc(v.zisk)}</td></tr>
            </tbody>
          </table>

          <h2>1. Daňové přiznání (Příloha č. 1, § 7)</h2>
          <table className="dane-t">
            <tbody>
              <tr><td>ř. 101 Příjmy</td><td className="r b">{kc(v.prijmy)}</td></tr>
              <tr><td>ř. 102 Výdaje (procentem z příjmů, 80 %)</td><td className="r b">{kc(v.vydaje)}</td></tr>
              <tr><td>ř. 104 Rozdíl mezi příjmy a výdaji (bez úprav je to i dílčí základ daně § 7, ř. 113)</td><td className="r b">{kc(v.zisk)}</td></tr>
              <tr><td>Daň 15 % z této části (odhad, slevu na poplatníka uplatňuje zaměstnavatel)</td><td className="r">{kc(v.dan)}</td></tr>
            </tbody>
          </table>
          <p className="dane-note">Příjmy ze zaměstnání (§ 6) se doplní z Potvrzení o zdanitelných příjmech od zaměstnavatele. Čísla řádků odpovídají tiskopisu 25 5405, u nového tiskopisu je zkontrolujte.</p>

          <h2>2. Přehled pro ČSSZ (sociální pojištění)</h2>
          <table className="dane-t">
            <tbody>
              <tr><td>Příjmy / výdaje / rozdíl</td><td className="r">{kc(v.prijmy)} / {kc(v.vydaje)} / {kc(v.zisk)}</td></tr>
              <tr><td>Druh činnosti</td><td className="r">vedlejší po celý rok (zaměstnání)</td></tr>
              <tr><td>Rozhodná částka pro vedlejší činnost {y}</td><td className="r">{kc(v.rozhodna)}</td></tr>
              {v.spPovinne ? (
                <>
                  <tr><td>Vyměřovací základ ({Math.round(v.koef * 100)} % ze zisku)</td><td className="r b">{kc(v.spVZ)}</td></tr>
                  <tr><td>Pojistné 29,2 %</td><td className="r b">{kc(v.sp)}</td></tr>
                  <tr><td>Zaplacené zálohy</td><td className="r">{kc(Number(z.sp) || 0)}</td></tr>
                  <tr className={v.spDoplatek > 0 ? 'pay' : ''}><td>{v.spDoplatek >= 0 ? 'Doplatek' : 'Přeplatek'}</td><td className="r b">{kc(Math.abs(v.spDoplatek))}</td></tr>
                  <tr><td>Měsíční záloha na další období (odhad)</td><td className="r">{kc(v.spZaloha)}</td></tr>
                </>
              ) : (
                <tr><td>Zisk je pod rozhodnou částkou: pojistné se neplatí, přehled se jen podá.</td><td className="r b">0 Kč</td></tr>
              )}
            </tbody>
          </table>

          <h2>3. Přehled pro zdravotní pojišťovnu</h2>
          <table className="dane-t">
            <tbody>
              <tr><td>Vyměřovací základ (50 % ze zisku, při zaměstnání bez minima)</td><td className="r b">{kc(v.zpVZ)}</td></tr>
              <tr><td>Pojistné 13,5 %</td><td className="r b">{kc(v.zp)}</td></tr>
              <tr><td>Zaplacené zálohy</td><td className="r">{kc(Number(z.zp) || 0)}</td></tr>
              <tr className={v.zpDoplatek > 0 ? 'pay' : ''}><td>{v.zpDoplatek >= 0 ? 'Doplatek' : 'Přeplatek'}</td><td className="r b">{kc(Math.abs(v.zpDoplatek))}</td></tr>
              <tr><td>Měsíční záloha na další období (odhad)</td><td className="r">{kc(v.zpZaloha)}</td></tr>
            </tbody>
          </table>

          <h2>Termíny za rok {y}</h2>
          <ul className="dane-ul">
            <li>Daňové přiznání: papírově do 1. 4. {y + 1}, elektronicky do 1. 5. {y + 1} (připadne-li na svátek nebo víkend, posouvá se na další pracovní den).</li>
            <li>Přehled ČSSZ a přehled pro zdravotní pojišťovnu: do měsíce po lhůtě pro podání přiznání. Doplatky do 8 dnů po podání přehledu.</li>
          </ul>

          {(f.nezapl.length > 0 || f.prevedene.length > 0) && (
            <>
              <h2>Pozor na hranici roku</h2>
              <ul className="dane-ul">
                {f.prevedene.map((x) => <li key={x.id}>Faktura {x.cislo} ({kc(x.castka)}) vystavená v {y}, zaplacená {fmtDate(x.datum_zaplaceni)}: počítá se do roku {rokPrijmu(x)}.</li>)}
                {f.nezapl.map((x) => <li key={x.id}>Faktura {x.cislo} ({kc(x.castka)}) zatím nezaplacená: do příjmů se započte v roce, kdy peníze přijdou.</li>)}
              </ul>
            </>
          )}

          <h2>Seznam příjmů {y}</h2>
          <table className="dane-t list">
            <thead><tr><th>Faktura</th><th>Odběratel</th><th>Vystaveno</th><th>Zaplaceno</th><th className="r">Částka</th></tr></thead>
            <tbody>
              {f.prij.map((x) => (
                <tr key={x.id}>
                  <td>{x.cislo}</td>
                  <td>{idx.klient[x.klient_id]?.zkratka || idx.klient[x.klient_id]?.nazev || ''}</td>
                  <td>{fmtDate(x.datum_vystaveni)}</td>
                  <td>{x.datum_zaplaceni ? fmtDate(x.datum_zaplaceni) : '–'}</td>
                  <td className="r">{fmtKc(x.castka)}</td>
                </tr>
              ))}
              <tr className="sum"><td colSpan="4">Celkem</td><td className="r">{fmtKc(f.sum)}</td></tr>
            </tbody>
          </table>
          {z.poznamka && <p className="dane-note">Poznámka: {z.poznamka}</p>}
          <p className="dane-note">Výpočet je pomůcka podle údajů v aplikaci. Před podáním ho porovnejte s tiskopisy a aktuálními částkami pro daný rok.</p>
        </article>
      </div>
      {toast}
    </>
  )
}

// ---------- Celý rok: zaměstnání + podnikání ----------
const pct = (x) => `${(x * 100).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %`

function Celkem({ y, z, setZal, ulozit, prijmyFaktury, db }) {
  const [otevrit, setOtevrit] = useState(false)
  const data = (yy) => (db.nastaveni || []).find((r) => r.klic === `dane-${yy}`)?.hodnota || {}
  const osvc = z.osvc_prijmy != null && z.osvc_prijmy !== '' ? Number(z.osvc_prijmy) : prijmyFaktury
  const c = celkovaDan(y, { ...z, osvc_prijmy: osvc })
  const vys = z.vysledek || {}
  const maVysledek = vys.dan != null
  const vyplneno = Number(z.zam_prijem) > 0
  const loni = data(y - 1)
  const set = (k) => (e) => setZal({ ...z, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const deti = z.deti?.length ? z.deti : []
  const roky = [...new Set((db.nastaveni || []).filter((r) => /^dane-\d{4}$/.test(r.klic) && Number(r.hodnota?.zam_prijem) > 0).map((r) => Number(r.klic.slice(5))))].sort()
  const fakturyRok = (yy) => db.faktury.filter((x) => rokPrijmu(x) === yy).reduce((a, x) => a + Number(x.castka || 0), 0)

  return (
    <>
      <section className="panel" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <h2 style={{ margin: 0 }}>Celý rok {y}: zaměstnání a podnikání</h2>
          <button className="link small no-print" onClick={() => setOtevrit(!otevrit)}>{otevrit ? 'Skrýt údaje' : vyplneno ? 'Upravit údaje' : 'Doplnit údaje'}</button>
        </div>
        {z.zdroj && <div className="small faint" style={{ marginTop: 4 }}>Údaje z dokladů: {z.zdroj}</div>}

        {(otevrit || !vyplneno) && (
          <div className="no-print" style={{ marginTop: 12 }}>
            <div className="g-four" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
              <label>Příjem ze zaměstnání (ř. 1 potvrzení)<input className="input" type="number" value={z.zam_prijem ?? ''} onChange={set('zam_prijem')} /></label>
              <label>Sražené zálohy na daň (ř. 6)<input className="input" type="number" value={z.zam_zaloha ?? ''} onChange={set('zam_zaloha')} /></label>
              <label>Příjmy z podnikání podle přiznání<input className="input" type="number" value={z.osvc_prijmy ?? ''} placeholder={`z faktur: ${Math.round(prijmyFaktury)}`} onChange={set('osvc_prijmy')} /></label>
              <label>Zaplacené úroky z hypotéky<input className="input" type="number" value={z.uroky ?? ''} onChange={set('uroky')} /></label>
              <label>Účetní za přiznání<input className="input" type="number" value={z.ucetni ?? ''} onChange={set('ucetni')} /></label>
            </div>
            <div className="g-four" style={{ marginTop: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems: 'end' }}>
              {[0, 1, 2].map((i) => (
                <label key={i}>{i + 1}. dítě (měsíců)<input className="input" type="number" min="0" max="12" value={deti[i] ?? ''} onChange={(e) => { const d = [...deti]; d[i] = e.target.value; setZal({ ...z, deti: d }) }} /></label>
              ))}
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!z.manzelka} onChange={set('manzelka')} /> Sleva na manželku</label>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              {!vyplneno && loni.zam_prijem && <button className="btn ghost sm" onClick={() => setZal({ ...z, deti: loni.deti?.map((m) => (m ? 12 : 0)), manzelka: loni.manzelka, uroky: loni.uroky, ucetni: loni.ucetni, zam_prijem: loni.zam_prijem })}>Převzít z roku {y - 1}</button>}
              <button className="btn sm" onClick={async () => { await ulozit(); setOtevrit(false) }}>Uložit</button>
            </div>
          </div>
        )}

        {vyplneno && (
          <>
            <div className="dane-dlazdice">
              <div><b>{kc(c.hrube)}</b><span>hrubý příjem celkem<br />{kc(c.zam)} zaměstnání, {kc(c.osvc)} revize</span></div>
              <div><b>{kc(c.cisty)}</b><span>čistého po dani a odvodech<br />{kc(c.cisty / 12)} měsíčně</span></div>
              {c.danKonecna >= 0
                ? <div><b>{kc(c.danKonecna)}</b><span>daň z příjmů za rok<br />efektivně {pct(c.sazba)} z hrubého</span></div>
                : <div className="ok"><b>0 Kč</b><span>daň z příjmů za rok<br />slevy a děti ji smazaly, bonus {kc(-c.danKonecna)}</span></div>}
              <div className={c.vysledek > 0 ? 'pay' : 'ok'}><b>{c.vysledek > 0 ? '' : '+'}{kc(Math.abs(c.vysledek))}</b><span>{c.vysledek > 0 ? 'doplatit finančnímu úřadu' : 'přeplatek, vrátí finanční úřad'}{maVysledek ? (Math.abs(-vys.dan - (-c.vysledek)) <= 2 ? ', sedí s přiznáním' : `, v přiznání ${vys.dan > 0 ? 'doplatek' : 'přeplatek'} ${kc(Math.abs(vys.dan))}`) : ' (výpočet)'}</span></div>
            </div>

            <table className="dane-t" style={{ marginTop: 12 }}>
              <tbody>
                <tr><td>Dílčí základ ze zaměstnání (§ 6)</td><td className="r">{kc(c.zam)}</td></tr>
                <tr><td>Dílčí základ z podnikání (§ 7, 20 % z příjmů {kc(c.osvc)})</td><td className="r">{kc(c.dzd7)}</td></tr>
                {c.uroky > 0 && <tr><td>Odpočet úroků z hypotéky (max. 150 000 Kč)</td><td className="r">− {kc(c.uroky)}</td></tr>}
                <tr><td>Základ daně zaokrouhlený</td><td className="r b">{kc(c.zaklad)}</td></tr>
                <tr><td>Daň 15 %</td><td className="r">{kc(c.dan)}</td></tr>
                <tr><td>Slevy: na poplatníka{z.manzelka ? ' a na manželku' : ''}</td><td className="r">− {kc(Math.min(c.slevy, c.dan))}</td></tr>
                {c.zvyhodneni > 0 && <tr><td>Daňové zvýhodnění na děti ({c.deti.filter(Boolean).length})</td><td className="r">− {kc(c.zvyhodneni)}</td></tr>}
                <tr><td>Daň po slevách{c.danKonecna < 0 ? ' (daňový bonus)' : ''}</td><td className="r b">{kc(c.danKonecna)}</td></tr>
                <tr><td>Už srazil zaměstnavatel</td><td className="r">− {kc(c.zalohy)}</td></tr>
                <tr className={c.vysledek > 0 ? 'pay' : ''}><td>{c.vysledek > 0 ? 'Doplatek daně' : 'Přeplatek daně'}</td><td className="r b">{kc(Math.abs(c.vysledek))}</td></tr>
              </tbody>
            </table>

            <h3 style={{ margin: '16px 0 6px' }}>Co z toho plyne</h3>
            <ul className="dane-ul">
              <li>Po daních a pojistném ti z revizí zůstalo zhruba <b>{kc(c.cistyOsvc)}</b> ({kc(c.cistyOsvc / 12)} měsíčně), tedy {pct(c.osvc ? c.cistyOsvc / c.osvc : 0)} z vyfakturovaného. Skutečné náklady jako nafta nebo materiál v tom odečtené nejsou. Daň, která připadá na podnikání, je {kc(c.danZPodnikani)}, pojistné {kc(c.sp + c.zp)}{c.ucetni ? `, účetní ${kc(c.ucetni)}` : ''}.</li>
              <li>Z každé zaplacené faktury si odkládej asi <b>{pct(odlozit(y))}</b> na daň a pojistné. Při {kc(c.osvc)} je to {kc(c.osvc * odlozit(y))} za rok.</li>
              {c.uroky > 0 && <li>Úroky z hypotéky ti snížily daň o <b>{kc(c.usporaUroky)}</b>.{Number(z.uroky) > 150000 ? ' Odečíst jde nejvýš 150 000 Kč, zbytek propadá.' : ''}</li>}
              {c.zvyhodneni > 0 && <li>Na dětech ušetříš {kc(c.zvyhodneni)}{z.manzelka ? `, sleva na manželku dělá ${kc(24840)}` : ''}.</li>}
              <li>Ze zaměstnání ti zaměstnavatel strhl na sociální a zdravotní odhadem {kc(c.zamOdvody)}, z podnikání platíš {kc(c.sp)} sociální a {kc(c.zp)} zdravotní{vys.sp != null ? ` (podle přehledů doplatek ${kc(vys.sp)} ČSSZ a ${kc(vys.zp)} ZP)` : vys.zp != null ? ` (podle přehledu doplatek ZP ${kc(vys.zp)})` : ''}.</li>
              {Math.abs(prijmyFaktury - c.osvc) > 1000 && z.osvc_prijmy && <li>Podle faktur v aplikaci přišlo v roce {y} {kc(prijmyFaktury)}, v přiznání je {kc(c.osvc)}{z.osvc_odvozeno ? ' (dopočteno z přehledu pro pojišťovnu)' : ''}. Rozdíl {kc(prijmyFaktury - c.osvc)} stojí za kontrolu (datum zaplacení faktur na přelomu roku).</li>}
            </ul>
          </>
        )}
      </section>

      {roky.length > 0 && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2>Příjmy po letech</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="dane-t">
              <thead><tr><th>Rok</th><th className="r">Zaměstnání</th><th className="r">Revize</th><th className="r">Celkem hrubé</th><th className="r">Daň</th><th className="r">Čistý příjem</th><th className="r">Měsíčně</th><th className="r">Přiznání</th></tr></thead>
              <tbody>
                {roky.map((yy) => {
                  const h = data(yy)
                  const r = celkovaDan(yy, { ...h, osvc_prijmy: h.osvc_prijmy ?? fakturyRok(yy) })
                  const d = h.vysledek?.dan ?? r.vysledek
                  return (
                    <tr key={yy} className={yy === y ? 'sum' : ''}>
                      <td>{yy}</td><td className="r">{kc(r.zam)}</td><td className="r">{kc(r.osvc)}</td><td className="r b">{kc(r.hrube)}</td>
                      <td className="r">{r.danKonecna < 0 ? `bonus ${kc(-r.danKonecna)}` : kc(r.danKonecna)}</td><td className="r b">{kc(r.cisty)}</td><td className="r">{kc(r.cisty / 12)}</td>
                      <td className="r">{d > 0 ? `doplatek ${kc(d)}` : `přeplatek ${kc(-d)}`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="dane-note">Čistý příjem = hrubý příjem − daň − odvody zaměstnance (odhad) − pojistné z podnikání − účetní.</p>
        </section>
      )}
    </>
  )
}
