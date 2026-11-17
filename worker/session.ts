// Signed session cookie, shared by openanstruk.org and 3d.openanstruk.org.
//
// The cookie is `<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`, signed with
// SESSION_SECRET. It is not encrypted: it carries only what the user already
// knows about themselves (id, name, email, picture), and it is HttpOnly.
//
// ⚠ OpenAnstruk-3D/worker/session.ts is a copy of this file. Keep them identical:
// a change to the payload or the encoding here that is not made there logs every
// 3D user out (or worse, lets a stale shape through).

export interface Session {
  u: number        // users.id
  e: number        // expiry, unix seconds
  d: 0 | 1         // profile done (birth year, occupation, institution, consent)
  v: number        // last visit logged, unix seconds
  n: string        // name
  m: string        // email
  p: string        // picture URL ('' when none)
}

export const COOKIE = 'oa_s'
export const FLAG = 'oa_in'          // not HttpOnly, no data: lets static pages say "Buka App"
export const MAX_AGE = 30 * 24 * 3600

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function unb64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function key(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET missing or shorter than 32 characters')
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function sign(s: Session, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(s)))
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body)))
  return body + '.' + b64url(mac)
}

/** The session in `token`, or null when it is malformed, forged or expired. */
export async function verify(token: string | null | undefined, secret: string, now = Date.now() / 1000): Promise<Session | null> {
  if (!token) return null
  const i = token.indexOf('.')
  if (i < 1 || i !== token.lastIndexOf('.')) return null
  const body = token.slice(0, i)
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret), unb64url(token.slice(i + 1)), enc.encode(body))
    if (!ok) return null
    const s = JSON.parse(dec.decode(unb64url(body))) as Session
    if (typeof s.u !== 'number' || typeof s.e !== 'number' || s.e <= now) return null
    return s
  } catch {
    return null
  }
}

export function readCookie(req: Request, name: string): string | null {
  const h = req.headers.get('Cookie')
  if (!h) return null
  for (const part of h.split(';')) {
    const j = part.indexOf('=')
    if (j > 0 && part.slice(0, j).trim() === name) return part.slice(j + 1).trim()
  }
  return null
}

/** Set-Cookie values for a session; `domain` is '' in local development. */
export function sessionCookies(token: string, domain: string): string[] {
  const d = domain ? `; Domain=${domain}` : ''
  return [
    `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax${d}`,
    `${FLAG}=1; Path=/; Max-Age=${MAX_AGE}; Secure; SameSite=Lax${d}`,
  ]
}

export function clearCookies(domain: string): string[] {
  const d = domain ? `; Domain=${domain}` : ''
  return [
    `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax${d}`,
    `${FLAG}=; Path=/; Max-Age=0; Secure; SameSite=Lax${d}`,
  ]
}
