// Verifies a Google Identity Services ID token (RS256 JWT) with WebCrypto.
// No library: the checks are the ones Google documents for ID tokens.
import { unb64url } from './session'

export interface GoogleUser { sub: string; email: string; name: string; picture: string }

interface Jwk { kid: string; n: string; e: string; kty: string; alg?: string }

const CERTS = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
const dec = new TextDecoder()

let cache: { keys: Jwk[]; until: number } | null = null

async function googleKeys(fetchKeys: () => Promise<Response>): Promise<Jwk[]> {
  if (cache && cache.until > Date.now()) return cache.keys
  const r = await fetchKeys()
  if (!r.ok) throw new Error('google certs: HTTP ' + r.status)
  const age = /max-age=(\d+)/.exec(r.headers.get('Cache-Control') || '')
  const keys = ((await r.json()) as { keys: Jwk[] }).keys
  cache = { keys, until: Date.now() + (age ? Number(age[1]) : 3600) * 1000 }
  return keys
}

export class TokenError extends Error {}

/**
 * The user in `token` when it is a valid Google ID token for `clientId`;
 * throws TokenError otherwise. `fetchKeys` is injectable for tests.
 */
export async function verifyGoogleToken(
  token: string, clientId: string, now = Date.now() / 1000,
  fetchKeys: () => Promise<Response> = () => fetch(CERTS),
): Promise<GoogleUser> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new TokenError('malformed token')
  let header: { alg: string; kid: string }, claims: Record<string, unknown>
  try {
    header = JSON.parse(dec.decode(unb64url(parts[0])))
    claims = JSON.parse(dec.decode(unb64url(parts[1])))
  } catch { throw new TokenError('malformed token') }
  if (header.alg !== 'RS256') throw new TokenError('unexpected alg')

  let jwk = (await googleKeys(fetchKeys)).find(k => k.kid === header.kid)
  if (!jwk) { cache = null; jwk = (await googleKeys(fetchKeys)).find(k => k.kid === header.kid) }   // keys rotated
  if (!jwk) throw new TokenError('unknown key')
  const pub = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, unb64url(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1]))
  if (!ok) throw new TokenError('bad signature')

  if (!ISSUERS.has(String(claims.iss))) throw new TokenError('bad issuer')
  if (claims.aud !== clientId) throw new TokenError('bad audience')
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new TokenError('expired')
  if (claims.email_verified !== true) throw new TokenError('email not verified')
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') throw new TokenError('missing claims')
  return {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    name: typeof claims.name === 'string' ? claims.name : '',
    picture: typeof claims.picture === 'string' ? claims.picture : '',
  }
}

/** For tests: forget the cached keys. */
export function resetKeyCache() { cache = null }
