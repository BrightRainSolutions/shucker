// Data layer. Reads go to Neon when online (and get cached in IndexedDB
// for offline use); writes go through the queue. Every local write also lands
// in a "shadow" record so it shows up immediately, online or not, and is
// merged over server data until its queue items have flushed.

import { reactive } from 'vue'
import { get, set } from 'idb-keyval'
import { db } from './db'
import { enqueue, onQueueDone, onRemap, replaceDeep, resolveId, useQueue } from '../composables/useQueue'
import { processPhoto, saveLocalPhoto } from './photos'
import { localToday } from './dates'

const SKEY = 'oc:shadow'
const TABLES = ['places', 'oysters', 'visits', 'tastings', 'ratings', 'photos']

export const shadow = reactive(Object.fromEntries(TABLES.map((t) => [t, {}])))
const keyOf = (id) => (Array.isArray(id) ? id.join(':') : id)
const ratingKey = (r) => `${r.tasting_id}:${r.user_id}`

const clone = (v) => JSON.parse(JSON.stringify(v))
const persistShadow = () => set(SKEY, clone(shadow))

let shadowLoaded = null
export function loadShadow() {
  shadowLoaded ||= get(SKEY).then((s) => {
    for (const t of TABLES) shadow[t] = s?.[t] || {}
  })
  return shadowLoaded
}

onRemap(async (from, to) => {
  for (const t of TABLES) {
    const next = {}
    for (const rec of Object.values(shadow[t])) {
      const r = replaceDeep(rec, from, to)
      next[t === 'ratings' ? ratingKey(r) : r.id] = r
    }
    shadow[t] = next
  }
  await persistShadow()
})

// Drop a shadow once nothing pending still backs it.
onQueueDone(async (item) => {
  if (!item.shadows?.length) return
  const { items } = useQueue()
  const stillPending = (ref) =>
    items.value.some((it) => it.shadows?.some((s) => s.table === ref.table && keyOf(s.id) === keyOf(ref.id)))
  let changed = false
  for (const ref of item.shadows) {
    if (!stillPending(ref) && shadow[ref.table]?.[keyOf(ref.id)]) {
      delete shadow[ref.table][keyOf(ref.id)]
      changed = true
    }
  }
  if (changed) await persistShadow()
})

function putShadow(table, rec) {
  const k = table === 'ratings' ? ratingKey(rec) : rec.id
  shadow[table][k] = { ...(shadow[table][k] || {}), ...clone(rec) }
  persistShadow()
  return shadow[table][k]
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
const q = async (builder) => {
  const { data, error } = await builder
  if (error) throw error
  return data
}

// Bar signal is often "connected" but useless; don't wait long before
// falling back to the last cached copy.
const READ_TIMEOUT_MS = 4000

// Share one in-flight/recent read per key so nested loads don't refetch.
const recent = new Map() // key -> { at, promise }
const RECENT_MS = 3000

function cachedQuery(key, fn, { preferCache = false } = {}) {
  if (preferCache) return get(`oc:cache:${key}`).then((c) => c ?? cachedQuery(key, fn))
  const hit = recent.get(key)
  if (hit && (hit.pending || Date.now() - hit.at < RECENT_MS)) return hit.promise
  const entry = { at: Date.now(), pending: true }
  entry.promise = readThrough(key, fn).finally(() => {
    entry.pending = false
    entry.at = Date.now()
  })
  recent.set(key, entry)
  return entry.promise
}

// After a failed read, treat the network as flaky for a bit: serve the cache
// straight away instead of making every screen wait out a timeout.
let flakyUntil = 0
const FLAKY_MS = 30_000

async function readThrough(key, fn) {
  const cacheKey = `oc:cache:${key}`
  if (navigator.onLine && Date.now() >= flakyUntil) {
    try {
      const data = await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('read timeout')), READ_TIMEOUT_MS)),
      ])
      set(cacheKey, data)
      return data
    } catch (e) {
      console.warn('[data]', key, e?.message || e)
      if (!e?.code) flakyUntil = Date.now() + FLAKY_MS
    }
  }
  return (await get(cacheKey)) ?? null
}

if (typeof window !== 'undefined') window.addEventListener('online', () => (flakyUntil = 0))

const mergeById = (serverRows = [], shadowTable = {}, filter = () => true) => {
  const out = new Map((serverRows || []).map((r) => [r.id, r]))
  for (const s of Object.values(shadowTable)) {
    if (!filter(s)) continue
    out.set(s.id, { ...(out.get(s.id) || {}), ...s, _local: true })
  }
  return [...out.values()]
}

