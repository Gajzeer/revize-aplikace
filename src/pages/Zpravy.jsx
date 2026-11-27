import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data'
import { TODAY, addMonths, fmtDate, iso, norm, parse, supabase } from '../lib'
import { Modal, useToast } from '../ui'
import { kvGet, kvSet } from '../offline'
import { nahratSablony, nazevSouboru, stahnoutWord, wordBlob, zdrojSablony } from '../sablony'
import { OdeslatEmail } from '../posta'
import { evSDatem, prepisData, prepisEv } from '../datumy'
import { odhlasitMicrosoft, prihlasenMicrosoft, wordNaPdf } from '../pdf'

export const TYPY_Z = {
  SP: 'Spotřebiče',
  NO: 'Nouzové osvětlení',
  'ML-P': 'Myčka portálová',
  'ML-R': 'Myčka ruční',
  'ML-PR': 'Myčky (portál + ruční)',
  ST: 'Stavba / elektroinstalace',
  NN: 'Elektroinstalace NN',
  JINE: 'Jiné',
}
const STAVY = { rozpracovano: 'Rozpracovaná', hotovo: 'Hotová', predano: 'Předaná' }

// datum v textu zprávy: 29.04.2026, 29.4.2026, 29. 4. 2026
const RE_DATE = /\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\b/g
const toIso = (d, m, y) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const czDate = (s) => { const d = parse(s); return d ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` : '' }

function mapText(bloky, fn) {
  return bloky.map((b) => (b.t === 'p' ? { ...b, x: fn(b.x) } : { ...b, r: b.r.map((row) => row.map((c) => ({ ...c, x: fn(c.x) }))) }))
}
function allText(bloky) {
  return bloky.map((b) => (b.t === 'p' ? b.x : b.r.map((r) => r.map((c) => c.x).join(' ')).join('\n'))).join('\n')
}
// nahradí v textu všechna data, která odpovídají staré hodnotě (v libovolném zápisu)
function replaceDate(txt, oldIso, newIso) {
  if (!oldIso || !newIso || oldIso === newIso) return txt
  return txt.replace(RE_DATE, (m, d, mo, y) => (toIso(d, mo, y) === oldIso ? czDate(newIso) : m))
}

export default function Zpravy({ sub }) {
  if (sub?.[0]) return <Editor key={sub[0]} id={Number(sub[0])} />
  return <Seznam />
}

function Seznam() {
  const { db, idx } = useData()
  const [q, setQ] = useState('')
  const [typ, setTyp] = useState('')
  const [rok, setRok] = useState('')
  const [hrom, setHrom] = useState(false)
  const roky = [...new Set(db.zpravy.map((z) => (z.datum_revize || '').slice(0, 4)).filter(Boolean))].sort().reverse()
  const list = useMemo(() => {
    const t = norm(q)
    return db.zpravy
      .filter((z) => !typ || z.typ === typ)
      .filter((z) => !rok || (z.datum_revize || '').startsWith(rok))
      .filter((z) => !t || norm(`${z.nazev} ${z.ev_cislo} ${idx.objekt[z.objekt_id]?.nazev}`).includes(t))
      .sort((a, b) => (b.datum_revize || '').localeCompare(a.datum_revize || '') || a.nazev.localeCompare(b.nazev, 'cs'))
  }, [db, q, typ, rok])

  return (
    <>
      <div className="head">
        <div>
          <h1>Revizní zprávy</h1>
          <p>{db.zpravy.length} zpráv. Novou zprávu vytvoříte nejrychleji z loňské: otevřete ji a dejte „Nová zpráva z této“.</p>
        </div>
        <button className="btn" onClick={() => setHrom(true)}>Vytvořit letošní zprávy</button>
      </div>
      {hrom && <Hromadne onClose={() => setHrom(false)} />}
      <SablonyPanel />
      <PdfPanel />
      {db.zpravy.length === 0 && (
        <section className="panel" style={{ marginBottom: 16 }}>
          <h2>Zatím žádné zprávy</h2>
          <p style={{ margin: 0 }}>Vaše zprávy z roku 2026 jsou připravené v souboru <b>zpravy-2026.json</b> (složka CLAUDE\REVIZE APLIKACE). Nahrajte ho v <a href="#/import">Nahrát úpravy ze souboru</a>.</p>
        </section>
      )}
      <div className="bar">
        <input className="input" placeholder="Hledat stanici, objekt nebo číslo zprávy" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={typ} onChange={(e) => setTyp(e.target.value)} aria-label="Druh">
          <option value="">Všechny druhy</option>
          {Object.entries(TYPY_Z).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="select" value={rok} onChange={(e) => setRok(e.target.value)} aria-label="Rok">
          <option value="">Všechny roky</option>
          {roky.map((r) => <option key={r}>{r}</option>)}
        </select>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Zpráva</th><th className="hide-m">Druh</th><th>Revize</th><th className="hide-m">Stav</th></tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan="4" className="muted">Nic nenalezeno.</td></tr>}
            {list.slice(0, 300).map((z) => (
              <tr key={z.id} style={{ cursor: 'pointer' }} onClick={() => (location.hash = `#/zpravy/${z.id}`)}>
                <td>
                  <a href={`#/zpravy/${z.id}`} style={{ fontWeight: 600, color: 'var(--ink)' }}>{z.nazev}</a>
                  <div className="small muted">{[idx.objekt[z.objekt_id]?.nazev, z.ev_cislo].filter(Boolean).join(' · ')}{z.vzor ? ' · vzor' : ''}</div>
                </td>
                <td className="hide-m small">{TYPY_Z[z.typ] || z.typ}</td>
                <td className="num">{fmtDate(z.datum_revize)}</td>
                <td className="hide-m small">{STAVY[z.stav] || z.stav}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// Hromadně: pro každou stanici a druh zprávy vezme poslední zprávu z dřívějška a vytvoří z ní letošní
function Hromadne({ onClose }) {
  const { db, idx, reload } = useData()
  const dnes = iso(TODAY())
  const [f, setF] = useState({ objekt: '', datum: dnes, vyp: dnes, pred: dnes })
  const [vyber, setVyber] = useState(null)
  const [prubeh, setPrubeh] = useState(null)
  const Y = f.datum.slice(0, 4)
  const pik = db.klienti.find((k) => k.zkratka === 'PIK')
  const molObj = db.objekty.filter((o) => o.klient_id === pik?.id).sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs', { numeric: true }))
  const kandidati = useMemo(() => {
    const obj = new Set(f.objekt ? [Number(f.objekt)] : molObj.map((o) => o.id))
    const m = {}
    for (const z of db.zpravy) {
      if (!obj.has(z.objekt_id) || !z.datum_revize) continue
      const k = `${z.objekt_id}|${z.typ}`
      const x = (m[k] ||= { k, objekt_id: z.objekt_id, typ: z.typ, letos: false, z: null })
      if (z.datum_revize.startsWith(Y)) x.letos = true
      else if (z.datum_revize < Y && (!x.z || z.datum_revize > x.z.datum_revize)) x.z = z
    }
    return Object.values(m).filter((x) => x.z && !x.letos)
      .sort((a, b) => (idx.objekt[a.objekt_id]?.nazev || '').localeCompare(idx.objekt[b.objekt_id]?.nazev || '', 'cs', { numeric: true }) || a.typ.localeCompare(b.typ))
  }, [db, f.objekt, Y])
  const sel = vyber || Object.fromEntries(kandidati.map((x) => [x.k, true]))
  const pocet = kandidati.filter((x) => sel[x.k]).length
  const hotove = db.zpravy.filter((z) => (z.datum_revize || '').startsWith(Y) && (f.objekt ? z.objekt_id === Number(f.objekt) : molObj.some((o) => o.id === z.objekt_id))).length

  async function vytvorit() {
    const todo = kandidati.filter((x) => sel[x.k])
    const chyby = []
    for (let i = 0; i < todo.length; i++) {
      setPrubeh(`Vytvářím ${i + 1} z ${todo.length}…`)
      const x = todo[i]
      const lhuta = db.revize.find((r) => r.id === x.z.revize_id)?.lhuta_mesicu || 12
      try { await novaZeZpravy(x.z, { datum: f.datum, vyp: f.vyp, pred: f.pred, lhuta }, db.zpravy) } catch (e) { chyby.push(`${x.z.nazev}: ${e.message}`) }
    }
    await reload()
    setPrubeh(chyby.length ? `Hotovo, ${todo.length - chyby.length} vytvořeno. Nepovedlo se: ${chyby.join('; ')}` : `Hotovo, nových zpráv: ${todo.length}. Najdete je v seznamu pod rokem ${Y}.`)
  }

  return (
    <Modal title="Vytvořit letošní zprávy" onClose={onClose}>
      <div className="muted small">Pro každou stanici a druh zprávy vezme poslední zprávu z minulých let a udělá z ní novou, stejně jako „Nová zpráva z této“. Stanice, které už letos zprávu daného druhu mají, se přeskočí. Data pak u jednotlivých zpráv můžete upravit.</div>
      <label>Stanice
        <select className="select" value={f.objekt} onChange={(e) => { setF({ ...f, objekt: e.target.value }); setVyber(null) }}>
          <option value="">Všechny stanice MOL ({molObj.length})</option>
          {molObj.map((o) => <option key={o.id} value={o.id}>{o.nazev}</option>)}
        </select>
      </label>
      <div className="two">
        <label>Revize provedena<input className="input" type="date" value={f.datum} onChange={(e) => { setF({ ...f, datum: e.target.value }); setVyber(null) }} /></label>
        <label>Vypracováno<input className="input" type="date" value={f.vyp} onChange={(e) => setF({ ...f, vyp: e.target.value })} /></label>
      </div>
      <label>Předáno<input className="input" type="date" value={f.pred} onChange={(e) => setF({ ...f, pred: e.target.value })} /></label>
      <div className="small muted">Pro rok {Y}: {kandidati.length ? `chybí ${kandidati.length} ${kandidati.length < 5 ? (kandidati.length === 1 ? 'zpráva' : 'zprávy') : 'zpráv'}` : 'nic nechybí'}{hotove ? `, ${hotove} už je hotových` : ''}.</div>
      {kandidati.length > 0 && (
        <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px' }}>
          <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
            <input type="checkbox" checked={pocet === kandidati.length} onChange={(e) => setVyber(Object.fromEntries(kandidati.map((x) => [x.k, e.target.checked])))} /> Vybrat vše
          </label>
          {kandidati.map((x) => (
            <label key={x.k} className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400 }}>
              <input type="checkbox" checked={!!sel[x.k]} onChange={(e) => setVyber({ ...sel, [x.k]: e.target.checked })} />
              <span>{idx.objekt[x.objekt_id]?.nazev} · {TYPY_Z[x.typ] || x.typ} <span className="faint">(z {fmtDate(x.z.datum_revize)})</span></span>
            </label>
          ))}
        </div>
      )}
      {prubeh && <div className="small">{prubeh}</div>}
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>{prubeh?.startsWith('Hotovo') ? 'Zavřít' : 'Zrušit'}</button>
        <button className="btn" disabled={!pocet || (prubeh && !prubeh.startsWith('Hotovo'))} onClick={vytvorit}>Vytvořit {pocet} {pocet === 1 ? 'zprávu' : pocet > 1 && pocet < 5 ? 'zprávy' : 'zpráv'}</button>
      </div>
    </Modal>
  )
}

