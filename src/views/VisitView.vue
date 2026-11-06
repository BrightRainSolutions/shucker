<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useQueue } from '../composables/useQueue'
import { addPhoto, getVisitBundle, lastRatingFor, loadMyRatings, updateVisit } from '../lib/data'
import { ALL_SCORES, loadingLine } from '../lib/attributes'
import { formatDate, relativeDay } from '../lib/dates'
import TopBar from '../components/TopBar.vue'
import PhotoImg from '../components/PhotoImg.vue'
import PairedBars from '../components/PairedBars.vue'
import CameraButton from '../components/CameraButton.vue'
import ShellRating from '../components/ShellRating.vue'

const route = useRoute()
const router = useRouter()
const { user, me, peopleFor, profileFor } = useAuth()
const { aliases, resolveId } = useQueue()

const bundle = ref(null)
const loading = ref(true)
const notes = ref('')
const viewer = ref(null)

// My ratings from other nights, for "Your last" on oysters I haven't rated tonight.
const myRatings = ref([])

async function load() {
  ;[bundle.value, myRatings.value] = await Promise.all([getVisitBundle(route.params.id), loadMyRatings(user.value?.id)])
  notes.value = bundle.value?.visit?.notes || ''
  loading.value = false
}
onMounted(load)
watch(() => route.params.id, load)
watch(
  () => aliases[route.params.id],
  (to) => to && router.replace({ params: { id: resolveId(route.params.id) } }),
)

const visit = computed(() => bundle.value?.visit)
const extraPhotos = computed(() =>
  (bundle.value?.photos || []).filter((p) => !p.tasting_id && p.id !== visit.value?.cover_photo_id),
)

// Everyone who rated this tasting, me first then by name.
const ratersOf = (t) => peopleFor(t.ratings.map((r) => r.user_id))

function rowsFor(t) {
  const raters = ratersOf(t)
  return ALL_SCORES.map((a) => ({
    label: a.label,
    values: raters.map((p) => ({ color: p.color, value: ratingOf(t, p.id)?.[a.key] ?? null })),
  }))
}
const ratingOf = (t, pid) => t.ratings.find((r) => r.user_id === pid)
const iRated = (t) => !!ratingOf(t, user.value?.id)?.overall
const closeups = (t) => (bundle.value?.photos || []).filter((p) => p.tasting_id === t.id)

async function saveNotes() {
  if ((visit.value.notes || '') === notes.value) return
  await updateVisit(visit.value.id, { notes: notes.value || null })
  visit.value.notes = notes.value
}

async function onPhoto(file) {
  await addPhoto(file, { visitId: visit.value.id, setCover: !visit.value.cover_photo_id })
  await load()
}

const editTo = (step) => ({ name: 'add', params: { visitId: visit.value.id }, query: { step } })
const rateTo = (t) => ({ name: 'add', params: { visitId: visit.value.id }, query: { step: 4, t: t.id } })
const myColor = computed(() => me.value?.color || profileFor(user.value?.id).color)
const lastFor = (t) => lastRatingFor(myRatings.value, t.oyster_id, t.id)
const shortDate = (iso) => formatDate(iso, { month: 'short', day: 'numeric' })
</script>

