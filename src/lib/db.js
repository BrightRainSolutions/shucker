import { createClient } from '@neon/neon-js/supabase'

export const authUrl = import.meta.env.VITE_NEON_AUTH_URL
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL

export const configured = Boolean(authUrl && dataApiUrl)

// Neon Auth plus the Data API, behind the same query and auth calls as supabase-js.
export const db = configured ? createClient({ auth: { url: authUrl }, dataApi: { url: dataApiUrl } }) : null
