// Vyplnění původní Word zprávy (šablony) upraveným textem z aplikace.
// Struktura bloků odpovídá převodu z Wordu: odstavce s textem a tabulky s neprázdnými řádky, v pořadí těla dokumentu.
import JSZip from 'jszip'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const kids = (el, name) => [...el.childNodes].filter((n) => n.nodeType === 1 && n.namespaceURI === W && n.localName === name)
const runsOf = (p) => {
  const out = []
  for (const c of p.childNodes) {
    if (c.nodeType !== 1 || c.namespaceURI !== W) continue
    if (c.localName === 'r') out.push(c)
    else if (c.localName === 'hyperlink') out.push(...kids(c, 'r'))
  }
  return out
}

// textové kousky odstavce: w:t, w:tab ('\t'), w:br/w:cr ('\n')
function segments(p) {
  const segs = []
  let pos = 0
  for (const r of runsOf(p))
    for (const c of r.childNodes) {
      if (c.nodeType !== 1 || c.namespaceURI !== W) continue
      let t = null
      if (c.localName === 't') t = c.textContent
      else if (c.localName === 'tab') t = '\t'
      else if (c.localName === 'br' || c.localName === 'cr') t = '\n'
      if (t == null) continue
      segs.push({ node: c, run: r, kind: c.localName === 't' ? 't' : 'x', start: pos, end: pos + t.length, text: t })
      pos += t.length
    }
  return segs
}
const pText = (p) => segments(p).map((s) => s.text).join('')

// změní jen úsek, který se liší (formát písma okolního textu zůstane)
function setText(p, oldFull, wanted) {
  if (oldFull === wanted) return
  let a = 0
  while (a < oldFull.length && a < wanted.length && oldFull[a] === wanted[a]) a++
  let s = 0
  while (s < oldFull.length - a && s < wanted.length - a && oldFull[oldFull.length - 1 - s] === wanted[wanted.length - 1 - s]) s++
  const b = oldFull.length - s
  const mid = wanted.slice(a, wanted.length - s)
  const segs = segments(p)
  let target = segs.find((g) => g.kind === 't' && g.start <= a && a < g.end) || segs.find((g) => g.kind === 't' && g.end === a) || segs.find((g) => g.kind === 't' && g.start >= a)
  if (!target) {
    // odstavec bez textového uzlu: přidat do prvního běhu (nebo nového)
    const doc = p.ownerDocument
    let r = runsOf(p)[0]
    if (!r) { r = doc.createElementNS(W, 'w:r'); p.appendChild(r) }
    const t = doc.createElementNS(W, 'w:t')
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
    r.appendChild(t)
    target = { node: t, kind: 't', start: a, end: a, text: '' }
    segs.push(target)
  }
  for (const g of segs) {
    const from = Math.max(a, g.start)
    const to = Math.min(b, g.end)
    if (g === target) {
      const off = Math.max(0, a - g.start)
      const cutTo = Math.max(off, Math.min(b, g.end) - g.start)
      g.node.textContent = g.text.slice(0, off) + mid + g.text.slice(cutTo)
      g.node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
    } else if (from < to) {
      if (g.kind === 't') {
        g.node.textContent = g.text.slice(0, from - g.start) + g.text.slice(to - g.start)
        g.node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
      } else g.node.parentNode.removeChild(g.node)
    }
  }
}

// převod jako při importu: odstavce bez textu a prázdné řádky tabulek se přeskakují
function parseBody(doc) {
  const body = doc.getElementsByTagNameNS(W, 'body')[0]
  const out = []
  for (const el of body.childNodes) {
    if (el.nodeType !== 1 || el.namespaceURI !== W) continue
    if (el.localName === 'p') {
      const raw = pText(el)
      const x = raw.replace(/\t/g, '    ').trimEnd()
      if (x.trim()) out.push({ t: 'p', el, raw, x })
    } else if (el.localName === 'tbl') {
      const rows = []
      for (const tr of kids(el, 'tr')) {
        const cells = kids(tr, 'tc').map((tc) => {
          const ps = kids(tc, 'p')
          return { tc, ps, x: ps.map((p) => pText(p).trim()).join('\n').trim() }
        })
        if (cells.some((c) => c.x)) rows.push({ tr, cells })
      }
      if (rows.length) out.push({ t: 'tab', el, rows })
    }
  }
  return out
}

