<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { loadOysterList } from '../lib/data'
import { formatDate } from '../lib/dates'
import { loadingLine } from '../lib/attributes'
import TopBar from '../components/TopBar.vue'

const { peopleFor, shortName } = useAuth()

const oysters = ref([])
const loading = ref(true)
const query = ref('')

onMounted(async () => {
  oysters.value = await loadOysterList()
  loading.value = false
})

// Phones type straight or curly apostrophes, so "queens", "queen's" and
// "queen’s" should all find Queen’s Cup.
const normalize = (s) => s.toLowerCase().replace(/['’`]/g, '')

const matches = computed(() => {
  const words = normalize(query.value).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return oysters.value
  return oysters.value.filter((o) => {
    const text = normalize([o.name, o.grower, o.growing_area, o.region].filter(Boolean).join(' '))
    return words.every((w) => text.includes(w))
  })
})

// Everyone who has scored it, me first.
const raters = (o) => peopleFor(Object.keys(o.scores))
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
</script>

<template>
  <div>
    <TopBar title="Oysters" back="/" />
    <main class="page">
      <input
        v-model="query"
        class="input search"
        type="search"
        placeholder="Have we had it? Search name, grower, water…"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        aria-label="Search oysters"
      />

      <div v-if="loading" class="loading">{{ loadingLine() }}</div>

      <div v-else-if="!oysters.length" class="empty">
        <span class="big-emoji">🦪</span>
        <p>No oysters yet. Tragic.</p>
      </div>

      <div v-else-if="!matches.length" class="empty">
        <p>
          Nope, never had <strong>{{ query.trim() }}</strong>.
        </p>
        <p class="small muted">Sounds like a reason to order it.</p>
      </div>

      <template v-else>
        <p class="count small muted">
          {{ matches.length }} {{ matches.length === 1 ? 'oyster' : 'oysters' }}{{ query.trim() ? ' found' : ' and counting' }}
        </p>
        <RouterLink v-for="o in matches" :key="o.id" :to="`/oyster/${o.id}`" class="row-card">
          <div class="who">
            <strong class="name">{{ o.name }}</strong>
            <div class="small muted meta">
              {{ [o.growing_area || o.grower, o.lastHad ? `last had ${formatDate(o.lastHad)}` : null].filter(Boolean).join(' · ') }}
            </div>
          </div>
          <div v-if="raters(o).length" class="scores">
            <span
              v-for="p in raters(o)"
              :key="p.id"
              class="score"
              :style="{ background: p.color }"
              :title="`${p.display_name}: ${fmt(o.scores[p.id].avg)} average over ${o.scores[p.id].count}`"
            >
              {{ shortName(p) }} {{ fmt(o.scores[p.id].avg) }} <span class="n">({{ o.scores[p.id].count }})</span>
            </span>
          </div>
          <span v-else class="small muted unrated">Not rated</span>
        </RouterLink>
      </template>
    </main>
  </div>
</template>

<style scoped>
.search { margin-bottom: 12px; }
.count { margin: 0 0 8px; }
.row-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 8px;
  border-radius: var(--radius-sm);
  background: var(--surface);
  box-shadow: var(--shadow);
  text-decoration: none;
}
.who { flex: 1; min-width: 0; }
.name { display: block; font-size: 1.05rem; }
.meta { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scores { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; max-width: 55%; }
.score {
  color: #fff;
  font-weight: 800;
  font-size: 0.85rem;
  border-radius: 999px;
  padding: 3px 10px;
  white-space: nowrap;
}
.n { font-weight: 600; opacity: 0.85; }
.unrated { flex: none; }
</style>
