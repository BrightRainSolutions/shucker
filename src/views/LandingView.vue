<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { findTodayVisit, getVisitBundle } from '../lib/data'
import PendingPill from '../components/PendingPill.vue'

const router = useRouter()
const { me, user, signOut } = useAuth()
const today = ref(null)
const menu = ref(false)

onMounted(async () => {
  today.value = await findTodayVisit()
})

const addLabel = computed(() => {
  if (!today.value) return 'Add Oyster Date'
  return `Join Tonight at ${today.value.place_name || 'Home'}`
})

async function add() {
  if (!today.value) return router.push({ name: 'add' })
  // Drop into the step that most likely needs doing.
  const b = await getVisitBundle(today.value.id)
  let step = 3
  if (b && !b.visit.cover_photo_id) step = 2
  else if (b?.tastings.length) step = 4
  router.push({ name: 'add', params: { visitId: today.value.id }, query: { step } })
}

const initial = computed(() => (me.value?.display_name || user.value?.email || '?').slice(0, 1).toUpperCase())

async function doSignOut() {
  await signOut()
  router.replace({ name: 'login' })
}
</script>

<template>
  <main class="landing">
    <div class="top">
      <PendingPill />
      <div class="spacer" />
      <div class="me-wrap">
        <button class="me" :style="{ background: me?.color || 'var(--coral)' }" aria-label="Profile" @click="menu = !menu">
          {{ initial }}
        </button>
        <div v-if="menu" class="menu card">
          <p class="small muted">Signed in as {{ me?.display_name || user?.email }}</p>
          <button class="btn ghost block" @click="doSignOut">Sign out</button>
        </div>
      </div>
    </div>

    <div class="brand">
      <img src="/pwa-512.png" alt="" class="mark" />
      <h1>Shucker</h1>
    </div>

    <div class="buttons">
      <button class="big-btn add" :class="{ join: today }" @click="add">
        <span class="kicker">{{ today ? 'Already shucking' : 'Tonight?' }}</span>
        <span class="label">{{ addLabel }}</span>
      </button>
      <RouterLink to="/dates" class="big-btn see">
        <span class="kicker">The archive</span>
        <span class="label">See Oyster Dates</span>
      </RouterLink>
    </div>
  </main>
</template>

<style scoped>
.landing {
  min-height: 100dvh;
  max-width: 600px;
  margin: 0 auto;
  padding: calc(12px + var(--safe-top)) 20px calc(28px + var(--safe-bottom));
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(120% 60% at 50% 0%, color-mix(in srgb, var(--sea-3) 18%, transparent), transparent 70%);
}
.top { display: flex; align-items: center; min-height: 48px; }
.me-wrap { position: relative; }
.me {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 3px solid var(--surface);
  box-shadow: var(--shadow);
  color: #fff;
  font-weight: 800;
  cursor: pointer;
}
.menu {
  position: absolute;
  right: 0;
  top: 52px;
  width: 220px;
  z-index: 10;
}
.menu p { margin: 0 0 10px; }
.brand { text-align: center; margin: 4vh 0 3vh; }
.mark { width: min(44vw, 200px); height: auto; border-radius: 22%; filter: drop-shadow(0 10px 20px rgba(11, 58, 91, 0.2)); }
h1 { font-size: 2.4rem; margin: 6px 0 0; }
.buttons { display: flex; flex-direction: column; gap: 16px; margin-top: auto; }
.big-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-end;
  min-height: 150px;
  padding: 20px 22px;
  border: 0;
  border-radius: 28px;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  box-shadow: var(--shadow);
  transition: transform 0.1s ease;
  position: relative;
  overflow: hidden;
}
.big-btn:active { transform: scale(0.98); }
.big-btn::after {
  content: '';
  position: absolute;
  right: -30px;
  top: -30px;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
}
.kicker {
  font-size: 0.8rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.8;
}
.label { font-family: var(--display); font-weight: 800; font-size: 1.9rem; line-height: 1.05; }
.add { background: var(--coral); color: #fff; }
.add.join { background: var(--lemon); color: var(--ink); }
.see { background: var(--sea); color: var(--cream); }
</style>
