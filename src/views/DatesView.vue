<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { loadOysterStatsCombined, loadOysters, loadPlaces, loadVisitSummaries } from '../lib/data'
import { relativeDay } from '../lib/dates'
import { loadingLine } from '../lib/attributes'
import { lookingUp } from '../lib/lookups'
import TopBar from '../components/TopBar.vue'
import PhotoImg from '../components/PhotoImg.vue'
import OysterMap from '../components/OysterMap.vue'

const route = useRoute()
const router = useRouter()
const { peopleFor, shortName } = useAuth()
// Everyone who rated something that night, me first.
const raters = (v) => peopleFor(Object.keys(v.avg_overall_by_user || {}))

const mode = computed(() => (route.query.view === 'map' ? 'map' : 'list'))
const setMode = (m) => router.replace({ query: m === 'map' ? { view: 'map' } : {} })

const visits = ref([])
const origins = ref([])
const places = ref([])
const oysters = ref([])
const loading = ref(true)

onMounted(async () => {
  const [v, s, p, o] = await Promise.all([loadVisitSummaries(), loadOysterStatsCombined(), loadPlaces(), loadOysters()])
  visits.value = v
  // Count from summaries so visits still sitting on this phone count too.
  const counts = {}
  for (const x of v) if (x.place_id) counts[x.place_id] = (counts[x.place_id] || 0) + 1
  places.value = p.filter((x) => counts[x.id]).map((x) => ({ ...x, visit_count: counts[x.id] }))
  oysters.value = o
  // Local, not-yet-synced oysters with a pin still deserve a dot.
  const known = new Set(s.map((x) => x.oyster_id))
  origins.value = [
    ...s,
    ...o.filter((x) => !known.has(x.id)).map((x) => ({ ...x, oyster_id: x.id, avg_overall: null, tasting_count: 0 })),
  ]
  loading.value = false
})

// Same three lists as the To check page: confirm, couldn't find, needs a pin.
const toCheck = computed(
  () =>
    oysters.value.filter(
      (o) => o.needs_review || ['not_found', 'failed'].includes(o.lookup_status) || (o.lat == null && !lookingUp(o)),
    ).length,
)
const fmt = (v) => (v == null ? '–' : Number(v).toFixed(1))
</script>

<template>
  <div class="dates" :class="mode">
    <TopBar title="Oyster Dates" back="/" />
    <div class="subbar">
      <div class="segmented">
        <button :class="{ on: mode === 'list' }" @click="setMode('list')">List</button>
        <button :class="{ on: mode === 'map' }" @click="setMode('map')">Map</button>
      </div>
      <RouterLink v-if="toCheck" to="/needs-pin" class="needs small">
        <span class="badge-pin">✅ To check ({{ toCheck }})</span>
      </RouterLink>
    </div>

    <div v-if="loading" class="loading">{{ loadingLine() }}</div>

    <main v-else-if="mode === 'list'" class="page">
      <div v-if="!visits.length" class="empty">
        <span class="big-emoji">🦪</span>
        <p>No oysters yet. Tragic.</p>
        <RouterLink to="/add" class="btn primary">Add the first Oyster Date</RouterLink>
      </div>

      <RouterLink v-for="v in visits" :key="v.id" :to="`/visit/${v.id}`" class="vcard">
        <div class="ph">
          <PhotoImg :photo-id="v.cover_photo_id" :path="v.cover_thumb_path" :alt="v.place_name || 'Home'" />
          <span v-if="v._local" class="local small">on this phone</span>
        </div>
        <div class="meta">
          <div class="when small">{{ relativeDay(v.visited_on) }}</div>
          <h3>{{ v.place_name || 'Home' }}</h3>
          <div class="small muted">{{ v.tasting_count || 0 }} oyster{{ v.tasting_count === 1 ? '' : 's' }}</div>
          <div v-if="raters(v).length" class="scores small">
            <span
              v-for="p in raters(v)"
              :key="p.id"
              class="score"
              :style="{ background: p.color }"
              :title="`${p.display_name}'s average`"
            >
              {{ shortName(p) }} {{ fmt(v.avg_overall_by_user[p.id]) }}
            </span>
          </div>
        </div>
      </RouterLink>
    </main>

    <div v-else class="mapbox">
      <OysterMap :origins="origins" :places="places" />
    </div>
  </div>
</template>

<style scoped>
.dates.map { height: 100dvh; display: flex; flex-direction: column; }
.mapbox { position: relative; flex: 1; }
.subbar {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 600px;
  margin: 0 auto;
  padding: 0 16px 10px;
}
.needs { text-decoration: none; margin-left: auto; }
.vcard {
  display: block;
  margin-bottom: 18px;
  border-radius: 24px;
  overflow: hidden;
  background: var(--surface);
  box-shadow: var(--shadow);
  text-decoration: none;
  transition: transform 0.1s ease;
}
.vcard:active { transform: scale(0.985); }
.ph { position: relative; aspect-ratio: 16 / 11; }
.local {
  position: absolute;
  top: 10px;
  left: 10px;
  background: var(--lemon);
  color: var(--ink);
  border-radius: 999px;
  padding: 2px 10px;
  font-weight: 700;
}
.meta { padding: 12px 16px 14px; }
.meta h3 { margin: 2px 0 6px; font-size: 1.4rem; }
.when { color: var(--coral); font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; }
.scores { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.score {
  color: #fff;
  font-weight: 800;
  border-radius: 999px;
  padding: 2px 10px;
}
</style>
