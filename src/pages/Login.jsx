import { useState } from 'react'
import { supabase } from '../lib'
import { Logo } from '../ui'

export default function Login() {
  const [mode, setMode] = useState('in')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState(null)
  const [ok, setOk] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    setOk(null)
    setBusy(true)
    const fn = mode === 'in' ? supabase.auth.signInWithPassword : supabase.auth.signUp
    const { error, data } = await fn.call(supabase.auth, {
      email: email.trim(),
      password: pass,
      options: { emailRedirectTo: location.origin },
    })
    setBusy(false)
    if (error) {
      setErr(
        error.message.includes('Invalid login')
          ? 'E-mail nebo heslo nesedí.'
          : error.message.includes('not confirmed')
            ? 'Účet ještě není potvrzený. Klikněte na odkaz v e-mailu.'
            : error.message
      )
    } else if (mode === 'up' && !data.session) {
      setOk('Účet je založený. Potvrďte ho odkazem z e-mailu a pak se přihlaste.')
      setMode('in')
    }
  }

  return (
    <div className="login">
      <div className="art">
        <Logo size={44} />
        <div>
          <h1>Revize, klienti a faktury na jednom místě</h1>
          <p>Termíny revizí, výdělky a doklady revizního technika. Přístup má jen majitel účtu.</p>
        </div>
        <span className="small" style={{ color: '#7f878d' }}>
          Revizní technik E2A
        </span>
      </div>
      <form onSubmit={submit}>
        <h2>{mode === 'in' ? 'Přihlášení' : 'Založení účtu'}</h2>
        <input className="input" type="email" autoComplete="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          className="input"
          type="password"
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          placeholder={mode === 'in' ? 'Heslo' : 'Nové heslo (min. 8 znaků)'}
          minLength={mode === 'up' ? 8 : undefined}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          required
        />
        {err && <div className="err">{err}</div>}
        {ok && <div className="ok-msg">{ok}</div>}
        <button className="btn" disabled={busy}>
          {mode === 'in' ? 'Přihlásit' : 'Založit účet'}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'Poprvé tady? Založit účet' : 'Už mám účet, přihlásit'}
        </button>
      </form>
    </div>
  )
}
