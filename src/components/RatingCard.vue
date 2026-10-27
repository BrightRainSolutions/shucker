<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useAuth } from '../composables/useAuth'
import { ATTRIBUTES, ALL_SCORES, OVERALL } from '../lib/attributes'
import { formatDate } from '../lib/dates'
import { addPhoto, saveRating } from '../lib/data'
import ShellRating from './ShellRating.vue'
import ScoreSlider from './ScoreSlider.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import CameraButton from './CameraButton.vue'
import PhotoImg from './PhotoImg.vue'
import PairedBars from './PairedBars.vue'
import ShuckerFact from './ShuckerFact.vue'
import { lookingUp } from '../lib/lookups'

const props = defineProps({
  tasting: { type: Object, required: true },
  visitId: { type: String, required: true },
  photos: { type: Array, default: () => [] },
  // My most recent rating of this oyster from another night (see lastRatingFor)
  last: { type: Object, default: null },
})
const emit = defineEmits(['changed'])

const { user, me, profileFor, peopleFor, shortName } = useAuth()

const FIELDS = [...ALL_SCORES.map((a) => a.key), 'would_order_again', 'note']
const mine = computed(() => props.tasting.ratings?.find((r) => r.user_id === user.value?.id) ?? null)
// Every other family member who has rated this one.
const theirs = computed(() => (props.tasting.ratings || []).filter((r) => r.user_id !== user.value?.id))
const ratingBy = (uid) => props.tasting.ratings?.find((r) => r.user_id === uid)
const otherRaters = computed(() => peopleFor(theirs.value.map((r) => r.user_id)))
const myColor = computed(() => me.value?.color || profileFor(user.value?.id).color)

const form = reactive(Object.fromEntries(FIELDS.map((k) => [k, mine.value?.[k] ?? null])))
const savedOnce = ref(!!mine.value)
const saving = ref(false)

let timer = null
let dirty = false
watch(
  form,
  () => {
    dirty = true
    clearTimeout(timer)
    timer = setTimeout(save, 600)
  },
  { deep: true },
)

async function save() {
  if (!dirty) return
  dirty = false
  saving.value = true
  await saveRating(props.tasting.id, user.value.id, { ...form })
  savedOnce.value = true
  saving.value = false
}

onBeforeUnmount(() => {
  clearTimeout(timer)
  save()
})

const iHaveRated = computed(() => savedOnce.value && form.overall != null)

// "Your last" hint + one-tap copy, only while tonight's card is still blank.
// Never applied automatically: an untouched card saves nothing.
const SCORE_KEYS = [...ALL_SCORES.map((a) => a.key), 'would_order_again']
const blank = computed(() => !mine.value && SCORE_KEYS.every((k) => form[k] == null))
const lastLabel = computed(() =>
  props.last ? `${props.last.overall} · ${formatDate(props.last.visited_on, { month: 'short', day: 'numeric' })}` : '',
)
function startFromLast() {
  for (const k of SCORE_KEYS) form[k] = props.last[k] ?? null
}

// One bar per person who rated, me first.
const compareLegend = computed(() => [{ ...profileFor(user.value?.id), color: myColor.value }, ...otherRaters.value])
const compareRows = computed(() =>
  ALL_SCORES.map((a) => ({
    label: a.label,
    values: [
      { value: form[a.key], color: myColor.value },
      ...otherRaters.value.map((p) => ({ value: ratingBy(p.id)?.[a.key] ?? null, color: p.color })),
    ],
  })),
)
const showCompare = ref(false)

async function onPhoto(file) {
  await addPhoto(file, { visitId: props.visitId, tastingId: props.tasting.id })
  emit('changed')
}
</script>

