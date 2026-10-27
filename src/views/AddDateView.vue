<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQueue } from '../composables/useQueue'
import { useAuth } from '../composables/useAuth'
import {
  addPhoto,
  addTasting,
  createOyster,
  createPlace,
  findOrCreateVisit,
  getVisitBundle,
  lastRatingFor,
  loadMyRatings,
  loadOysters,
  loadPlaces,
  removeTasting,
  updateTasting,
} from '../lib/data'
import { distanceKm, getPosition } from '../lib/geo'
import { formatDate, localToday } from '../lib/dates'
import { loadingLine } from '../lib/attributes'
import { lookingUp, pollWhile, sweepLookups } from '../lib/lookups'
import TopBar from '../components/TopBar.vue'
import ComboBox from '../components/ComboBox.vue'
import MiniMap from '../components/MiniMap.vue'
import ToggleSwitch from '../components/ToggleSwitch.vue'
import CameraButton from '../components/CameraButton.vue'
import PhotoImg from '../components/PhotoImg.vue'
import RatingCard from '../components/RatingCard.vue'

const route = useRoute()
const router = useRouter()
const { aliases, resolveId } = useQueue()

const STEPS = ['Where', 'Photo', 'Oysters', 'Rate']
const visitId = computed(() => route.params.visitId || null)
const step = computed(() => (visitId.value ? Math.min(4, Math.max(1, Number(route.query.step) || 2)) : 1))
const goStep = (n) => visitId.value && router.replace({ query: { ...route.query, step: n } })

const bundle = ref(null)
const places = ref([])
const oysters = ref([])
const here = ref(null)
const busy = ref(false)
const loading = ref(true)

async function reload() {
  if (!visitId.value) return
  bundle.value = await getVisitBundle(visitId.value)
}

// My ratings from other nights, for the "Your last" hint on each rating card.
const { user } = useAuth()
const myRatings = ref([])
const lastFor = (t) => lastRatingFor(myRatings.value, t.oyster_id, t.id)

