import { useEffect, useMemo, useRef, useState } from 'react'
import { OdeslatEmail } from '../posta'
import QRCode from 'qrcode'
import { useData } from '../data'
import { TODAY, fmtDate, fmtKc, iso, norm, supabase } from '../lib'
import { useToast } from '../ui'

// --- pomocné ---------------------------------------------------------------
export function nextCislo(faktury, y = TODAY().getFullYear()) {
  const n = Math.max(0, ...faktury.filter((f) => f.rok === y).map((f) => parseInt(f.cislo) || 0))
  return `${String(n + 1).padStart(3, '0')}/${String(y).slice(2)}`
}
const vs = (cislo, rok) => `${rok}${String(parseInt(cislo) || 0).padStart(3, '0')}`
const kc = (n) => `${Math.round(Number(n) || 0).toLocaleString('cs-CZ').replace(/\s/g, ' ')},- Kč`
const plus = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return iso(x) }

// text položky na faktuře podle typu revize (formát, který Pavel používá u PIK)
function popisRevize(r, o) {
  const t = norm(r.typ)
  const txt =
    t.includes('spotreb') ? 'Pravidelná revize - el. spotřebiče (dle ČSN 33 1600 ed.2)'
    : t.includes('nouz') || t === 'no' ? 'Pravidelná zkouška nouzového osvětlení (dle ČSN EN 1838)'
    : t.includes('portal') ? 'Pravidelná revize - mycí linka portálová (dle ČSN 33 1500 ed.2)'
    : t.includes('rucni') ? 'Pravidelná revize - mycí linka ruční (dle ČSN 33 1500 ed.2)'
    : t.includes('stavb') ? 'Pravidelná revize el. instalace stavby (dle ČSN 33 1500 ed.2)'
    : `Pravidelná revize – ${r.typ}`
  const kde = o ? (/^mol\b/i.test(o.nazev) ? `ČS PHM ${o.nazev}` : o.nazev) : ''
  return kde ? `${kde}\n${txt}` : txt
}

const emptyItem = () => ({ mnozstvi: 1, jednotka: 'ks', popis: '', cena_ks: '' })

// --- vystavení nové faktury ------------------------------------------------
export default function Faktura({ sub }) {
  if (sub?.[0] && sub[0] !== 'nova') return <FakturaTisk id={Number(sub[0])} />
  if (sub?.[1]?.startsWith('n')) return <NovaFaktura nabidkaId={Number(sub[1].slice(1))} revizeIds={[]} />
  return <NovaFaktura revizeIds={(sub?.[1] || '').split(',').filter(Boolean).map(Number)} />
}

