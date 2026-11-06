// Offline-first write queue, persisted in IndexedDB.
//
// Every insert/update goes through here. Items flush FIFO so parents land
// before children. Ids are generated client-side, so a child can reference a
// parent that only exists locally. When a find-or-create RPC comes back with a
// different id (the other phone created the same visit/tasting/oyster first),
// the local id is remapped on every queued item and recorded as an alias.

import { ref, reactive, computed } from 'vue'
import { get, set } from 'idb-keyval'
import { db } from '../lib/db'
import { blobToHex, getLocalPhoto } from '../lib/photos'

const QKEY = 'oc:queue'
const AKEY = 'oc:aliases'
const FKEY = 'oc:failed'
const MAX_TRIES = 4
const TICK_MS = 15_000

const items = ref([])
const failed = ref([])
const aliases = reactive({})
const flushing = ref(false)
const lastError = ref(null)

const waiters = new Map() // qid -> resolve[]
const doneHooks = new Set()
const remapHooks = new Set()
let inflightQid = null
let loading = null
let timer = null
let canFlush = () => true

const clone = (v) => JSON.parse(JSON.stringify(v))
const persistQueue = () => set(QKEY, clone(items.value))
const persistFailed = () => set(FKEY, clone(failed.value))
const persistAliases = () => set(AKEY, clone(aliases))

function load() {
  loading ||= Promise.all([get(QKEY), get(AKEY), get(FKEY)]).then(([q, a, f]) => {
    items.value = q || []
    Object.assign(aliases, a || {})
    failed.value = f || []
  })
  return loading
}

export function resolveId(id) {
  let x = id
  for (let n = 0; x && aliases[x] && n < 10; n++) x = aliases[x]
  return x
}

export function replaceDeep(v, from, to) {
  if (v === from) return to
  if (Array.isArray(v)) return v.map((x) => replaceDeep(x, from, to))
  if (v && typeof v === 'object') {
    const o = {}
    for (const k of Object.keys(v)) o[k] = replaceDeep(v[k], from, to)
    return o
  }
  return v
}

function resolveDeep(v) {
  if (typeof v === 'string') return aliases[v] ? resolveId(v) : v
  if (Array.isArray(v)) return v.map(resolveDeep)
  if (v && typeof v === 'object') {
    const o = {}
    for (const k of Object.keys(v)) o[k] = resolveDeep(v[k])
    return o
  }
  return v
}

async function remap(from, to) {
  if (!from || !to || from === to) return
  aliases[from] = to
  items.value = items.value.map((it) => replaceDeep(it, from, to))
  failed.value = failed.value.map((it) => replaceDeep(it, from, to))
  await Promise.all([persistQueue(), persistAliases(), persistFailed()])
  for (const fn of remapHooks) await fn(from, to)
}

function settle(qid, value) {
  const list = waiters.get(qid)
  waiters.delete(qid)
  list?.forEach((resolve) => resolve(value))
}

function waitFor(qid) {
  return new Promise((resolve) => {
    if (!waiters.has(qid)) waiters.set(qid, [])
    waiters.get(qid).push(resolve)
  })
}

/**
 * Queue a write. Returns { qid, done } where `done` resolves with the result
 * once flushed (or null if it was dead-lettered). It never rejects.
 *
 * item.op: 'rpc' | 'insert' | 'upsert' | 'update' | 'delete' | 'photo'
 * item.coalesce: optional key; a pending (not in-flight) item with the same
 *   key is replaced in place (update patches are merged).
 * item.shadows: [{ table, id }] local shadow records this write backs.
 */
export async function enqueue(item) {
  await load()
  if (item.coalesce) {
    const existing = items.value.find((it) => it.coalesce === item.coalesce && it.qid !== inflightQid)
    if (existing) {
      if (item.op === 'update') existing.patch = { ...existing.patch, ...item.patch }
      else Object.assign(existing, item, { qid: existing.qid, tries: 0 })
      await persistQueue()
      flushSoon()
      return { qid: existing.qid, done: waitFor(existing.qid) }
    }
  }
  const qid = crypto.randomUUID()
  items.value.push({ ...clone(item), qid, tries: 0, at: Date.now() })
  await persistQueue()
  const done = waitFor(qid)
  flushSoon()
  return { qid, done }
}

const q = async (builder) => {
  const { data, error } = await builder
  if (error) throw error
  return data
}