// vytvoří kopii zprávy pro novou revizi: posune data, rok v ev. čísle a termín příští revize
export async function novaZeZpravy(src, { datum, vyp, pred, lhuta }, zpravy = []) {
  const { data: full, error } = await supabase.from('zpravy').select('*').eq('id', src.id).single()
  if (error) throw error
  const oldY = (full.datum_revize || '').slice(0, 4)
  const newY = datum.slice(0, 4)
  let bloky = full.bloky
  // datum revize, vypracování a předání
  bloky = prepisData(bloky, { stara: { revize: full.datum_revize, vyp: full.datum_vypracovani, pred: full.datum_predani }, nova: { revize: datum, vyp, pred }, jen: ['revize', 'vyp', 'pred'] })
  // termín příští revize ve tvaru MM/RRRR
  if (full.datum_revize && lhuta) {
    const o = addMonths(parse(full.datum_revize), lhuta)
    const n = addMonths(parse(datum), lhuta)
    const f = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
    bloky = mapText(bloky, (t) => t.split(f(o)).join(f(n)))
  }
  // evidenční číslo
  let ev = full.ev_cislo || ''
  // zprávy, kde se ev. č. při převodu nenašlo: vzít ho z řádku „Ev.č. revize: …“ / „Evidenční číslo …: …“
  if (!ev) for (const x of full.bloky || []) {
    const m = x.t === 'p' && (x.x || '').match(/Ev(?:\.\s*č\.|idenční\s+číslo)[^:]{0,20}:\s*(\S+)/i)
    if (m) { ev = m[1]; break }
  }
  const evStare = ev
  if (ev) {
    let nev = evSDatem(ev, datum)
    if (nev === ev) nev = ev.split(oldY).join(newY)
    bloky = prepisEv(bloky, ev, nev)
    ev = nev
  }
  // předložené dokumenty: „předchozí pravidelná revizní zpráva, vyhotovena …, ev.č: …“ = zpráva, ze které kopírujeme
  if (full.datum_vypracovani || full.datum_revize) bloky = prepisData(bloky, { minula: { datum: full.datum_vypracovani || full.datum_revize, ev: evStare }, jen: ['minula'] })
  const nazev = oldY && newY !== oldY ? full.nazev.split(oldY).join(newY) : `${full.nazev} (nová)`
  const { data, error: e2 } = await supabase
    .from('zpravy')
    .insert({
      objekt_id: full.objekt_id, revize_id: full.revize_id, typ: full.typ, nazev, ev_cislo: ev || null,
      datum_revize: datum, datum_vypracovani: vyp, datum_predani: pred, stav: 'rozpracovano', vzor: false,
      zdroj: zdrojSablony(full, zpravy) ? `kopie: ${zdrojSablony(full, zpravy)}` : `kopie zprávy ${full.nazev}`, bloky,
    })
    .select()
    .single()
  if (e2) throw e2
  return data
}