<template>
  <div>
    <div v-if="loading" class="loading">{{ loadingLine() }}</div>
    <div v-else-if="!visit" class="page">
      <TopBar back="/dates" />
      <div class="empty"><span class="big-emoji">🌊</span>Lost at sea. That Oyster Date isn't here.</div>
    </div>

    <template v-else>
      <div class="hero">
        <PhotoImg :photo-id="visit.cover_photo_id" kind="full" :alt="visit.place?.name" />
        <div class="hero-bar"><TopBar back="/dates" /></div>
        <div class="hero-text">
          <div class="when">{{ relativeDay(visit.visited_on) }}</div>
          <h1>{{ visit.place?.name || 'Home' }}</h1>
          <div v-if="visit.place?.city" class="city">{{ visit.place.city }}</div>
        </div>
        <RouterLink v-if="!visit.cover_photo_id" :to="editTo(2)" class="btn primary add-cover">Add The Photo</RouterLink>
      </div>

      <main class="page stack">
        <textarea
          v-model="notes"
          class="input"
          rows="2"
          placeholder="Notes on the night: the company, the mignonette, the view…"
          @blur="saveNotes"
        />

        <div class="row wrap">
          <RouterLink :to="editTo(3)" class="btn sea">+ Oyster</RouterLink>
          <RouterLink :to="editTo(4)" class="btn">Rate</RouterLink>
          <div class="spacer" />
          <CameraButton small label="Photo" :save="onPhoto" />
        </div>

        <p v-if="!bundle.tastings.length" class="empty">No oysters yet. Tragic.</p>

        <article v-for="t in bundle.tastings" :key="t.id" class="card tasting">
          <header class="row">
            <div>
              <RouterLink :to="`/oyster/${t.oyster_id}`" class="oname">{{ t.oyster?.name }}</RouterLink>
              <div class="small muted">
                {{ [t.oyster?.growing_area, t.price_each != null ? `$${Number(t.price_each).toFixed(2)} ea` : null].filter(Boolean).join(' · ') }}
              </div>
            </div>
          </header>

          <div v-if="!iRated(t)" class="unrated row">
            <span class="small">
              <span class="muted">You haven't rated it tonight</span>
              <template v-if="lastFor(t)">
                · Your last: <strong :style="{ color: myColor }">{{ lastFor(t).overall }} · {{ shortDate(lastFor(t).visited_on) }}</strong>
              </template>
            </span>
            <div class="spacer" />
            <RouterLink :to="rateTo(t)" class="btn rate-btn">Rate</RouterLink>
          </div>
          <ul v-if="t.ratings.length" class="people">
            <li v-for="p in ratersOf(t)" :key="p.id" class="person" :style="{ '--c': p.color }">
              <div class="row">
                <span class="pname">{{ p.display_name }}</span>
                <div class="spacer" />
                <ShellRating :model-value="ratingOf(t, p.id)?.overall ?? null" readonly :size="22" :color="p.color" />
              </div>
              <!-- Others' overall is always visible (like the badge); the rest waits until you've rated. -->
              <template v-if="p.id === user?.id || iRated(t)">
                <div class="small">
                  <span v-if="ratingOf(t, p.id)?.would_order_again === true" class="again yes">Would order again</span>
                  <span v-else-if="ratingOf(t, p.id)?.would_order_again === false" class="again no">Once was enough</span>
                </div>
                <p v-if="ratingOf(t, p.id)?.note" class="note">“{{ ratingOf(t, p.id).note }}”</p>
              </template>
            </li>
          </ul>
          <p v-if="t.ratings.length && !iRated(t)" class="small muted">Rate it to see everyone's full scores. No peeking.</p>

          <PairedBars v-if="iRated(t)" :rows="rowsFor(t)" :legend="ratersOf(t)" />

          <div v-if="closeups(t).length" class="closeups">
            <button v-for="p in closeups(t)" :key="p.id" class="cu" @click="viewer = p">
              <PhotoImg :photo-id="p.id" />
            </button>
          </div>
        </article>

        <div v-if="extraPhotos.length" class="closeups more">
          <button v-for="p in extraPhotos" :key="p.id" class="cu" @click="viewer = p">
            <PhotoImg :photo-id="p.id" />
          </button>
        </div>
      </main>

      <div v-if="viewer" class="viewer" @click="viewer = null">
        <PhotoImg :photo-id="viewer.id" kind="full" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.hero {
  position: relative;
  height: min(78vw, 520px);
  max-height: 62dvh;
  background: var(--sea);
  color: #fff;
}
.hero-bar { position: absolute; top: 0; left: 0; right: 0; }
.hero-bar :deep(.topbar) { background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; }
.hero::after {
  content: '';
  position: absolute;
  inset: 40% 0 0;
  background: linear-gradient(transparent, rgba(4, 20, 32, 0.8));
  pointer-events: none;
}
.hero-text { position: absolute; left: 20px; right: 20px; bottom: 18px; z-index: 1; }
.hero-text h1 { margin: 0; font-size: 2.3rem; color: #fff; }
.when { font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: var(--lemon); font-size: 0.85rem; }
.city { opacity: 0.85; }
.add-cover { position: absolute; right: 16px; top: calc(70px + var(--safe-top)); z-index: 1; }

.tasting .oname {
  font-family: var(--display);
  font-weight: 800;
  font-size: 1.35rem;
  text-decoration: none;
}
.unrated {
  margin-top: 10px;
  padding: 8px 8px 8px 12px;
  border: 1.5px dashed var(--line);
  border-radius: var(--radius-sm);
}
.rate-btn { min-height: 36px; padding: 0 16px; font-size: 0.85rem; }
.people { list-style: none; padding: 0; margin: 12px 0 14px; }
.person { border-left: 4px solid var(--c); padding: 4px 0 4px 10px; }
.person + .person { margin-top: 8px; }
.pname { font-weight: 800; color: var(--c); }
.again { font-weight: 700; }
.again.yes { color: var(--kelp); }
.again.no { color: var(--muted); }
.note { margin: 4px 0 0; font-style: italic; font-size: 0.92rem; }
.closeups { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.cu { width: 72px; height: 72px; border: 0; padding: 0; border-radius: 12px; overflow: hidden; cursor: pointer; }
.viewer {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.92);
  display: grid;
  place-items: center;
  padding: var(--safe-top) 0 var(--safe-bottom);
}
.viewer :deep(img) { object-fit: contain; }
</style>
