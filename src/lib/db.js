import { createClient } from '@neon/neon-js/supabase'

// Sign-in goes through this site's own /neon-auth path, which Netlify (and the
// dev server) forwards to Neon Auth. That makes Neon's login cookie
// first-party; iPhone home-screen apps can throw away the third-party one,
// leaving people stuck on the sign-in screen after a successful sign-in.
export const authUrl = `${window.location.origin}/neon-auth`
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL

export const configured = Boolean(dataApiUrl)

// Neon Auth plus the Data API, behind the same query and auth calls as supabase-js.
export const db = configured ? createClient({ auth: { url: authUrl }, dataApi: { url: dataApiUrl } }) : null