<template>
  <article class="card rcard">
    <header class="head">
      <div>
        <h3>{{ tasting.oyster?.name || 'Mystery oyster' }}</h3>
        <p v-if="lookingUp(tasting.oyster) || tasting.oyster?._local" class="muted small sub">looking it up…</p>
        <p v-else class="muted small sub">
          {{ [tasting.oyster?.grower, tasting.oyster?.growing_area].filter(Boolean).join(' · ') }}
        </p>
      </div>
      <div v-if="otherRaters.length" class="badges">
        <template v-for="p in otherRaters" :key="p.id">
          <span
            v-if="ratingBy(p.id)?.overall"
            class="their-badge"
            :style="{ background: p.color }"
            :title="`${p.display_name} gave it ${ratingBy(p.id).overall}`"
          >
            {{ shortName(p) }} · {{ ratingBy(p.id).overall }}
          </span>
        </template>
      </div>
    </header>

    <ShuckerFact :oyster="tasting.oyster" class="rfact" />

    <div v-if="last && blank" class="last row">
      <span class="small">Your last: <strong :style="{ color: myColor }">{{ lastLabel }}</strong></span>
      <div class="spacer" />
      <button type="button" class="btn small-btn" @click="startFromLast">Start from it</button>
    </div>

    <div class="overall">
      <ShellRating v-model="form.overall" :size="54" :color="myColor" />
      <div class="ends small muted">
        <span>{{ OVERALL.low }}</span><span>{{ OVERALL.high }}</span>
      </div>
    </div>

    <div class="row again">
      <ToggleSwitch
        :model-value="!!form.would_order_again"
        label="Would order again"
        @update:model-value="form.would_order_again = $event"
      />
      <div class="spacer" />
      <span v-if="saving" class="small muted">saving…</span>
      <span v-else-if="savedOnce" class="small saved">saved</span>
    </div>

    <div class="scores">
      <ScoreSlider
        v-for="a in ATTRIBUTES"
        :key="a.key"
        v-model="form[a.key]"
        :label="a.label"
        :low="a.low"
        :high="a.high"
        :color="myColor"
      />
    </div>

    <textarea v-model.lazy="form.note" class="input note" rows="2" placeholder="Tasting notes, hot takes, regrets…" />

    <div class="row wrap foot">
      <CameraButton small label="Close-up" :save="onPhoto" />
      <div class="thumbs">
        <div v-for="p in photos" :key="p.id" class="thumb">
          <PhotoImg :photo-id="p.id" :path="p.thumb_path" />
        </div>
      </div>
    </div>

    <template v-if="theirs.length && iHaveRated">
      <button type="button" class="more" @click="showCompare = !showCompare">
        {{ showCompare ? 'Hide' : 'See' }} how you compare
      </button>
      <PairedBars v-if="showCompare" :rows="compareRows" :legend="compareLegend" />
    </template>
    <p v-else-if="theirs.length" class="small muted">
      Rate it to see {{ theirs.length === 1 ? `${shortName(otherRaters[0])}'s` : "everyone's" }} full scores. No peeking.
    </p>
  </article>
</template>

<style scoped>
.rfact { margin-bottom: 12px; }
.rcard + .rcard { margin-top: 16px; }
.rcard { scroll-margin-top: calc(72px + var(--safe-top)); }
.head { display: flex; align-items: flex-start; gap: 10px; justify-content: space-between; }
.head h3 { margin: 0; font-size: 1.35rem; }
.sub { margin: 2px 0 0; }
.badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; max-width: 55%; }
.their-badge {
  flex: none;
  color: #fff;
  font-weight: 800;
  font-size: 0.85rem;
  padding: 4px 10px;
  border-radius: 999px;
}
.overall { margin: 14px 0 6px; }
.last {
  margin-top: 12px;
  padding: 8px 8px 8px 12px;
  border: 1.5px dashed var(--line);
  border-radius: var(--radius-sm);
}
.small-btn { min-height: 36px; padding: 0 14px; font-size: 0.85rem; }
.ends { display: flex; justify-content: space-between; max-width: 290px; padding: 0 4px; }
.again { margin: 10px 0 4px; }
.saved { color: var(--kelp); font-weight: 700; }
.more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  border: 0;
  background: none;
  color: var(--sea-3);
  font-weight: 800;
  padding: 0;
  cursor: pointer;
}
.scores { padding: 4px 0 8px; }
.note { margin-top: 8px; }
.foot { margin-top: 12px; }
.thumbs { display: flex; gap: 6px; flex-wrap: wrap; }
.thumb { width: 44px; height: 44px; border-radius: 10px; overflow: hidden; }
</style>
