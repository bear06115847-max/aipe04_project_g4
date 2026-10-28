<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

interface ReviewImage {
  id: string
  label: string
  src?: string
}
const props = defineProps<{ images: ReviewImage[]; selectedId?: string }>()
const emit = defineEmits<{ 'update:selectedId': [id: string] }>()
const activeId = ref(props.images[0]?.id ?? '')
const failedIds = ref(new Set<string>())
const dialog = ref<HTMLDialogElement | null>(null)
const viewport = ref<HTMLDivElement | null>(null)
const zoom = ref(1)
const activeImage = computed(() => props.images.find((image) => image.id === activeId.value))
const activeIndex = computed(() => props.images.findIndex((image) => image.id === activeId.value))
const canPreview = computed(() => !!activeImage.value?.src && !failedIds.value.has(activeId.value))

watch(
  () => props.selectedId,
  (id) => {
    if (props.images.some((image) => image.id === id)) activeId.value = id!
  },
)
watch(
  () => props.images,
  (images) => {
    if (!images.some((image) => image.id === activeId.value)) activeId.value = images[0]?.id ?? ''
  },
)
function choose(id: string) {
  activeId.value = id
  emit('update:selectedId', id)
}
function openPreview() {
  if (!canPreview.value) return
  zoom.value = 1
  dialog.value?.showModal()
}
async function changeZoom(delta: number) {
  const previous = zoom.value
  const next = Math.min(6, Math.max(1, previous + delta))
  if (next === previous) return
  const view = viewport.value
  const centerX = view ? view.scrollLeft + view.clientWidth / 2 : 0
  const centerY = view ? view.scrollTop + view.clientHeight / 2 : 0
  zoom.value = next
  await nextTick()
  if (view) {
    view.scrollLeft = (centerX * next) / previous - view.clientWidth / 2
    view.scrollTop = (centerY * next) / previous - view.clientHeight / 2
  }
}
</script>

<template>
  <div class="review-gallery">
    <template v-if="activeImage">
      <div class="gallery-summary">
        <span aria-live="polite">照片 {{ activeIndex + 1 }} / {{ images.length }}</span
        ><span>點擊圖片可放大</span>
      </div>
      <button
        v-if="canPreview"
        type="button"
        class="image-preview-button"
        :aria-label="`放大圖片：${activeImage.label}`"
        @click="openPreview"
      >
        <img
          :key="activeImage.id"
          :src="activeImage.src"
          :alt="activeImage.label"
          @error="failedIds.add(activeImage.id)"
        />
      </button>
      <p v-else class="image-unavailable">無法預覽此來源圖片，請參考原始標示確認資料。</p>
      <p class="gallery-caption">{{ activeImage.label }}</p>
      <div class="gallery-thumbnails" role="group" aria-label="選擇來源圖片">
        <button
          v-for="(image, index) in images"
          :id="image.id"
          :key="image.id"
          type="button"
          class="gallery-thumbnail"
          :aria-label="`選擇圖片 ${index + 1}：${image.label}`"
          :aria-pressed="image.id === activeId"
          @click="choose(image.id)"
        >
          <img
            v-if="image.src && !failedIds.has(image.id)"
            :src="image.src"
            alt=""
            @error="failedIds.add(image.id)"
          /><span>{{ index + 1 }}</span>
        </button>
      </div>
    </template>
    <p v-else>目前沒有可預覽的圖片，請參考原始標示確認資料。</p>
    <Teleport to="body">
      <dialog ref="dialog" class="image-lightbox" aria-label="來源圖片放大檢視">
        <div class="lightbox-heading">
          <h2>來源圖片</h2>
          <button type="button" autofocus @click="dialog?.close()">關閉</button>
        </div>
        <p class="lightbox-caption">{{ activeImage?.label }}</p>
        <div class="lightbox-controls" role="group" aria-label="圖片縮放">
          <button
            type="button"
            aria-label="縮小圖片"
            :aria-disabled="zoom <= 1"
            @click="changeZoom(-0.5)"
          >
            縮小 −
          </button>
          <span aria-live="polite">{{ Math.round(zoom * 100) }}%</span>
          <button
            type="button"
            aria-label="放大圖片"
            :aria-disabled="zoom >= 6"
            @click="changeZoom(0.5)"
          >
            放大 ＋
          </button>
          <button type="button" @click="zoom = 1">適合視窗</button>
        </div>
        <div
          ref="viewport"
          class="lightbox-viewport"
          tabindex="0"
          aria-label="放大圖片區域，可使用方向鍵捲動"
        >
          <div
            class="lightbox-canvas"
            :style="{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }"
          >
            <img v-if="canPreview" :src="activeImage?.src" :alt="activeImage?.label" />
          </div>
        </div>
      </dialog>
    </Teleport>
  </div>
</template>

<style scoped>
.image-lightbox {
  box-sizing: border-box;
  width: min(1100px, calc(100% - 24px));
  max-height: calc(100dvh - 24px);
  padding: 24px;
  color: #142332;
  background: #fff;
  border: 2px solid #142332;
  border-radius: 20px;
  font:
    17px/1.5 'Noto Sans TC',
    'Microsoft JhengHei',
    sans-serif;
}
.image-lightbox * {
  box-sizing: border-box;
}
.image-lightbox::backdrop {
  background: #142332b3;
}
.lightbox-heading {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
}
.lightbox-heading h2 {
  font-size: 26px;
  margin: 0;
}
.image-lightbox button {
  min-height: 44px;
  border: 2px solid #142332;
  border-radius: 10px;
  padding: 8px 16px;
  color: #142332;
  background: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.image-lightbox button:hover {
  background: #f0f5e3;
}
.image-lightbox button[aria-disabled='true'] {
  color: #61717a;
  border-color: #c5cfd3;
  background: #e8eced;
  cursor: not-allowed;
}
.lightbox-heading button {
  background: #d4e887;
}
.image-lightbox :focus-visible {
  outline: 3px solid #597b23;
  outline-offset: 3px;
}
.lightbox-caption {
  margin: 10px 0 16px;
  overflow-wrap: anywhere;
}
.lightbox-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 16px;
}
.lightbox-controls span {
  min-width: 52px;
  text-align: center;
}
.lightbox-viewport {
  height: min(62dvh, 650px);
  overflow: auto;
  background: #f3f4f2;
  border: 1px solid #c5cfd3;
  border-radius: 12px;
}
.lightbox-canvas {
  display: flex;
  align-items: center;
  justify-content: center;
}
.lightbox-canvas img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  max-width: none;
}
@media (max-width: 600px) {
  .image-lightbox {
    padding: 16px;
  }
  .image-lightbox button {
    padding-inline: 12px;
    font-size: 15px;
  }
  .lightbox-controls {
    gap: 8px;
  }
  .lightbox-viewport {
    height: 55dvh;
  }
}
</style>
