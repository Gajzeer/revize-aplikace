import { useEffect, useRef, useState } from 'react'
import { useData } from '../data'
import { fmtDate, supabase } from '../lib'
import { Modal } from '../ui'
import { jeSitovaChyba } from '../offline'

const BUCKET = 'prilohy'
const isImg = (p) => (p.typ || '').startsWith('image/')
const velikost = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`)

// fotky z mobilu zmenší na rozumnou velikost (max 2000 px, JPEG), ať se rychle nahrají i přes data
async function zmensit(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 600e3) return file
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k)
    c.height = Math.round(bmp.height * k)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85))
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

export default function Prilohy({ objektId, open = true }) {
  const { db, save, remove, nahratPozdeji } = useData()
  const list = (db.prilohy || []).filter((p) => p.objekt_id === objektId).sort((a, b) => b.id - a.id)
  const [urls, setUrls] = useState({})
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [detail, setDetail] = useState(null)
  const [del, setDel] = useState(false)
  const foto = useRef(null)
  const soubor = useRef(null)
  const key = list.map((p) => p.id).join(',')

  useEffect(() => {
    const chybi = list.filter((p) => !urls[p.id] && p.id > 0)
    if (!open || !chybi.length) return
    supabase.storage.from(BUCKET).createSignedUrls(chybi.map((p) => p.cesta), 3600).then(({ data }) => {
      if (!data) return
      const m = {}
      data.forEach((d, i) => d.signedUrl && (m[chybi[i].id] = d.signedUrl))
      setUrls((u) => ({ ...u, ...m }))
    })
  }, [open, key])

  async function nahrat(files) {
    setErr(null)
    const arr = [...files]
    for (let i = 0; i < arr.length; i++) {
      setBusy(`Nahrávám ${i + 1} z ${arr.length}…`)
      try {
        const f = await zmensit(arr[i])
        const cesta = `objekt-${objektId}/${Date.now()}-${f.name.normalize('NFD').replace(/[^\w.-]+/g, '_')}`
        const row = { objekt_id: objektId, nazev: arr[i].name, cesta, typ: f.type || null, velikost: f.size }
        let offline = !navigator.onLine
        if (!offline) {
          const { error } = await supabase.storage.from(BUCKET).upload(cesta, f, { contentType: f.type || 'application/octet-stream' })
          if (error && jeSitovaChyba(error)) offline = true
          else if (error) throw error
        }
        if (offline) {
          await nahratPozdeji(row, f)
          setUrls((u) => ({ ...u, [cesta]: URL.createObjectURL(f) }))
        } else await save('prilohy', row)
      } catch (e) {
        setErr(`${arr[i].name}: ${e.message}`)
      }
    }
    setBusy(null)
  }

  async function smazat(p) {
    await supabase.storage.from(BUCKET).remove([p.cesta])
    await remove('prilohy', p.id)
    setDetail(null)
  }

  const fotky = list.filter(isImg)
  const docs = list.filter((p) => !isImg(p))
  return (
    <div className="prilohy">
      <div className="prilohy-bar">
        <span className="small" style={{ fontWeight: 600, color: 'var(--ink-2)' }}>Fotky a dokumenty{list.length ? ` (${list.length})` : ''}</span>
        <button className="link small" disabled={!!busy} onClick={() => foto.current.click()}>Vyfotit / přidat fotky</button>
        <button className="link small" disabled={!!busy} onClick={() => soubor.current.click()}>Přidat dokument</button>
        <input ref={foto} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { nahrat(e.target.files); e.target.value = '' }} />
        <input ref={soubor} type="file" multiple hidden onChange={(e) => { nahrat(e.target.files); e.target.value = '' }} />
      </div>
      {busy && <div className="small muted">{busy}</div>}
      {err && <div className="small err">Nahrání selhalo: {err}</div>}
      {fotky.length > 0 && (
        <div className="thumbs">
          {fotky.map((p) => (
            <button key={p.id} className="thumb" onClick={() => setDetail(p)} title={p.nazev}>
              {urls[p.id] || urls[p.cesta] ? <img src={urls[p.id] || urls[p.cesta]} alt={p.nazev} loading="lazy" /> : <span className="faint small">{p.ceka ? 'čeká' : '…'}</span>}
              {p.ceka && <span className="thumb-wait">čeká na signál</span>}
            </button>
          ))}
        </div>
      )}
      {docs.map((p) => (
        <div key={p.id} className="doc-row small">
          <a href={urls[p.id] || '#'} target="_blank" rel="noreferrer">{p.nazev}</a>
          <span className="faint">{p.ceka ? 'čeká na signál · ' : ''}{velikost(p.velikost || 0)} · {fmtDate(p.created_at?.slice(0, 10))}</span>
          <button className="link small" onClick={() => setDetail(p)}>…</button>
        </div>
      ))}
      {detail && (
        <Modal title={detail.nazev} onClose={() => { setDetail(null); setDel(false) }}>
          {isImg(detail) && urls[detail.id] && <img src={urls[detail.id]} alt={detail.nazev} style={{ width: '100%', borderRadius: 8 }} />}
          <div className="small muted">Přidáno {fmtDate(detail.created_at?.slice(0, 10))} · {velikost(detail.velikost || 0)}</div>
          <label>Popis
            <input className="input" defaultValue={detail.poznamka || ''} onBlur={(e) => e.target.value !== (detail.poznamka || '') && save('prilohy', { id: detail.id, poznamka: e.target.value || null })} placeholder="např. rozvaděč RH, štítek myčky" />
          </label>
          <div className="actions">
            <button className={`btn ${del ? 'danger' : 'ghost'}`} style={{ marginRight: 'auto' }} onClick={() => (del ? (setDel(false), smazat(detail)) : setDel(true))}>{del ? 'Opravdu smazat' : 'Smazat'}</button>
            {urls[detail.id] && <a className="btn ghost" href={urls[detail.id]} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Otevřít</a>}
            <button className="btn" onClick={() => setDetail(null)}>Zavřít</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
