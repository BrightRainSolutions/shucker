<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { getOysterBundle, lastRatingFor, loadMyRatings, updateOyster } from '../lib/data'
import { lookingUp, pollWhile, retryLookup } from '../lib/lookups'
import { ALL_SCORES, loadingLine, speciesLabel } from '../lib/attributes'
import { formatDate } from '../lib/dates'
import TopBar from '../components/TopBar.vue'
import MiniMap from '../components/MiniMap.vue'
import PairedBars from '../components/PairedBars.vue'
import PhotoImg from '../components/PhotoImg.vue'
import ShuckerFact from '../components/ShuckerFact.vue'

const route = useRoute()
const { user, me, peopleFor, profileFor, shortName } = useAuth()
const bundle = ref(null)
const myRatings = ref([])
const loading = ref(true)

async function load() {
  ;[bundle.value, myRatings.value] = await Promise.all([getOysterBundle(route.params.id), loadMyRatings(user.value?.id)])
  loading.value = false
}
// Details fill in while a lookup runs.
const watchLookup = pollWhile(() => lookingUp(bundle.value?.oyster), load)
onMounted(() => load().then(watchLookup.kick))
watch(() => route.params.id, load)
onBeforeUnmount(() => watchLookup.stop())

const o = computed(() => bundle.value?.oyster)
const statFor = (pid) => bundle.value?.stats.find((s) => s.user_id === pid)
// Everyone who has rated this oyster at least once, me first.
const raters = computed(() => peopleFor((bundle.value?.stats || []).map((s) => s.user_id)))
// Legend shows how many times each person has rated it.
const legend = computed(() =>
  raters.value.map((p) => ({ ...p, display_name: `${p.display_name} (${statFor(p.id)?.tasting_count || 0})` })),
)

const rows = computed(() =>
  ALL_SCORES.map((a) => ({
    label: a.label,
    values: raters.value.map((p) => ({ color: p.color, value: statFor(p.id)?.[`avg_${a.key}`] ?? null })),
  })),
)
// Includes my ratings still waiting to sync, which the server rows don't have yet.
const myByTasting = computed(() => new Map(myRatings.value.map((r) => [r.tasting_id, r])))
const overallOf = (t, pid) =>
  t.ratings?.find((r) => r.user_id === pid)?.overall ??
  (pid === user.value?.id ? (myByTasting.value.get(t.id)?.overall ?? null) : null)
const ratersOfRow = (t) => {
  const ids = (t.ratings || []).filter((r) => r.overall != null).map((r) => r.user_id)
  if (myByTasting.value.has(t.id)) ids.push(user.value?.id)
  return peopleFor(ids)
}
const iRatedRow = (t) => overallOf(t, user.value?.id) != null

// Oysterater only has pages for oysters it knows, so fall back to its search.
const oysterater = computed(() =>
  o.value?.oysterater_url
    ? { href: o.value.oysterater_url, label: 'On Oysterater ↗' }
    : { href: `https://www.oysterater.com/?s=${encodeURIComponent(o.value?.name || '')}`, label: 'Search Oysterater ↗' },
)

const latest = computed(() => (o.value ? lastRatingFor(myRatings.value, o.value.id) : null))
const myColor = computed(() => me.value?.color || profileFor(user.value?.id).color)
const rateTo = (t) => ({ name: 'add', params: { visitId: t.visit.id }, query: { step: 4, t: t.id } })
// Claude-filled details stay flagged until someone confirms them.
const sourceHost = computed(() => {
  try {
    return new URL(o.value?.details_url).hostname.replace(/^www./, '')
  } catch {
    return null
  }
})
async function confirmDetails() {
  await updateOyster(o.value.id, { needs_review: false })
  await load()
}
// The lookup only filled empty fields, and these oysters were added by name.
async function clearDetails() {
  if (!confirm(`Clear what was looked up for ${o.value.name}?`)) return
  await updateOyster(o.value.id, {
    grower: null, growing_area: null, region: null, species: null, cultivation: null,
    lat: null, lng: null, location_approx: true, oysterater_url: null, details_url: null,
    fact: null, fact_url: null, needs_review: false, lookup_status: 'not_found',
  })
  await load()
}
async function lookAgain() {
  await retryLookup(o.value.id)
  await load()
  watchLookup.kick()
}

const thumbOf = (t) => t.photos?.[0]?.thumb_path || t.visit?.cover?.thumb_path || null
</script>

