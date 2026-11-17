// The Worker behind two hosts:
//   openanstruk.org      the landing page, sign-in, the profile form, the admin CSV
//   2d.openanstruk.org   the 2D app, behind the sign-in gate (APP_URL)
// Everything else is served straight from dist/ (static assets do not invoke this
// script; only the paths in wrangler.toml `run_worker_first` do).
// openanstruk.org/app sends people to the app host; openanstruk.org/2d no longer exists.
//
// Secrets (never in this file or wrangler.toml): SESSION_SECRET, ADMIN_EMAIL.
// See README "Sign-in" for setup.
import { COOKIE, Session, clearCookies, readCookie, sessionCookies, sign, verify } from './session'
import { TokenError, verifyGoogleToken } from './google'
import { CONSENT_VERSION, parseProfile } from './profile'

interface Env {
  ASSETS: { fetch(req: Request | string): Promise<Response> }
  DB: D1
  SESSION_SECRET: string
  ADMIN_EMAIL: string
  GOOGLE_CLIENT_ID: string
  COOKIE_DOMAIN: string        // "openanstruk.org" in production, "" locally
  APP_ORIGINS: string          // other origins allowed as ?next= and to POST here, comma separated
  APP_URL: string              // the 2D app: "https://2d.openanstruk.org/"
  SITE: string                 // this site, where accounts live: "https://openanstruk.org"
  AUTH_ENABLED: string         // "1" turns sign-in and the gate on; anything else leaves the site open
}
interface D1 { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<unknown> }
interface D1Stmt { bind(...v: unknown[]): D1Stmt; first<T>(): Promise<T | null>; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> }
interface Ctx { waitUntil(p: Promise<unknown>): void }

interface UserRow {
  id: number; email: string; name: string; picture: string; birth_year: number | null
  occupation: string | null; institution: string | null; consent_version: string | null
}

const VISIT_EVERY = 12 * 3600
const nowIso = () => new Date().toISOString()
const isDone = (u: UserRow) => u.birth_year != null && !!u.occupation && !!u.institution && u.consent_version === CONSENT_VERSION

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } })
}

function redirect(to: string, cookies: string[] = []): Response {
  const h = new Headers({ Location: to, 'Cache-Control': 'no-store' })
  for (const c of cookies) h.append('Set-Cookie', c)
  return new Response(null, { status: 302, headers: h })
}

function withCookies(res: Response, cookies: string[]): Response {
  if (!cookies.length) return res
  const out = new Response(res.body, res)
  for (const c of cookies) out.headers.append('Set-Cookie', c)
  return out
}

const appOrigins = (env: Env) => env.APP_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)

/** Where to send the user after signing in: a path on this site or a page on an app origin. */
export function safeNext(next: unknown, origins: string[], fallback = '/'): string {
  if (typeof next !== 'string' || !next) return fallback
  if (next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) return next
  try {
    const u = new URL(next)
    if (origins.includes(u.origin)) return u.href
  } catch { /* not a URL */ }
  return fallback
}

/** POSTs must come from this site or an app origin (the cookie is SameSite=Lax, this is the second lock). */
function sameSite(req: Request, env: Env): boolean {
  const o = req.headers.get('Origin')
  return !!o && (o === new URL(req.url).origin || appOrigins(env).includes(o))
}

async function session(req: Request, env: Env): Promise<Session | null> {
  return verify(readCookie(req, COOKIE), env.SESSION_SECRET)
}

function fromRow(u: UserRow, v: number): Session {
  return { u: u.id, e: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, d: isDone(u) ? 1 : 0, v, n: u.name, m: u.email, p: u.picture }
}

async function asset(env: Env, req: Request, path: string): Promise<Response> {
  return env.ASSETS.fetch(new Request(new URL(path, req.url), req))
}

// ── pages ──────────────────────────────────────────────────────────────

async function loginPage(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url)
  const next = safeNext(url.searchParams.get('next'), appOrigins(env), env.APP_URL)
  const s = await session(req, env)
  if (s) return redirect(s.d ? next : '/profil?next=' + encodeURIComponent(next))
  const page = await asset(env, req, '/html/login.html')
  return new HTMLRewriter()
    .on('meta[name="oa-client-id"]', { element(e) { e.setAttribute('content', env.GOOGLE_CLIENT_ID) } })
    .transform(page)
}

async function profilePage(req: Request, env: Env): Promise<Response> {
  const s = await session(req, env)
  if (!s) return redirect('/login?next=/profil')
  const page = await asset(env, req, '/html/profil.html')
  const out = new Response(page.body, page)                 // personal page: never from a cache
  out.headers.set('Cache-Control', 'no-store')
  return out
}

