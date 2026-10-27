// Netlify Scheduled Function: free Supabase projects pause after ~a week of
// quiet, so touch the database once a day. A read alone didn't count as
// activity, so this calls keepalive_ping(), which stamps the keepalive row.
// anon may call only that function, so the anon key never sees real data.
// Reuses the site's VITE_ env vars.

export default async () => {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.error('keepalive: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set')
    return new Response('missing env', { status: 500 })
  }

  const headers = { apikey: key, 'Content-Type': 'application/json' }
  // Legacy anon keys are JWTs and also go in Authorization; new publishable keys don't.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`

  const res = await fetch(`${url}/rest/v1/rpc/keepalive_ping`, { method: 'POST', headers, body: '{}' })
  const body = await res.text()
  console.log('keepalive', res.status, body)
  return new Response(body, { status: res.ok ? 200 : 502 })
}

// Daily, at an odd minute.
export const config = { schedule: '17 14 * * *' }
