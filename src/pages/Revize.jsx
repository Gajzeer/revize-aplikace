import { useMemo, useState } from 'react'
import { useData } from '../data'
import { TODAY, addMonths, fmtDate, fmtKc, iso, norm, parse } from '../lib'
import { Due, Modal, Seg, useToast } from '../ui'
import { cekaFakturace, molRok } from '../mol'

export default function Revize() {
  const { db, idx, save } = useData()
  const [q, setQ] = useState('')
  const [kl, setKl] = useState('')
  const [range, setRange] = useState('90')
  const [view, setView] = useState('terminy') // terminy | fakturace | mol
  const [done, setDone] = useState(null)
  const [edit, setEdit] = useState(null)
  const [open, setOpen] = useState({})
  const [toast, say] = useToast()

  // revize v pohledu, seskupené po objektech (benzinka = jeden řádek)
  const Y = TODAY().getFullYear()
  const mol = useMemo(() => molRok(db, Y), [db, Y])
  const fak = useMemo(() => cekaFakturace(db), [db])
  const fakSum = fak.reduce((a, r) => a + Number(r.cena || 0), 0)
  const fakObj = new Set(fak.map((r) => r.objekt_id)).size

  const groups = useMemo(() => {
    const t = norm(q)
    const lim = range === 'all' ? null : range === 'late' ? iso(TODAY()) : iso(addMonths(TODAY(), range === '30' ? 1 : 3))
    const g = {}
    const base =
      view === 'fakturace' ? cekaFakturace(db)
      : view === 'mol' ? mol.zbyva
      : db.revize.filter((r) => r.stav !== 'archiv')
    base
      .map((r) => ({ ...r, o: idx.objekt[r.objekt_id] }))
      .filter((r) => !kl || String(r.o?.klient_id) === kl)
      .filter((r) => view !== 'terminy' || !lim || (r.pristi && (range === 'late' ? r.pristi < lim : r.pristi <= lim)))
      .filter((r) => !t || norm(`${r.o?.nazev} ${r.o?.adresa} ${r.typ} ${r.o?.kod}`).includes(t))
      .forEach((r) => (g[r.objekt_id] ||= { o: r.o, id: r.objekt_id, rv: [] }).rv.push(r))
    return Object.values(g)
      .map((x) => {
        x.rv.sort((a, b) => (a.pristi || '9999').localeCompare(b.pristi || '9999'))
        x.next = x.rv[0]?.pristi
        x.cena = x.rv.reduce((a, r) => a + Number(r.cena || 0), 0)
        return x
      })
      .sort((a, b) => (a.next || '9999').localeCompare(b.next || '9999') || (a.o?.nazev || '').localeCompare(b.o?.nazev || ''))
  }, [db, q, kl, range, view, mol])

  const sum = groups.reduce((a, x) => a + x.cena, 0)
  const nrev = groups.reduce((a, x) => a + x.rv.length, 0)
  const klienti = db.klienti.filter((k) => db.objekty.some((o) => o.klient_id === k.id))

  return (
    <>
      <div className="head">
        <div>
          <h1>Revize a termíny</h1>
          <p>{groups.length} objektů, {nrev} revizí{sum > 0 && <> · celkem podle ceníku {fmtKc(sum)}</>}</p>
        </div>
        <button className="btn" onClick={() => setEdit({ typ: '', lhuta_mesicu: 12 })}>Přidat revizi</button>
      </div>
      <div className="bar">
        <input className="input" placeholder="Hledat objekt, adresu nebo typ" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={kl} onChange={(e) => setKl(e.target.value)} aria-label="Klient">
          <option value="">Všichni klienti</option>
          {klienti.map((k) => (
            <option key={k.id} value={k.id}>{idx.label[k.id]}</option>
          ))}
        </select>
        {view === 'terminy' && <Seg value={range} onChange={setRange} options={[['late', 'Po termínu'], ['30', 'Do měsíce'], ['90', 'Do 3 měsíců'], ['all', 'Vše']]} />}
      </div>

      <div className="sumcards">
        <button className={`sumcard ${view === 'fakturace' ? 'on' : ''}`} onClick={() => setView(view === 'fakturace' ? 'terminy' : 'fakturace')} aria-pressed={view === 'fakturace'}>
          <span className="sc-l">Hotovo, čeká na fakturaci</span>
          <span className="sc-v num">{fmtKc(fakSum)}</span>
          <span className="sc-s">{fakObj ? `${fakObj} ${fakObj === 1 ? 'objekt' : fakObj < 5 ? 'objekty' : 'objektů'}, ${fak.length} revizí` : 'nic nečeká'}</span>
        </button>
        <button className={`sumcard mol ${view === 'mol' ? 'on' : ''}`} onClick={() => setView(view === 'mol' ? 'terminy' : 'mol')} aria-pressed={view === 'mol'}>
          <span className="sc-l">MOL zbývá do 31. 12. {Y}</span>
          <span className="sc-v num">{fmtKc(mol.sumZ)}</span>
          <span className="sc-s">{mol.stanicZ} stanic, {mol.zbyva.length} revizí · letos hotovo {fmtKc(mol.sumH)}</span>
        </button>
      </div>
      {view !== 'terminy' && (
        <div className="small muted" style={{ margin: '-4px 0 12px' }}>
          {view === 'fakturace' ? 'Revize provedené, ale ještě nevyfakturované. Vystavit fakturu ji připraví i s položkami; Vyfakturováno ji jen odebere ze seznamu.' : 'Stanice MOL, kde letos ještě chybí revize s termínem do konce roku.'}{' '}
          <button className="link" onClick={() => setView('terminy')}>Zpět na termíny</button>
        </div>
      )}

      {groups.length === 0 && <div className="panel muted">V tomto výběru nic není. Zkuste delší období.</div>}
      <div className="objlist">
        {groups.map((x) => {
          const isOpen = open[x.id]
          return (
            <section key={x.id} className={`obj ${isOpen ? 'open' : ''}`}>
              <div className="obj-head">
                <button className="obj-main" onClick={() => setOpen({ ...open, [x.id]: !isOpen })} aria-expanded={!!isOpen}>
                  <span className="obj-name">{x.o?.nazev}</span>
                  <span className="small muted">{x.o?.adresa}</span>
                  <span className="obj-types">
                    {x.rv.map((r) => <span key={r.id} className="chip">{r.typ}</span>)}
                  </span>
                </button>
                <div className="obj-side">
                  {view === 'fakturace' ? <span className="small muted">hotovo {fmtDate(x.rv[0]?.posledni)}</span> : <Due date={x.next} />}
                  <span className="obj-price num">{x.cena ? fmtKc(x.cena) : ''}</span>
                  {view === 'fakturace' ? (
                    <>
                    <a className="btn sm" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }} href={`#/faktura/nova/${x.rv.map((r) => r.id).join(',')}`}>Vystavit fakturu</a>
                    <button
                      className="btn ghost sm"
                      title="Fakturu jste vystavil jinde – jen odebrat ze seznamu"
                      onClick={async () => {
                        try {
                          for (const r of x.rv) await save('revize', { id: r.id, stav: 'planovano' })
                          say(`${x.o?.nazev}: vyfakturováno`)
                        } catch (e) {
                          say('Uložení selhalo: ' + e.message)
                        }
                      }}
                    >
                      Vyfakturováno
                    </button>
                    </>
                  ) : (
                  <button className="btn ghost sm" onClick={() => setDone({ o: x.o, rv: x.rv, datum: iso(TODAY()), sel: Object.fromEntries(x.rv.map((r) => [r.id, !r.pristi || r.pristi <= iso(addMonths(TODAY(), 3))])), ceka: true })}>Hotovo</button>
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="obj-detail">
                  {x.rv.map((r) => (
                    <div key={r.id} className={`obj-rev ${r.stav === 'ceka_fakturace' ? 'wait' : ''}`}>
                      <button className="link" style={{ color: 'var(--ink)', textAlign: 'left' }} onClick={() => setEdit(r)} title="Upravit revizi">
                        {r.typ}
                      </button>
                      <span className="small faint">naposledy {fmtDate(r.posledni)}{r.lhuta_mesicu ? `, lhůta ${r.lhuta_mesicu} měs.` : ''}{r.stav === 'ceka_fakturace' ? ' · čeká na fakturaci' : ''}</span>
                      <Due date={r.pristi} />
                      <span className="num small" style={{ textAlign: 'right' }}>{r.cena ? fmtKc(r.cena) : ''}</span>
                    </div>
                  ))}
                  {(x.o?.vedouci || x.o?.telefon) && <div className="small muted">{[x.o.vedouci, x.o.telefon].filter(Boolean).join(' · ')}</div>}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {done && (
        <Modal title="Zapsat provedené revize" onClose={() => setDone(null)}>
          <div><b>{done.o?.nazev}</b></div>
          <label>
            Datum provedení
            <input className="input" type="date" value={done.datum} onChange={(e) => setDone({ ...done, datum: e.target.value })} />
          </label>
          <div style={{ display: 'grid', gap: 6 }}>
            {done.rv.map((r) => (
              <label key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500, color: 'var(--ink)' }}>
                <input type="checkbox" checked={!!done.sel[r.id]} onChange={(e) => setDone({ ...done, sel: { ...done.sel, [r.id]: e.target.checked } })} />
                <span style={{ flex: 1 }}>{r.typ}</span>
                <span className="small faint">příště {r.lhuta_mesicu ? fmtDate(iso(addMonths(parse(done.datum), r.lhuta_mesicu))) : 'ručně'}</span>
              </label>
            ))}
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 500, color: 'var(--ink)' }}>
            <input type="checkbox" checked={!!done.ceka} onChange={(e) => setDone({ ...done, ceka: e.target.checked })} style={{ marginTop: 3 }} />
            <span>Ještě nevyfakturováno<span className="small muted" style={{ display: 'block', fontWeight: 400 }}>Zařadí se do „Hotovo, čeká na fakturaci“, dokud nedopíšete zprávu a nevystavíte fakturu.</span></span>
          </label>
          <div className="muted small">
            K fakturaci: {fmtKc(done.rv.filter((r) => done.sel[r.id]).reduce((a, r) => a + Number(r.cena || 0), 0))}
          </div>
          <div className="actions">
            <button className="btn ghost" onClick={() => setDone(null)}>Zrušit</button>
            <button
              className="btn"
              disabled={!done.rv.some((r) => done.sel[r.id])}
              onClick={async () => {
                try {
                  const list = done.rv.filter((r) => done.sel[r.id])
                  for (const r of list) {
                    await save('revize', {
                      id: r.id,
                      posledni: done.datum,
                      stav: done.ceka ? 'ceka_fakturace' : 'planovano',
                      pristi: r.lhuta_mesicu ? iso(addMonths(parse(done.datum), r.lhuta_mesicu)) : r.pristi,
                    })
                  }
                  setDone(null)
                  say(list.length > 1 ? `Zapsáno ${list.length} revizí` : 'Revize zapsána')
                } catch (e) {
                  say('Uložení selhalo: ' + e.message)
                }
              }}
            >
              Zapsat revize
            </button>
          </div>
        </Modal>
      )}

      {edit && <RevizeForm initial={edit} onClose={() => setEdit(null)} onSaved={(m) => say(m)} />}
      {toast}
    </>
  )
}

