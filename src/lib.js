import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://proddwpjcpceaodbmxvp.supabase.co',
  'sb_publishable_jXv-aWC3P884rC4tMgMx7Q_3tNcKR64'
)

export const TODAY = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export const parse = (s) => (s ? new Date(s + 'T00:00:00') : null)
export const iso = (d) => {
  const z = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}
export const addMonths = (d, m) => {
  const r = new Date(d)
  const day = r.getDate()
  r.setDate(1)
  r.setMonth(r.getMonth() + m)
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()
  r.setDate(Math.min(day, last))
  return r
}
export const daysTo = (s) => {
  const d = parse(s)
  if (!d) return null
  return Math.round((d - TODAY()) / 86400000)
}
export const fmtDate = (s) => {
  const d = parse(s)
  return d ? d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '–'
}
export const fmtKc = (n) =>
  n == null ? '–' : Math.round(n).toLocaleString('cs-CZ').replace(/ /g, ' ') + ' Kč'
export const fmtTis = (n) => (Math.round(n / 100) / 10).toLocaleString('cs-CZ') + ' tis.'

// stav podle počtu dní do termínu
export const stav = (days) => {
  if (days == null) return { key: 'none', label: 'bez termínu' }
  if (days < 0) return { key: 'late', label: `${-days} dní po termínu` }
  if (days === 0) return { key: 'soon', label: 'dnes' }
  if (days <= 30) return { key: 'soon', label: `za ${days} dní` }
  if (days <= 90) return { key: 'near', label: `za ${days} dní` }
  return { key: 'ok', label: days > 400 ? `za ${Math.round(days / 30.4)} měs.` : `za ${days} dní` }
}

export const norm = (s) =>
  (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
