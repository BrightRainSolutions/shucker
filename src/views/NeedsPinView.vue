<script setup>
import { computed, onMounted, ref } from 'vue'
import { loadOysters } from '../lib/data'
import { loadingLine } from '../lib/attributes'
import { lookingUp } from '../lib/lookups'
import TopBar from '../components/TopBar.vue'

const oysters = ref([])
const loading = ref(true)
onMounted(async () => {
  oysters.value = await loadOysters()
  loading.value = false
})

// Looked up automatically and nobody has confirmed it yet.
const toConfirm = computed(() => oysters.value.filter((o) => o.needs_review))
const notFound = computed(() =>
  oysters.value.filter((o) => !o.needs_review && (o.lookup_status === 'not_found' || o.lookup_status === 'failed')),
)
const unpinned = computed(() =>
  oysters.value.filter((o) => o.lat == null && !lookingUp(o) && !o.needs_review && !notFound.value.includes(o)),
)
const nothing = computed(() => !toConfirm.value.length && !notFound.value.length && !unpinned.value.length)
const where = (o) => [o.growing_area, o.region].filter(Boolean).join(', ')
</script>

<template>
  <div>
    <TopBar title="To check" back="/dates" />
    <div v-if="loading" class="loading">{{ loadingLine() }}</div>
    <main v-else class="page">
      <p class="muted">Couch-time homework.</p>
      <div v-if="nothing" class="empty"><span class="big-emoji">✅</span>Nothing to check. Gold star.</div>

      <template v-if="toConfirm.length">
        <h3>Look right?</h3>
        <RouterLink v-for="o in toConfirm" :key="o.id" :to="`/oyster/${o.id}`" class="item card">
          <div>
            <strong>{{ o.name }}</strong>
            <div class="small muted">{{ where(o) || 'Looked up automatically' }}</div>
          </div>
          <span class="badge-pin">Check</span>
        </RouterLink>
      </template>

      <template v-if="notFound.length">
        <h3>Couldn't find these</h3>
        <RouterLink v-for="o in notFound" :key="o.id" :to="`/oyster/${o.id}`" class="item card">
          <div>
            <strong>{{ o.name }}</strong>
            <div class="small muted">{{ o.lookup_status === 'failed' ? 'The lookup hit a snag' : 'Nothing online' }}</div>
          </div>
          <span class="badge-pin">Open</span>
        </RouterLink>
      </template>

      <template v-if="unpinned.length">
        <h3>Needs a pin</h3>
        <RouterLink v-for="o in unpinned" :key="o.id" :to="`/oyster/${o.id}/pin`" class="item card">
          <div>
            <strong>{{ o.name }}</strong>
            <div class="small muted">{{ [o.grower, o.growing_area].filter(Boolean).join(' · ') || 'Mysterious origins' }}</div>
          </div>
          <span class="badge-pin">Pin it</span>
        </RouterLink>
      </template>
    </main>
  </div>
</template>

<style scoped>
h3 { margin: 18px 0 8px; }
.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 64px;
  margin-bottom: 10px;
  text-decoration: none;
}
</style>
