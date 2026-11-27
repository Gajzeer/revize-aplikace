import { useMemo, useState } from 'react'
import { useData } from '../data'
import { fmtKc, norm } from '../lib'
import { Modal, useToast } from '../ui'

export default function Cenik() {
  const { db, idx } = useData()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)
  const [toast, say] = useToast()

  const groups = useMemo(() => {
    const t = norm(q)
    const g = {}
    db.cenik
      .filter((c) => !t || norm(`${c.polozka} ${c.poznamka} ${idx.klient[c.klient_id]?.nazev}`).includes(t))
      .forEach((c) => (g[c.klient_id || 0] ||= []).push(c))
    return Object.entries(g)
      .map(([kid, items]) => [Number(kid), items.sort((a, b) => a.polozka.localeCompare(b.polozka, 'cs'))])
      .sort((a, b) => (a[0] === 0 ? -1 : b[0] === 0 ? 1 : (idx.klient[a[0]]?.nazev || '').localeCompare(idx.klient[b[0]]?.nazev || '', 'cs')))
  }, [db, q])

  return (
    <>
      <div className="head">
        <div>
          <h1>Ceník</h1>
          <p>Ceny podle klientů, převzaté z vašich faktur</p>
        </div>
        <button className="btn" onClick={() => setEdit({ jednotka: 'ks' })}>Přidat položku</button>
      </div>
      <div className="bar">
        <input className="input" placeholder="Hledat položku nebo klienta" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {groups.length === 0 && <div className="empty">Nic nenalezeno.</div>}
      <div className="stack">
        {groups.map(([kid, items]) => (
          <section className="panel" key={kid}>
            <h2>{kid ? idx.klient[kid]?.zkratka || idx.klient[kid]?.nazev : 'Obecný ceník'}</h2>
            <div className="rows">
              {items.map((c) => (
                <button key={c.id} className="row rowbtn" onClick={() => setEdit(c)}>
                  <div>
                    <div className="t">{c.polozka}</div>
                    {c.poznamka && <div className="s">{c.poznamka}</div>}
                  </div>
                  <div className="num" style={{ whiteSpace: 'nowrap' }}>
                    {fmtKc(c.cena)} <span className="faint small">/ {c.jednotka}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {edit && <CenikForm initial={edit} onClose={() => setEdit(null)} onSaved={() => say('Položka uložena')} />}
      {toast}
    </>
  )
}

function CenikForm({ initial, onClose, onSaved }) {
  const { db, save, remove } = useData()
  const [c, setC] = useState(initial)
  const set = (k) => (e) => setC({ ...c, [k]: e.target.value })
  return (
    <Modal title={c.id ? 'Upravit položku' : 'Nová položka ceníku'} onClose={onClose}>
      <label>
        Klient
        <select className="select" value={c.klient_id || ''} onChange={set('klient_id')}>
          <option value="">Obecný ceník</option>
          {db.klienti.map((k) => <option key={k.id} value={k.id}>{k.zkratka || k.nazev}</option>)}
        </select>
      </label>
      <label>Položka<input className="input" value={c.polozka || ''} onChange={set('polozka')} /></label>
      <div className="two">
        <label>Cena (Kč)<input className="input" type="number" min="0" value={c.cena ?? ''} onChange={set('cena')} /></label>
        <label>Jednotka<input className="input" value={c.jednotka || ''} onChange={set('jednotka')} /></label>
      </div>
      <label>Poznámka<input className="input" value={c.poznamka || ''} onChange={set('poznamka')} /></label>
      <div className="actions">
        {c.id && remove && (
          <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={async () => { await remove('cenik', c.id); onClose() }}>Smazat</button>
        )}
        <button className="btn ghost" onClick={onClose}>Zrušit</button>
        <button
          className="btn"
          disabled={!c.polozka || c.cena === '' || c.cena == null}
          onClick={async () => {
            await save('cenik', { ...c, klient_id: c.klient_id ? Number(c.klient_id) : null, cena: Number(c.cena) })
            onSaved()
            onClose()
          }}
        >
          Uložit položku
        </button>
      </div>
    </Modal>
  )
}
