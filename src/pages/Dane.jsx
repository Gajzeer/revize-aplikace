import { useMemo, useState } from 'react'
import { useData } from '../data'
import { TODAY, fmtDate, fmtKc } from '../lib'
import { useToast } from '../ui'

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
      const hodnota = { sp: Number(z.sp) || 0, zp: Number(z.zp) || 0, poznamka: z.poznamka || '' }
      await save('nastaveni', nrow ? { id: nrow.id, hodnota } : { klic, hodnota })
      say('Zaplacené zálohy uloženy')
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
