import { useMemo, useState } from 'react'
import { useData } from '../data'
import { TODAY, fmtDate, fmtKc, iso, norm } from '../lib'
import { useToast } from '../ui'

export const STAVY_N = { koncept: 'Koncept', odeslana: 'Odeslaná', prijata: 'Přijatá', odmitnuta: 'Odmítnutá', fakturovano: 'Vyfakturovaná' }
const kc = (n) => `${Math.round(Number(n) || 0).toLocaleString('cs-CZ').replace(/\s/g, ' ')},- Kč`
const plus = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return iso(x) }
export const soucet = (pol) => (pol || []).reduce((a, it) => a + Number(it.mnozstvi || 0) * Number(it.cena_ks || 0), 0)

export function nextCisloN(nabidky, y = TODAY().getFullYear()) {
  const n = Math.max(0, ...nabidky.filter((x) => x.rok === y).map((x) => parseInt(String(x.cislo).replace(/\D.*$/, '')) || 0))
  return `${String(n + 1).padStart(3, '0')}/${String(y).slice(2)}`
}

export default function Nabidky({ sub }) {
  if (sub?.[0]) return <Nabidka key={sub[0]} id={sub[0] === 'nova' ? null : Number(sub[0])} />
  return <Seznam />
}

function Seznam() {
  const { db, idx } = useData()
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const t = norm(q)
    return [...db.nabidky]
      .filter((n) => !t || norm(`${n.cislo} ${n.nazev} ${idx.klient[n.klient_id]?.nazev || n.odberatel}`).includes(t))
      .sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || b.id - a.id)
  }, [db, q])
  const otevrene = db.nabidky.filter((n) => n.stav === 'odeslana' || n.stav === 'prijata')
  return (
    <>
      <div className="head">
        <div>
          <h1>Cenové nabídky</h1>
          <p>Nabídka se sestaví z ceníku klienta. Když ji klient přijme, jedním tlačítkem z ní vystavíte fakturu.</p>
        </div>
        <a className="btn" href="#/nabidky/nova" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Nová nabídka</a>
      </div>
      {otevrene.length > 0 && (
        <div className="sumcards" style={{ marginBottom: 16 }}>
          <div className="sumcard" style={{ cursor: 'default' }}><span className="sc-l">Odeslané a přijaté nabídky</span><span className="sc-v num">{fmtKc(otevrene.reduce((a, n) => a + soucet(n.polozky), 0))}</span><span className="sc-s">{otevrene.length} čeká na rozhodnutí klienta nebo na fakturu</span></div>
        </div>
      )}
      <div className="bar"><input className="input" placeholder="Hledat klienta nebo číslo nabídky" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Nabídka</th><th className="hide-m">Datum</th><th className="r">Částka</th><th>Stav</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan="4" className="muted">Zatím žádná nabídka. Začněte tlačítkem Nová nabídka.</td></tr>}
            {list.map((n) => (
              <tr key={n.id} style={{ cursor: 'pointer' }} onClick={() => (location.hash = `#/nabidky/${n.id}`)}>
                <td>
                  <a href={`#/nabidky/${n.id}`} style={{ fontWeight: 600, color: 'var(--ink)' }}>{n.cislo} · {idx.klient[n.klient_id]?.zkratka || idx.klient[n.klient_id]?.nazev || (n.odberatel || '').split('\n')[0]}</a>
                  <div className="small muted">{n.nazev}</div>
                </td>
                <td className="hide-m num">{fmtDate(n.datum)}</td>
                <td className="num r">{fmtKc(soucet(n.polozky))}</td>
                <td className="small"><span className={`tag ${{ koncept: 'none', odeslana: 'near', prijata: 'soon', odmitnuta: 'late', fakturovano: 'ok' }[n.stav] || 'none'}`}>{STAVY_N[n.stav] || n.stav}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

const emptyItem = () => ({ mnozstvi: 1, jednotka: 'ks', popis: '', cena_ks: '' })

function Nabidka({ id }) {
  const { db, idx, save, remove } = useData()
  const [toast, say] = useToast()
  const ex = id ? db.nabidky.find((n) => n.id === id) : null
  const [n, setN] = useState(() =>
    ex
      ? { ...ex, polozky: ex.polozky?.length ? ex.polozky : [emptyItem()] }
      : { cislo: nextCisloN(db.nabidky), klient_id: '', objekt_id: '', odberatel: '', nazev: 'Cenová nabídka na provedení revizí', datum: iso(TODAY()), platnost_do: plus(iso(TODAY()), 30), stav: 'koncept', polozky: [emptyItem()], poznamka: 'Nejsem plátce DPH. Ceny jsou konečné.' }
  )
  const [edit, setEdit] = useState(!ex)
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState(false)
  if (id && !ex) return <div className="panel muted">Nabídka nenalezena. <a href="#/nabidky">Zpět na nabídky</a></div>

  const set = (k) => (e) => setN({ ...n, [k]: e.target.value })
  const setIt = (i, k, v) => setN({ ...n, polozky: n.polozky.map((it, j) => (j === i ? { ...it, [k]: v } : it)) })
  const total = soucet(n.polozky)
  const cenik = db.cenik.filter((c) => (n.klient_id ? c.klient_id === Number(n.klient_id) : true) || c.klient_id == null)
  const objekty = db.objekty.filter((o) => !n.klient_id || o.klient_id === Number(n.klient_id)).sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs'))
  const k = idx.klient[n.klient_id]
  const d = idx.nast.dodavatel || {}

  async function ulozit(extra = {}) {
    setBusy(true)
    try {
      const row = {
        ...(n.id ? { id: n.id } : {}),
        cislo: n.cislo, rok: Number(n.datum.slice(0, 4)), klient_id: n.klient_id ? Number(n.klient_id) : null, objekt_id: n.objekt_id ? Number(n.objekt_id) : null,
        odberatel: n.odberatel || null, nazev: n.nazev || null, datum: n.datum, platnost_do: n.platnost_do || null, stav: n.stav,
        polozky: n.polozky.filter((it) => it.popis || it.cena_ks), poznamka: n.poznamka || null, updated_at: new Date().toISOString(), ...extra,
      }
      const r = await save('nabidky', row)
      setN({ ...n, ...row, id: r.id, polozky: row.polozky.length ? row.polozky : [emptyItem()] })
      setEdit(false)
      say('Nabídka uložena')
      if (!n.id) history.replaceState(null, '', `#/nabidky/${r.id}`)
      return r
    } catch (e) {
      say('Uložení selhalo: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="head no-print">
        <div>
          <h1>{n.id ? `Nabídka ${n.cislo}` : 'Nová cenová nabídka'}</h1>
          <p>{[k?.nazev || (n.odberatel || '').split('\n')[0], fmtKc(total), STAVY_N[n.stav]].filter(Boolean).join(' · ')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {n.id && !edit && <button className="btn ghost" onClick={() => setEdit(true)}>Upravit</button>}
          {n.id && !edit && <button className="btn ghost" onClick={() => { const t = document.title; document.title = `NABÍDKA ${n.cislo.replace('/', '-')} - ${k?.zkratka || ''}`; print(); document.title = t }}>Tisk / PDF</button>}
          {n.id && !edit && n.klient_id && n.stav !== 'fakturovano' && <a className="btn" href={`#/faktura/nova/n${n.id}`} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Vystavit fakturu</a>}
          {n.faktura_id && <a className="btn ghost" href={`#/faktura/${n.faktura_id}`} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Otevřít fakturu</a>}
        </div>
      </div>

      {n.id && !edit && (
        <div className="bar no-print">
          <span className="small muted" style={{ alignSelf: 'center' }}>Stav:</span>
          <div className="seg">
            {['koncept', 'odeslana', 'prijata', 'odmitnuta'].map((s) => (
              <button key={s} className={n.stav === s ? 'on' : ''} disabled={busy || n.stav === 'fakturovano'} onClick={() => { setN({ ...n, stav: s }); ulozit({ stav: s }) }}>{STAVY_N[s]}</button>
            ))}
          </div>
          {!n.klient_id && <span className="small muted" style={{ alignSelf: 'center' }}>Pro vystavení faktury vyberte v úpravě klienta z evidence.</span>}
        </div>
      )}

      {edit ? (
        <section className="panel stack no-print" style={{ gap: 14 }}>
          <div className="g-four">
            <label>Číslo<input className="input" value={n.cislo} onChange={set('cislo')} /></label>
            <label>Klient
              <select className="select" value={n.klient_id || ''} onChange={(e) => setN({ ...n, klient_id: e.target.value, objekt_id: '' })}>
                <option value="">Nový / mimo evidenci</option>
                {db.klienti.map((x) => <option key={x.id} value={x.id}>{x.nazev}</option>)}
              </select>
            </label>
            <label>Datum<input className="input" type="date" value={n.datum} onChange={(e) => setN({ ...n, datum: e.target.value, platnost_do: plus(e.target.value, 30) })} /></label>
            <label>Platí do<input className="input" type="date" value={n.platnost_do || ''} onChange={set('platnost_do')} /></label>
          </div>
          {!n.klient_id && (
            <label>Odběratel (název a adresa, každý údaj na nový řádek)<textarea className="input" rows="3" value={n.odberatel || ''} onChange={set('odberatel')} /></label>
          )}
          <div className="g-two">
            <label>Předmět nabídky<input className="input" value={n.nazev || ''} onChange={set('nazev')} /></label>
            <label>Objekt (nepovinné)
              <select className="select" value={n.objekt_id || ''} onChange={set('objekt_id')}>
                <option value="">–</option>
                {objekty.map((o) => <option key={o.id} value={o.id}>{o.nazev}</option>)}
              </select>
            </label>
          </div>
          <div>
            <div className="items-head small muted hide-m"><span>Množství</span><span>Popis</span><span className="r">Cena za jednotku</span><span className="r">Celkem</span><span /></div>
            {n.polozky.map((it, i) => (
              <div className="item" key={i}>
                <div className="item-q">
                  <input className="input" type="number" min="0" step="any" value={it.mnozstvi} onChange={(e) => setIt(i, 'mnozstvi', e.target.value)} aria-label="Množství" />
                  <select className="select" value={it.jednotka} onChange={(e) => setIt(i, 'jednotka', e.target.value)} aria-label="Jednotka">
                    {['ks', 'km', 'obvod', 'hod', 'kpl'].map((j) => <option key={j}>{j}</option>)}
                  </select>
                </div>
                <textarea className="input" rows={String(it.popis).includes('\n') ? 2 : 1} value={it.popis} onChange={(e) => setIt(i, 'popis', e.target.value)} placeholder="Popis položky" aria-label="Popis" />
                <input className="input r" type="number" min="0" step="any" value={it.cena_ks} onChange={(e) => setIt(i, 'cena_ks', e.target.value)} aria-label="Cena za jednotku" />
                <span className="num r item-sum">{fmtKc(Number(it.mnozstvi || 0) * Number(it.cena_ks || 0))}</span>
                <button className="btn ghost sm" onClick={() => setN({ ...n, polozky: n.polozky.filter((_, j) => j !== i) })} aria-label="Odebrat položku">✕</button>
              </div>
            ))}
            <div className="bar" style={{ marginTop: 10 }}>
              <button className="btn ghost sm" onClick={() => setN({ ...n, polozky: [...n.polozky, emptyItem()] })}>Přidat prázdnou položku</button>
              <select
                className="select"
                value=""
                onChange={(e) => {
                  const c = db.cenik.find((x) => x.id === Number(e.target.value))
                  if (c) setN({ ...n, polozky: [...n.polozky.filter((it) => it.popis || it.cena_ks), { mnozstvi: 1, jednotka: c.jednotka || 'ks', popis: c.polozka, cena_ks: c.cena }] })
                }}
                aria-label="Přidat z ceníku"
              >
                <option value="">Přidat z ceníku{k ? ` (${k.zkratka || k.nazev})` : ''}…</option>
                {cenik.map((c) => <option key={c.id} value={c.id}>{c.polozka} – {fmtKc(c.cena)}{c.jednotka && c.jednotka !== 'ks' ? ` / ${c.jednotka}` : ''}</option>)}
              </select>
              {n.objekt_id && (
                <button
                  className="btn ghost sm"
                  onClick={() => {
                    const rv = db.revize.filter((r) => r.objekt_id === Number(n.objekt_id) && r.stav !== 'archiv')
                    const o = idx.objekt[n.objekt_id]
                    setN({ ...n, polozky: [...n.polozky.filter((it) => it.popis || it.cena_ks), ...rv.map((r) => ({ mnozstvi: 1, jednotka: 'ks', popis: `${o.nazev}\nRevize – ${r.typ}`, cena_ks: r.cena ?? '' }))] })
                  }}
                >
                  Přidat revize objektu
                </button>
              )}
            </div>
          </div>
          <label>Poznámka v nabídce<textarea className="input" rows="2" value={n.poznamka || ''} onChange={set('poznamka')} /></label>
          <div className="inv-total"><span className="muted">Celkem (neplátce DPH)</span><b className="num">{fmtKc(total)}</b></div>
          <div className="actions">
            {n.id && (del
              ? <button className="btn danger" style={{ marginRight: 'auto' }} onClick={async () => { await remove('nabidky', n.id); location.hash = '#/nabidky' }}>Opravdu smazat</button>
              : <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => setDel(true)}>Smazat</button>)}
            <button className="btn ghost" onClick={() => (n.id ? (setN({ ...ex, polozky: ex.polozky?.length ? ex.polozky : [emptyItem()] }), setEdit(false)) : (location.hash = '#/nabidky'))}>Zrušit</button>
            <button className="btn" disabled={busy || !n.cislo || (!n.klient_id && !n.odberatel) || total <= 0} onClick={() => ulozit()}>{busy ? 'Ukládám…' : 'Uložit nabídku'}</button>
          </div>
        </section>
      ) : (
        <div className="sheet-wrap">
          <article className="sheet">
            <header className="inv-top">
              <div className="inv-title">CENOVÁ NABÍDKA č.{n.cislo}</div>
              <dl className="inv-dates">
                <dt>Datum</dt><dd>{fmtDate(n.datum)}</dd>
                {n.platnost_do && <><dt>Platnost nabídky do</dt><dd>{fmtDate(n.platnost_do)}</dd></>}
              </dl>
            </header>
            <div className="inv-parties">
              <div>
                <div className="inv-lbl">Dodavatel</div>
                <b>{d.jmeno}</b>
                <div>{d.ulice}</div>
                <div>{d.mesto}</div>
                <div className="inv-small">
                  {d.telefon && <div>Tel: {d.telefon}</div>}
                  {d.email && <div>Email: {d.email}</div>}
                  <div>IČO: {d.ico}</div>
                  <div>{d.poznamka}</div>
                </div>
              </div>
              <div>
                <div className="inv-lbl">Odběratel</div>
                {k ? (
                  <>
                    <b>{k.nazev}</b>
                    {(k.adresa || '').split(',').map((s) => <div key={s}>{s.trim()}</div>)}
                    <div className="inv-small">{k.ico && <div>IČO: {k.ico}</div>}{k.dic && <div>DIČ: {k.dic}</div>}</div>
                  </>
                ) : (
                  (n.odberatel || '').split('\n').map((s, i) => (i === 0 ? <b key={i}>{s}</b> : <div key={i}>{s}</div>))
                )}
              </div>
            </div>
            {(n.nazev || n.objekt_id) && (
              <div className="inv-strip" style={{ gridTemplateColumns: '1fr' }}>
                <div><span>Předmět nabídky</span>{[n.nazev, idx.objekt[n.objekt_id]?.nazev].filter(Boolean).join(' – ')}</div>
              </div>
            )}
            <table className="inv-items">
              <thead><tr><th>Množství</th><th>Popis</th><th className="r">Cena za jednotku</th><th className="r">Celkem</th></tr></thead>
              <tbody>
                {n.polozky.filter((it) => it.popis || it.cena_ks).map((it, i) => (
                  <tr key={i}>
                    <td className="nw">{it.mnozstvi} {it.jednotka}</td>
                    <td style={{ whiteSpace: 'pre-line' }}>{it.popis}</td>
                    <td className="r nw">{kc(it.cena_ks)}</td>
                    <td className="r nw">{kc(Number(it.mnozstvi || 0) * Number(it.cena_ks || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="inv-foot">
              <div className="inv-sign">
                {n.poznamka && <div style={{ marginBottom: 10, whiteSpace: 'pre-line' }}>{n.poznamka}</div>}
                <div className="inv-lbl">Razítko a podpis</div>
                <div className="inv-signbox" />
              </div>
              <div className="inv-sum">
                <div><span>DPH</span>Neplátce DPH</div>
                <div className="inv-grand"><span>Celkem</span>{kc(total)}</div>
              </div>
            </div>
          </article>
        </div>
      )}
      {toast}
    </>
  )
}
