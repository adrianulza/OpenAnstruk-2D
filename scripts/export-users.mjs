// Downloads the accounts from the live D1 database into CSV files.
//
//   node scripts/export-users.mjs            -> exports/users-<date>.csv, exports/visits-<date>.csv
//   node scripts/export-users.mjs --local    -> the same from the local `wrangler dev` database
//
// Needs `npx wrangler login` once. exports/ is not tracked: it holds personal data.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const where = process.argv.includes('--local') ? '--local' : '--remote'
const QUERIES = {
  users: `SELECT u.id, u.name, u.email, u.birth_year, CAST(strftime('%Y','now') AS INTEGER) - u.birth_year AS age_now,
            u.occupation, u.institution, u.consent_version, u.consent_at, u.created_at, u.last_seen_at,
            (SELECT COUNT(*) FROM visits v WHERE v.user_id = u.id AND v.app = '2d') AS visits_2d,
            (SELECT COUNT(*) FROM visits v WHERE v.user_id = u.id AND v.app = '3d') AS visits_3d
          FROM users u ORDER BY u.created_at`,
  visits: `SELECT v.at, v.app, u.email, u.birth_year, CAST(substr(v.at,1,4) AS INTEGER) - u.birth_year AS age_at_visit
           FROM visits v JOIN users u ON u.id = v.user_id ORDER BY v.at`,
}

const cell = v => {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s              // spreadsheet formula injection
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

mkdirSync('exports', { recursive: true })
const day = new Date().toISOString().slice(0, 10)
for (const [name, sql] of Object.entries(QUERIES)) {
  // The query goes in a file: on Windows npx needs a shell, and a shell splits a --command argument.
  const dir = mkdtempSync(join(tmpdir(), 'oa-export-')), q = join(dir, 'q.sql')
  writeFileSync(q, sql)
  let out
  try {
    out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'openanstruk-users', where, '--json', '--file', JSON.stringify(q)],
      { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 1 << 28 })
  } finally { rmSync(dir, { recursive: true, force: true }) }
  const rows = JSON.parse(out)[0].results
  const cols = rows.length ? Object.keys(rows[0]) : []
  const file = `exports/${name}-${day}.csv`
  writeFileSync(file, '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n') + '\r\n')
  console.log(`${file}: ${rows.length} rows`)
}
