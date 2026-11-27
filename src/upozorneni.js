import { useMemo } from 'react'
import { useData } from './data'
import { TODAY, addMonths, daysTo, fmtDate, fmtKc, iso, parse } from './lib'
import { cekaFakturace } from './mol'

// Kolik dní předem se na co upozorňuje
export const PREDEM = { revize: 30, faktura: 3, kalibrace: 90, doklad: 120, fakturace: 14 }

const skryte = () => { try { return JSON.parse(localStorage.getItem('upoz-skryte') || '{}') } catch { return {} } }
export function skryt(id, dni) {
  const s = skryte()
  s[id] = iso(new Date(TODAY().getTime() + dni * 864e5))
  try { localStorage.setItem('upoz-skryte', JSON.stringify(s)) } catch {}
}

// pořadí: peníze a doklady před běžnými termíny revizí
const RANK = { late: { faktura: 0, doklad: 1, kalibrace: 1, revize: 2 }, soon: { doklad: 3, kalibrace: 3, faktura: 4, fakturace: 5, revize: 6 } }
const rank = (u) => RANK[u.level][u.kind] ?? 5

// Všechno, co vyžaduje pozornost: { id, kind, level: 'late'|'soon', title, sub, date, href }
export function seznamUpozorneni(db, idx) {
  const out = []
  const today = iso(TODAY())
  // revize po termínu a do 30 dní, po objektech
  const po = {}
  db.revize
    .filter((r) => r.stav !== 'archiv' && r.stav !== 'ceka_fakturace' && r.pristi && daysTo(r.pristi) <= PREDEM.revize)
    .forEach((r) => (po[r.objekt_id] ||= []).push(r))
  Object.values(po).forEach((l) => {
    l.sort((a, b) => a.pristi.localeCompare(b.pristi))
    const d = l[0].pristi
    const o = idx.objekt[l[0].objekt_id]
    out.push({
      id: `r${l[0].objekt_id}|${d}`, kind: 'revize', level: d < today ? 'late' : 'soon', date: d,
      title: `${d < today ? 'Revize po termínu' : 'Blíží se revize'}: ${o?.nazev || 'objekt'}`,
      sub: l.map((r) => r.typ).join(', '), href: '#/revize',
    })
  })
  // faktury po splatnosti a těsně před ní
  db.faktury
    .filter((f) => f.zaplaceno === false || (f.zaplaceno == null && f.datum_splatnosti && daysTo(f.datum_splatnosti) >= -60))
    .filter((f) => f.datum_splatnosti && daysTo(f.datum_splatnosti) <= PREDEM.faktura)
    .forEach((f) => {
      const po = f.datum_splatnosti < today
      out.push({
        id: `f${f.id}`, kind: 'faktura', level: po ? 'late' : 'soon', date: f.datum_splatnosti,
        title: `${po ? 'Faktura po splatnosti' : 'Splatnost faktury'} ${f.cislo}`,
        sub: `${idx.klient[f.klient_id]?.zkratka || idx.klient[f.klient_id]?.nazev || ''} · ${fmtKc(f.castka)}`, href: '#/faktury',
      })
    })
  // kalibrace přístrojů
  db.pristroje
    .filter((p) => p.aktivni)
    .forEach((p) => {
      if (!p.kalibrace_dne) {
        out.push({ id: `pk${p.id}`, kind: 'kalibrace', level: 'soon', date: null, title: `Doplňte datum kalibrace: ${p.nazev}`, sub: 'bez něj aplikace nehlídá další kalibraci', href: '#/doklady' })
        return
      }
      const d = iso(addMonths(parse(p.kalibrace_dne), p.interval_mesicu || 24))
      if (daysTo(d) <= PREDEM.kalibrace)
        out.push({ id: `p${p.id}|${d}`, kind: 'kalibrace', level: d < today ? 'late' : 'soon', date: d, title: `Kalibrace ${p.nazev}`, sub: d < today ? 'kalibrace propadla' : 'objednejte kalibraci', href: '#/doklady' })
    })
  // osvědčení a další doklady
  db.doklady
    .filter((x) => x.platnost_do && daysTo(x.platnost_do) <= PREDEM.doklad)
    .forEach((x) =>
      out.push({ id: `d${x.id}|${x.platnost_do}`, kind: 'doklad', level: x.platnost_do < today ? 'late' : 'soon', date: x.platnost_do, title: `Končí platnost: ${x.nazev}`, sub: x.platnost_do < today ? 'platnost skončila' : 'přihlaste se včas na přezkoušení', href: '#/doklady' })
    )
  // hotové revize, které dlouho čekají na fakturu
  const fak = cekaFakturace(db).filter((r) => r.posledni && daysTo(r.posledni) <= -PREDEM.fakturace)
  if (fak.length)
    out.push({ id: `cf${fak.length}`, kind: 'fakturace', level: 'soon', date: null, title: `Nevyfakturováno déle než ${PREDEM.fakturace} dní: ${fak.length} revizí`, sub: fmtKc(fak.reduce((a, r) => a + Number(r.cena || 0), 0)), href: '#/revize' })

  const sk = skryte()
  return out
    .filter((u) => !(sk[u.id] && sk[u.id] > today))
    .sort((a, b) => rank(a) - rank(b) || (a.date || '9').localeCompare(b.date || '9'))
}

