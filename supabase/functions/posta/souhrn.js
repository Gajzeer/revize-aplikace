// Ranní souhrn: z dat poskládá předmět, textovou verzi a HTML „newsletter“.
// Čistý JavaScript bez závislostí, aby šel vyzkoušet i mimo Supabase.

const APP = 'https://gajzeer.github.io/revize-aplikace/'
const DNY = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota']
const MES = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince']

const kc = (n) => `${Math.round(n).toLocaleString('cs-CZ').replace(/\s/g, '\u00a0')}\u00a0Kč`
const d = (s) => (s ? `${Number(s.slice(8, 10))}.\u00a0${Number(s.slice(5, 7))}.` : '')
const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const sum = (l) => l.reduce((a, x) => a + Number(x.castka ?? x.cena ?? 0), 0)
const dniMezi = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5)

// barvy
const C = {
  modra: '#14365c', modraSv: '#e8eef5', zluta: '#f2c230', text: '#1d2733', seda: '#5b6876',
  linka: '#dfe5eb', pozadi: '#eef1f4', cervena: '#b3261e', cervenaSv: '#fbeceb', zelena: '#2e7d4f',
}
const FONT = "font-family:Segoe UI,Helvetica,Arial,sans-serif;"

export function vytvorSouhrn({ ud, rv, fa, ob, kl, zp }, dnes) {
  const T = iso(dnes)
  const zitra = iso(new Date(dnes.getTime() + 864e5))
  const za14 = iso(new Date(dnes.getTime() + 14 * 864e5))
  const konecRoku = `${dnes.getFullYear()}-12-31`
  const rok = String(dnes.getFullYear())
  const O = Object.fromEntries(ob.map((o) => [o.id, o]))
  const K = Object.fromEntries(kl.map((k) => [k.id, k]))
  const stanice = (id) => O[id]?.nazev || '?'
  const klient = (id) => K[id]?.zkratka || K[id]?.nazev || ''

  const aktivni = rv.filter((r) => r.stav !== 'ceka_fakturace')
  const poTerminu = aktivni.filter((r) => r.pristi && r.pristi < T && !(r.posledni || '').startsWith(rok)).sort((a, b) => a.pristi.localeCompare(b.pristi))
  const brzy = aktivni.filter((r) => r.pristi && r.pristi >= T && r.pristi <= za14).sort((a, b) => a.pristi.localeCompare(b.pristi))
  const doKonce = aktivni.filter((r) => r.pristi && r.pristi <= konecRoku && !(r.posledni || '').startsWith(rok))
  const mistDoKonce = new Set(doKonce.map((r) => r.objekt_id)).size
  const cekaFakt = rv.filter((r) => r.stav === 'ceka_fakturace')
  const nezapl = fa.filter((f) => !f.zaplaceno)
  const poSplat = nezapl.filter((f) => f.datum_splatnosti && f.datum_splatnosti < T).sort((a, b) => a.datum_splatnosti.localeCompare(b.datum_splatnosti))
  const kal = ud.filter((u) => !u.hotovo).sort((a, b) => (a.datum + (a.cas || '99')).localeCompare(b.datum + (b.cas || '99')))
  const kalDnes = kal.filter((u) => u.datum === T)
  const kalZitra = kal.filter((u) => u.datum === zitra)
  const rozprac = zp.length
  const naRade = poTerminu.length + brzy.length
  const veHre = sum(cekaFakt) + sum(nezapl)

  const datumDlouhe = `${DNY[dnes.getDay()]} ${dnes.getDate()}. ${MES[dnes.getMonth()]} ${dnes.getFullYear()}`
  const subject = `Ráno ${dnes.getDate()}. ${dnes.getMonth() + 1}.: ${kalDnes.length + kalZitra.length ? kalDnes.length + kalZitra.length + '× v kalendáři, ' : ''}${naRade} revizí na řadě, ${kc(veHre).replace(/\u00a0/g, ' ')} ve hře`

  // ---------- textová verze (pro poštu bez HTML) ----------
  const r = []
  const udTxt = (u) => `${u.cas ? u.cas.slice(0, 5) + ' ' : ''}${u.nazev}${u.objekt_id && O[u.objekt_id] ? ' – ' + stanice(u.objekt_id) : ''}`
  r.push(`DNES ${dnes.getDate()}. ${dnes.getMonth() + 1}. ${dnes.getFullYear()}`)
  kalDnes.forEach((u) => r.push('• ' + udTxt(u)))
  kalZitra.forEach((u) => r.push('• zítra ' + udTxt(u)))
  if (!kal.length) r.push('• V kalendáři na dnes a zítra nic není.')
  r.push('', 'REVIZE')
  r.push(`• Po termínu: ${poTerminu.length}`)
  r.push(`• Do 14 dnů: ${brzy.length}`)
  r.push(`• Do konce roku zbývá ${doKonce.length} revizí na ${mistDoKonce} místech, celkem ${kc(sum(doKonce))}`)
  if (rozprac) r.push(`• Rozpracované zprávy: ${rozprac}`)
  r.push('', 'PENÍZE VE HŘE')
  r.push(`• Čeká na fakturaci: ${cekaFakt.length} revizí, ${kc(sum(cekaFakt))}`)
  r.push(`• Nezaplacené faktury: ${nezapl.length}, ${kc(sum(nezapl))}`)
  poSplat.forEach((f) => r.push(`   – ${f.cislo} ${klient(f.klient_id)} ${kc(f.castka)}, splatná ${d(f.datum_splatnosti)}`))
  r.push('', 'Aplikace: ' + APP)
  const text = r.join('\n').replace(/\u00a0/g, ' ')

  // ---------- HTML ----------
  const sekce = (nadpis, pozn, obsah, barva = C.modra) => `
<tr><td style="padding:26px 28px 0 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="${FONT}font-size:17px;font-weight:700;color:${barva};padding-bottom:2px;">${nadpis}</td></tr>
    ${pozn ? `<tr><td style="${FONT}font-size:13px;color:${C.seda};padding-bottom:10px;">${pozn}</td></tr>` : '<tr><td style="font-size:0;line-height:0;height:10px;">&nbsp;</td></tr>'}
    <tr><td>${obsah}</td></tr>
  </table>
</td></tr>`

  const tabulka = (hlavicka, radky, zarovnani, dalsi = 0) => {
    const th = hlavicka.map((h, i) => `<th align="${zarovnani[i]}" style="${FONT}font-size:11px;font-weight:600;color:${C.seda};text-align:${zarovnani[i]};padding:6px 8px;border-bottom:2px solid ${C.linka};">${h}</th>`).join('')
    const tr = radky.map((rad, ri) => `<tr${ri % 2 ? ` style="background:#f7f9fb;"` : ''}>${rad.map((c, i) => `<td align="${zarovnani[i]}" valign="top" style="${FONT}font-size:14px;color:${C.text};text-align:${zarovnani[i]};padding:8px;border-bottom:1px solid ${C.linka};">${c}</td>`).join('')}</tr>`).join('')
    const pata = dalsi > 0 ? `<tr><td colspan="${hlavicka.length}" style="${FONT}font-size:13px;color:${C.seda};padding:8px;">a dalších ${dalsi}, celý seznam v aplikaci</td></tr>` : ''
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>${th}</tr>${tr}${pata}</table>`
  }

  const dlazdice = (cislo, popis, barva) => `
<td width="33%" valign="top" style="padding:0 4px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:6px;border-top:4px solid ${barva};">
    <tr><td style="${FONT}font-size:22px;font-weight:700;color:${C.text};padding:14px 12px 2px 12px;white-space:nowrap;">${cislo}</td></tr>
    <tr><td style="${FONT}font-size:12px;line-height:16px;color:${C.seda};padding:0 12px 14px 12px;">${popis}</td></tr>
  </table>
</td>`

  // kalendář
  const udRadek = (u, den) => `<tr>
    <td width="64" valign="top" style="${FONT}font-size:14px;font-weight:700;color:${C.modra};padding:7px 0;">${u.cas ? esc(u.cas.slice(0, 5)) : den}</td>
    <td valign="top" style="${FONT}font-size:14px;color:${C.text};padding:7px 0;">${esc(u.nazev)}${u.objekt_id && O[u.objekt_id] ? `<br><span style="font-size:13px;color:${C.seda};">${esc(stanice(u.objekt_id))}</span>` : ''}</td></tr>`
  const kalBlok = (seznam, den) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${seznam.map((u) => udRadek(u, den)).join('')}</table>`
  let kalendar = ''
  if (kalDnes.length) kalendar += kalBlok(kalDnes, 'dnes')
  else kalendar += `<p style="${FONT}font-size:14px;color:${C.seda};margin:0 0 6px 0;">Na dnešek nic v kalendáři.</p>`
  if (kalZitra.length) kalendar += `<p style="${FONT}font-size:12px;font-weight:600;color:${C.seda};margin:12px 0 0 0;">Zítra</p>` + kalBlok(kalZitra, 'zítra')

  const MAX = 10
  const revRadky = (l, sTerminem) => l.slice(0, MAX).map((x) => {
    const dni = dniMezi(T, x.pristi)
    const kdy = sTerminem
      ? `${d(x.pristi)}<br><span style="font-size:12px;color:${C.cervena};">${-dni}&nbsp;dní po</span>`
      : `${d(x.pristi)}<br><span style="font-size:12px;color:${C.seda};">${dni === 0 ? 'dnes' : dni === 1 ? 'zítra' : `za ${dni} dní`}</span>`
    return [`<strong>${esc(stanice(x.objekt_id))}</strong>`, esc(x.typ || ''), kdy, x.cena ? kc(x.cena) : '']
  })

  let telo = ''
  telo += sekce('Dnes a zítra', '', kalendar)
  if (poTerminu.length) telo += sekce(`Po termínu (${poTerminu.length})`, 'Letos ještě neudělané, termín už minul.',
    tabulka(['Stanice', 'Typ', 'Termín', 'Cena'], revRadky(poTerminu, true), ['left', 'left', 'left', 'right'], poTerminu.length - MAX), C.cervena)
  telo += sekce(`Do 14 dnů (${brzy.length})`, brzy.length ? `Do ${d(za14)}` : '',
    brzy.length ? tabulka(['Stanice', 'Typ', 'Termín', 'Cena'], revRadky(brzy, false), ['left', 'left', 'left', 'right'], brzy.length - MAX)
      : `<p style="${FONT}font-size:14px;color:${C.seda};margin:0;">Nic se v příštích dvou týdnech nekrátí.</p>`)
  if (poSplat.length) telo += sekce(`Faktury po splatnosti (${poSplat.length})`, `Celkem ${kc(sum(poSplat))}`,
    tabulka(['Faktura', 'Klient', 'Částka', 'Splatná'],
      poSplat.slice(0, MAX).map((f) => [esc(f.cislo), esc(klient(f.klient_id)), `<strong>${kc(f.castka)}</strong>`, `${d(f.datum_splatnosti)}<br><span style="font-size:12px;color:${C.cervena};">${dniMezi(f.datum_splatnosti, T)}&nbsp;dní po</span>`]),
      ['left', 'left', 'right', 'left'], poSplat.length - MAX), C.cervena)

  // přehled do konce roku
  const radekPrehled = (popis, hodnota) => `<tr><td style="${FONT}font-size:14px;color:${C.text};padding:8px 0;border-bottom:1px solid ${C.linka};">${popis}</td><td align="right" style="${FONT}font-size:14px;font-weight:700;color:${C.text};padding:8px 0;border-bottom:1px solid ${C.linka};white-space:nowrap;">${hodnota}</td></tr>`
  telo += sekce('Do konce roku', '', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${radekPrehled(`Zbývá revizí (${mistDoKonce} míst)`, doKonce.length)}
    ${radekPrehled('Hodnota zbývajících revizí', kc(sum(doKonce)))}
    ${radekPrehled(`Hotovo, čeká na fakturaci (${cekaFakt.length})`, kc(sum(cekaFakt)))}
    ${radekPrehled(`Nezaplacené faktury (${nezapl.length})`, kc(sum(nezapl)))}
    ${rozprac ? radekPrehled('Rozpracované zprávy', rozprac) : ''}
  </table>`)

  const html = `<!DOCTYPE html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.pozadi};">
<div style="display:none;max-height:0;overflow:hidden;">${naRade} revizí na řadě, ${kc(veHre)} ve hře.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.pozadi};">
<tr><td align="center" style="padding:16px 8px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">
  <tr><td style="background:${C.modra};padding:22px 28px 18px 28px;border-bottom:4px solid ${C.zluta};">
    <div style="${FONT}font-size:13px;color:#b9c8da;">Ranní souhrn · revize elektro</div>
    <div style="${FONT}font-size:24px;font-weight:700;color:#ffffff;padding-top:4px;">Dobré ráno, ${esc(datumDlouhe)}</div>
  </td></tr>
  <tr><td style="background:${C.modraSv};padding:16px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${dlazdice(naRade, 'revizí na řadě', poTerminu.length ? C.cervena : C.modra)}
      ${dlazdice(kc(sum(cekaFakt)), `čeká na fakturaci<br>(${cekaFakt.length} revizí)`, C.zluta)}
      ${dlazdice(kc(sum(nezapl)), `nezaplaceno<br>(${nezapl.length} faktur)`, poSplat.length ? C.cervena : C.zelena)}
    </tr></table>
  </td></tr>
  ${telo}
  <tr><td align="center" style="padding:28px 28px 8px 28px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="background:${C.modra};border-radius:6px;">
        <a href="${APP}" style="${FONT}display:inline-block;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;padding:12px 26px;">Otevřít aplikaci</a>
      </td></tr></table>
  </td></tr>
  <tr><td align="center" style="${FONT}font-size:12px;color:${C.seda};padding:12px 28px 24px 28px;">Posílá aplikace Revize každé ráno.</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`

  return { subject, text, html }
}
