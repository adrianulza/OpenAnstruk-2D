import { describe, expect, it, beforeEach } from 'vitest'
import { Session, sign, verify, readCookie } from './session'
import { TokenError, resetKeyCache, verifyGoogleToken } from './google'
import { parseProfile, MIN_AGE } from './profile'
import { safeNext } from './index'

const SECRET = 'x'.repeat(40)
const NOW = 1_800_000_000
const S: Session = { u: 7, e: NOW + 3600, d: 1, v: 0, n: 'Ulza', m: 'u@example.test', p: '' }

describe('session cookie', () => {
  it('round-trips', async () => {
    expect(await verify(await sign(S, SECRET), SECRET, NOW)).toEqual(S)
  })
  it('rejects a changed payload', async () => {
    const t = await sign(S, SECRET)
    const forged = btoa(JSON.stringify({ ...S, u: 1 })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    expect(await verify(forged + t.slice(t.indexOf('.')), SECRET, NOW)).toBeNull()
  })
  it('rejects another secret, expiry and junk', async () => {
    const t = await sign(S, SECRET)
    expect(await verify(t, 'y'.repeat(40), NOW)).toBeNull()
    expect(await verify(t, SECRET, NOW + 3601)).toBeNull()
    for (const junk of ['', 'abc', 'a.b.c', '.', t + 'x']) expect(await verify(junk, SECRET, NOW)).toBeNull()
  })
  it('refuses a short secret', async () => {
    await expect(sign(S, 'short')).rejects.toThrow()
  })
  it('reads a cookie by name', () => {
    const r = new Request('https://x.test', { headers: { Cookie: 'a=1; oa_s=tok.en; b=2' } })
    expect(readCookie(r, 'oa_s')).toBe('tok.en')
    expect(readCookie(r, 'oa')).toBeNull()
  })
})

// ── Google ID token, with a key pair made here standing in for Google's ──
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const enc = (o: object) => b64u(new TextEncoder().encode(JSON.stringify(o)))
const CLIENT = 'client-123.apps.googleusercontent.com'

describe('Google ID token', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey)
  const certs = () => Promise.resolve(new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'k1' }] }), { headers: { 'Cache-Control': 'max-age=60' } }))
  const good = { iss: 'https://accounts.google.com', aud: CLIENT, exp: NOW + 600, sub: '1234', email: 'A@Example.test', email_verified: true, name: 'A', picture: 'https://p' }
  async function token(claims: object, kid = 'k1', key = kp.privateKey) {
    const head = enc({ alg: 'RS256', kid, typ: 'JWT' }) + '.' + enc(claims)
    return head + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head)))
  }
  beforeEach(() => resetKeyCache())

  it('accepts a valid token and lowercases the email', async () => {
    expect(await verifyGoogleToken(await token(good), CLIENT, NOW, certs)).toEqual({ sub: '1234', email: 'a@example.test', name: 'A', picture: 'https://p' })
  })
  it.each([
    ['audience', { aud: 'other' }],
    ['issuer', { iss: 'https://evil.test' }],
    ['expiry', { exp: NOW - 3600 }],
    ['unverified email', { email_verified: false }],
  ])('rejects a wrong %s', async (_, bad) => {
    await expect(verifyGoogleToken(await token({ ...good, ...bad }), CLIENT, NOW, certs)).rejects.toBeInstanceOf(TokenError)
  })
  it('rejects a token signed by another key, or an unknown kid', async () => {
    const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']) as CryptoKeyPair
    await expect(verifyGoogleToken(await token(good, 'k1', other.privateKey), CLIENT, NOW, certs)).rejects.toBeInstanceOf(TokenError)
    await expect(verifyGoogleToken(await token(good, 'k9'), CLIENT, NOW, certs)).rejects.toBeInstanceOf(TokenError)
    await expect(verifyGoogleToken('a.b', CLIENT, NOW, certs)).rejects.toBeInstanceOf(TokenError)
  })
})

describe('profile form', () => {
  const ok = { name: '  Ulza  ', birth_year: 1999, occupation: 'Mahasiswa', institution: 'USK', consent: true }
  it('accepts and trims', () => {
    expect(parseProfile(ok, 2026)).toEqual({ name: 'Ulza', birth_year: 1999, occupation: 'Mahasiswa', institution: 'USK' })
  })
  it('keeps "Lainnya" with its text', () => {
    expect(parseProfile({ ...ok, occupation: 'Lainnya', occupation_other: 'Drafter' }, 2026)).toMatchObject({ occupation: 'Lainnya: Drafter' })
    expect(typeof parseProfile({ ...ok, occupation: 'Lainnya' }, 2026)).toBe('string')
  })
  it('refuses under age, unknown occupation, missing fields and no consent', () => {
    for (const bad of [
      { birth_year: 2026 - MIN_AGE + 1 }, { birth_year: 1900 }, { birth_year: 'x' },
      { occupation: 'Hacker' }, { name: ' ' }, { institution: '' }, { consent: 'true' },
    ]) expect(typeof parseProfile({ ...ok, ...bad }, 2026)).toBe('string')
    expect(typeof parseProfile({ ...ok, birth_year: 2026 - MIN_AGE }, 2026)).toBe('object')
  })
})

describe('next after sign-in', () => {
  const apps = ['https://2d.openanstruk.org', 'https://3d.openanstruk.org']
  const APP = 'https://2d.openanstruk.org/'
  it('allows paths here and pages on app origins only', () => {
    expect(safeNext('/profil?x=1', apps, APP)).toBe('/profil?x=1')
    expect(safeNext('https://2d.openanstruk.org/', apps, APP)).toBe(APP)
    expect(safeNext('https://3d.openanstruk.org/?m=1', apps, APP)).toBe('https://3d.openanstruk.org/?m=1')
    for (const bad of ['//evil.test', '/\\evil.test', 'https://evil.test/', 'https://2d.openanstruk.org.evil.test/', 'javascript:alert(1)', '', null])
      expect(safeNext(bad, apps, APP)).toBe(APP)
  })
})
