import { ref, computed } from 'vue'
import { get, set } from 'idb-keyval'
import { authUrl, configured, db } from '../lib/db'

const session = ref(null)
const profiles = ref([])
const ready = ref(false)
let initPromise = null

// Used only if someone's profile row is missing a color (or hasn't loaded).
const FALLBACK_COLORS = ['#ff6b5a', '#2bb3a3', '#f2a91e', '#7a5cff', '#3f7a52', '#e05297', '#1d74a8', '#a8642a']
const fallbackColor = (id = '') => FALLBACK_COLORS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % FALLBACK_COLORS.length]

async function loadProfiles() {
  if (!session.value) return
  const { data, error } = await db.from('profiles').select('*').order('display_name')
  if (!error && data) {
    profiles.value = data
    set('oc:profiles', data)
  } else {
    profiles.value = (await get('oc:profiles')) || profiles.value
  }
}

// Neon Auth needs the network to answer "who am I?", and a failed call looks
// the same as being signed out. Remember who was signed in so the app still
// opens on bad signal; that stand-in session has no token, so nothing syncs
// until the real one is back.
const USER_KEY = 'oc:user'

function rememberUser(s) {
  try {
    if (s?.user) localStorage.setItem(USER_KEY, JSON.stringify({ id: s.user.id, email: s.user.email }))
    else localStorage.removeItem(USER_KEY)
  } catch {}
}

function rememberedSession() {
  try {
    const user = JSON.parse(localStorage.getItem(USER_KEY))
    return user ? { user } : null
  } catch {
    return null
  }
}

const authReachable = () =>
  navigator.onLine &&
  fetch(`${authUrl}/ok`, { mode: 'no-cors', signal: AbortSignal.timeout(4000) }).then(
    () => true,
    () => false,
  )

async function fetchSession() {
  const timeout = new Promise((resolve) => setTimeout(() => resolve({}), 4000))
  const { data } = await Promise.race([db.auth.getSession(), timeout]).catch(() => ({}))
  if (data?.session) {
    rememberUser(data.session)
    return data.session
  }
  const remembered = rememberedSession()
  if (remembered && !(await authReachable())) return remembered
  rememberUser(null)
  return null
}

// Back online with only the stand-in session: fetch the real one.
async function restoreSession() {
  if (!session.value || session.value.access_token) return
  session.value = await fetchSession()
  if (session.value?.access_token) loadProfiles()
}

export function initAuth() {
  initPromise ||= (async () => {
    if (!configured) {
      ready.value = true
      return
    }
    profiles.value = (await get('oc:profiles')) || []
    session.value = await fetchSession()
    db.auth.onAuthStateChange((event, s) => {
      if (!s && event !== 'SIGNED_OUT') return // bad signal, not a sign-out
      const wasSignedIn = !!session.value?.access_token
      session.value = s
      rememberUser(s)
      if (s && (!wasSignedIn || event === 'SIGNED_IN')) loadProfiles()
    })
    window.addEventListener('online', restoreSession)
    window.addEventListener('focus', restoreSession)
    if (session.value) loadProfiles()
    ready.value = true
  })()
  return initPromise
}

const user = computed(() => session.value?.user ?? null)
const me = computed(() => profiles.value.find((p) => p.id === user.value?.id) ?? null)
const byName = (a, b) => (a.display_name || '').localeCompare(b.display_name || '')

// Everyone in the family except me, alphabetical.
const others = computed(() =>
  profiles.value.filter((p) => p.id !== user.value?.id).map(withColor).sort(byName),
)

// Me first, then everyone else, so grouped bars always read in the same order.
const people = computed(() => {
  const list = []
  if (user.value) list.push(withColor(me.value ?? { id: user.value.id, display_name: 'Me' }))
  return [...list, ...others.value]
})

function withColor(p) {
  return p.color ? p : { ...p, color: fallbackColor(p.id) }
}

function profileFor(userId) {
  const p = profiles.value.find((x) => x.id === userId)
  if (p) return withColor(p)
  return { id: userId, display_name: userId === user.value?.id ? 'Me' : 'Family', color: fallbackColor(userId) }
}

/** Profiles for a set of user ids (e.g. whoever rated a tasting), me first, then by name. */
function peopleFor(userIds) {
  const ids = new Set([...userIds].filter(Boolean))
  const mine = user.value && ids.has(user.value.id) ? [profileFor(user.value.id)] : []
  const rest = [...ids].filter((id) => id !== user.value?.id).map(profileFor).sort(byName)
  return [...mine, ...rest]
}

// First word of a display name: short enough for chips when the whole family rated.
const shortName = (p) => (p?.display_name || '?').trim().split(/\s+/)[0]

async function signInWithPassword(email, password) {
  const { error } = await db.auth.signInWithPassword({ email, password })
  if (error) throw error
  session.value = await fetchSession()
  if (session.value) loadProfiles()
}

async function signOut() {
  await db.auth.signOut()
  rememberUser(null)
  session.value = null
}

export function useAuth() {
  return {
    session,
    user,
    me,
    others,
    people,
    peopleFor,
    shortName,
    profiles,
    ready,
    profileFor,
    loadProfiles,
    signInWithPassword,
    signOut,
  }
}
