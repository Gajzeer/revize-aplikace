// Odesílání e-mailů z aplikace Revize přes schránku majitele (SMTP, např. Seznam).
// 1) POST z aplikace (přihlášený majitel): { to, cc?, subject, text, attachments?: [{ filename, content (base64), contentType? }] }
// 2) Ranní souhrn: POST s hlavičkou x-cron-token = CRON_TOKEN a tělem { souhrn: true }
// Tajné hodnoty (Supabase → Edge Functions → Secrets): SMTP_USER, SMTP_PASS, volitelně SMTP_HOST, SMTP_PORT, SMTP_FROM_NAME, SOUHRN_TO, CRON_TOKEN
import nodemailer from 'npm:nodemailer@6.9.16'
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const env = (k: string, d = '') => Deno.env.get(k) ?? d
const URL_ = env('SUPABASE_URL')

function transport() {
  const user = env('SMTP_USER')
  if (!user || !env('SMTP_PASS')) throw new Error('Chybí nastavení schránky (SMTP_USER a SMTP_PASS v Supabase → Edge Functions → Secrets).')
  const port = Number(env('SMTP_PORT', '465'))
  return {
    from: env('SMTP_FROM_NAME') ? `"${env('SMTP_FROM_NAME')}" <${user}>` : user,
    t: nodemailer.createTransport({ host: env('SMTP_HOST', 'smtp.seznam.cz'), port, secure: port === 465, auth: { user, pass: env('SMTP_PASS') } }),
  }
}

const kc = (n: number) => `${Math.round(n).toLocaleString('cs-CZ')} Kč`
const d = (s: string) => (s ? `${Number(s.slice(8, 10))}. ${Number(s.slice(5, 7))}.` : '')