/** The gate in front of the app (on the app host): HTML is sent to sign in, anything else is refused. */
async function gate(req: Request, env: Env, ctx: Ctx, html: boolean): Promise<Response> {
  const url = new URL(req.url)
  const here = url.href                        // sign-in lives on SITE, so the way back is a full URL
  const s = await session(req, env)
  if (!s) return html ? redirect(env.SITE + '/login?next=' + encodeURIComponent(here)) : new Response('Masuk dulu di ' + env.SITE + '/login', { status: 403 })
  if (!s.d) return html ? redirect(env.SITE + '/profil?next=' + encodeURIComponent(here)) : new Response('Lengkapi profil di ' + env.SITE + '/profil', { status: 403 })
  if (!html) return env.ASSETS.fetch(req)

  const cookies: string[] = []
  const now = Math.floor(Date.now() / 1000)
  if (now - s.v > VISIT_EVERY) {
    // Also the moment a deleted account is noticed on another device.
    const u = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(s.u).first()
    if (!u) return redirect(env.SITE + '/login?next=' + encodeURIComponent(here), clearCookies(env.COOKIE_DOMAIN))
    ctx.waitUntil(env.DB.batch([
      env.DB.prepare("INSERT INTO visits (user_id, app, at) VALUES (?, '2d', ?)").bind(s.u, nowIso()),
      env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(nowIso(), s.u),
    ]))
    cookies.push(...sessionCookies(await sign({ ...s, v: now }, env.SESSION_SECRET), env.COOKIE_DOMAIN))
  }
  const page = await asset(env, req, '/html/app.html')
  return withCookies(injectAccount(page, s, env.SITE + '/account.js'), cookies)
}

/** Puts the account menu into an app page: the user's name, email and picture, and the widget. */
export function injectAccount(page: Response, s: Session, src: string): Response {
  const data = JSON.stringify({ name: s.n, email: s.m, picture: s.p, place: 'top-right' }).replace(/</g, '\\u003c')
  const res = new HTMLRewriter()
    .on('body', { element(e) { e.append(`<script>window.__oaUser=${data}</script><script src="${src}" defer></script>`, { html: true }) } })
    .transform(page)
  const out = new Response(res.body, res)
  out.headers.set('Cache-Control', 'no-store')
  return out
}

// ── API ────────────────────────────────────────────────────────────────

async function authGoogle(req: Request, env: Env): Promise<Response> {
  const body = await req.json().catch(() => null) as { credential?: string; next?: string } | null
  if (!body?.credential) return json({ error: 'Token Google tidak ada.' }, 400)
  let g
  try {
    g = await verifyGoogleToken(body.credential, env.GOOGLE_CLIENT_ID)
  } catch (e) {
    if (e instanceof TokenError) return json({ error: 'Login Google tidak valid. Coba lagi.' }, 401)
    throw e
  }
  const t = nowIso()
  const u = await env.DB.prepare(
    `INSERT INTO users (google_sub, email, name, picture, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, picture = excluded.picture, last_seen_at = excluded.last_seen_at
     RETURNING id, email, name, picture, birth_year, occupation, institution, consent_version`,
  ).bind(g.sub, g.email, g.name, g.picture, t, t).first<UserRow>()
  if (!u) throw new Error('user upsert returned nothing')
  const s = fromRow(u, 0)                 // v = 0: the first app page logs the visit
  const next = safeNext(body.next, appOrigins(env), env.APP_URL)
  const to = s.d ? next : '/profil?next=' + encodeURIComponent(next)
  return withCookies(json({ redirect: to }), sessionCookies(await sign(s, env.SESSION_SECRET), env.COOKIE_DOMAIN))
}

async function getProfile(req: Request, env: Env): Promise<Response> {
  const s = await session(req, env)
  if (!s) return json({ error: 'Belum masuk.' }, 401)
  const u = await env.DB.prepare('SELECT id, email, name, picture, birth_year, occupation, institution, consent_version FROM users WHERE id = ?')
    .bind(s.u).first<UserRow>()
  if (!u) return json({ error: 'Akun tidak ditemukan.' }, 401, { 'Set-Cookie': clearCookies(env.COOKIE_DOMAIN)[0] })
  return json({ ...u, id: undefined, consent_version: undefined, complete: isDone(u) })
}

async function saveProfile(req: Request, env: Env): Promise<Response> {
  const s = await session(req, env)
  if (!s) return json({ error: 'Belum masuk.' }, 401)
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const p = parseProfile(body || {})
  if (typeof p === 'string') return json({ error: p }, 400)
  const u = await env.DB.prepare(
    `UPDATE users SET name = ?, birth_year = ?, occupation = ?, institution = ?, consent_version = ?, consent_at = ?
     WHERE id = ? RETURNING id, email, name, picture, birth_year, occupation, institution, consent_version`,
  ).bind(p.name, p.birth_year, p.occupation, p.institution, CONSENT_VERSION, nowIso(), s.u).first<UserRow>()
  if (!u) return json({ error: 'Akun tidak ditemukan.' }, 401)
  const next = safeNext(body?.next, appOrigins(env), env.APP_URL)
  return withCookies(json({ redirect: next }), sessionCookies(await sign(fromRow(u, s.v), env.SESSION_SECRET), env.COOKIE_DOMAIN))
}