onMounted(async () => {
  const [p, o, mine] = await Promise.all([loadPlaces(), loadOysters(), loadMyRatings(user.value?.id), reload()])
  places.value = p
  oysters.value = o
  myRatings.value = mine
  loading.value = false
  watchLookups.kick()
  // Arriving from an oyster's history (?t=<tasting id>): jump to that card.
  if (route.query.t) {
    await nextTick()
    document.getElementById(`tasting-${route.query.t}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  here.value = await getPosition()
  if (here.value && !newPlace.lat) Object.assign(newPlace, { lat: here.value.lat, lng: here.value.lng })
})

watch(visitId, reload)

// If the server handed back a different id (the other phone got there first), follow it.
watch(
  () => visitId.value && aliases[visitId.value],
  (to) => {
    if (to) router.replace({ params: { visitId: resolveId(visitId.value) }, query: route.query })
  },
)

// ---------------------------------------------------------------- Step 1
const isHome = ref(false)
const placeChoice = ref(null)
const visitedOn = ref(localToday())
const addingPlace = ref(false)
const newPlace = reactive({ name: '', city: '', lat: null, lng: null })

const sortedPlaces = computed(() => {
  const list = [...places.value]
  if (here.value) {
    for (const p of list) p._km = distanceKm(here.value, p)
    return list.sort((a, b) => a._km - b._km)
  }
  return list.sort((a, b) => (b.last_visited || '').localeCompare(a.last_visited || '') || a.name.localeCompare(b.name))
})

const placeFilter = (p, qq) => `${p.name} ${p.city || ''}`.toLowerCase().includes(qq)
const fmtKm = (km) => (km == null || !isFinite(km) ? '' : km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`)

function startAddPlace(name) {
  addingPlace.value = true
  placeChoice.value = null
  newPlace.name = name || ''
}

const canContinue1 = computed(() => {
  if (!visitedOn.value) return false
  if (isHome.value) return true
  if (addingPlace.value) return newPlace.name.trim().length > 0
  return !!placeChoice.value
})

async function continue1() {
  busy.value = true
  try {
    let placeId = null
    if (!isHome.value) {
      placeId = addingPlace.value
        ? await createPlace({
            name: newPlace.name.trim(),
            city: newPlace.city.trim() || null,
            lat: newPlace.lat,
            lng: newPlace.lng,
          })
        : placeChoice.value.id
    }
    const id = await findOrCreateVisit({ placeId, visitedOn: visitedOn.value })
    router.replace({ name: 'add', params: { visitId: id }, query: { step: 2 } })
  } finally {
    busy.value = false
  }
}

watch(isHome, (h) => {
  if (h) {
    placeChoice.value = null
    addingPlace.value = false
  }
})

// ---------------------------------------------------------------- Step 2
async function onCover(file) {
  await addPhoto(file, { visitId: visitId.value, setCover: true })
  await reload()
}

// ---------------------------------------------------------------- Step 3
const oysterFilter = (o, qq) => `${o.name} ${o.grower || ''} ${o.growing_area || ''} ${o.region || ''}`.toLowerCase().includes(qq)
const chosenIds = computed(() => new Set((bundle.value?.tastings || []).map((t) => t.oyster_id)))
const pickable = computed(() => oysters.value.filter((o) => !chosenIds.value.has(o.id)))

// "Kushi" -> Kusshi: one or two letters off, depending on length.
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}
const nearMiss = (o, qq) => qq.length >= 4 && editDistance(o.name.toLowerCase(), qq) <= (qq.length <= 6 ? 1 : 2)

async function pickOyster(o) {
  await addTasting(visitId.value, o.id)
  await reload()
}

// Name only: everything else is looked up in the background (lib/lookups).
async function quickAddOyster(name) {
  if (!name) return
  const id = await createOyster({ name })
  await addTasting(visitId.value, id)
  oysters.value = await loadOysters()
  await reload()
  sweepLookups()
  watchLookups.kick()
}

// Show details as they arrive.
const watchLookups = pollWhile(() => (bundle.value?.tastings || []).some((t) => lookingUp(t.oyster) || t.oyster?._local), reload)
onBeforeUnmount(() => watchLookups.stop())

async function setPrice(t, v) {
  const price = v === '' || v == null ? null : Number(v)
  t.price_each = price
  await updateTasting(t.id, { price_each: price })
}

async function dropTasting(t) {
  if (t.ratings?.length && !confirm(`Remove ${t.oyster?.name}? Ratings for it go too.`)) return
  await removeTasting(t.id)
  await reload()
}

// ---------------------------------------------------------------- Step 4
const closeupsFor = (tid) => (bundle.value?.photos || []).filter((p) => p.tasting_id === tid)

const title = computed(() => {
  const v = bundle.value?.visit
  if (!v) return 'New Oyster Date'
  return v.place?.name || 'Home'
})
const subtitle = computed(() => (bundle.value?.visit ? formatDate(bundle.value.visit.visited_on) : ''))

function next() {
  if (step.value < 4) goStep(step.value + 1)
  else router.push({ name: 'visit', params: { id: visitId.value } })
}
</script>

<template>
  <div>
    <TopBar :title="title" back="/" />
    <main class="page">
      <p v-if="subtitle" class="muted sub">{{ subtitle }}</p>

      <nav class="stepper" aria-label="Steps">
        <button
          v-for="(s, i) in STEPS"
          :key="s"
          type="button"
          class="dot"
          :class="{ on: step === i + 1, done: step > i + 1 }"
          :disabled="!visitId || i === 0"
          @click="goStep(i + 1)"
        >
          <span class="n">{{ i + 1 }}</span>
          <span class="t">{{ s }}</span>
        </button>
      </nav>

      <div v-if="loading" class="loading">{{ loadingLine() }}</div>

      <!-- 1. Where and when -->
      <section v-else-if="step === 1" class="stack">
        <h2>Where are we?</h2>
        <ToggleSwitch v-model="isHome" label="Home night" />

        <template v-if="!isHome">
          <div v-if="placeChoice" class="picked card row">
            <div>
              <strong>{{ placeChoice.name }}</strong>
              <div class="small muted">{{ placeChoice.city }}</div>
            </div>
            <div class="spacer" />
            <button class="btn" @click="placeChoice = null">Change</button>
          </div>
          <ComboBox
            v-else-if="!addingPlace"
            :items="sortedPlaces"
            :filter="placeFilter"
            placeholder="Find the oyster bar"
            :add-label="(qq) => (qq ? `+ Add “${qq}”` : '+ Add place')"
            @select="placeChoice = $event"
            @add="startAddPlace"
          >
            <template #item="{ item }">
              <div class="row">
                <div>
                  <strong>{{ item.name }}</strong>
                  <div class="small muted">{{ item.city }}</div>
                </div>
                <div class="spacer" />
                <span class="small muted">{{ here ? fmtKm(item._km) : item.last_visited ? formatDate(item.last_visited) : '' }}</span>
              </div>
            </template>
          </ComboBox>

          <div v-if="addingPlace" class="card stack">
            <h3>New place</h3>
            <label class="field"><span>Name</span><input v-model="newPlace.name" class="input" /></label>
            <label class="field"><span>City</span><input v-model="newPlace.city" class="input" placeholder="Seattle, WA" /></label>
            <div class="field">
              <span>Pin (tap or drag to adjust)</span>
              <MiniMap
                :lat="newPlace.lat"
                :lng="newPlace.lng"
                editable
                :zoom="16"
                height="220px"
                @update="Object.assign(newPlace, $event)"
              />
            </div>
            <button class="btn ghost" @click="addingPlace = false">Never mind</button>
          </div>
        </template>

        <label class="field">
          <span>When</span>
          <input v-model="visitedOn" type="date" class="input" :max="localToday()" />
        </label>

        <button class="btn primary big block" :disabled="!canContinue1 || busy" @click="continue1">
          {{ busy ? 'Setting the table…' : 'Continue' }}
        </button>
      </section>

      <!-- 2. The Photo -->
      <section v-else-if="step === 2" class="stack">
        <h2>The Photo</h2>
        <p class="muted">The presentation shot. Before anyone touches anything.</p>
        <div v-if="bundle?.visit?.cover_photo_id" class="cover">
          <PhotoImg
            :photo-id="bundle.visit.cover_photo_id"
            :path="bundle.photos.find((p) => p.id === bundle.visit.cover_photo_id)?.storage_path"
            kind="full"
          />
        </div>
        <CameraButton
          :label="bundle?.visit?.cover_photo_id ? 'Replace' : 'Add The Photo'"
          :small="!!bundle?.visit?.cover_photo_id"
          :save="onCover"
        />
      </section>

      <!-- 3. What we ate -->
      <section v-else-if="step === 3" class="stack">
        <h2>What are we eating?</h2>
        <p class="small muted hint">Type each name off the menu. We'll look up the rest.</p>
        <ComboBox
          :items="pickable"
          :filter="oysterFilter"
          :fuzzy="nearMiss"
          stay-open
          placeholder="Kusshi, Hama Hama, Hood Canal…"
          :open-on-focus="true"
          :add-label="(qq) => (qq ? `+ Add “${qq}”` : null)"
          @select="pickOyster"
          @add="quickAddOyster"
        >
          <template #item="{ item }">
            <div>
              <strong>{{ item.name }}</strong>
              <span v-if="item.lat == null" class="badge-pin" style="margin-left: 6px">needs a pin</span>
              <div class="small muted">{{ [item.grower, item.growing_area].filter(Boolean).join(' · ') }}</div>
            </div>
          </template>
        </ComboBox>

        <ul class="chips">
          <li v-for="t in bundle?.tastings || []" :key="t.id" class="tchip">
            <div class="tname">
              <strong>{{ t.oyster?.name }}</strong>
              <span v-if="lookingUp(t.oyster) || t.oyster?._local" class="small muted looking">looking it up…</span>
              <span v-else class="small muted">{{ [t.oyster?.growing_area, t.oyster?.region].filter(Boolean).join(', ') }}</span>
            </div>
            <label class="price">
              <span>$</span>
              <input
                :value="t.price_each == null ? '' : Number(t.price_each).toFixed(2)"
                type="number"
                inputmode="decimal"
                step="0.25"
                min="0"
                placeholder="ea"
                aria-label="Price each"
                @change="setPrice(t, $event.target.value)"
              />
            </label>
            <button class="x" :aria-label="`Remove ${t.oyster?.name}`" @click="dropTasting(t)">×</button>
          </li>
        </ul>
        <p v-if="!bundle?.tastings?.length" class="empty small">No oysters yet. Tragic.</p>
      </section>

      <!-- 4. Rate -->
      <section v-else-if="step === 4">
        <h2>Rate 'em</h2>
        <p v-if="!bundle?.tastings?.length" class="empty">
          Nothing to rate yet.
          <button class="btn" @click="goStep(3)">Add oysters</button>
        </p>
        <RatingCard
          v-for="t in bundle?.tastings || []"
          :id="`tasting-${t.id}`"
          :key="t.id"
          :tasting="t"
          :visit-id="visitId"
          :photos="closeupsFor(t.id)"
          :last="lastFor(t)"
          @changed="reload"
        />
      </section>

      <div v-if="visitId && !loading" class="nav">
        <button v-if="step > 2" class="btn ghost big" @click="goStep(step - 1)">Back</button>
        <div class="spacer" />
        <button class="btn sea big" @click="next">
          {{ step === 2 && !bundle?.visit?.cover_photo_id ? 'Skip' : step === 4 ? 'Done' : 'Next' }}
        </button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.sub { margin: -6px 0 10px; }
.stepper {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-bottom: 20px;
}
.dot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border: 0;
  background: none;
  padding: 4px 0;
  cursor: pointer;
  color: var(--muted);
}
.dot:disabled { cursor: default; }
.dot .n {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--surface-2);
  font-weight: 800;
}
.dot .t { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.dot.on { color: var(--text); }
.dot.on .n { background: var(--coral); color: #fff; transform: scale(1.1); }
.dot.done .n { background: var(--kelp); color: #fff; }

.picked { padding: 12px 16px; }
.cover {
  aspect-ratio: 4 / 5;
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow);
}
.chips { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.tchip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px 10px 16px;
  border-radius: 999px;
  background: var(--surface);
  box-shadow: var(--shadow);
  animation: pop 0.25s cubic-bezier(0.3, 1.5, 0.6, 1);
}
@keyframes pop { from { transform: scale(0.9); opacity: 0; } }
.tname { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
.hint { margin: -6px 0 0; }
.looking { font-style: italic; animation: breathe 1.6s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: 0.45; } }
.price {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--surface-2);
  border-radius: 999px;
  padding: 0 14px;
  height: 44px;
  font-size: 17px;
  font-weight: 600;
  cursor: text;
}
.price input {
  width: 64px;
  border: 0;
  background: transparent;
  outline: none;
  font: inherit;
  -moz-appearance: textfield;
  appearance: textfield;
}
/* No spinner arrows: they ate half the field. */
.price input::-webkit-outer-spin-button,
.price input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.x {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: var(--surface-2);
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
}
.nav {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 10px;
  margin-top: 24px;
  padding: 12px 0 calc(8px + var(--safe-bottom));
  background: linear-gradient(transparent, var(--bg) 30%);
}
</style>
