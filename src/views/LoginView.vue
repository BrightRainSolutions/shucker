<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { configured } from '../lib/supabase'

const route = useRoute()
const router = useRouter()
const { signInWithPassword } = useAuth()

const email = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  busy.value = true
  try {
    await signInWithPassword(email.value.trim(), password.value)
    router.replace(route.query.next || '/')
  } catch (e) {
    error.value = e.message || 'That did not work.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="login">
    <div class="hero">
      <img src="/pwa-512.png" alt="" class="mark" />
      <h1>Shucker</h1>
      <p class="tag">One family. A lot of oysters. Strong opinions.</p>
    </div>

    <div v-if="!configured" class="card stack">
      <h3>Not wired up yet</h3>
      <p class="muted">
        Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env</code>, then restart.
      </p>
    </div>

    <form v-else class="card stack" @submit.prevent="submit">
      <label class="field">
        <span>Email</span>
        <input v-model="email" class="input" type="email" autocomplete="username" required />
      </label>
      <label class="field">
        <span>Password</span>
        <input v-model="password" class="input" type="password" autocomplete="current-password" />
      </label>
      <p v-if="error" class="err">{{ error }}</p>
      <button class="btn primary big block" :disabled="busy || !password">Sign in</button>
    </form>
  </main>
</template>

<style scoped>
.login {
  min-height: 100dvh;
  max-width: 440px;
  margin: 0 auto;
  padding: calc(40px + var(--safe-top)) 20px 40px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.hero { text-align: center; }
.mark { width: 140px; height: 140px; border-radius: 22%; box-shadow: var(--shadow); }
h1 { font-size: 2.6rem; margin: 4px 0 6px; color: var(--sea); }
@media (prefers-color-scheme: dark) {
  h1 { color: var(--cream); }
}
.tag { margin: 0; color: var(--muted); }
.err { color: var(--coral); margin: 0; font-weight: 600; }
</style>