async function souhrn() {
  const db = createClient(URL_, env('SUPABASE_SERVICE_ROLE_KEY'))
  const dnes = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }))
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  const T = iso(dnes)
  const za14 = iso(new Date(dnes.getTime() + 14 * 864e5))
  const konecRoku = `${dnes.getFullYear()}-12-31`
  const [ud, rv, fa, ob, kl, zp] = await Promise.all([
    db.from('udalosti').select('datum,cas,nazev,hotovo,objekt_id').gte('datum', T).lte('datum', iso(new Date(dnes.getTime() + 864e5))),
    db.from('revize').select('id,objekt_id,typ,pristi,cena,stav,posledni').neq('stav', 'archiv'),
    db.from('faktury').select('cislo,klient_id,castka,datum_splatnosti,zaplaceno'),
    db.from('objekty').select('id,nazev,klient_id'),
    db.from('klienti').select('id,nazev,zkratka'),
    db.from('zpravy').select('nazev,stav').eq('stav', 'rozpracovano'),
  ])
  for (const r of [ud, rv, fa, ob, kl, zp]) if (r.error) throw r.error
  const O = Object.fromEntries(ob.data!.map((o) => [o.id, o]))
  const K = Object.fromEntries(kl.data!.map((k) => [k.id, k]))
  const rok = String(dnes.getFullYear())
  const aktivni = rv.data!.filter((r) => r.stav !== 'ceka_fakturace')
  const poTerminu = aktivni.filter((r) => r.pristi && r.pristi < T && !(r.posledni || '').startsWith(rok))
  const brzy = aktivni.filter((r) => r.pristi && r.pristi >= T && r.pristi <= za14)
  const doKonce = aktivni.filter((r) => r.pristi && r.pristi <= konecRoku && !(r.posledni || '').startsWith(rok))
  const cekaFakt = rv.data!.filter((r) => r.stav === 'ceka_fakturace')
  const nezapl = fa.data!.filter((f) => !f.zaplaceno)
  const poSplat = nezapl.filter((f) => f.datum_splatnosti && f.datum_splatnosti < T)
  const sum = (l: { castka?: number; cena?: number }[]) => l.reduce((a, x) => a + Number(x.castka ?? x.cena ?? 0), 0)
  const st = (l: { objekt_id: number }[]) => [...new Set(l.map((r) => O[r.objekt_id]?.nazev || '?'))]

  const r: string[] = []
  const dnesUd = ud.data!.filter((u) => !u.hotovo)
  r.push(`DNES ${dnes.getDate()}. ${dnes.getMonth() + 1}. ${dnes.getFullYear()}`)
  if (dnesUd.length) dnesUd.sort((a, b) => (a.datum + (a.cas || '')).localeCompare(b.datum + (b.cas || ''))).forEach((u) => r.push(`• ${u.datum === T ? '' : 'zítra '}${u.cas ? u.cas + ' ' : ''}${u.nazev}${u.objekt_id && O[u.objekt_id] ? ' – ' + O[u.objekt_id].nazev : ''}`))
  else r.push('• V kalendáři na dnes a zítra nic není.')
  r.push('')
  r.push('REVIZE')
  if (poTerminu.length) r.push(`• Po termínu: ${poTerminu.length} (${st(poTerminu).slice(0, 8).join(', ')}${st(poTerminu).length > 8 ? '…' : ''})`)
  if (brzy.length) r.push(`• Do 14 dnů: ${brzy.length} (${brzy.sort((a, b) => a.pristi.localeCompare(b.pristi)).slice(0, 8).map((x) => `${O[x.objekt_id]?.nazev || '?'} ${x.typ} ${d(x.pristi)}`).join(', ')})`)
  r.push(`• Do konce roku zbývá ${doKonce.length} revizí na ${st(doKonce).length} místech, celkem ${kc(sum(doKonce))}`)
  if (zp.data!.length) r.push(`• Rozpracované zprávy: ${zp.data!.length}`)
  r.push('')
  r.push('PENÍZE VE HŘE')
  r.push(`• Hotovo, čeká na fakturaci: ${cekaFakt.length} revizí, ${kc(sum(cekaFakt))}`)
  r.push(`• Nezaplacené faktury: ${nezapl.length}, ${kc(sum(nezapl))}`)
  if (poSplat.length) poSplat.sort((a, b) => a.datum_splatnosti.localeCompare(b.datum_splatnosti)).slice(0, 10).forEach((f) => r.push(`   – ${f.cislo} ${K[f.klient_id]?.zkratka || K[f.klient_id]?.nazev || ''} ${kc(f.castka)}, splatná ${d(f.datum_splatnosti)}`))
  r.push('')
  r.push('Aplikace: https://gajzeer.github.io/revize-aplikace/')
  return { subject: `Ráno ${dnes.getDate()}. ${dnes.getMonth() + 1}.: ${dnesUd.length ? dnesUd.length + '× v kalendáři, ' : ''}${poTerminu.length + brzy.length} revizí na řadě, ${kc(sum(cekaFakt) + sum(nezapl))} ve hře`, text: r.join('\n') }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const cron = req.headers.get('x-cron-token')
    if (body.souhrn) {
      const ct = env('CRON_TOKEN').trim()
      if (!ct) return json({ error: 'V Supabase chybí CRON_TOKEN.' }, 401)
      if ((cron || '').trim() !== ct) return json({ error: `Neplatný klíč (délka ${(cron || '').trim().length} vs. ${ct.length}).` }, 401)
      const s = await souhrn()
      const { t, from } = transport()
      await t.sendMail({ from, to: env('SOUHRN_TO', env('SMTP_USER')), subject: s.subject, text: s.text })
      return json({ ok: true })
    }
    // jen přihlášený majitel aplikace
    const auth = req.headers.get('Authorization') || ''
    const u = createClient(URL_, env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } } })
    const { data: ok, error } = await u.rpc('je_vlastnik')
    if (error || !ok) return json({ error: 'Nepřihlášený uživatel.' }, 401)
    if (!body.to || !body.subject) return json({ error: 'Chybí adresát nebo předmět.' }, 400)
    const { t, from } = transport()
    const info = await t.sendMail({
      from, to: body.to, cc: body.cc || undefined, bcc: body.kopieMne ? env('SMTP_USER') : undefined,
      subject: body.subject, text: body.text || '',
      attachments: (body.attachments || []).map((a: { filename: string; content: string; contentType?: string }) => ({ filename: a.filename, content: a.content, encoding: 'base64', contentType: a.contentType })),
    })
    return json({ ok: true, id: info.messageId })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
