import { createApp } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import { router } from './router'
import { initAuth, useAuth } from './composables/useAuth'
import { startQueue } from './composables/useQueue'
import { loadShadow } from './lib/data'
import { sweepLookups } from './lib/lookups'
import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'

registerSW({ immediate: true })

initAuth().then(() => {
  const { session } = useAuth()
  loadShadow()
  startQueue({ canFlush: () => !!session.value })
  if (session.value) sweepLookups()
})

createApp(App).use(router).mount('#app')
