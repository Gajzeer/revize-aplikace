// PDF zprávy přes Microsoft Word online (OneDrive): převod dělá přímo Word, vzhled je 1:1.
// Soubor se nahraje do složky aplikace na OneDrivu (Aplikace/Revize), převede a hned smaže.
let msal = null
let msalId = null
const SCOPES = ['Files.ReadWrite.AppFolder']
// prázdná stránka pro okno přihlášení (aplikace se v něm nespouští)
const redirectUri = () => new URL('msal.html', location.href.split('#')[0]).href

async function klient(clientId) {
  if (msal && msalId === clientId) return msal
  const { PublicClientApplication } = await import('@azure/msal-browser')
  msal = new PublicClientApplication({ auth: { clientId, authority: 'https://login.microsoftonline.com/consumers', redirectUri: redirectUri() }, cache: { cacheLocation: 'localStorage' } })
  await msal.initialize()
  msalId = clientId
  return msal
}

async function token(clientId) {
  const m = await klient(clientId)
  const ucet = m.getAllAccounts()[0]
  if (ucet) {
    try { return (await m.acquireTokenSilent({ scopes: SCOPES, account: ucet })).accessToken } catch { /* přihlásit znovu */ }
  }
  return (await m.acquireTokenPopup({ scopes: SCOPES, redirectUri: redirectUri() })).accessToken
}

export const prihlasenMicrosoft = async (clientId) => !!clientId && (await klient(clientId)).getAllAccounts()[0]?.username
export async function odhlasitMicrosoft(clientId) { const m = await klient(clientId); const u = m.getAllAccounts()[0]; if (u) await m.clearCache({ account: u }) }

export async function wordNaPdf(docx, clientId) {
  if (!clientId) throw new Error('PDF přes Word ještě není nastavené (chybí ID aplikace Microsoft v Revizních zprávách).')
  const t = await token(clientId)
  const H = { Authorization: `Bearer ${t}` }
  const jmeno = `prevod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.docx`
  const up = await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${jmeno}:/content`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, body: docx })
  if (!up.ok) throw new Error(`OneDrive nepřijal soubor (${up.status}).`)
  const item = await up.json()
  try {
    const r = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/content?format=pdf`, { headers: H })
    if (!r.ok) throw new Error(`Word soubor nepřevedl (${r.status}).`)
    return new Blob([await r.arrayBuffer()], { type: 'application/pdf' })
  } finally {
    fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${item.id}`, { method: 'DELETE', headers: H }).catch(() => {})
  }
}
