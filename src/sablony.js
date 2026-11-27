// Word šablony revizních zpráv v soukromém úložišti (prilohy/sablony) a stažení vyplněné zprávy
import { supabase } from './lib'
import { kvGet, kvSet } from './offline'
import { klicSablony, vyplnitDocx } from './docx'

const BUCKET = 'prilohy'

// cesta k původnímu Word souboru, ze kterého zpráva pochází (i přes řetěz kopií)
export function zdrojSablony(z, zpravy) {
  let cur = z
  for (let i = 0; i < 20 && cur; i++) {
    const s = cur.zdroj || ''
    if (s.startsWith('kopie: ')) return s.slice(7)
    if (s.startsWith('kopie zprávy ')) { const n = s.slice(13); cur = zpravy.find((x) => x.nazev === n && x.id !== cur.id); continue }
    return s || null
  }
  return null
}

async function stahnout(path, cacheKey) {
  const c = await kvGet(cacheKey)
  if (c) return c
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) throw new Error(/not found|404|Object not found/i.test(error.message || '') ? 'NENI' : error.message)
  const buf = await data.arrayBuffer()
  kvSet(cacheKey, buf)
  return buf
}

export async function stahnoutWord(z, zpravy) {
  const zdroj = zdrojSablony(z, zpravy)
  if (!zdroj) throw new Error('Zpráva nemá původní Word šablonu.')
  const key = await klicSablony(zdroj)
  let tpl
  try {
    tpl = await stahnout(`sablony/${key}.docx`, `sab-${key}`)
  } catch (e) {
    if (e.message === 'NENI') throw new Error('Word šablona této zprávy ještě není nahraná. Nahrajte šablony v seznamu Revizních zpráv.')
    throw e
  }
  const blob = await vyplnitDocx(tpl, (h) => stahnout(`sablony/media/${h}`, `med-${h}`), z.bloky)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${z.nazev.replace(/[\\/:*?"<>|]+/g, '-')}.docx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

// jednorázové nahrání složky sablony-zprav (vybere ji uživatel)
export async function nahratSablony(files, progress) {
  const list = [...files].filter((f) => /\.(docx|emf|jpe?g|png|wmf)$/i.test(f.name))
  const existing = new Set()
  for (const dir of ['sablony', 'sablony/media']) {
    for (let off = 0; ; off += 1000) {
      const { data } = await supabase.storage.from(BUCKET).list(dir, { limit: 1000, offset: off })
      if (!data?.length) break
      data.forEach((x) => existing.add(`${dir}/${x.name}`))
      if (data.length < 1000) break
    }
  }
  let done = 0, skip = 0, err = 0
  for (const f of list) {
    const rel = f.webkitRelativePath || f.name
    const path = /\/media\//.test(rel) ? `sablony/media/${f.name}` : `sablony/${f.name}`
    if (existing.has(path)) { skip++; progress(done + skip, list.length); continue }
    const { error } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: true, contentType: f.name.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : f.type || 'application/octet-stream' })
    if (error) err++
    else done++
    progress(done + skip, list.length)
  }
  return { done, skip, err, total: list.length }
}