export async function loadPlaces(opts) {
  await loadShadow()
  const rows = await cachedQuery('places', () => q(db.from('places').select('*, visits(visited_on)')), opts)
  return mergeById(rows, shadow.places).map((p) => ({
    ...p,
    lat: p.lat == null ? null : Number(p.lat),
    lng: p.lng == null ? null : Number(p.lng),
    last_visited: (p.visits || []).reduce((m, v) => (v.visited_on > m ? v.visited_on : m), ''),
    visit_count: (p.visits || []).length,
  }))
}

export async function loadOysters() {
  await loadShadow()
  const rows = await cachedQuery('oysters', () => q(db.from('oysters').select('*').order('name')))
  return mergeById(rows, shadow.oysters)
    .map((o) => ({ ...o, lat: o.lat == null ? null : Number(o.lat), lng: o.lng == null ? null : Number(o.lng) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadOysterStatsCombined() {
  const rows = await cachedQuery('oyster_stats_combined', () => q(db.from('oyster_stats_combined').select('*')))
  return rows || []
}

export async function loadVisitSummaries(opts) {
  await loadShadow()
  const placesP = loadPlaces(opts)
  const rows =
    (await cachedQuery('visit_summary', () =>
      q(db.from('visit_summary').select('*').order('visited_on', { ascending: false }).order('created_at', { ascending: false })),
      opts,
    )) || []
  const known = new Map(rows.map((r) => [r.id, r]))
  const places = Object.fromEntries((await placesP).map((p) => [p.id, p]))
  const tastingCount = (vid) => Object.values(shadow.tastings).filter((t) => t.visit_id === vid).length
  // Per-person average overall from ratings still on this phone (visit not synced yet).
  const localAverages = (vid) => {
    const tids = new Set(Object.values(shadow.tastings).filter((t) => t.visit_id === vid).map((t) => t.id))
    const sums = {}
    for (const r of Object.values(shadow.ratings)) {
      if (!tids.has(r.tasting_id) || r.overall == null) continue
      const s = (sums[r.user_id] ||= { total: 0, n: 0 })
      s.total += r.overall
      s.n += 1
    }
    return Object.fromEntries(Object.entries(sums).map(([uid, s]) => [uid, Math.round((s.total / s.n) * 100) / 100]))
  }

  for (const s of Object.values(shadow.visits)) {
    const base = known.get(s.id)
    if (base) {
      known.set(s.id, { ...base, ...s, _local: true })
    } else if (s.visited_on) {
      const p = places[s.place_id]
      known.set(s.id, {
        ...s,
        place_name: p?.name ?? null,
        place_city: p?.city ?? null,
        tasting_count: tastingCount(s.id),
        avg_overall_by_user: localAverages(s.id),
        _local: true,
      })
    }
  }
  return [...known.values()].sort(
    (a, b) => b.visited_on.localeCompare(a.visited_on) || String(b.created_at).localeCompare(String(a.created_at)),
  )
}

export async function findTodayVisit() {
  const today = localToday()
  const all = await loadVisitSummaries()
  return all.find((v) => v.visited_on === today) ?? null
}

export async function getVisitBundle(rawId) {
  await loadShadow()
  const id = resolveId(rawId)
  // in parallel: these are needed to fill in local-only rows
  const placesP = loadPlaces()
  const oystersP = loadOysters()
  const data =
    (await cachedQuery(`visit:${id}`, async () => {
      const [visit, tastings, photos] = await Promise.all([
        q(db.from('visits').select('*, place:places(*)').eq('id', id).maybeSingle()),
        q(db.from('tastings').select('*, oyster:oysters(*), ratings(*)').eq('visit_id', id).order('created_at')),
        q(db.from('photos').select('*').eq('visit_id', id).order('created_at')),
      ])
      return { visit, tastings, photos }
    })) || {}

  const sv = shadow.visits[id]
  if (!data.visit && !sv) return null
  const visit = { ...(data.visit || {}), ...(sv || {}) }
  if (!visit.place && visit.place_id) {
    visit.place = shadow.places[visit.place_id] || (await placesP).find((p) => p.id === visit.place_id) || null
  }

  const oysters = Object.fromEntries((await oystersP).map((o) => [o.id, o]))
  const tastings = mergeById(data.tastings, shadow.tastings, (t) => t.visit_id === id).map((t) => {
    const ratings = new Map((t.ratings || []).map((r) => [r.user_id, r]))
    for (const r of Object.values(shadow.ratings)) {
      if (r.tasting_id === t.id) ratings.set(r.user_id, { ...(ratings.get(r.user_id) || {}), ...r, _local: true })
    }
    return { ...t, oyster: t.oyster || oysters[t.oyster_id] || null, ratings: [...ratings.values()] }
  })
  tastings.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  const photos = mergeById(data.photos, shadow.photos, (p) => p.visit_id === id)
  return { visit, tastings, photos }
}

export async function getOysterBundle(rawId) {
  await loadShadow()
  const id = resolveId(rawId)
  const data =
    (await cachedQuery(`oyster:${id}`, async () => {
      const [oyster, stats, tastings] = await Promise.all([
        q(db.from('oysters').select('*').eq('id', id).maybeSingle()),
        q(db.from('oyster_stats').select('*').eq('oyster_id', id)),
        q(
          db
            .from('tastings')
            .select(
              '*, ratings(*), photos(id), visit:visits(id, visited_on, cover_photo_id, place:places(name, city))',
            )
            .eq('oyster_id', id),
        ),
      ])
      return { oyster, stats, tastings }
    })) || {}
  const so = shadow.oysters[id]
  if (!data.oyster && !so) return null
  const oyster = { ...(data.oyster || {}), ...(so || {}) }
  for (const k of ['lat', 'lng']) oyster[k] = oyster[k] == null ? null : Number(oyster[k])
  const tastings = (data.tastings || [])
    .filter((t) => t.visit)
    .sort((a, b) => b.visit.visited_on.localeCompare(a.visit.visited_on))
  return { oyster, stats: data.stats || [], tastings }
}

/**
 * All of one person's ratings that have an overall score, each tagged with its
 * oyster and night, newest night first. Ratings are per night (an oyster can
 * score differently depending on what else was on the plate); this powers the
 * "your last" hints. Includes ratings still waiting to sync.
 */
export async function loadMyRatings(userId) {
  await loadShadow()
  if (!userId) return []
  const rows =
    (await cachedQuery(`myratings:${userId}`, () =>
      q(
        db
          .from('ratings')
          .select('*, tasting:tastings(oyster_id, visit_id, visit:visits(visited_on))')
          .eq('user_id', userId),
      ),
    )) || []
  const byTasting = new Map()
  for (const r of rows) {
    if (!r.tasting?.visit) continue
    const { tasting, ...rating } = r
    byTasting.set(r.tasting_id, {
      ...rating,
      oyster_id: tasting.oyster_id,
      visit_id: tasting.visit_id,
      visited_on: tasting.visit.visited_on,
    })
  }
  for (const r of Object.values(shadow.ratings)) {
    if (r.user_id !== userId) continue
    const known = byTasting.get(r.tasting_id)
    const t = shadow.tastings[r.tasting_id]
    const visitedOn = known?.visited_on ?? (t && shadow.visits[t.visit_id]?.visited_on)
    if (!known && !(t && visitedOn)) continue
    byTasting.set(r.tasting_id, {
      ...(known || { oyster_id: t.oyster_id, visit_id: t.visit_id, visited_on: visitedOn }),
      ...r,
    })
  }
  return [...byTasting.values()]
    .filter((r) => r.overall != null)
    .sort(
      (a, b) =>
        b.visited_on.localeCompare(a.visited_on) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')),
    )
}

/** My most recent rating of this oyster from any other night, or null. */
export const lastRatingFor = (myRatings, oysterId, exceptTastingId = null) =>
  myRatings.find((r) => r.oyster_id === oysterId && r.tasting_id !== exceptTastingId) ?? null

// ---------------------------------------------------------------------------
// Writes (all queued)
// ---------------------------------------------------------------------------
const uuid = () => crypto.randomUUID()
const now = () => new Date().toISOString()
const race = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(undefined), ms))])

