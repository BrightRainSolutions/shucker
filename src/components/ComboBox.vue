<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  items: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'Search…' },
  // (item, lowercased query) => boolean
  filter: { type: Function, required: true },
  itemKey: { type: String, default: 'id' },
  // shown as the last option; receives the current query
  addLabel: { type: Function, default: null },
  limit: { type: Number, default: 30 },
  openOnFocus: { type: Boolean, default: true },
  // (item, lowercased query) => boolean; near misses offered as "Did you mean"
  // only when `filter` finds nothing, so a typo picks the existing item
  fuzzy: { type: Function, default: null },
  // keep the field focused and empty after a pick, for entering several in a row
  stayOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['select', 'add'])

const query = ref('')
const open = ref(false)
const input = ref(null)

const matched = computed(() => {
  const qq = query.value.trim().toLowerCase()
  if (!qq) return { list: props.items, fuzzy: false }
  const list = props.items.filter((it) => props.filter(it, qq))
  if (list.length || !props.fuzzy) return { list, fuzzy: false }
  return { list: props.items.filter((it) => props.fuzzy(it, qq)), fuzzy: true }
})
const results = computed(() => matched.value.list.slice(0, props.limit))

function done() {
  query.value = ''
  open.value = false
  if (props.stayOpen) input.value?.focus()
  else input.value?.blur()
}

function choose(item) {
  emit('select', item)
  done()
}

function add() {
  emit('add', query.value.trim())
  if (props.stayOpen) done()
  else open.value = false
}

function onBlur() {
  // let taps on options land first
  setTimeout(() => (open.value = false), 180)
}

function onEnter() {
  if (results.value.length) choose(results.value[0])
  else if (props.addLabel) add()
}

defineExpose({ clear: () => (query.value = ''), focus: () => input.value?.focus() })
</script>

<template>
  <div class="combo">
    <div class="field-wrap">
      <svg class="mag" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2" />
        <path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
      </svg>
      <input
        ref="input"
        v-model="query"
        class="input"
        type="search"
        autocomplete="off"
        autocorrect="off"
        :placeholder="placeholder"
        @focus="openOnFocus && (open = true)"
        @input="open = true"
        @blur="onBlur"
        @keydown.enter.prevent="onEnter"
        @keydown.esc="open = false"
      />
    </div>
    <ul v-if="open" class="list card" role="listbox">
      <li v-for="item in results" :key="item[itemKey]">
        <button type="button" class="opt" @mousedown.prevent @click="choose(item)">
          <span v-if="matched.fuzzy" class="maybe small">Did you mean</span>
          <slot name="item" :item="item">{{ item.name }}</slot>
        </button>
      </li>
      <li v-if="!results.length && !addLabel" class="none muted small">Nothing matches. The sea is vast, though.</li>
      <li v-if="addLabel && addLabel(query.trim())">
        <button type="button" class="opt add" @mousedown.prevent @click="add">{{ addLabel(query.trim()) }}</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.combo { position: relative; }
.field-wrap { position: relative; }
.mag {
  position: absolute;
  left: 14px;
  top: 50%;
  width: 20px;
  height: 20px;
  transform: translateY(-50%);
  color: var(--muted);
  pointer-events: none;
}
.input { padding-left: 42px; }
.list {
  position: absolute;
  z-index: 30;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  max-height: min(60vh, 420px);
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 6px;
}
.opt {
  display: block;
  width: 100%;
  min-height: 52px;
  text-align: left;
  padding: 10px 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
}
.opt:hover,
.opt:focus-visible { background: var(--surface-2); outline: none; }
.opt.add { color: var(--accent); font-weight: 800; }
.maybe { display: block; color: var(--muted); font-weight: 700; }
.none { padding: 12px; }
</style>