function Editor({ id }) {
  const { db, idx, reload, remove, save } = useData()
  const meta = db.zpravy.find((z) => z.id === id)
  const [z, setZ] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [nova, setNova] = useState(null)
  const [repl, setRepl] = useState(null)
  const [del, setDel] = useState(false)
  const [nahled, setNahled] = useState(false)
  const [wordBusy, setWordBusy] = useState(false)
  const [mail, setMail] = useState(false)
  const msId = idx.nast.microsoft?.clientId
  const [toast, say] = useToast()

  useEffect(() => {
    setZ(null)
    // obsah zprávy: ze sítě, bez signálu z posledně otevřené kopie v telefonu
    const zCache = () => kvGet(`zprava-${id}`).then((c) => (c ? setZ(c) : say('Zprávu se nepodařilo načíst. Bez signálu jdou otevřít jen zprávy, které už byly v tomto zařízení otevřené.')))
    if (id < 0) return void zCache()
    supabase.from('zpravy').select('*').eq('id', id).single()
      .then(({ data, error }) => {
        if (error) return zCache()
        const v = { ...data, bloky: data.bloky || [] }
        kvGet(`zprava-${id}`).then((c) => {
          // neodeslaná úprava z terénu je novější než verze v databázi
          if (c && new Date(c.updated_at || 0) > new Date(v.updated_at || 0)) setZ(c)
          else { setZ(v); kvSet(`zprava-${id}`, v) }
        })
      })
      .catch(zCache)
  }, [id])
  useEffect(() => {
    const f = (e) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    addEventListener('beforeunload', f)
    return () => removeEventListener('beforeunload', f)
  }, [dirty])

  if (!z) return <div className="muted">{meta ? `Načítám ${meta.nazev}…` : 'Načítám zprávu…'}</div>
  const set = (k) => (e) => { setZ({ ...z, [k]: e.target.value }); setDirty(true) }
  // změna data nahoře se propíše i do textu zprávy (k řádkům „Datum vypracování“, „předal dne“ atd.)
  const ROLE = { datum_revize: 'revize', datum_vypracovani: 'vyp', datum_predani: 'pred' }
  const setDatum = (k) => (e) => {
    const v = e.target.value
    const stara = { revize: z.datum_revize, vyp: z.datum_vypracovani, pred: z.datum_predani }
    let bloky = v ? prepisData(z.bloky, { stara, nova: { ...stara, [ROLE[k]]: v }, jen: [ROLE[k]] }) : z.bloky
    // datum revize je i v evidenčním čísle (2026-17-09-MOL417 E-ML-R)
    const ev = k === 'datum_revize' && v ? evSDatem(z.ev_cislo, v) : z.ev_cislo
    if (ev !== z.ev_cislo) bloky = prepisEv(bloky, z.ev_cislo, ev)
    setZ({ ...z, [k]: v, bloky, ev_cislo: ev })
    setDirty(true)
  }
  const setB = (bi, b) => { const bl = [...z.bloky]; bl[bi] = b; setZ({ ...z, bloky: bl }); setDirty(true) }
  const rev = db.revize.find((r) => r.id === z.revize_id)
  const datesFound = [...new Set([...allText(z.bloky).matchAll(RE_DATE)].map((m) => toIso(m[1], m[2], m[3])))].sort()
  const wide = Math.max(0, ...z.bloky.filter((b) => b.t === 'tab').map((b) => Math.max(...b.r.map((r) => r.reduce((a, c) => a + (c.s || 1), 0)))))

  async function ulozit(extra = {}) {
    setBusy(true)
    const { created_at, ...row } = { ...z, ...extra }
    const upd = { ...row, objekt_id: row.objekt_id ? Number(row.objekt_id) : null, revize_id: row.revize_id ? Number(row.revize_id) : null, updated_at: new Date().toISOString() }
    try {
      await save('zpravy', upd)
      setZ({ ...z, ...extra, updated_at: upd.updated_at })
      setDirty(false)
      say(navigator.onLine ? 'Zpráva uložena' : 'Uloženo v telefonu, odešle se po připojení')
    } catch (e) {
      say('Uložení selhalo: ' + e.message)
    }
    setBusy(false)
  }

  return (
    <>
      <div className="head no-print">
        <div>
          <h1 style={{ fontSize: 26 }}>{z.nazev}</h1>
          <p>{[idx.objekt[z.objekt_id]?.nazev, TYPY_Z[z.typ], z.ev_cislo].filter(Boolean).join(' · ')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost" onClick={() => setNahled(!nahled)}>{nahled ? 'Upravovat' : 'Náhled'}</button>
          <button
            className="btn"
            disabled={!!wordBusy}
            title="Vyplní váš původní Word. PDF pak uložíte ve Wordu: Soubor → Uložit jako → PDF."
            onClick={async () => {
              if (dirty) await ulozit()
              setWordBusy(true)
              try { await stahnoutWord(z, db.zpravy) } catch (e) { say(e.message) }
              setWordBusy(false)
            }}
          >
            {wordBusy === true ? 'Připravuji Word…' : 'Stáhnout Word'}
          </button>
          {msId && (
            <button
              className="btn"
              disabled={!!wordBusy}
              title="Word vyplní a převede do PDF přímo Microsoft Word (přes váš OneDrive), vzhled je 1:1."
              onClick={async () => {
                if (dirty) await ulozit()
                setWordBusy('pdf')
                try {
                  const pdf = await wordNaPdf(await wordBlob(z, db.zpravy), msId)
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(pdf)
                  a.download = `${nazevSouboru(z)}.pdf`
                  document.body.appendChild(a); a.click(); a.remove()
                  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
                } catch (e) { say(e.message) }
                setWordBusy(false)
              }}
            >
              {wordBusy === 'pdf' ? 'Převádím do PDF…' : 'Stáhnout PDF'}
            </button>
          )}
          <button className="btn ghost" onClick={async () => { if (dirty) await ulozit(); setMail(true) }}>Odeslat e-mailem</button>
          <button className="btn ghost" onClick={() => { setNahled(true); setTimeout(() => { const t = document.title; document.title = z.nazev; print(); document.title = t }, 100) }}>Rychlý tisk</button>
          <button className="btn ghost" onClick={() => setNova({ datum: iso(TODAY()), vyp: iso(TODAY()), pred: iso(TODAY()), lhuta: rev?.lhuta_mesicu || 12 })}>Nová zpráva z této</button>
          {(z.stav || 'rozpracovano') === 'rozpracovano' && (
            <button className="btn" disabled={busy} title="Uloží zprávu a změní stav z Rozpracovaná na Hotová" onClick={() => ulozit({ stav: 'hotovo' })}>Zpráva je hotová</button>
          )}
          <button className="btn ghost" disabled={!dirty || busy} onClick={() => ulozit()}>{busy ? 'Ukládám…' : dirty ? 'Uložit' : 'Uloženo'}</button>
        </div>
      </div>

      {!nahled && (
        <section className="panel no-print" style={{ marginBottom: 16 }}>
          <div className="g-four" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)' }}>
            <label>Název<input className="input" value={z.nazev} onChange={set('nazev')} /></label>
            <label>Ev. číslo<input className="input" value={z.ev_cislo || ''} onChange={set('ev_cislo')} /></label>
            <label>Druh
              <select className="select" value={z.typ || ''} onChange={set('typ')}>
                {Object.entries(TYPY_Z).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Stav
              <select className="select" value={z.stav || 'rozpracovano'} onChange={set('stav')}>
                {Object.entries(STAVY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <div className="g-four" style={{ marginTop: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <label>Revize provedena<input className="input" type="date" value={z.datum_revize || ''} onChange={setDatum('datum_revize')} /></label>
            <label>Objekt
              <select className="select" value={z.objekt_id || ''} onChange={set('objekt_id')}>
                <option value="">–</option>
                {[...db.objekty].sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs')).map((o) => <option key={o.id} value={o.id}>{o.nazev}</option>)}
              </select>
            </label>
            <label>Vypracováno<input className="input" type="date" value={z.datum_vypracovani || ''} onChange={setDatum('datum_vypracovani')} /></label>
            <label>Předáno<input className="input" type="date" value={z.datum_predani || ''} onChange={setDatum('datum_predani')} /></label>
          </div>
          <div className="bar" style={{ marginTop: 12, marginBottom: 0 }}>
            <button className="btn ghost sm" onClick={() => setRepl({ co: '', cim: '' })}>Najít a nahradit</button>
            <button className="btn ghost sm" onClick={() => setRepl({ dates: Object.fromEntries(datesFound.map((d) => [d, d])) })}>Změnit data v textu ({datesFound.length})</button>
            {z.zdroj && <span className="small faint" style={{ alignSelf: 'center' }}>Zdroj: {z.zdroj}</span>}
            <span style={{ marginLeft: 'auto' }} />
            {del ? (
              <button className="btn danger sm" onClick={async () => { await remove('zpravy', z.id); location.hash = '#/zpravy' }}>Opravdu smazat zprávu</button>
            ) : (
              <button className="btn ghost sm" onClick={() => setDel(true)}>Smazat</button>
            )}
          </div>
        </section>
      )}

      <style>{`@media print { @page { size: A4 ${wide > 10 ? 'landscape' : 'portrait'}; margin: 12mm 12mm 14mm; } }`}</style>
      <div className="sheet-wrap">
        <article className={`sheet rz ${wide > 10 ? 'land' : ''} ${nahled ? 'view' : 'edit'}`}>
          {z.bloky.map((b, bi) =>
            b.t === 'p' ? (
              nahled ? (
                <p key={bi} className={`rz-p ${b.b ? 'b' : ''} ${b.a || ''}`}>{b.x}</p>
              ) : (
                <textarea
                  key={bi}
                  className={`rz-p rz-in ${b.b ? 'b' : ''} ${b.a || ''}`}
                  value={b.x}
                  rows={Math.max(1, Math.ceil(b.x.length / 95) + (b.x.match(/\n/g) || []).length)}
                  onChange={(e) => setB(bi, { ...b, x: e.target.value })}
                />
              )
            ) : (
              <TabBlok key={bi} b={b} edit={!nahled} onChange={(nb) => setB(bi, nb)} />
            )
          )}
        </article>
      </div>

      {mail && (() => {
        const o = idx.objekt[z.objekt_id]
        const kl = o && db.klienti.find((k) => k.id === o.klient_id)
        const dod = idx.nast.dodavatel || {}
        return (
          <OdeslatEmail
            title="Odeslat zprávu e-mailem"
            to={kl?.email || ''}
            subject={`Revizní zpráva ${z.ev_cislo || z.nazev}`}
            text={`Dobrý den,\n\nv příloze zasílám revizní zprávu ${z.nazev}${o ? ` (${o.nazev})` : ''}.\n\nS pozdravem\n${dod.jmeno || ''}${dod.telefon ? `\n${dod.telefon}` : ''}`}
            priprav={async () => {
              const w = await wordBlob(z, db.zpravy)
              return msId ? [{ name: `${nazevSouboru(z)}.pdf`, blob: await wordNaPdf(w, msId) }] : [{ name: `${nazevSouboru(z)}.docx`, blob: w }]
            }}
            onClose={() => setMail(false)}
            onSent={() => { if (z.stav !== 'predano') { setZ({ ...z, stav: 'predano' }); save('zpravy', { id: z.id, stav: 'predano' }) } }}
          />
        )
      })()}
      {nova && (
        <Modal title="Nová zpráva z této" onClose={() => setNova(null)}>
          <div className="muted small">Zkopíruje celou zprávu. Data a evidenční číslo se posunou, termín příští revize se přepočítá. Naměřené hodnoty pak jen přepíšete.</div>
          <div className="two">
            <label>Revize provedena<input className="input" type="date" value={nova.datum} onChange={(e) => setNova({ ...nova, datum: e.target.value })} /></label>
            <label>Lhůta (měsíce)<input className="input" type="number" value={nova.lhuta} onChange={(e) => setNova({ ...nova, lhuta: Number(e.target.value) })} /></label>
          </div>
          <div className="two">
            <label>Vypracováno<input className="input" type="date" value={nova.vyp} onChange={(e) => setNova({ ...nova, vyp: e.target.value })} /></label>
            <label>Předáno<input className="input" type="date" value={nova.pred} onChange={(e) => setNova({ ...nova, pred: e.target.value })} /></label>
          </div>
          <div className="actions">
            <button className="btn ghost" onClick={() => setNova(null)}>Zrušit</button>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const n = await novaZeZpravy(z, nova, db.zpravy)
                  await reload()
                  setNova(null)
                  location.hash = `#/zpravy/${n.id}`
                } catch (e) {
                  say('Nepodařilo se: ' + e.message)
                }
                setBusy(false)
              }}
            >
              Vytvořit zprávu
            </button>
          </div>
        </Modal>
      )}

      {repl && !repl.dates && (
        <Modal title="Najít a nahradit v celé zprávě" onClose={() => setRepl(null)}>
          <label>Najít<input className="input" autoFocus value={repl.co} onChange={(e) => setRepl({ ...repl, co: e.target.value })} /></label>
          <label>Nahradit za<input className="input" value={repl.cim} onChange={(e) => setRepl({ ...repl, cim: e.target.value })} /></label>
          <div className="small muted">Nalezeno: {repl.co ? allText(z.bloky).split(repl.co).length - 1 : 0}×</div>
          <div className="actions">
            <button className="btn ghost" onClick={() => setRepl(null)}>Zrušit</button>
            <button className="btn" disabled={!repl.co} onClick={() => { setZ({ ...z, bloky: mapText(z.bloky, (t) => t.split(repl.co).join(repl.cim)) }); setDirty(true); setRepl(null) }}>Nahradit vše</button>
          </div>
        </Modal>
      )}
      {repl?.dates && (
        <Modal title="Data ve zprávě" onClose={() => setRepl(null)}>
          <div className="muted small">Každé datum, které se ve zprávě objevuje. Změňte, co je potřeba, a všechny výskyty se přepíšou.</div>
          <div style={{ display: 'grid', gap: 8, maxHeight: '50vh', overflow: 'auto' }}>
            {Object.keys(repl.dates).map((d) => (
              <label key={d} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 10 }}>
                <span className="num">{fmtDate(d)}</span>
                <input className="input" type="date" value={repl.dates[d]} onChange={(e) => setRepl({ dates: { ...repl.dates, [d]: e.target.value } })} />
              </label>
            ))}
          </div>
          <div className="actions">
            <button className="btn ghost" onClick={() => setRepl(null)}>Zrušit</button>
            <button
              className="btn"
              onClick={() => {
                let bl = z.bloky
                Object.entries(repl.dates).forEach(([o, n]) => { if (n && o !== n) bl = mapText(bl, (t) => replaceDate(t, o, n)) })
                setZ({ ...z, bloky: bl })
                setDirty(true)
                setRepl(null)
              }}
            >
              Přepsat data
            </button>
          </div>
        </Modal>
      )}
      {toast}
    </>
  )
}

function TabBlok({ b, edit, onChange }) {
  const setCell = (ri, ci, x) => onChange({ ...b, r: b.r.map((row, i) => (i === ri ? row.map((c, j) => (j === ci ? { ...c, x } : c)) : row)) })
  // řádek tabulky s měřením: kopie posledního (pro nový spotřebič / obvod)
  // řádky se označí původním pořadím, aby šly přenést do Wordu (nový řádek = kopie řádku nad ním)
  const stamp = (rows) => (rows.some((r) => r[0]?.ri !== undefined || r[0]?.nw) ? rows : rows.map((r, i) => [{ ...r[0], ri: i }, ...r.slice(1)]))
  const addRow = (ri) => {
    const rows = stamp(b.r)
    const src = rows[ri]
    const from = src[0].nw ? src[0].from : src[0].ri
    const nr = src.map((c, j) => ({ x: j === 0 && /^\d+$/.test(c.x) ? String(Number(c.x) + 1) : '', ...(c.s ? { s: c.s } : {}) }))
    nr[0] = { ...nr[0], nw: 1, from }
    const r = [...rows]
    r.splice(ri + 1, 0, nr)
    onChange({ ...b, r })
  }
  const delRow = (ri) => onChange({ ...b, r: stamp(b.r).filter((_, i) => i !== ri) })
  const cols = Math.max(...b.r.map((r) => r.reduce((a, c) => a + (c.s || 1), 0)))
  return (
    <table className={`rz-tab ${cols > 10 ? 'dense' : ''}`}>
      <tbody>
        {b.r.map((row, ri) => (
          <tr key={ri}>
            {row.map((c, ci) => (
              <td key={ci} colSpan={c.s || 1}>
                {edit ? (
                  <textarea className="rz-cell" value={c.x} rows={Math.max(1, (c.x.match(/\n/g) || []).length + 1)} onChange={(e) => setCell(ri, ci, e.target.value)} />
                ) : (
                  <span style={{ whiteSpace: 'pre-line' }}>{c.x}</span>
                )}
              </td>
            ))}
            {edit && (
              <td className="rz-rowtools no-print">
                <button title="Přidat řádek pod" onClick={() => addRow(ri)}>+</button>
                {b.r.length > 1 && <button title="Smazat řádek" onClick={() => delRow(ri)}>×</button>}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// nastavení převodu do PDF přes Microsoft Word online (ID aplikace z registrace v Microsoft Entra)
function PdfPanel() {
  const { idx, db, save } = useData()
  const ms = idx.nast.microsoft || {}
  const [id, setId] = useState(ms.clientId || '')
  const [ucet, setUcet] = useState(null)
  const [stav, setStav] = useState(null)
  const [otevrit, setOtevrit] = useState(false)
  useEffect(() => { if (ms.clientId) prihlasenMicrosoft(ms.clientId).then(setUcet).catch(() => {}) }, [ms.clientId])
  if (ms.clientId && ucet && !otevrit) return <div className="small muted" style={{ margin: '-6px 0 14px' }}>PDF přes Word: přihlášeno jako {ucet}. <button className="link small" onClick={() => setOtevrit(true)}>Nastavení</button></div>
  async function ulozitId() {
    const row = (db.nastaveni || []).find((r) => r.klic === 'microsoft')
    await save('nastaveni', row ? { id: row.id, hodnota: { clientId: id.trim() } } : { klic: 'microsoft', hodnota: { clientId: id.trim() } })
    setStav('Uloženo. Teď se přihlaste.')
  }
  async function zkusit() {
    setStav('Přihlašuji a zkouším převod…')
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
      zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Test</w:t></w:r></w:p></w:body></w:document>')
      const pdf = await wordNaPdf(await zip.generateAsync({ type: 'blob' }), id.trim())
      setUcet(await prihlasenMicrosoft(id.trim()))
      setStav(`Funguje (zkušební PDF ${Math.round(pdf.size / 1000)} kB). U zpráv je teď tlačítko Stáhnout PDF a e-mail posílá PDF.`)
      setOtevrit(false)
    } catch (e) { setStav('Nepodařilo se: ' + e.message) }
  }
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <h2>PDF přes Word</h2>
      <p style={{ marginTop: 0 }}>Zprávu převede do PDF přímo Microsoft Word přes váš OneDrive, takže PDF vypadá 1:1 jako z Wordu. Stačí jednou vložit ID aplikace z registrace u Microsoftu a přihlásit se.</p>
      <div className="bar">
        <input className="input" placeholder="ID aplikace (Application client ID)" value={id} onChange={(e) => setId(e.target.value)} />
        <button className="btn ghost" disabled={!id.trim() || id.trim() === ms.clientId} onClick={ulozitId}>Uložit</button>
        <button className="btn" disabled={!ms.clientId || id.trim() !== ms.clientId} onClick={zkusit}>Přihlásit a vyzkoušet</button>
        {ucet && <button className="btn ghost" onClick={async () => { await odhlasitMicrosoft(ms.clientId); setUcet(null) }}>Odhlásit {ucet}</button>}
      </div>
      {stav && <div className="small">{stav}</div>}
    </section>
  )
}

function SablonyPanel() {
  const [stav, setStav] = useState(null)
  const [skryt, setSkryt] = useState(() => { try { return localStorage.getItem('sablony-ok') === '1' } catch { return false } })
  if (skryt && !stav) return null
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <h2>Word šablony zpráv</h2>
      <p style={{ marginTop: 0 }}>
        Tlačítko <b>Stáhnout Word</b> vyplní váš původní Word (hlavička PIK, tabulky, písmo). Jednou sem nahrajte složku <b>sablony-zprav</b> z CLAUDE\REVIZE APLIKACE (430 souborů, asi 41 MB).
      </p>
      <label className="btn" style={{ display: 'inline-flex', alignItems: 'center', cursor: stav?.busy ? 'wait' : 'pointer' }}>
        {stav?.busy ? `Nahrávám ${stav.n} z ${stav.total}…` : 'Vybrat složku sablony-zprav'}
        <input
          type="file"
          hidden
          multiple
          webkitdirectory=""
          disabled={stav?.busy}
          onChange={async (e) => {
            const files = e.target.files
            setStav({ busy: true, n: 0, total: files.length })
            try {
              const r = await nahratSablony(files, (n, total) => setStav({ busy: true, n, total }))
              setStav({ hotovo: r })
              if (!r.err) { try { localStorage.setItem('sablony-ok', '1') } catch {} }
            } catch (err) {
              setStav({ chyba: err.message })
            }
          }}
        />
      </label>
      {stav?.hotovo && <div className="small" style={{ marginTop: 8 }}>Hotovo: nahráno {stav.hotovo.done}, už nahraných {stav.hotovo.skip}{stav.hotovo.err ? `, nepovedlo se ${stav.hotovo.err} (vyberte složku znovu, doplní se jen chybějící)` : ''}.</div>}
      {stav?.chyba && <div className="small err" style={{ marginTop: 8 }}>Nahrání selhalo: {stav.chyba}</div>}
      {stav?.hotovo && !stav.hotovo.err && <button className="link small" style={{ marginTop: 6 }} onClick={() => { setSkryt(true); setStav(null) }}>Skrýt</button>}
    </section>
  )
}
