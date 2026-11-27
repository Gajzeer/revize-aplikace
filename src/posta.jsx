// Odeslání e-mailu z aplikace (přes funkci „posta“ v Supabase a schránku majitele)
import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib'
import { Modal } from './ui'

const b64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob) })
const velikost = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`)

export async function odeslatEmail({ to, cc, subject, text, prilohy = [], kopieMne }) {
  const attachments = await Promise.all(prilohy.map(async (p) => ({ filename: p.name, content: await b64(p.blob), contentType: p.blob.type || undefined })))
  const { data, error } = await supabase.functions.invoke('posta', { body: { to, cc, subject, text, attachments, kopieMne } })
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).error || msg } catch { /* bez těla */ }
    if (/SMTP_USER|SMTP_PASS/.test(msg)) msg = 'Posílání ještě není nastavené: v Supabase chybí heslo ke schránce (SMTP_PASS v Edge Functions → Secrets).'
    else if (/Invalid login|535|auth/i.test(msg)) msg = 'Schránka odmítla přihlášení. Zkontrolujte heslo pro aplikace (SMTP_PASS) v Supabase.'
    else if (/Failed to send a request|fetch/i.test(msg)) msg = 'Bez připojení k internetu e-mail odeslat nejde.'
    throw new Error(msg)
  }
  return data
}

// priprav: async () => [{ name, blob }] – přílohy připravené aplikací (Word zprávy, PDF faktury…)
export function OdeslatEmail({ title = 'Odeslat e-mailem', to = '', subject = '', text = '', priprav, onClose, onSent }) {
  const [f, setF] = useState({ to, cc: '', subject, text, kopieMne: true })
  const [prilohy, setPrilohy] = useState([])
  const [stav, setStav] = useState(priprav ? 'Připravuji přílohy…' : null)
  const [busy, setBusy] = useState(false)
  const [hotovo, setHotovo] = useState(false)
  const file = useRef(null)

  useEffect(() => {
    if (!priprav) return
    let ok = true
    priprav().then((p) => { if (ok) { setPrilohy(p); setStav(null) } }).catch((e) => ok && setStav('Přílohu se nepodařilo připravit: ' + e.message))
    return () => { ok = false }
  }, [])

  async function odeslat() {
    setBusy(true)
    setStav('Odesílám…')
    try {
      await odeslatEmail({ ...f, prilohy })
      setHotovo(true)
      setStav(`Odesláno na ${f.to}.`)
      onSent?.(f)
    } catch (e) {
      setStav(e.message)
    }
    setBusy(false)
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal title={title} onClose={onClose}>
      <label>Komu<input className="input" type="email" multiple value={f.to} onChange={set('to')} placeholder="email@zakaznik.cz" /></label>
      <label>Kopie<input className="input" type="email" multiple value={f.cc} onChange={set('cc')} placeholder="nepovinné" /></label>
      <label>Předmět<input className="input" value={f.subject} onChange={set('subject')} /></label>
      <label>Text<textarea className="input" rows={7} value={f.text} onChange={set('text')} /></label>
      <div className="small">
        <b>Přílohy</b>
        {prilohy.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>{p.name}</span><span className="faint">{velikost(p.blob.size)}</span>
            <button className="link small" onClick={() => setPrilohy(prilohy.filter((_, j) => j !== i))}>odebrat</button>
          </div>
        ))}
        <button className="link small" onClick={() => file.current.click()}>Přidat soubor</button>
        <input ref={file} type="file" multiple hidden onChange={(e) => { setPrilohy([...prilohy, ...[...e.target.files].map((x) => ({ name: x.name, blob: x }))]); e.target.value = '' }} />
      </div>
      <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400 }}>
        <input type="checkbox" checked={f.kopieMne} onChange={(e) => setF({ ...f, kopieMne: e.target.checked })} /> Poslat kopii i mně
      </label>
      {stav && <div className={`small ${/nepodařilo|odmítla|nejde|není nastavené|Chyb/i.test(stav) ? 'err' : ''}`}>{stav}</div>}
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>{hotovo ? 'Zavřít' : 'Zrušit'}</button>
        {!hotovo && <button className="btn" disabled={busy || !f.to.trim() || !f.subject.trim() || stav === 'Připravuji přílohy…'} onClick={odeslat}>Odeslat</button>}
      </div>
    </Modal>
  )
}
