// Netlify Background Function: fills in an oyster's details with Claude.
// The phone POSTs { id } with its Supabase access token and gets a 202 right
// away; this keeps running (up to 15 min) and writes the result to the
// database, where the phone picks it up. Every database call runs as the
// signed-in person, so the usual RLS applies. Needs ANTHROPIC_API_KEY.

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { lookupOyster } from './lookup.js'

// The bundler moves this file, so look for domain.md both beside it and
// where netlify.toml's included_files puts it.
async function loadDomain() {
  const places = [new URL('./domain.md', import.meta.url), resolve(process.cwd(), 'netlify/functions/oyster-lookup/domain.md')]
  for (const p of places) {
    try {
      return await readFile(p, 'utf8')
    } catch {}
  }
  throw new Error('domain.md not found')
}

export default async (req) => {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /i, '')
  const { id } = await req.json().catch(() => ({}))
  if (!token || !id) return console.error('oyster-lookup: missing token or id')

  const db = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })
  const { data: who, error: authError } = await db.auth.getUser(token)
  if (authError || !who?.user) return console.error('oyster-lookup: not signed in')

  // Null means another lookup has it, or it's already done.
  const { data: name, error: claimError } = await db.rpc('claim_oyster_lookup', { p_id: id })
  if (claimError) return console.error('oyster-lookup: claim failed', claimError.message)
  if (!name) return console.log('oyster-lookup: nothing to do for', id)

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const { result, usage, passes, error } = await lookupOyster(client, await loadDomain(), name)
    console.log('oyster-lookup', JSON.stringify({ name, found: !!result, passes, usage, error }))
    const { error: saveError } = await db.rpc('finish_oyster_lookup', {
      p_id: id,
      p_status: error ? 'failed' : result ? 'found' : 'not_found',
      p_result: result,
    })
    if (saveError) throw new Error(saveError.message)
  } catch (e) {
    console.error('oyster-lookup failed', name, e.message)
    await db.rpc('finish_oyster_lookup', { p_id: id, p_status: 'failed', p_result: null })
  }
}

export const config = { background: true }
