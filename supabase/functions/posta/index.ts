// Odesílání e-mailů z aplikace Revize přes schránku majitele (SMTP, např. Seznam).
// 1) POST z aplikace (přihlášený majitel): { to, cc?, subject, text, attachments?: [{ filename, content (base64), contentType? }] }
// 2) Ranní souhrn: POST s hlavičkou x-cron-token = CRON_TOKEN a tělem { souhrn: true }
// Tajná hodnota (Supabase → Edge Functions → Secrets): SMTP_PASS (heslo pro aplikace ze Seznamu).
// Adresa a jméno odesílatele se berou z údajů dodavatele v aplikaci (nastaveni 'dodavatel'), případně SMTP_USER / SMTP_FROM_NAME.
// Ranní souhrn spouští GitHub Actions z repa Gajzeer/revize-aplikace; ověří se jeho podepsaný token (OIDC), žádné sdílené heslo.
import nodemailer from 'npm:nodemailer@6.9.16'
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6'
import { vytvorSouhrn } from './souhrn.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token, x-github-oidc',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const env = (k: string, d = '') => Deno.env.get(k) ?? d
const URL_ = env('SUPABASE_URL')

const admin = () => createClient(URL_, env('SUPABASE_SERVICE_ROLE_KEY'))

async function transport() {
  const { data } = await admin().from('nastaveni').select('hodnota').eq('klic', 'dodavatel').maybeSingle()
  const dod = (data?.hodnota || {}) as { email?: string; jmeno?: string }
  const user = env('SMTP_USER') || dod.email || ''
  if (!user || !env('SMTP_PASS')) throw new Error('Chybí nastavení schránky (SMTP_PASS v Supabase → Edge Functions → Secrets).')
  const port = Number(env('SMTP_PORT', '465'))
  const jmeno = env('SMTP_FROM_NAME') || (dod.jmeno ? `${dod.jmeno} – revize elektro` : '')
  return {
    user,
    from: jmeno ? `"${jmeno}" <${user}>` : user,
    t: nodemailer.createTransport({ host: env('SMTP_HOST', 'smtp.seznam.cz'), port, secure: port === 465, auth: { user, pass: env('SMTP_PASS') } }),
  }
}


// token, který GitHub Actions vydá běhu workflow: musí být z Pavlova repa a z hlavní větve
const GH = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'))
async function jeGithubCron(auth: string) {
  try {
    const { payload } = await jwtVerify(auth.replace(/^Bearer\s+/i, ''), GH, { issuer: 'https://token.actions.githubusercontent.com', audience: 'revize-souhrn' })
    return payload.repository === 'Gajzeer/revize-aplikace' && payload.ref === 'refs/heads/main'
  } catch { return false }
}

async function souhrn() {
  const db = admin()
  const dnes = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }))
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  const T = iso(dnes)
  const [ud, rv, fa, ob, kl, zp] = await Promise.all([
    db.from('udalosti').select('datum,cas,nazev,hotovo,objekt_id').gte('datum', T).lte('datum', iso(new Date(dnes.getTime() + 864e5))),
    db.from('revize').select('id,objekt_id,typ,pristi,cena,stav,posledni').neq('stav', 'archiv'),
    db.from('faktury').select('cislo,klient_id,castka,datum_splatnosti,zaplaceno'),
    db.from('objekty').select('id,nazev,klient_id'),
    db.from('klienti').select('id,nazev,zkratka'),
    db.from('zpravy').select('nazev,stav').eq('stav', 'rozpracovano'),
  ])
  for (const r of [ud, rv, fa, ob, kl, zp]) if (r.error) throw r.error
  return vytvorSouhrn({ ud: ud.data!, rv: rv.data!, fa: fa.data!, ob: ob.data!, kl: kl.data!, zp: zp.data! }, dnes)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const cron = req.headers.get('x-cron-token')
    if (body.souhrn) {
      const ct = env('CRON_TOKEN').trim()
      const ok = (ct && (cron || '').trim() === ct) || (await jeGithubCron(req.headers.get('x-github-oidc') || ''))
      if (!ok) return json({ error: 'Neověřené spuštění souhrnu.' }, 401)
      const s = await souhrn()
      const { t, from, user } = await transport()
      await t.sendMail({ from, to: env('SOUHRN_TO') || user, subject: s.subject, text: s.text, html: s.html })
      return json({ ok: true })
    }
    // jen přihlášený majitel aplikace
    const auth = req.headers.get('Authorization') || ''
    const u = createClient(URL_, env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } } })
    const { data: ok, error } = await u.rpc('je_vlastnik')
    if (error || !ok) return json({ error: 'Nepřihlášený uživatel.' }, 401)
    if (!body.to || !body.subject) return json({ error: 'Chybí adresát nebo předmět.' }, 400)
    const { t, from, user } = await transport()
    const info = await t.sendMail({
      from, to: body.to, cc: body.cc || undefined, bcc: body.kopieMne ? user : undefined,
      subject: body.subject, text: body.text || '',
      attachments: (body.attachments || []).map((a: { filename: string; content: string; contentType?: string }) => ({ filename: a.filename, content: a.content, encoding: 'base64', contentType: a.contentType })),
    })
    return json({ ok: true, id: info.messageId })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