export async function createPlace({ name, city = null, address = null, url = null, lat = null, lng = null }) {
  await loadShadow()
  const row = { id: uuid(), name, city, address, url, lat, lng }
  putShadow('places', { ...row, created_at: now() })
  await enqueue({ op: 'insert', table: 'places', row, shadows: [{ table: 'places', id: row.id }] })
  return row.id
}

/** Find-or-create on (place_id, visited_on). Waits briefly for the server id. */
export async function findOrCreateVisit({ placeId, visitedOn }) {
  await loadShadow()
  // Quick local check; the RPC is the real arbiter of (place_id, visited_on).
  const existing = (await loadVisitSummaries({ preferCache: true })).find(
    (v) => (v.place_id ?? null) === (placeId ?? null) && v.visited_on === visitedOn,
  )
  if (existing) return resolveId(existing.id)
  const { pending } = useQueue()
  const queuedAhead = pending.value > 0
  const id = uuid()
  putShadow('visits', { id, place_id: placeId ?? null, visited_on: visitedOn, created_at: now() })
  const { done } = await enqueue({
    op: 'rpc',
    fn: 'find_or_create_visit',
    args: { p_id: id, p_place_id: placeId ?? null, p_visited_on: visitedOn },
    localId: id,
    shadows: [{ table: 'visits', id }],
  })
  // Wait briefly for the server's id, unless other writes (e.g. a brand-new
  // place, which can't conflict anyway) are queued ahead of it.
  if (!queuedAhead) await race(done, 4000)
  return resolveId(id)
}