<template>
  <div>
    <TopBar :title="o?.name || ''" back />
    <div v-if="loading" class="loading">{{ loadingLine() }}</div>
    <main v-else-if="!o" class="page empty"><span class="big-emoji">🦪</span>No such oyster. Was it a dream?</main>

    <main v-else class="page stack">
      <section>
        <h1 class="name">{{ o.name }}</h1>
        <p class="muted facts">
          {{ [o.grower, o.growing_area, o.region, speciesLabel(o.species), o.cultivation].filter(Boolean).join(' · ') }}
        </p>
        <p v-if="lookingUp(o)" class="muted small looking">Looking it up…</p>
        <a :href="oysterater.href" target="_blank" rel="noopener" class="small">{{ oysterater.label }}</a>
        <p v-if="latest" class="latest">
          Your latest:
          <strong :style="{ color: myColor }">{{ latest.overall }}</strong>
          <span class="muted"> · {{ formatDate(latest.visited_on) }}</span>
        </p>
      </section>

      <section v-if="o.needs_review" class="card review stack">
        <p class="small">
          Looked up automatically<template v-if="sourceHost">
            from <a :href="o.details_url" target="_blank" rel="noopener">{{ sourceHost }}</a></template
          >. Look right?
        </p>
        <div class="row">
          <button class="btn primary" @click="confirmDetails">Looks right</button>
          <button class="btn ghost" @click="clearDetails">Not this oyster</button>
        </div>
      </section>
      <section v-else-if="o.lookup_status === 'not_found' || o.lookup_status === 'failed'" class="card review row">
        <p class="small grow">
          {{ o.lookup_status === 'failed' ? 'The lookup hit a snag.' : "Couldn't find this one online." }}
        </p>
        <button class="btn" @click="lookAgain">Try again</button>
      </section>

      <ShuckerFact :oyster="o" />

      <section>
        <template v-if="o.lat != null">
          <MiniMap :lat="o.lat" :lng="o.lng" :zoom="8" height="180px" />
          <div class="row small pinrow">
            <span v-if="o.location_approx" class="muted">Approximate spot</span>
            <div class="spacer" />
            <RouterLink :to="`/oyster/${o.id}/pin`" class="btn">Move pin</RouterLink>
          </div>
        </template>
        <RouterLink v-else :to="`/oyster/${o.id}/pin`" class="needs card">
          <span class="badge-pin">Needs a pin</span>
          <span>Where does it grow? Tap to drop a pin.</span>
        </RouterLink>
      </section>

      <section v-if="bundle.stats.length" class="card">
        <h3>Family averages</h3>
        <PairedBars :rows="rows" :legend="legend" />
        <p class="small muted">
          <span v-for="p in raters" :key="p.id">
            {{ shortName(p) }} would order again:
            {{ statFor(p.id)?.would_order_again_pct != null ? `${statFor(p.id).would_order_again_pct}%` : '–' }}.
          </span>
        </p>
      </section>

      <section>
        <h3>Every time we've had it</h3>
        <p v-if="!bundle.tastings.length" class="muted">Never! Fix that.</p>
        <div v-for="t in bundle.tastings" :key="t.id" class="hist card">
          <RouterLink :to="`/visit/${t.visit.id}`" class="hlink">
            <div class="th"><PhotoImg :path="thumbOf(t)" /></div>
            <div class="hmeta">
              <strong>{{ t.visit.place?.name || 'Home' }}</strong>
              <div class="small muted">{{ formatDate(t.visit.visited_on) }}</div>
            </div>
          </RouterLink>
          <div class="overalls">
            <RouterLink v-if="!iRatedRow(t)" :to="rateTo(t)" class="btn rate-btn">Rate</RouterLink>
            <span
              v-for="p in ratersOfRow(t)"
              :key="p.id"
              class="ov"
              :style="{ background: p.color }"
              :title="`${p.display_name}: ${overallOf(t, p.id)}`"
            >
              {{ overallOf(t, p.id) }}
            </span>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.name { font-size: 2.4rem; margin: 0; }
.facts { margin: 4px 0; }
.pinrow { margin-top: 8px; }
.needs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  text-decoration: none;
  border: 3px dashed var(--lemon);
}
.latest { margin: 10px 0 0; font-size: 1.05rem; }
.review { border: 3px dashed var(--lemon); }
.review p { margin: 0; }
.grow { flex: 1; }
.looking { margin: 2px 0; font-style: italic; }
.hist {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  margin-bottom: 10px;
}
.hlink {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  text-decoration: none;
}
.rate-btn { min-height: 34px; padding: 0 14px; font-size: 0.85rem; }
.th { width: 64px; height: 64px; border-radius: 12px; overflow: hidden; flex: none; }
.hmeta { flex: 1; min-width: 0; }
.overalls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 4px; max-width: 45%; }
.ov {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: #fff;
  font-weight: 800;
}
</style>
