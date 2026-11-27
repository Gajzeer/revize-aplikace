// Offline režim: poslední data a fronta neodeslaných změn v IndexedDB prohlížeče
const DB_NAME = 'revize-offline'
let dbp = null
function idb() {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1)
      r.onupgradeneeded = () => {
        r.result.createObjectStore('kv')
        r.result.createObjectStore('fronta', { keyPath: 'n', autoIncrement: true })
      }
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  return dbp
}
async function tx(store, mode, fn) {
  const d = await idb()
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode)
    const out = fn(t.objectStore(store))
    t.oncomplete = () => res(out?.result)
    t.onerror = () => rej(t.error)
  })
}
export const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k)).catch(() => undefined)
export const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k)).catch(() => {})
export const frontaPridat = (op) => tx('fronta', 'readwrite', (s) => s.add({ ...op, at: Date.now() }))
export const frontaVse = () => tx('fronta', 'readonly', (s) => s.getAll()).then((x) => x || []).catch(() => [])
export const frontaSmazat = (n) => tx('fronta', 'readwrite', (s) => s.delete(n))

// chyba sítě (ne chyba databáze): fetch selže, nebo je zařízení offline
export const jeSitovaChyba = (e) => !navigator.onLine || e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(e?.message || '')

let tmp = -1
export const docasneId = () => -(Date.now() * 10 + (tmp = (tmp + 1) % 10)) // záporné = zatím jen v telefonu

// při odhlášení: zavřít spojení a smazat vše uložené v zařízení
export async function smazatVse() {
  try { if (dbp) (await dbp).close() } catch {}
  dbp = null
  await new Promise((res) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res() })
}