function RevizeForm({ initial, onClose, onSaved }) {
  const { db, save, remove } = useData()
  const [r, setR] = useState(initial)
  const [confirm, setConfirm] = useState(false)
  const set = (k) => (e) => setR({ ...r, [k]: e.target.value })
  const objekty = [...db.objekty].sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs'))
  return (
    <Modal title={r.id ? 'Upravit revizi' : 'Nová revize'} onClose={onClose}>
      <label>
        Objekt
        <select className="select" value={r.objekt_id || ''} onChange={set('objekt_id')}>
          <option value="">Vyberte objekt</option>
          {objekty.map((o) => (
            <option key={o.id} value={o.id}>{o.nazev}</option>
          ))}
        </select>
      </label>
      <label>
        Typ revize
        <input className="input" value={r.typ} onChange={set('typ')} placeholder="např. Elektrické spotřebiče" />
      </label>
      <div className="two">
        <label>
          Lhůta (měsíce)
          <input className="input" type="number" min="1" value={r.lhuta_mesicu || ''} onChange={set('lhuta_mesicu')} />
        </label>
        <label>
          Cena (Kč)
          <input className="input" type="number" min="0" value={r.cena || ''} onChange={set('cena')} />
        </label>
      </div>
      <div className="two">
        <label>
          Poslední revize
          <input className="input" type="date" value={r.posledni || ''} onChange={set('posledni')} />
        </label>
        <label>
          Příští termín
          <input className="input" type="date" value={r.pristi || ''} onChange={set('pristi')} />
        </label>
      </div>
      <label>
        Poznámka
        <input className="input" value={r.poznamka || ''} onChange={set('poznamka')} />
      </label>
      <div className="actions">
        {r.id && (
          confirm ? (
            <button className="btn danger" style={{ marginRight: 'auto' }} onClick={async () => { await remove('revize', r.id); onSaved('Revize smazána'); onClose() }}>Opravdu smazat</button>
          ) : (
            <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => setConfirm(true)}>Smazat</button>
          )
        )}
        <button className="btn ghost" onClick={onClose}>Zrušit</button>
        <button
          className="btn"
          disabled={!r.objekt_id || !r.typ}
          onClick={async () => {
            const lh = r.lhuta_mesicu ? Number(r.lhuta_mesicu) : null
            const pristi = r.pristi || (r.posledni && lh ? iso(addMonths(parse(r.posledni), lh)) : null)
            await save('revize', {
              ...(r.id ? { id: r.id } : {}),
              objekt_id: Number(r.objekt_id), typ: r.typ, lhuta_mesicu: lh,
              cena: r.cena ? Number(r.cena) : null, posledni: r.posledni || null, pristi,
              poznamka: r.poznamka || null,
            })
            onSaved(r.id ? 'Revize uložena' : 'Revize přidána')
            onClose()
          }}
        >
          {r.id ? 'Uložit revizi' : 'Přidat revizi'}
        </button>
      </div>
    </Modal>
  )
}

