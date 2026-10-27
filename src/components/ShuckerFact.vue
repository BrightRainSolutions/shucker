<script setup>
defineProps({ oyster: { type: Object, default: null } })
</script>

<template>
  <p v-if="oyster?.fact" class="fact">
    <span class="kicker">Shucker fact</span>
    {{ oyster.fact }}
    <a v-if="oyster.fact_url" :href="oyster.fact_url" target="_blank" rel="noopener" class="src">source ↗</a>
  </p>
</template>

<style scoped>
.fact {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--lemon) 22%, var(--surface));
  font-size: 0.92rem;
  line-height: 1.35;
}
.kicker {
  display: block;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.src { margin-left: 4px; font-size: 0.8rem; color: var(--muted); white-space: nowrap; }
</style>