export async function updateVisit(id, patch) {
  await loadShadow()
  id = resolveId(id)
  putShadow('visits', { id, ...patch })
  await enqueue({
    op: 'update',
    table: 'visits',
    id,
    patch,
    coalesce: `visits:update:${id}`,
    shadows: [{ table: 'visits', id }],
  })
}

export async function createOyster({ name, grower = null, growing_area = null, species = null, lat = null, lng = null }) {
  await loadShadow()
  const clean = (s) => (s || '').trim().toLowerCase()
  const match = (await loadOysters()).find((o) => clean(o.name) === clean(name) && clean(o.grower) === clean(grower))
  if (match) return match.id
  const id = uuid()
  putShadow('oysters', {
    id,
    name,
    grower,
    growing_area,
    species,
    lat,
    lng,
    location_approx: lat == null,
    created_at: now(),
  })
  const queuedAhead = useQueue().pending.value > 0
  const { done } = await enqueue({
    op: 'rpc',
    fn: 'find_or_create_oyster',
    args: { p_id: id, p_name: name, p_grower: grower, p_growing_area: growing_area, p_species: species, p_lat: lat, p_lng: lng },
    localId: id,
    shadows: [{ table: 'oysters', id }],
  })
  if (!queuedAhead) await race(done, 3000)
  return resolveId(id)
}

export async function updateOyster(id, patch) {
  await loadShadow()
  id = resolveId(id)
  putShadow('oysters', { id, ...patch })
  await enqueue({
    op: 'update',
    table: 'oysters',
    id,
    patch,
    coalesce: `oysters:update:${id}`,
    shadows: [{ table: 'oysters', id }],
  })
}

export async function addTasting(visitId, oysterId, priceEach = null) {
  await loadShadow()
  visitId = resolveId(visitId)
  oysterId = resolveId(oysterId)
  const dupe = Object.values(shadow.tastings).find((t) => t.visit_id === visitId && t.oyster_id === oysterId)
  if (dupe) return dupe.id
  const id = uuid()
  putShadow('tastings', { id, visit_id: visitId, oyster_id: oysterId, price_each: priceEach, created_at: now() })
  const queuedAhead = useQueue().pending.value > 0
  const { done } = await enqueue({
    op: 'rpc',
    fn: 'find_or_create_tasting',
    args: { p_id: id, p_visit_id: visitId, p_oyster_id: oysterId, p_price_each: priceEach },
    localId: id,
    shadows: [{ table: 'tastings', id }],
  })
  if (!queuedAhead) await race(done, 3000)
  return resolveId(id)
}

export async function updateTasting(id, patch) {
  await loadShadow()
  id = resolveId(id)
  if (shadow.tastings[id]) putShadow('tastings', { id, ...patch })
  await enqueue({ op: 'update', table: 'tastings', id, patch, coalesce: `tastings:update:${id}` })
}

export async function removeTasting(id) {
  await loadShadow()
  id = resolveId(id)
  delete shadow.tastings[id]
  persistShadow()
  await enqueue({ op: 'delete', table: 'tastings', id })
}

const SCORE_FIELDS = [
  'overall',
  'brininess',
  'smell_of_the_sea',
  'sweetness',
  'creaminess',
  'minerality',
  'brightness',
  'texture',
  'size',
  'would_order_again',
  'note',
]

export async function saveRating(tastingId, userId, fields) {
  await loadShadow()
  tastingId = resolveId(tastingId)
  const row = { tasting_id: tastingId, user_id: userId }
  for (const k of SCORE_FIELDS) if (k in fields) row[k] = fields[k] === '' ? null : fields[k]
  const merged = putShadow('ratings', { ...row, updated_at: now() })
  const full = { tasting_id: tastingId, user_id: userId }
  for (const k of SCORE_FIELDS) if (k in merged) full[k] = merged[k]
  await enqueue({
    op: 'upsert',
    table: 'ratings',
    row: full,
    onConflict: 'tasting_id,user_id',
    coalesce: `ratings:${tastingId}:${userId}`,
    shadows: [{ table: 'ratings', id: [tastingId, userId] }],
  })
}

/** Resize, keep locally, show immediately, upload in the background. */
export async function addPhoto(file, { visitId, tastingId = null, setCover = false }) {
  await loadShadow()
  visitId = resolveId(visitId)
  tastingId = tastingId ? resolveId(tastingId) : null
  const id = uuid()
  const blobs = await processPhoto(file)
  await saveLocalPhoto(id, blobs)
  putShadow('photos', { id, visit_id: visitId, tasting_id: tastingId, created_at: now() })
  const shadows = [{ table: 'photos', id }]
  if (setCover) {
    putShadow('visits', { id: visitId, cover_photo_id: id })
    shadows.push({ table: 'visits', id: visitId })
  }
  await enqueue({ op: 'photo', photoId: id, visitId, tastingId, setCover, shadows })
  return id
}
