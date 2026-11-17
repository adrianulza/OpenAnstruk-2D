// The profile form, validated here as well as in the page: the page is a convenience,
// this is the rule.

export const CONSENT_VERSION = '2026-11-16'   // bump when /privasi changes in substance
export const MIN_AGE = 18

export const OCCUPATIONS = [
  'Mahasiswa',
  'Dosen/Peneliti',
  'Engineer/Konsultan',
  'Kontraktor/Pelaksana',
  'Arsitek',
  'Lainnya',
] as const

export interface Profile { name: string; birth_year: number; occupation: string; institution: string }

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''

/** The profile in `body`, or a message (Indonesian, shown to the user) saying what is wrong. */
export function parseProfile(body: Record<string, unknown>, year = new Date().getUTCFullYear()): Profile | string {
  const name = clean(body.name, 100)
  const institution = clean(body.institution, 150)
  const birth_year = Number(body.birth_year)
  let occupation = clean(body.occupation, 60)
  const other = clean(body.occupation_other, 60)

  if (!name) return 'Nama wajib diisi.'
  if (!Number.isInteger(birth_year) || birth_year < year - 100 || birth_year > year) return 'Tahun lahir tidak valid.'
  if (year - birth_year < MIN_AGE) return `OpenAnstruk hanya untuk pengguna berusia ${MIN_AGE} tahun atau lebih.`
  if (!(OCCUPATIONS as readonly string[]).includes(occupation)) return 'Pilih pekerjaan.'
  if (occupation === 'Lainnya') {
    if (!other) return 'Tuliskan pekerjaan Anda.'
    occupation = 'Lainnya: ' + other
  }
  if (!institution) return 'Institusi atau perusahaan wajib diisi.'
  if (body.consent !== true) return 'Centang persetujuan untuk melanjutkan.'
  return { name, birth_year, occupation, institution }
}