export function useUpozorneni(tick = 0) {
  const { db, idx } = useData()
  return useMemo(() => seznamUpozorneni(db, idx), [db, idx, tick])
}

// Oznámení v prohlížeči / telefonu jednou denně při otevření aplikace
export function oznamitDnes(list) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !list.length) return
    const k = 'upoz-oznameno'
    if (localStorage.getItem(k) === iso(TODAY())) return
    localStorage.setItem(k, iso(TODAY()))
    const late = list.filter((u) => u.level === 'late').length
    new Notification(`Revize: ${list.length} upozornění${late ? `, ${late} po termínu` : ''}`, {
      body: list.slice(0, 4).map((u) => u.title).join('\n'),
      tag: 'revize-denni',
    })
  } catch {}
}

// Soubor .ics s připomínkami pro kalendář v telefonu
export function kalendarIcs(db, idx) {
  const esc = (s) => String(s || '').replace(/[\\,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n')
  const d8 = (s) => s.replace(/-/g, '')
  const next = (s) => { const d = parse(s); d.setDate(d.getDate() + 1); return d8(iso(d)) }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const ev = []
  const add = (uid, date, title, desc, alarmDays) =>
    ev.push([
      'BEGIN:VEVENT', `UID:${uid}@revize-pavel-gaj`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d8(date)}`, `DTEND;VALUE=DATE:${next(date)}`,
      `SUMMARY:${esc(title)}`, desc ? `DESCRIPTION:${esc(desc)}` : null,
      ...alarmDays.flatMap((n) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, `TRIGGER:-P${n}D`, 'END:VALARM']),
      'END:VEVENT',
    ].filter(Boolean).join('\r\n'))
  const today = iso(TODAY())
  const po = {}
  db.revize.filter((r) => r.stav !== 'archiv' && r.stav !== 'ceka_fakturace' && r.pristi && r.pristi >= today).forEach((r) => ((po[r.pristi + '|' + r.objekt_id] ||= []).push(r)))
  Object.entries(po).forEach(([k, l]) => {
    const [d, oid] = k.split('|')
    add(`rev-${oid}-${d}`, d, `Revize: ${idx.objekt[oid]?.nazev || ''}`, l.map((r) => r.typ).join(', '), [14, 3])
  })
  db.faktury.filter((f) => !f.zaplaceno && f.datum_splatnosti && f.datum_splatnosti >= today)
    .forEach((f) => add(`fak-${f.id}`, f.datum_splatnosti, `Splatnost faktury ${f.cislo}`, `${idx.klient[f.klient_id]?.nazev || ''}, ${fmtKc(f.castka)}`, [0]))
  db.pristroje.filter((p) => p.aktivni && p.kalibrace_dne).forEach((p) => {
    const d = iso(addMonths(parse(p.kalibrace_dne), p.interval_mesicu || 24))
    add(`kal-${p.id}-${d}`, d, `Konec kalibrace ${p.nazev}`, `Kalibrováno ${fmtDate(p.kalibrace_dne)}. Objednat kalibraci.`, [60, 30])
  })
  db.doklady.filter((x) => x.platnost_do).forEach((x) => add(`dok-${x.id}-${x.platnost_do}`, x.platnost_do, `Končí platnost: ${x.nazev}`, x.cislo || '', [120, 60, 14]))
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Revize//CS', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Revize – termíny', ...ev, 'END:VCALENDAR'].join('\r\n')
}

export function stahnoutIcs(db, idx) {
  const blob = new Blob([kalendarIcs(db, idx)], { type: 'text/calendar;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'revize-terminy.ics'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