async function deleteAccount(req: Request, env: Env): Promise<Response> {
  const s = await session(req, env)
  if (!s) return json({ error: 'Belum masuk.' }, 401)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM visits WHERE user_id = ?').bind(s.u),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(s.u),
  ])
  return withCookies(json({ redirect: '/' }), clearCookies(env.COOKIE_DOMAIN))
}

// Spreadsheet programs run a cell that starts with = + - @ as a formula.
const cell = (v: unknown) => {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

async function adminCsv(req: Request, env: Env, which: string): Promise<Response> {
  const s = await session(req, env)
  if (!s || !env.ADMIN_EMAIL || s.m.toLowerCase() !== env.ADMIN_EMAIL.trim().toLowerCase()) return new Response('Forbidden', { status: 403 })
  const sql = which === 'visits'
    ? `SELECT v.at, v.app, u.email, u.birth_year, CAST(substr(v.at, 1, 4) AS INTEGER) - u.birth_year AS age_at_visit
       FROM visits v JOIN users u ON u.id = v.user_id ORDER BY v.at`
    : `SELECT u.id, u.name, u.email, u.birth_year, CAST(strftime('%Y', 'now') AS INTEGER) - u.birth_year AS age_now,
              u.occupation, u.institution, u.consent_version, u.consent_at, u.created_at, u.last_seen_at,
              (SELECT COUNT(*) FROM visits v WHERE v.user_id = u.id AND v.app = '2d') AS visits_2d,
              (SELECT COUNT(*) FROM visits v WHERE v.user_id = u.id AND v.app = '3d') AS visits_3d
       FROM users u ORDER BY u.created_at`
  const { results } = await env.DB.prepare(sql).all<Record<string, unknown>>()
  const cols = results.length ? Object.keys(results[0]) : []
  const csv = '﻿' + [cols.join(','), ...results.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n') + '\r\n'
  return new Response(csv, { headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="openanstruk-${which}-${nowIso().slice(0, 10)}.csv"`,
  } })
}

// ── router ─────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url)
    const { pathname } = url
    const m = req.method
    const onApp = url.host === new URL(env.APP_URL).host

    // The switch (wrangler.toml AUTH_ENABLED). Off: no sign-in, the app is open. It exists
    // because secrets can only be added to a Worker that already runs a script, so the
    // script shipped first, switched off, and was switched on once the secrets were in.
    if (env.AUTH_ENABLED !== '1') {
      if (onApp && pathname === '/') return asset(env, req, '/html/app.html')
      if (pathname === '/app' || pathname === '/login') return redirect(env.APP_URL)
      if (pathname === '/profil' || pathname === '/logout') return redirect(env.SITE + '/')
      if (pathname.startsWith('/api/')) return json({ error: 'Login belum aktif.' }, 503)
      if (pathname === '/') return asset(env, req, '/html/index.html')
      return env.ASSETS.fetch(req)
    }

    // 2d.openanstruk.org: the app at its root, its files behind the gate. Account pages
    // live on the main site; anything else asked of this host is sent there.
    if (onApp) {
      if (pathname === '/') return gate(req, env, ctx, true)
      if (pathname.startsWith('/assets/')) return gate(req, env, ctx, false)
      return redirect(env.SITE + pathname + url.search)
    }

    // openanstruk.org
    if (pathname === '/') return asset(env, req, '/html/index.html')
    if (pathname === '/app' || pathname === '/html/app.html') return redirect(env.APP_URL)   // old links
    if (pathname.startsWith('/assets/')) return gate(req, env, ctx, false)
    if (pathname === '/login' && m === 'GET') return loginPage(req, env)
    if (pathname === '/profil' && m === 'GET') return profilePage(req, env)
    // A plain link, so the account menu on an app host can sign out without CORS.
    // The worst a forged link can do is sign someone out.
    if (pathname === '/logout') return redirect(env.SITE + '/', clearCookies(env.COOKIE_DOMAIN))

    if (pathname.startsWith('/api/')) {
      if (m === 'POST' && !sameSite(req, env)) return json({ error: 'Asal permintaan tidak dikenal.' }, 403)
      if (pathname === '/api/auth/google' && m === 'POST') return authGoogle(req, env)
      if (pathname === '/api/profile' && m === 'GET') return getProfile(req, env)
      if (pathname === '/api/profile' && m === 'POST') return saveProfile(req, env)
      if (pathname === '/api/account/delete' && m === 'POST') return deleteAccount(req, env)
      if (pathname === '/api/admin/users.csv' && m === 'GET') return adminCsv(req, env, 'users')
      if (pathname === '/api/admin/visits.csv' && m === 'GET') return adminCsv(req, env, 'visits')
      return json({ error: 'Tidak ditemukan.' }, 404)
    }
    return env.ASSETS.fetch(req)
  },
}