// text buňky: řádky rozdělit do odstavců buňky
function setCell(c, wanted) {
  if (c.x === (wanted || '').trim()) return
  const lines = String(wanted || '').split('\n')
  const ps = c.ps.length ? c.ps : []
  if (!ps.length) return
  let f = ps.findIndex((p) => pText(p).trim())
  if (f < 0) f = 0
  const doc = c.tc.ownerDocument
  for (let k = 0; k < lines.length; k++) {
    let p = ps[f + k]
    if (!p) {
      p = ps[ps.length - 1].cloneNode(true)
      ps[ps.length - 1].parentNode.insertBefore(p, ps[ps.length - 1].nextSibling)
      for (const g of segments(p)) g.kind === 't' ? (g.node.textContent = '') : g.node.parentNode.removeChild(g.node)
      ps.push(p)
    }
    const raw = pText(p)
    const lead = raw.match(/^\s*/)[0]
    const trail = raw.match(/\s*$/)[0]
    setText(p, raw, raw.trim() ? lead + lines[k] + trail : lines[k])
  }
  for (let k = f + lines.length; k < ps.length; k++) {
    const raw = pText(ps[k])
    if (raw) setText(ps[k], raw, '')
  }
  void doc
}

function fillTable(tpl, ed) {
  const T = tpl.rows
  const E = ed.r
  const marked = E.some((r) => r[0]?.ri !== undefined || r[0]?.nw)
  const plan = marked
    ? E.map((r) => (r[0]?.nw ? { src: r[0].from ?? T.length - 1, nw: true, r } : { src: r[0].ri, r }))
    : E.map((r, i) => ({ src: Math.min(i, T.length - 1), nw: i >= T.length, r }))
  const used = new Set(plan.filter((x) => !x.nw).map((x) => x.src))
  // nové řádky: kopie zdrojového řádku vložená za něj
  const lastInserted = {}
  for (const x of plan) {
    const s = T[x.src]
    if (!s) continue
    if (!x.nw) { fillRow(s, x.r); continue }
    const tr = s.tr.cloneNode(true)
    const after = lastInserted[x.src] || s.tr
    after.parentNode.insertBefore(tr, after.nextSibling)
    lastInserted[x.src] = tr
    const cells = kids(tr, 'tc').map((tc) => { const ps = kids(tc, 'p'); return { tc, ps, x: ps.map((p) => pText(p).trim()).join('\n').trim() } })
    fillRow({ tr, cells }, x.r)
  }
  T.forEach((row, i) => { if (!used.has(i) && row.tr.parentNode) row.tr.parentNode.removeChild(row.tr) })
}
function fillRow(row, cells) {
  // buňky se sloučením (gridSpan) jsou v blocích jednou, stejně jako tc ve Wordu
  row.cells.forEach((c, j) => { if (cells[j]) setCell(c, cells[j].x) })
}

export async function vyplnitDocx(sablona, media, bloky) {
  const zip = await JSZip.loadAsync(sablona)
  const xml = await zip.file('word/document.xml').async('string')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const tpl = parseBody(doc)
  if (tpl.length !== bloky.length) throw new Error(`Šablona má ${tpl.length} částí, zpráva ${bloky.length}. Zprávu nejde do Wordu přenést.`)
  tpl.forEach((t, i) => {
    const b = bloky[i]
    if (t.t !== b.t) throw new Error(`Část ${i + 1} zprávy neodpovídá šabloně.`)
    if (t.t === 'p') { if (t.x !== b.x) setText(t.el, t.raw, b.x.replace(/ {4}/g, '\t') + t.raw.slice(t.raw.replace(/\s+$/, '').length)) }
    else fillTable(t, b)
  })
  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc))
  // vrátit velké obrázky (hlavička, logo), které jsou v úložišti jen jednou
  const man = zip.file('claude-media.json') ? JSON.parse(await zip.file('claude-media.json').async('string')) : {}
  for (const [path, h] of Object.entries(man)) {
    const data = await media(h)
    zip.file(path, data)
  }
  zip.remove('claude-media.json')
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' })
}

// klíč šablony: SHA-1 cesty původního souboru (stejně jako při přípravě šablon)
export async function klicSablony(zdroj) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(zdroj))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20)
}
