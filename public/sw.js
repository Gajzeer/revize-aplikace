// Service worker: aplikace se otevře i bez signálu. Data se sem neukládají (ta drží IndexedDB v aplikaci).
const CACHE = 'revize-app-v2'
self.addEventListener('install', (e) => {
  // uloží stránku i soubory aplikace, na které odkazuje (skripty, styly)
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])
      const html = await (await c.match('/')).text()
      const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
      await c.addAll(files)
    }).then(() => self.skipWaiting())
  )
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const own = url.origin === location.origin
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)
  if (!own && !fonts) return // databáze a ostatní služby jdou vždy přímo
  if (req.mode === 'navigate') {
    // stránka: vždy čerstvá ze sítě, bez signálu poslední uložená
    e.respondWith(
      fetch(req)
        .then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put('/', c)); return r })
        .catch(() => caches.match('/', { ignoreVary: true }))
    )
    return
  }
  // soubory aplikace (mají v názvu otisk obsahu) a písma: z mezipaměti, jinak ze sítě a uložit
  e.respondWith(
    caches.match(req, { ignoreVary: true, ignoreSearch: false }).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)) }
      return r
    }))
  )
})