function NovaFaktura({ revizeIds, nabidkaId }) {
  const { db, idx, save } = useData()
  const [toast, say] = useToast()
  const pre = db.revize.filter((r) => revizeIds.includes(r.id))
  const nab = nabidkaId ? db.nabidky.find((x) => x.id === nabidkaId) : null
  const klient0 = nab ? nab.klient_id : pre[0] ? idx.objekt[pre[0].objekt_id]?.klient_id : ''
  const splat = idx.nast.dodavatel?.splatnost_dni || 14
  const [f, setF] = useState(() => {
    const k = idx.klient[klient0]
    return {
      cislo: nextCislo(db.faktury),
      klient_id: klient0 || '',
      datum_vystaveni: iso(TODAY()),
      datum_splatnosti: plus(iso(TODAY()), splat),
      zakazka: nab ? `dle cenové nabídky č. ${nab.cislo}` : k?.zkratka === 'PIK' ? `EL.REVIZE MOL ${TODAY().getFullYear()}` : '',
      poznamka: '',
    }
  })
  const [items, setItems] = useState(() =>
    nab?.polozky?.length
      ? nab.polozky.map((it) => ({ mnozstvi: it.mnozstvi, jednotka: it.jednotka || 'ks', popis: it.popis, cena_ks: it.cena_ks }))
      : pre.length
      ? [...pre]
          .sort((a, b) => a.objekt_id - b.objekt_id)
          .map((r) => ({ mnozstvi: 1, jednotka: 'ks', popis: popisRevize(r, idx.objekt[r.objekt_id]), cena_ks: r.cena ?? '', revize_id: r.id }))
      : [emptyItem()]
  )
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const setIt = (i, k, v) => setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)))
  const total = items.reduce((a, it) => a + Number(it.mnozstvi || 0) * Number(it.cena_ks || 0), 0)
  const cenik = db.cenik.filter((c) => !f.klient_id || c.klient_id === Number(f.klient_id) || c.klient_id == null)
  const cekajici = db.revize.filter((r) => r.stav === 'ceka_fakturace' && idx.objekt[r.objekt_id]?.klient_id === Number(f.klient_id) && !items.some((it) => it.revize_id === r.id))
  const dupl = db.faktury.some((x) => x.cislo === f.cislo && x.rok === Number(f.datum_vystaveni.slice(0, 4)))

  async function vystavit() {
    setBusy(true)
    try {
      const rok = Number(f.datum_vystaveni.slice(0, 4))
      const fak = await save('faktury', {
        cislo: f.cislo, rok, klient_id: Number(f.klient_id), datum_vystaveni: f.datum_vystaveni, datum_splatnosti: f.datum_splatnosti,
        castka: total, zakazka: f.zakazka || null, poznamka: f.poznamka || null, zaplaceno: false,
      })
      const rows = items.filter((it) => it.popis).map((it) => ({
        faktura_id: fak.id, popis: it.popis, mnozstvi: `${it.mnozstvi} ${it.jednotka}`.trim(),
        cena_ks: Number(it.cena_ks || 0), celkem: Number(it.mnozstvi || 0) * Number(it.cena_ks || 0),
      }))
      const { error } = await supabase.from('polozky_faktur').insert(rows)
      if (error) throw error
      for (const it of items) if (it.revize_id) await save('revize', { id: it.revize_id, stav: 'planovano' })
      if (nab) await save('nabidky', { id: nab.id, stav: 'fakturovano', faktura_id: fak.id })
      location.hash = `#/faktura/${fak.id}`
    } catch (e) {
      say('Vystavení selhalo: ' + e.message)
      setBusy(false)
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Vystavit fakturu{nab ? ` z nabídky ${nab.cislo}` : ''}</h1>
          <p>Po vystavení se faktura uloží do evidence a otevře se k tisku nebo uložení do PDF.</p>
        </div>
      </div>
      <section className="panel stack" style={{ gap: 14 }}>
        <div className="g-four">
          <label>Číslo<input className="input" value={f.cislo} onChange={set('cislo')} />{dupl && <span className="small err">Toto číslo už existuje</span>}</label>
          <label>
            Odběratel
            <select className="select" value={f.klient_id} onChange={set('klient_id')}>
              <option value="">Vyberte</option>
              {db.klienti.map((k) => <option key={k.id} value={k.id}>{k.nazev}</option>)}
            </select>
          </label>
          <label>Vystaveno<input className="input" type="date" value={f.datum_vystaveni} onChange={(e) => setF({ ...f, datum_vystaveni: e.target.value, datum_splatnosti: plus(e.target.value, splat) })} /></label>
          <label>Splatnost<input className="input" type="date" value={f.datum_splatnosti} onChange={set('datum_splatnosti')} /></label>
        </div>
        <div className="g-two">
          <label>Zakázka / č. objednávky<input className="input" value={f.zakazka} onChange={set('zakazka')} /></label>
          <label>Poznámka na faktuře<input className="input" value={f.poznamka} onChange={set('poznamka')} /></label>
        </div>

        <div>
          <div className="items-head small muted hide-m"><span>Množství</span><span>Popis</span><span className="r">Cena za jednotku</span><span className="r">Celkem</span><span /></div>
          {items.map((it, i) => (
            <div className="item" key={i}>
              <div className="item-q">
                <input className="input" type="number" min="0" step="any" value={it.mnozstvi} onChange={(e) => setIt(i, 'mnozstvi', e.target.value)} aria-label="Množství" />
                <select className="select" value={it.jednotka} onChange={(e) => setIt(i, 'jednotka', e.target.value)} aria-label="Jednotka">
                  {['ks', 'km', 'obvod', 'hod', 'kpl'].map((j) => <option key={j}>{j}</option>)}
                </select>
              </div>
              <textarea className="input" rows={it.popis.includes('\n') ? 2 : 1} value={it.popis} onChange={(e) => setIt(i, 'popis', e.target.value)} placeholder="Popis položky" aria-label="Popis" />
              <input className="input r" type="number" min="0" step="any" value={it.cena_ks} onChange={(e) => setIt(i, 'cena_ks', e.target.value)} aria-label="Cena za jednotku" />
              <span className="num r item-sum">{fmtKc(Number(it.mnozstvi || 0) * Number(it.cena_ks || 0))}</span>
              <button className="btn ghost sm" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Odebrat položku">✕</button>
            </div>
          ))}
          <div className="bar" style={{ marginTop: 10 }}>
            <button className="btn ghost sm" onClick={() => setItems([...items, emptyItem()])}>Přidat prázdnou položku</button>
            <select
              className="select"
              value=""
              onChange={(e) => {
                const c = db.cenik.find((x) => x.id === Number(e.target.value))
                if (c) setItems([...items.filter((it) => it.popis || it.cena_ks), { mnozstvi: 1, jednotka: c.jednotka || 'ks', popis: c.polozka, cena_ks: c.cena }])
              }}
              aria-label="Přidat z ceníku"
            >
              <option value="">Přidat z ceníku…</option>
              {cenik.map((c) => <option key={c.id} value={c.id}>{c.polozka} – {fmtKc(c.cena)}</option>)}
            </select>
            {cekajici.length > 0 && (
              <button
                className="btn ghost sm"
                onClick={() => setItems([...items.filter((it) => it.popis || it.cena_ks), ...cekajici.map((r) => ({ mnozstvi: 1, jednotka: 'ks', popis: popisRevize(r, idx.objekt[r.objekt_id]), cena_ks: r.cena ?? '', revize_id: r.id }))])}
              >
                Přidat hotové revize tohoto klienta ({cekajici.length})
              </button>
            )}
          </div>
        </div>

        <div className="inv-total">
          <span className="muted">Celkem k úhradě (neplátce DPH)</span>
          <b className="num">{fmtKc(total)}</b>
        </div>
        <div className="actions">
          <a className="btn ghost" href="#/faktury" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Zrušit</a>
          <button className="btn" disabled={busy || !f.klient_id || !f.cislo || dupl || total <= 0} onClick={vystavit}>
            {busy ? 'Vystavuji…' : 'Vystavit fakturu'}
          </button>
        </div>
      </section>
      {toast}
    </>
  )
}

