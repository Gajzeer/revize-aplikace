import { useMemo, useState } from 'react'
import { useData } from '../data'
import { TODAY, addMonths, fmtDate, fmtKc, iso, norm, parse } from '../lib'
import { Due, Modal, Seg, useToast } from '../ui'

export default function Revize() {
  const { db, idx, save } = useData()
  const [q, setQ] = useState('')
  const [kl, setKl] = useState('')
  const [range, setRange] = useState('90')
  const [done, setDone] = useState(null)
  const [edit, setEdit] = useState(null)
  const [toast, say] = useToast()

  const rows = useMemo(() => {
    const t = norm(q)
    const lim = range === 'all' ? null : range === 'late' ? iso(TODAY()) : iso(addMonths(TODAY(), range === '30' ? 1 : 3))
    return db.revize
      .map((r) => ({ ...r, o: idx.objekt[r.objekt_id] }))
      .filter((r) => !kl || String(r.o?.klient_id) === kl)
      .filter((r) => !lim || (r.pristi && (range === 'late' ? r.pristi < lim : r.pristi <= lim)))
      .filter((r) => !t || norm(`${r.o?.nazev} ${r.o?.adresa} ${r.typ} ${r.o?.kod}`).includes(t))
      .sort((a, b) => (a.pristi || '9999').localeCompare(b.pristi || '9999') || (a.o?.nazev || '').localeCompare(b.o?.nazev || ''))
  }, [db, q, kl, range])

  const sum = rows.reduce((a, r) => a + Number(r.cena || 0), 0)
  const klienti = db.klienti.filter((k) => db.objekty.some((o) => o.klient_id === k.id))

  return (
    <>
      <div className="head">
        <div>
          <h1>Revize a termíny</h1>
          <p>{rows.length} revizí v pohledu{sum > 0 && <> · hodnota podle ceníku {fmtKc(sum)}</>}</p>
        </div>
        <button className="btn" onClick={() => setEdit({ typ: '', lhuta_mesicu: 12 })}>Přidat revizi</button>
      </div>
      <div className="bar">
        <input className="input" placeholder="Hledat objekt, adresu nebo typ" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={kl} onChange={(e) => setKl(e.target.value)} aria-label="Klient">
          <option value="">Všichni klienti</option>
          {klienti.map((k) => (
            <option key={k.id} value={k.id}>{k.zkratka || k.nazev}</option>
          ))}
        </select>
        <Seg value={range} onChange={setRange} options={[['late', 'Po termínu'], ['30', 'Do měsíce'], ['90', 'Do 3 měsíců'], ['all', 'Vše']]} />
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Objekt</th>
              <th className="hide-m">Revize</th>
              <th className="hide-m">Poslední</th>
              <th>Příští</th>
              <th className="r hide-m">Cena</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan="6" className="muted">V tomto výběru nic není. Zkuste delší období.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.o?.nazev}</div>
                  <div className="small muted">{r.o?.adresa}</div>
                  <div className="small show-m" style={{ marginTop: 2 }}>{r.typ}</div>
                </td>
                <td className="hide-m">
                  {r.typ}
                  {r.lhuta_mesicu && <div className="small faint">lhůta {r.lhuta_mesicu} měs.</div>}
                </td>
                <td className="num hide-m">{fmtDate(r.posledni)}</td>
                <td><Due date={r.pristi} /></td>
                <td className="r num hide-m">{r.cena ? fmtKc(r.cena) : ''}</td>
                <td className="r">
                  <button className="btn ghost sm" onClick={() => setDone({ ...r, datum: iso(TODAY()) })}>Hotovo</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {done && (
        <Modal title="Zapsat provedenou revizi" onClose={() => setDone(null)}>
          <div>
            <b>{done.o?.nazev}</b>
            <div className="muted">{done.typ}</div>
          </div>
          <label>
            Datum provedení
            <input className="input" type="date" value={done.datum} onChange={(e) => setDone({ ...done, datum: e.target.value })} />
          </label>
          <div className="muted small">
            Příští termín: {done.lhuta_mesicu ? fmtDate(iso(addMonths(parse(done.datum), done.lhuta_mesicu))) : 'bez lhůty, doplňte ručně'}
          </div>
          <div className="actions">
            <button className="btn ghost" onClick={() => setDone(null)}>Zrušit</button>
            <button
              className="btn"
              onClick={async () => {
                try {
                  await save('revize', {
                    id: done.id,
                    posledni: done.datum,
                    pristi: done.lhuta_mesicu ? iso(addMonths(parse(done.datum), done.lhuta_mesicu)) : done.pristi,
                  })
                  setDone(null)
                  say('Revize zapsána')
                } catch (e) {
                  say('Uložení selhalo: ' + e.message)
                }
              }}
            >
              Zapsat revizi
            </button>
          </div>
        </Modal>
      )}

      {edit && <RevizeForm initial={edit} onClose={() => setEdit(null)} onSaved={() => say('Revize přidána')} />}
      {toast}
    </>
  )
}

function RevizeForm({ initial, onClose, onSaved }) {
  const { db, save } = useData()
  const [r, setR] = useState(initial)
  const set = (k) => (e) => setR({ ...r, [k]: e.target.value })
  const objekty = [...db.objekty].sort((a, b) => a.nazev.localeCompare(b.nazev, 'cs'))
  return (
    <Modal title="Nová revize" onClose={onClose}>
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
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>Zrušit</button>
        <button
          className="btn"
          disabled={!r.objekt_id || !r.typ}
          onClick={async () => {
            const lh = r.lhuta_mesicu ? Number(r.lhuta_mesicu) : null
            const pristi = r.pristi || (r.posledni && lh ? iso(addMonths(parse(r.posledni), lh)) : null)
            await save('revize', {
              objekt_id: Number(r.objekt_id), typ: r.typ, lhuta_mesicu: lh,
              cena: r.cena ? Number(r.cena) : null, posledni: r.posledni || null, pristi,
            })
            onSaved()
            onClose()
          }}
        >
          Přidat revizi
        </button>
      </div>
    </Modal>
  )
}

