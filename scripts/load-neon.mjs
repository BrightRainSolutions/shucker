// One-off for the move to Neon: loads a Supabase backup into the Neon schema,
// swapping old login ids for new ones by email. Safe to re-run: it clears the
// app tables first, so the final copy at cutover replaces any earlier load.
// Logins in neon_auth are never touched.
//   node --env-file=.env scripts/load-neon.mjs backups/<folder>
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(process.env.PG_FROM || import.meta.url)
const pg = require('pg')
const dir = process.argv[2]
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))
const db = new pg.Client({ connectionString: process.env.DATABASE_URL.replace('sslmode=require', 'sslmode=verify-full') })
await db.connect()

const neonUsers = (await db.query(`select id, lower(email) email from neon_auth."user"`)).rows
const byEmail = new Map(neonUsers.map((u) => [u.email, u.id]))
const idMap = new Map()
for (const u of read('auth-users.json')) {
  const id = byEmail.get(u.email.toLowerCase())
  if (!id) throw new Error(`no Neon login for ${u.email}`)
  idMap.set(u.id, id)
}

const USER_COLS = ['created_by', 'user_id', 'taken_by']
const SKIP = new Set(['location', 'storage_path', 'thumb_path']) // generated, or Supabase Storage only
const insert = async (table, rows, mapRow = (r) => r) => {
  for (const raw of rows) {
    const row = mapRow({ ...raw })
    for (const c of USER_COLS) if (row[c]) row[c] = idMap.get(row[c]) ?? row[c]
    const cols = Object.keys(row).filter((c) => !SKIP.has(c))
    await db.query(
      `insert into public.${table} (${cols.map((c) => `"${c}"`).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      cols.map((c) => row[c]),
    )
  }
}

await db.query('begin')
try {
  await db.query(
    'truncate public.profiles, public.oysters, public.places, public.visits, public.tastings, public.ratings, public.photos, public.photo_files cascade',
  )
  const visits = read('tables/visits.json')
  const photos = read('tables/photos.json')
  await insert('profiles', read('tables/profiles.json'), (p) => ({ ...p, id: idMap.get(p.id) }))
  await insert('oysters', read('tables/oysters.json'))
  await insert('places', read('tables/places.json'))
  await insert('visits', visits, (v) => ({ ...v, cover_photo_id: null })) // covers point at photos, set below
  await insert('tastings', read('tables/tastings.json'))
  await insert('ratings', read('tables/ratings.json'))
  await insert('photos', photos)
  for (const p of photos) {
    await db.query('insert into public.photo_files (photo_id, full_jpeg, thumb_jpeg) values ($1, $2, $3)', [
      p.id,
      readFileSync(join(dir, 'photos', p.storage_path)),
      readFileSync(join(dir, 'photos', p.thumb_path)),
    ])
  }
  for (const v of visits) {
    if (v.cover_photo_id) await db.query('update public.visits set cover_photo_id = $1 where id = $2', [v.cover_photo_id, v.id])
  }
  await db.query('commit')
} catch (e) {
  await db.query('rollback')
  throw e
}

for (const t of ['profiles', 'oysters', 'places', 'visits', 'tastings', 'ratings', 'photos', 'photo_files']) {
  console.log(t, (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n)
}
const one = async (s) => (await db.query(s)).rows[0]
console.log(await one(`select count(*)::int covers from public.visits where cover_photo_id is not null`))
console.log(await one(`select round(sum(octet_length(full_jpeg) + octet_length(thumb_jpeg)) / 1048576.0, 2) as image_mb from public.photo_files`))
console.log(await one(`select count(*)::int as orphan_ratings from public.ratings r left join public.profiles p on p.id = r.user_id where p.id is null`))
console.log(await one(`select pg_size_pretty(pg_database_size(current_database())) as database_size`))
await db.end()