async function exec(it) {
  switch (it.op) {
    case 'rpc': {
      const data = await q(db.rpc(it.fn, it.args))
      if (it.localId && data && data !== it.localId) await remap(it.localId, data)
      return data
    }
    case 'insert':
      // upsert-ignore keeps retries idempotent
      await q(db.from(it.table).upsert(it.row, { onConflict: 'id', ignoreDuplicates: true }))
      return it.row.id
    case 'upsert':
      await q(db.from(it.table).upsert(it.row, { onConflict: it.onConflict }))
      return true
    case 'update':
      await q(db.from(it.table).update(it.patch).eq('id', it.id))
      return true
    case 'delete':
      await q(db.from(it.table).delete().eq('id', it.id))
      return true
    case 'photo':
      return execPhoto(it)
    default:
      throw Object.assign(new Error(`Unknown op ${it.op}`), { code: 'bad_op' })
  }
}

async function execPhoto({ photoId, visitId, tastingId, setCover }) {
  const [full, thumb] = await Promise.all([getLocalPhoto(photoId, 'full'), getLocalPhoto(photoId, 'thumb')])
  await q(
    db.from('photos').upsert({ id: photoId, visit_id: visitId, tasting_id: tastingId || null }, { onConflict: 'id', ignoreDuplicates: true }),
  )
  if (full && thumb) {
    await q(
      db
        .from('photo_files')
        .upsert({ photo_id: photoId, full_jpeg: await blobToHex(full), thumb_jpeg: await blobToHex(thumb) }, { onConflict: 'photo_id' }),
    )
  }
  if (setCover) await q(db.from('visits').update({ cover_photo_id: photoId }).eq('id', visitId))
  return photoId
}

function errMessage(e) {
  return e?.message || e?.error_description || String(e)
}

// Network trouble or an expired session: stop and try again later, don't count it.
function isTransient(e) {
  if (!navigator.onLine) return true
  const msg = errMessage(e)
  if (/failed to fetch|load failed|network|timeout|fetch|aborted|offline/i.test(msg) && !e?.code) return true
  if (e?.code === 'PGRST301' || e?.code === 'PGRST303' || /jwt|authentication required/i.test(msg)) return true
  const status = Number(e?.status || e?.statusCode)
  return status === 0 || status === 401 || status === 408 || status === 429 || status >= 500
}

export async function flush() {
  await load()
  if (flushing.value || !items.value.length || !navigator.onLine || !canFlush()) return
  flushing.value = true
  try {
    while (items.value.length) {
      const it = items.value[0]
      inflightQid = it.qid
      try {
        const result = await exec(resolveDeep(it))
        const done = items.value.shift()
        await persistQueue()
        lastError.value = null
        for (const fn of doneHooks) await fn(done, result)
        settle(done.qid, result ?? true)
      } catch (e) {
        lastError.value = errMessage(e)
        console.warn('[queue]', it.op, it.table || it.fn || '', lastError.value)
        if (isTransient(e)) break
        it.tries = (it.tries || 0) + 1
        if (it.tries >= MAX_TRIES) {
          items.value.shift()
          failed.value.push({ ...clone(it), error: lastError.value })
          await Promise.all([persistQueue(), persistFailed()])
          for (const fn of doneHooks) await fn(it, null)
          settle(it.qid, null)
          continue
        }
        await persistQueue()
        break
      }
    }
  } finally {
    inflightQid = null
    flushing.value = false
    tick()
  }
}

let soon = null
function flushSoon() {
  clearTimeout(soon)
  soon = setTimeout(flush, 50)
}

function tick() {
  if (items.value.length && !timer) timer = setInterval(flush, TICK_MS)
  if (!items.value.length && timer) {
    clearInterval(timer)
    timer = null
  }
}

export async function retryFailed() {
  await load()
  items.value.push(...failed.value.map((it) => ({ ...it, tries: 0, error: undefined })))
  failed.value = []
  await Promise.all([persistQueue(), persistFailed()])
  flushSoon()
}

export async function discardFailed() {
  failed.value = []
  await persistFailed()
}

let started = false
export async function startQueue(opts = {}) {
  if (opts.canFlush) canFlush = opts.canFlush
  await load()
  if (!started) {
    started = true
    window.addEventListener('online', flushSoon)
    window.addEventListener('focus', flushSoon)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') flushSoon()
    })
  }
  tick()
  flushSoon()
}

export const onQueueDone = (fn) => doneHooks.add(fn)
export const onRemap = (fn) => remapHooks.add(fn)

export function useQueue() {
  return {
    items,
    failed,
    aliases,
    flushing,
    lastError,
    pending: computed(() => items.value.length),
    flush,
    retryFailed,
    discardFailed,
    resolveId,
  }
}
