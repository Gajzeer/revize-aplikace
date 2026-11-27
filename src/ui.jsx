import { useEffect, useState } from 'react'
import { daysTo, fmtDate, stav } from './lib'

const P = {
  home: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5',
  calendar: 'M4 6.5h16V20H4zM4 10.5h16M8.5 3.5v5M15.5 3.5v5',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2',
  doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  tag: 'M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5zM8 8.5h.01',
  shield: 'M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6zM9 12l2 2 4-4',
  check: 'M5 12.5 10 17 19 7',
  plus: 'M12 5v14M5 12h14',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6z',
}

export function Icon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  )
}

export function Logo({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#2a3036" />
      <path d="M36 8 18 36h13l-4 20 19-29H33z" fill="#c8902a" />
    </svg>
  )
}

// revizní visačka s termínem
export function Due({ date, showDate = true }) {
  const d = daysTo(date)
  const s = stav(d)
  return (
    <span className={`tag ${s.key}`} title={s.label}>
      {showDate && date ? fmtDate(date) : null}
      {showDate && date ? <span className="tl">{s.label}</span> : s.label}
    </span>
  )
}

export function Modal({ title, children, onClose }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onClose()
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function useToast() {
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 2600)
    return () => clearTimeout(t)
  }, [msg])
  return [msg ? <div className="toast" role="status">{msg}</div> : null, setMsg]
}

export function Seg({ value, onChange, options }) {
  return (
    <div className="seg" role="group">
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)} aria-pressed={value === v}>
          {l}
        </button>
      ))}
    </div>
  )
}