// --- tisk / PDF ------------------------------------------------------------
// faktura jako PDF (A4) ze stránky, stejně jak vypadá na obrazovce a při tisku
async function pdfZListu(el) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const c = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, windowWidth: 1000 })
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const w = 210
  const h = (c.height * w) / c.width
  const img = c.toDataURL('image/jpeg', 0.92)
  let y = 0
  for (let i = 0; y < h - 0.5; i++, y += 297) { if (i) pdf.addPage(); pdf.addImage(img, 'JPEG', 0, -y, w, h) }
  return pdf.output('blob')
}

function FakturaTisk({ id }) {
  const { db, idx } = useData()
  const f = db.faktury.find((x) => x.id === id)
  const [items, setItems] = useState(null)
  const [qr, setQr] = useState(null)
  const d = idx.nast.dodavatel || {}
  const k = f ? idx.klient[f.klient_id] : null
  const VS = f ? vs(f.cislo, f.rok) : ''
  const ref = useRef(null)
  const [mail, setMail] = useState(false)

  useEffect(() => {
    supabase.from('polozky_faktur').select('*').eq('faktura_id', id).order('id').then(({ data }) => setItems(data || []))
  }, [id])
  const spayd = useMemo(() => {
    if (!f || !d.iban) return null
    const dt = (f.datum_splatnosti || '').replace(/-/g, '')
    return `SPD*1.0*ACC:${d.iban.replace(/\s/g, '')}*AM:${Number(f.castka).toFixed(2)}*CC:CZK*X-VS:${VS}${dt ? `*DT:${dt}` : ''}*MSG:FAKTURA ${f.cislo}`
  }, [f, d.iban, VS])
  useEffect(() => {
    if (spayd) QRCode.toDataURL(spayd, { margin: 0, width: 240, errorCorrectionLevel: 'M' }).then(setQr)
  }, [spayd])

  if (!f) return <div className="panel muted">Faktura nenalezena. <a href="#/faktury">Zpět na faktury</a></div>
  const iban = (d.iban || '').replace(/(.{4})/g, '$1 ').trim()

  return (
    <>
      <div className="head no-print">
        <div>
          <h1>Faktura {f.cislo}</h1>
          <p>{k?.nazev} · {fmtKc(f.castka)} · splatnost {fmtDate(f.datum_splatnosti)}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn ghost" href="#/faktury" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Zpět</a>
          <button className="btn ghost" onClick={() => setMail(true)}>Odeslat e-mailem</button>
          <button className="btn" onClick={() => { const t = document.title; document.title = `FAKTURA č.${f.cislo.replace('/', '-20')} - ${k?.zkratka || ''}`; print(); document.title = t }}>Tisk / uložit PDF</button>
        </div>
      </div>
      {mail && (
        <OdeslatEmail
          title="Odeslat fakturu e-mailem"
          to={k?.email || ''}
          subject={`Faktura ${f.cislo}`}
          text={`Dobrý den,\n\nv příloze zasílám fakturu č. ${f.cislo} na částku ${kc(f.castka)} se splatností ${fmtDate(f.datum_splatnosti)}.\nVariabilní symbol: ${VS}\nČíslo účtu: ${d.ucet || ''}\n\nS pozdravem\n${d.jmeno || ''}${d.telefon ? `\n${d.telefon}` : ''}`}
          priprav={async () => [{ name: `FAKTURA č.${f.cislo.replace('/', '-20')} - ${k?.zkratka || ''}.pdf`, blob: await pdfZListu(ref.current) }]}
          onClose={() => setMail(false)}
        />
      )}
      {!d.jmeno && <div className="panel err no-print">Chybí údaje dodavatele (tabulka nastavení).</div>}
      <div className="sheet-wrap">
        <article className="sheet" ref={ref}>
          <header className="inv-top">
            <div className="inv-title">FAKTURA č.{f.cislo}</div>
            <dl className="inv-dates">
              <dt>Datum vystavení</dt><dd>{fmtDate(f.datum_vystaveni)}</dd>
              <dt>Datum splatnosti</dt><dd>{fmtDate(f.datum_splatnosti)}</dd>
              <dt>Forma úhrady</dt><dd>bankovním převodem</dd>
            </dl>
          </header>
          <div className="inv-parties">
            <div>
              <div className="inv-lbl">Dodavatel</div>
              <b>{d.jmeno}</b>
              <div>{d.ulice}</div>
              <div>{d.mesto}</div>
              <div>{d.zeme}</div>
              <div className="inv-small">
                {d.telefon && <div>Tel: {d.telefon}</div>}
                {d.email && <div>Email: {d.email}</div>}
                <div>IČO: {d.ico}</div>
                {d.dic && <div>DIČ: {d.dic}</div>}
                <div>{d.poznamka}</div>
              </div>
            </div>
            <div>
              <div className="inv-bank">
                <div><span>Banka</span>{d.banka}</div>
                <div><span>Číslo účtu</span><b>{d.ucet}</b></div>
                <div><span>IBAN</span>{iban}</div>
              </div>
              <div className="inv-lbl" style={{ marginTop: 14 }}>Odběratel</div>
              <b>{k?.nazev}</b>
              {(k?.adresa || '').split(',').map((s) => <div key={s}>{s.trim()}</div>)}
              <div className="inv-small">
                {k?.ico && <div>IČO: {k.ico}</div>}
                {k?.dic && <div>DIČ: {k.dic}</div>}
              </div>
            </div>
          </div>
          <div className="inv-strip">
            <div><span>Zakázka / č. objednávky</span>{f.zakazka || '–'}</div>
            <div><span>Číslo účtu</span>{d.ucet}</div>
            <div><span>Variabilní symbol</span><b>{VS}</b></div>
            <div><span>Datum splatnosti</span>{fmtDate(f.datum_splatnosti)}</div>
          </div>
          <table className="inv-items">
            <thead>
              <tr><th>Množství</th><th>Popis</th><th className="r">Cena za 1 ks</th><th className="r">Celkem</th></tr>
            </thead>
            <tbody>
              {items === null && <tr><td colSpan="4">Načítám položky…</td></tr>}
              {items?.length === 0 && <tr><td colSpan="4">{f.zakazka || 'Fakturujeme Vám'}</td></tr>}
              {items?.map((it) => (
                <tr key={it.id}>
                  <td className="nw">{it.mnozstvi}</td>
                  <td style={{ whiteSpace: 'pre-line' }}>{it.popis}</td>
                  <td className="r nw">{it.cena_ks != null ? kc(it.cena_ks) : ''}</td>
                  <td className="r nw">{it.celkem != null ? kc(it.celkem) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="inv-foot">
            <div className="inv-sign">
              {f.poznamka && <div style={{ marginBottom: 10 }}>{f.poznamka}</div>}
              <div className="inv-lbl">Razítko a podpis</div>
              <div className="inv-signbox" />
            </div>
            <div className="inv-sum">
              <div><span>Mezisoučet</span>{kc(f.castka)}</div>
              <div><span>DPH</span>Neplátce DPH</div>
              <div className="inv-grand"><span>Celkem k úhradě</span>{kc(f.castka)}</div>
              {qr && (
                <div className="inv-qr">
                  <img src={qr} alt="QR platba" width="120" height="120" />
                  <span>QR platba</span>
                </div>
              )}
            </div>
          </div>
        </article>
      </div>
    </>
  )
}
