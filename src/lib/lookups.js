// Oysters are added by name alone; the oyster-lookup background function
// (Netlify) asks Claude for the rest and writes it to the database. This asks
// for every oyster still waiting, whenever one reaches the server: right away
// when online, or once the queue flushes after being offline. Claiming happens
// in the database, so two phones asking for the same oyster is harmless.

import { supabase } from './supabase'
import { onQueueDone } from '../composables/useQueue'

const ASK_AGAIN_MS = 2 * 60_000 // don't re-ask while a lookup is likely running
const STALE_RUN_MS = 5 * 60_000 // matches claim_oyster_lookup's retry window
const asked = new Map() // oyster id -> when we last asked

export const lookingUp = (o) => !!o && (o.lookup_status === 'pending' || o.lookup_status === 'running')

let sweeping = null
export function sweepLookups() {
  sweeping ||= sweep().finally(() => (sweeping = null))
  return sweeping
}

async function sweep() {
  if (!navigator.onLine) return
  const { data: auth } = await supabase.auth.getSession()
  const token = auth.session?.access_token
  if (!token) return
  const stale = new Date(Date.now() - STALE_RUN_MS).toISOString()
  const { data, error } = await supabase
    .from('oysters')
    .select('id')
    .or(`lookup_status.eq.pending,and(lookup_status.eq.running,lookup_at.lt.${stale})`)
  if (error || !data) return
  for (const { id } of data) ask(id, token)
}

// Failed lookups aren't retried on their own; this is the "Try again" button.
export async function retryLookup(id) {
  const { data: auth } = await supabase.auth.getSession()
  const token = auth.session?.access_token
  if (!token) return
  await supabase.from('oysters').update({ lookup_status: 'pending' }).eq('id', id)
  asked.delete(id)
  ask(id, token)
}

function ask(id, token) {
  if (Date.now() - (asked.get(id) || 0) < ASK_AGAIN_MS) return
  asked.set(id, Date.now())
  // A background function answers 202 straight away; the result lands in the database.
  fetch('/.netlify/functions/oyster-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id }),
  }).catch(() => asked.delete(id))
}

onQueueDone((item) => {
  if (item.fn === 'find_or_create_oyster') sweepLookups()
})
if (typeof window !== 'undefined') window.addEventListener('online', () => sweepLookups())

// Re-run `reload` every few seconds while `waiting()` is true, for up to four
// minutes, so details appear on screen as lookups finish.
export function pollWhile(waiting, reload) {
  let timer = null
  const started = Date.now()
  const tick = async () => {
    timer = null
    if (!waiting() || Date.now() - started > 4 * 60_000) return
    await reload()
    timer = setTimeout(tick, 6000)
  }
  const kick = () => {
    if (!timer) timer = setTimeout(tick, 6000)
  }
  return { kick, stop: () => clearTimeout(timer) }
}
