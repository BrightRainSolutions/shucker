<script setup>
// Shows a photo from this device if we have it (instant, offline), otherwise
// from the database. Without signal, a full photo falls back to its thumbnail.
import { ref, watch } from 'vue'
import { localPhotoUrl, photoUrl } from '../lib/photos'

const props = defineProps({
  photoId: { type: String, default: null },
  kind: { type: String, default: 'thumb' }, // 'thumb' | 'full'
  alt: { type: String, default: '' },
})

const src = ref(null)
const failed = ref(false)

watch(
  () => [props.photoId, props.kind],
  async () => {
    failed.value = false
    let url = null
    if (props.photoId) url = await photoUrl(props.photoId, props.kind).catch(() => null)
    if (!url && props.photoId && props.kind === 'full') url = await localPhotoUrl(props.photoId, 'thumb')
    src.value = url
  },
  { immediate: true },
)
</script>

<template>
  <img v-if="src && !failed" :src="src" :alt="alt" loading="lazy" decoding="async" @error="failed = true" />
  <div v-else class="ph-fallback" aria-hidden="true">
    <slot>
      <svg viewBox="0 0 64 64" width="40%" height="40%">
        <path
          d="M8 34c4-14 16-22 28-20 12 2 20 12 20 20-2 10-14 16-26 16S10 44 8 34z"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
        />
        <path d="M18 32c6-6 16-8 26-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      </svg>
    </slot>
  </div>
</template>

<style scoped>
img,
.ph-fallback {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ph-fallback {
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--sea-2), var(--sea));
  color: color-mix(in srgb, var(--cream) 55%, transparent);
}
</style>
