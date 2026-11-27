import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { supabase } from './lib'
import { DataProvider, useData } from './data'
import { Icon, Logo } from './ui'
import Prehled from './pages/Prehled'
import Revize from './pages/Revize'
import Klienti from './pages/Klienti'
import Faktury from './pages/Faktury'
import Cenik from './pages/Cenik'
import Doklady from './pages/Doklady'
import Login from './pages/Login'
import Import from './pages/Import'
import Kalendar from './pages/Kalendar'
import Faktura from './pages/Faktura'
import Zpravy from './pages/Zpravy'
import Nabidky from './pages/Nabidky'
import Dane from './pages/Dane'
import { oznamitDnes, seznamUpozorneni } from './upozorneni'
import { frontaVse, smazatVse } from './offline'

const PAGES = [
  { id: 'prehled', label: 'Přehled', icon: 'home', C: Prehled },
  { id: 'revize', label: 'Revize', icon: 'bolt', C: Revize },
  { id: 'kalendar', label: 'Kalendář', icon: 'calendar', C: Kalendar },
  { id: 'klienti', label: 'Klienti', icon: 'users', C: Klienti },
  { id: 'zpravy', label: 'Revizní zprávy', short: 'Zprávy', icon: 'report', C: Zpravy },
  { id: 'faktury', label: 'Faktury', icon: 'doc', C: Faktury },
  { id: 'nabidky', label: 'Cenové nabídky', short: 'Nabídky', icon: 'quote', C: Nabidky },
  { id: 'dane', label: 'Daňové podklady', short: 'Daně', icon: 'calc', C: Dane },
  { id: 'cenik', label: 'Ceník', icon: 'tag', C: Cenik },
  { id: 'doklady', label: 'Doklady a přístroje', short: 'Doklady', icon: 'shield', C: Doklady },
]

// odhlášení smaže i data uložená v zařízení pro práci bez signálu (neodeslané změny se ztratí, proto upozorní)
async function odhlasit() {
  const f = await frontaVse()
  if (f.length && !confirm(`V zařízení je ${f.length} neodeslaných změn. Odhlášením se ztratí. Pokračovat?`)) return
  await smazatVse()
  supabase.auth.signOut()
}

let navCount = 0 // počet přechodů uvnitř aplikace (pro tlačítko Zpět)

function useHash() {
  const [h, setH] = useState(location.hash.slice(2) || 'prehled')
  useEffect(() => {
    const f = () => { navCount = Math.max(0, navCount + 1); setH(location.hash.slice(2) || 'prehled') }
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return h
}

function Shell({ email }) {
  const hash = useHash()
  const [page, ...rest] = hash.split('/')
  const { db, error, lateCount, stav, synchronizovat } = useData()
  const [more, setMore] = useState(false)
  const MOBILE = ['prehled', 'revize', 'kalendar', 'klienti', 'faktury']
  const back = () => {
    // zpět o krok v aplikaci; když jsme stránku otevřeli napřímo, o úroveň výš
    if (navCount > 0) { navCount -= 2; history.back() }
    else location.hash = rest.length ? `#/${page}` : '#/prehled'
  }
  const P = page === 'import' ? { id: 'import', C: Import } : page === 'faktura' ? { id: 'faktury', C: Faktura } : PAGES.find((p) => p.id === page) || PAGES[0]
  useEffect(() => { window.scrollTo(0, 0) }, [hash])
  const { idx } = useData()
  useEffect(() => { if (db?.revize) oznamitDnes(seznamUpozorneni(db, idx)) }, [db])

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <Logo />
          <div>
            <b>REVIZE</b>
            <span>pracovní přehled</span>
          </div>
        </div>
        <nav className="nav">
          {PAGES.map((p) => (
            <a key={p.id} href={`#/${p.id}`} className={p.id === P.id ? 'on' : ''}>
              <Icon name={p.icon} />
              {p.label}
              {p.id === 'revize' && lateCount > 0 && <span className="count">{lateCount}</span>}
            </a>
          ))}
        </nav>
        <div className="foot">
          {email && <div>{email}</div>}
          <button onClick={odhlasit}>Odhlásit</button>
        </div>
      </aside>
      <main className="main">
        {error && <div className="panel err">Data se nepodařilo načíst: {error}</div>}
        {stav && (!stav.online || stav.cekajici > 0 || stav.chyba) && (
          <div className={`offbar no-print ${stav.chyba ? 'err' : ''}`}>
            <span>
              {stav.chyba
                ? `Jednu změnu databáze nepřijala (${stav.chyba}).`
                : !stav.online
                  ? `Bez signálu. Pracujete s daty z ${stav.z ? new Date(stav.z).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'posledního připojení'}.`
                  : 'Odesílám změny z terénu…'}
              {stav.cekajici > 0 && ` Neodeslané změny: ${stav.cekajici}. Odešlou se samy po připojení.`}
            </span>
            {navigator.onLine && <button className="btn ghost sm" onClick={synchronizovat}>Zkusit znovu</button>}
          </div>
        )}
        {!db && !error && <div className="muted">Načítám data…</div>}
        {db && hash !== 'prehled' && (
          <button className="backbtn no-print" onClick={back} aria-label="Zpět">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
            Zpět
          </button>
        )}
        {db && <P.C sub={rest} />}
      </main>
      <nav className="tabbar">
        {PAGES.filter((p) => MOBILE.includes(p.id)).map((p) => (
          <a key={p.id} href={`#/${p.id}`} className={p.id === P.id ? 'on' : ''} onClick={() => setMore(false)}>
            <Icon name={p.icon} />
            {p.short || p.label}
          </a>
        ))}
        <button className={!MOBILE.includes(P.id) || more ? 'on' : ''} onClick={() => setMore(!more)} aria-expanded={more}>
          <Icon name="more" />
          Další
        </button>
      </nav>
      {more && (
        <div className="moresheet" onClick={() => setMore(false)}>
          <div className="moresheet-in" onClick={(e) => e.stopPropagation()}>
            {PAGES.filter((p) => !MOBILE.includes(p.id)).map((p) => (
              <a key={p.id} href={`#/${p.id}`} className={p.id === P.id ? 'on' : ''} onClick={() => setMore(false)}>
                <Icon name={p.icon} />
                {p.label}
              </a>
            ))}
            <a href="#/import" onClick={() => setMore(false)}><Icon name="doc" />Nahrát úpravy ze souboru</a>
            <button onClick={odhlasit}><Icon name="home" />Odhlásit</button>
          </div>
        </div>
      )}
    </div>
  )
}

function App() {
  const demo = import.meta.env.DEV && new URLSearchParams(location.search).has('demo')
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    if (demo) { setSession({ user: { email: "demo" } }); return }
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [demo])
  if (session === undefined) return null
  if (!session) return <Login />
  return (
    <DataProvider>
      <Shell email={session.user?.email} />
    </DataProvider>
  )
}

// aplikace se otevře i bez signálu (uložené soubory aplikace v telefonu)
if ('serviceWorker' in navigator && import.meta.env.PROD) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
