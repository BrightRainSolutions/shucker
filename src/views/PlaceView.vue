<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { loadPlaces, loadVisitSummaries } from '../lib/data'
import { loadingLine } from '../lib/attributes'
import { relativeDay } from '../lib/dates'
import TopBar from '../components/TopBar.vue'
import MiniMap from '../components/MiniMap.vue'
import PhotoImg from '../components/PhotoImg.vue'

const route = useRoute()
const { peopleFor, shortName } = useAuth()
const raters = (v) => peopleFor(Object.keys(v.avg_overall_by_user || {}))
const place = ref(null)
const visits = ref([])
const loading = ref(true)

onMounted(async () => {
  const [ps, vs] = await Promise.all([loadPlaces(), loadVisitSummaries()])
  place.value = ps.find((p) => p.id === route.params.id) ?? null
  visits.value = vs.filter((v) => v.place_id === route.params.id)
  loading.value = false
})

const fmt = (v) => (v == null ? '–' : Number(v).toFixed(1))
const title = computed(() => place.value?.name || '')
</script>

<template>
  <div>
    <TopBar :title="title" back="/dates?view=map" />
    <div v-if="loading" class="loading">{{ loadingLine() }}</div>
    <main v-else-if="place" class="page stack">
      <p class="muted">{{ [place.city, place.address].filter(Boolean).join(' · ') }}</p>
      <MiniMap v-if="place.lat != null" :lat="place.lat" :lng="place.lng" :zoom="15" height="160px" color="#0b3a5b" />
      <h3>{{ visits.length }} Oyster Date{{ visits.length === 1 ? '' : 's' }} here</h3>
      <RouterLink v-for="v in visits" :key="v.id" :to="`/visit/${v.id}`" class="row card item">
        <div class="th"><PhotoImg :photo-id="v.cover_photo_id" /></div>
        <div class="spacer">
          <strong>{{ relativeDay(v.visited_on) }}</strong>
          <div class="small muted">{{ v.tasting_count }} oysters</div>
        </div>
        <div class="scores">
          <span v-for="p in raters(v)" :key="p.id" class="sc" :style="{ background: p.color }" :title="p.display_name">
            {{ shortName(p) }} {{ fmt(v.avg_overall_by_user[p.id]) }}
          </span>
        </div>
      </RouterLink>
    </main>
    <main v-else class="page empty">No such place.</main>
  </div>
</template>

<style scoped>
.item { padding: 10px; text-decoration: none; }
.th { width: 60px; height: 60px; border-radius: 12px; overflow: hidden; flex: none; }
.scores { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; max-width: 50%; }
.sc { color: #fff; font-weight: 800; border-radius: 999px; padding: 4px 10px; font-size: 0.85rem; }
</style>
