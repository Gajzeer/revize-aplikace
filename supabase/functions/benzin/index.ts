// Průměrná cena benzínu (Natural 95) v ČR. Jednou denně ji stáhne z mbenzin.cz a uloží do nastaveni 'benzin' (hodnota.auto).
// Ruční cenu a spotřebu ukládá aplikace do stejného řádku (rucne, spotreba); tady se nepřepisují.
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const dnes = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' })

export function najdiCenu(html: string) {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ')
  const ok = (s: string) => { const n = Number(s.replace(',', '.')); return n > 20 && n < 70 ? n : null }
  // tabulka „Aktuální cena paliv v posledních dnech“: datum | benzín | nafta (první řádek je nejnovější)
  const i = text.search(/cena paliv v posledních dnech/i)
  const t = i >= 0 && text.slice(i).match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\s*\|?\s*(\d{2},\d{1,2})\s*Kč\s*\|?\s*(\d{2},\d{1,2})\s*Kč/)
  const datum = t ? `${t[3]}-${t[2].padStart(2, '0')}-${t[1].padStart(2, '0')}` : dnes()
  // blok „Aktuální průměrné ceny benzínu a nafty v ČR“ → Benzín xx,xx Kč
  const a = text.match(/Aktuální průměrné ceny benzínu[\s\S]{0,300}?Benzín[^0-9]{0,40}(\d{2},\d{1,2})\s*Kč/i)
  if (a && ok(a[1])) return { cena: ok(a[1])!, datum }
  if (t && ok(t[4])) return { cena: ok(t[4])!, datum }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    const s = db()
    const { data: row } = await s.from('nastaveni').select('id,hodnota').eq('klic', 'benzin').maybeSingle()
    const h = (row?.hodnota || {}) as Record<string, any>
    if (h.aktualizovano === dnes() && h.auto && !body.znovu) return json({ ok: true, ...h, cerstve: false })
    let auto = null, chyba = null
    try {
      const r = await fetch('https://www.mbenzin.cz/', { headers: { 'User-Agent': 'Mozilla/5.0 (revize-aplikace; denni cena benzinu)', 'Accept-Language': 'cs' } })
      if (!r.ok) throw new Error(`mbenzin.cz vrátil ${r.status}`)
      auto = najdiCenu(await r.text())
      if (!auto) throw new Error('Na mbenzin.cz jsem cenu nenašel.')
    } catch (e) { chyba = (e as Error).message }
    // znovu načíst řádek těsně před zápisem, ať se nepřepíše ruční cena ze stejné chvíle
    const { data: row2 } = await s.from('nastaveni').select('id,hodnota').eq('klic', 'benzin').maybeSingle()
    const nova = { ...((row2?.hodnota || {}) as Record<string, unknown>), ...(auto ? { auto: { ...auto, zdroj: 'mbenzin.cz' }, aktualizovano: dnes() } : {}), chyba }
    if (row2) await s.from('nastaveni').update({ hodnota: nova }).eq('id', row2.id)
    else await s.from('nastaveni').insert({ klic: 'benzin', hodnota: nova })
    return json({ ok: !!auto, ...nova, cerstve: true })
  } catch (e) {
    return json({ ok: false, chyba: (e as Error).message }, 500)
  }
})
