import { useState } from 'react'
import { useData } from '../data'
import { fmtDate } from '../lib'
import { skryt, stahnoutIcs, useUpozorneni } from '../upozorneni'

const KIND = { revize: 'Revize', faktura: 'Faktura', kalibrace: 'Kalibrace', doklad: 'Doklad', fakturace: 'Fakturace' }

export default function UpozorneniPanel() {
  const { db, idx } = useData()
  const [tick, setTick] = useState(0)
  const list = useUpozorneni(tick)
  const [vse, setVse] = useState(false)
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'none'))
  const shown = vse ? list : list.slice(0, 6)

  return (
    <section className="panel upoz">
      <h2>
        Upozornění{list.length > 0 && <span className="count" style={{ marginLeft: 8 }}>{list.length}</span>}
        <button className="linkbtn" onClick={() => stahnoutIcs(db, idx)} title="Stáhne soubor .ics s připomínkami. Otevřete ho v telefonu a termíny se přidají do kalendáře.">Do kalendáře v telefonu</button>
      </h2>
      {list.length === 0 && <div className="muted small">Nic nehoří. Revize, faktury, kalibrace i osvědčení jsou v pořádku.</div>}
      <div className="rows">
        {shown.map((u) => (
          <div className={`row upoz-${u.level}`} key={u.id}>
            <a href={u.href} style={{ color: 'inherit', textDecoration: 'none', minWidth: 0 }}>
              <div className="t"><span className={`upoz-dot ${u.level}`} />{u.title}</div>
              <div className="s">{[KIND[u.kind], u.date && fmtDate(u.date), u.sub].filter(Boolean).join(' · ')}</div>
            </a>
            <button className="btn ghost sm" title="Skrýt na týden" onClick={() => { skryt(u.id, 7); setTick(tick + 1) }}>Odložit</button>
          </div>
        ))}
      </div>
      <div className="upoz-foot small">
        {list.length > 6 && <button className="linkbtn" onClick={() => setVse(!vse)}>{vse ? 'Méně' : `Zobrazit všech ${list.length}`}</button>}
        {perm === 'default' && (
          <button className="linkbtn" onClick={async () => setPerm(await Notification.requestPermission())}>Zapnout oznámení na tomto zařízení</button>
        )}
        {perm === 'granted' && <span className="faint">Oznámení zapnutá: jednou denně při otevření aplikace.</span>}
      </div>
    </section>
  )
}
