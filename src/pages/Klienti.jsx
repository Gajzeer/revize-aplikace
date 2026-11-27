import { useMemo, useState } from 'react'
import { useData } from '../data'
import { TODAY, fmtDate, fmtKc, norm } from '../lib'
import { Due, Modal, useToast } from '../ui'

export default function Klienti({ sub }) {
  const id = sub?.[0] ? Number(sub[0]) : null
  return id ? <Detail id={id} /> : <Seznam />
}

function Seznam() {
  const { db, idx } = useData()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)
  const Y = TODAY().getFullYear()
  const list = useMemo(() => {
    const t = norm(q)
    return db.klienti
      .map((k) => {
        const f = db.faktury.filter((x) => x.klient_id === k.id)
        const sum = (l) => l.reduce((a, x) => a + Number(x.castka), 0)
        const obj = db.objekty.filter((o) => o.klient_id === k.id)
        return { ...k, letos: sum(f.filter((x) => x.rok === Y)), celkem: sum(f), nf: f.length, no: obj.length, hay: norm(`${k.nazev} ${k.zkratka} ${k.ico} ${k.adresa} ${k.poznamka} ${obj.map((o) => `${o.nazev} ${o.adresa}`).join(' ')}`) }
      })
      .filter((k) => !t || k.hay.includes(t))
      .sort((a, b) => b.celkem - a.celkem)
  }, [db, q])

  return (
    <>
      <div className="head">
        <div>
          <h1>Klienti</h1>
          <p>{db.klienti.length} klientů, {db.objekty.length} objektů</p>
        </div>
        <button className="btn" onClick={() => setEdit({})}>Přidat klienta</button>
      </div>
      <div className="bar">
        <input className="input" placeholder="Hledat klienta, IČO, adresu nebo objekt (např. MOL)" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="kgrid">
        {list.map((k) => (
          <button key={k.id} className="kcard" onClick={() => (location.hash = `#/klienti/${k.id}`)}>
            <span className="abbr">{k.zkratka ? idx.label[k.id] : k.nazev.split(' ').slice(0, 2).join(' ')}</span>
            <span className="muted small">{k.nazev}{k.ico ? ` · IČO ${k.ico}` : ''}</span>
            <span className="meta">
              <span>Letos <b className="num" style={{ color: 'var(--ink)' }}>{fmtKc(k.letos)}</b></span>
              <span className="num">celkem {fmtKc(k.celkem)}</span>
            </span>
            <span className="meta">
              <span>{k.no} objektů</span>
              <span>{k.nf} faktur</span>
            </span>
          </button>
        ))}
      </div>
      {edit && <KlientForm initial={edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function Detail({ id }) {
  const { db } = useData()
  const k = db.klienti.find((x) => x.id === id)
  const [edit, setEdit] = useState(null)
  const [obj, setObj] = useState(null)
  const [q, setQ] = useState('')
  const [toast, say] = useToast()
  const objekty = useMemo(() => {
    const t = norm(q)
    return db.objekty
      .filter((o) => o.klient_id === id && (!t || norm(`${o.nazev} ${o.adresa} ${o.vedouci}`).includes(t)))
      .map((o) => {
        const rv = db.revize.filter((r) => r.objekt_id === o.id && r.stav !== 'archiv')
        const next = rv.map((r) => r.pristi).filter(Boolean).sort()[0]
        return { ...o, rv, next }
      })
      .sort((a, b) => (a.next || '9999').localeCompare(b.next || '9999'))
  }, [db, id, q])
  const fak = db.faktury.filter((f) => f.klient_id === id).sort((a, b) => (b.datum_vystaveni || '').localeCompare(a.datum_vystaveni || ''))
  const years = [...new Set(fak.map((f) => f.rok))].sort((a, b) => b - a)
  if (!k) return <div>Klient nenalezen.</div>

  return (
    <>
      <div className="back"><a href="#/klienti" className="small">Zpět na klienty</a></div>
      <div className="head">
        <div>
          <h1>{k.nazev}</h1>
          <p>{[k.ico && `IČO ${k.ico}`, k.dic && `DIČ ${k.dic}`, k.adresa].filter(Boolean).join(' · ')}</p>
        </div>
        <button className="btn ghost" onClick={() => setEdit(k)}>Upravit</button>
      </div>

      <div className="grid g-dash">
        <div className="stack">
          <section className="panel">
            <h2>
              Objekty a revize ({objekty.length})
              <button className="link small" onClick={() => setObj({ klient_id: id })}>Přidat objekt</button>
            </h2>
            {db.objekty.filter((o) => o.klient_id === id).length > 8 && (
              <input className="input" style={{ width: '100%', marginBottom: 10 }} placeholder="Hledat objekt" value={q} onChange={(e) => setQ(e.target.value)} />
            )}
            {objekty.length === 0 && <div className="empty">Zatím žádné objekty. Přidejte první objekt, ať můžete hlídat jeho revize.</div>}
            <div className="rows">
              {objekty.map((o) => (
                <details key={o.id} className="row" style={{ display: 'block' }}>
                  <summary style={{ display: 'flex', justifyContent: 'space-between', gap: 12, cursor: 'pointer', listStyle: 'none' }}>
                    <span>
                      <span className="t">{o.nazev}</span>
                      <span className="s" style={{ display: 'block' }}>{o.adresa}</span>
                    </span>
                    {o.next ? <Due date={o.next} showDate={false} /> : <span className="faint small">bez termínu</span>}
                  </summary>
                  <div style={{ padding: '10px 0 4px', display: 'grid', gap: 6 }}>
                    {(o.vedouci || o.telefon) && (
                      <div className="small muted">{[o.vedouci, o.telefon].filter(Boolean).join(' · ')}</div>
                    )}
                    {o.rv.map((r) => (
                      <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                        <span>{r.typ} <span className="faint">· naposledy {fmtDate(r.posledni)}</span></span>
                        <Due date={r.pristi} />
                      </div>
                    ))}
                    <div><button className="link small" onClick={() => setObj(o)}>Upravit objekt</button></div>
                  </div>
                </details>
              ))}
            </div>
          </section>
        </div>
        <div className="stack">
          {k.poznamka && (
            <section className="panel">
              <h2>Poznámka</h2>
              <div style={{ whiteSpace: 'pre-wrap' }}>{k.poznamka}</div>
            </section>
          )}
          <section className="panel">
            <h2>Kontakt</h2>
            <dl className="facts">
              <dt>Osoba</dt><dd>{k.kontakt || '–'}</dd>
              <dt>Telefon</dt><dd>{k.telefon ? <a href={`tel:${k.telefon}`}>{k.telefon}</a> : '–'}</dd>
              <dt>E-mail</dt><dd>{k.email ? <a href={`mailto:${k.email}`}>{k.email}</a> : '–'}</dd>
            </dl>
          </section>
          <section className="panel">
            <h2>Fakturace</h2>
            {years.length === 0 && <div className="empty">Zatím žádné faktury.</div>}
            <div className="rows">
              {years.map((y) => {
                const l = fak.filter((f) => f.rok === y)
                return (
                  <div className="row" key={y}>
                    <div className="t">{y}</div>
                    <div className="num">{fmtKc(l.reduce((a, f) => a + Number(f.castka), 0))} <span className="faint small">({l.length})</span></div>
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 8 }}><a className="small" href={`#/faktury/${id}`}>Zobrazit faktury klienta</a></div>
          </section>
        </div>
      </div>
      {edit && <KlientForm initial={edit} onClose={() => setEdit(null)} onSaved={() => say('Klient uložen')} />}
      {obj && <ObjektForm initial={obj} onClose={() => setObj(null)} onSaved={() => say('Objekt uložen')} />}
      {toast}
    </>
  )
}

function KlientForm({ initial, onClose, onSaved }) {
  const { save } = useData()
  const [k, setK] = useState(initial)
  const f = (key, label, type = 'text') => (
    <label>
      {label}
      <input className="input" type={type} value={k[key] || ''} onChange={(e) => setK({ ...k, [key]: e.target.value })} />
    </label>
  )
  return (
    <Modal title={k.id ? 'Upravit klienta' : 'Nový klient'} onClose={onClose}>
      {f('nazev', 'Název')}
      <div className="two">{f('zkratka', 'Zkratka')}{f('ico', 'IČO')}</div>
      <div className="two">{f('dic', 'DIČ')}{f('kontakt', 'Kontaktní osoba')}</div>
      <div className="two">{f('telefon', 'Telefon', 'tel')}{f('email', 'E-mail', 'email')}</div>
      {f('adresa', 'Adresa')}
      <label>
        Poznámka
        <textarea className="input" style={{ height: 90, padding: 10 }} value={k.poznamka || ''} onChange={(e) => setK({ ...k, poznamka: e.target.value })} />
      </label>
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>Zrušit</button>
        <button className="btn" disabled={!k.nazev} onClick={async () => { const { created_at, ...row } = k; await save('klienti', row); onSaved?.(); onClose() }}>
          Uložit klienta
        </button>
      </div>
    </Modal>
  )
}

function ObjektForm({ initial, onClose, onSaved }) {
  const { save } = useData()
  const [o, setO] = useState(initial)
  const f = (key, label) => (
    <label>
      {label}
      <input className="input" value={o[key] || ''} onChange={(e) => setO({ ...o, [key]: e.target.value })} />
    </label>
  )
  return (
    <Modal title={o.id ? 'Upravit objekt' : 'Nový objekt'} onClose={onClose}>
      {f('nazev', 'Název')}
      <div className="two">{f('kod', 'Kód')}{f('typ', 'Typ objektu')}</div>
      {f('adresa', 'Adresa')}
      <div className="two">{f('vedouci', 'Vedoucí / kontakt')}{f('telefon', 'Telefon')}</div>
      {f('poznamka', 'Poznámka')}
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>Zrušit</button>
        <button className="btn" disabled={!o.nazev} onClick={async () => { const { created_at, rv, next, ...row } = o; await save('objekty', row); onSaved?.(); onClose() }}>
          Uložit objekt
        </button>
      </div>
    </Modal>
  )
}
