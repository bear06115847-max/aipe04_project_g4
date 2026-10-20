<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { uploadDrugDraft, type DrugDraft } from '../api/drugs'
import { ApiError } from '../api/client'
import { useMedicineFlowStore } from '../stores/medicineFlow'

interface SelectedImage {
  id: number
  file: File
  previewUrl: string
  isLoaded: boolean
}

const MAX_IMAGES = 3
const MAX_FILE_BYTES = 3_000_000
const selectedImages = ref<SelectedImage[]>([])
const errorMessages = ref<string[]>([])
const router = useRouter()
const flow = useMedicineFlowStore()
const isUploading = ref(false)
const isNavigating = ref(false)
// 保留已收到的回應，保存失敗時只重試本機保存，不重送圖片。
const receivedBatch = shallowRef<{ files: File[]; draft: DrugDraft } | null>(null)
const saveStatus = ref<'pending' | 'saved' | 'duplicate'>('pending')
const isBatchFrozen = computed(() => isUploading.value || receivedBatch.value !== null)
const validImageCount = computed(
  () => selectedImages.value.filter((image) => image.isLoaded).length,
)
let nextImageId = 1
const canUpload = computed(
  () =>
    !isBatchFrozen.value &&
    selectedImages.value.length > 0 &&
    selectedImages.value.length <= MAX_IMAGES &&
    validImageCount.value === selectedImages.value.length,
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

// TypeScript 型別不會驗證 JSON；這裡檢查保存與圖片交接所需的結構。
function isUsableDraft(value: unknown, fileCount: number): value is DrugDraft {
  if (
    !isRecord(value) ||
    typeof value.draft_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.draft_id) ||
    !Array.isArray(value.source_images) ||
    value.source_images.length !== fileCount ||
    !Array.isArray(value.rows) ||
    !isRecord(value.extraction_meta)
  )
    return false
  const meta = value.extraction_meta
  if (
    ![
      meta.ocr_version,
      meta.rule_layer_version,
      meta.synonym_table_version,
      meta.extracted_at,
    ].every(isText) ||
    !Number.isFinite(Date.parse(String(meta.extracted_at)))
  )
    return false
  const imageIds = new Set<string>()
  const reasons = [
    'blur',
    'glare',
    'truncated',
    'skew',
    'low_resolution',
    'unsupported_label',
    'low_light',
  ]
  for (const image of value.source_images) {
    if (
      !isRecord(image) ||
      !isText(image.image_id) ||
      imageIds.has(image.image_id) ||
      !Array.from(
        { length: fileCount },
        (_, i) => `img-${String(i + 1).padStart(2, '0')}`,
      ).includes(image.image_id) ||
      (image.image_kind != null && image.image_kind !== 'drug_package') ||
      !['accepted', 'rejected'].includes(String(image.quality_status))
    )
      return false
    if (
      image.quality_status === 'rejected'
        ? !reasons.includes(String(image.reject_reason))
        : image.reject_reason != null
    )
      return false
    imageIds.add(image.image_id)
  }
  const rowIds = new Set<string>()
  for (const row of value.rows) {
    if (
      !isRecord(row) ||
      !isText(row.row_id) ||
      rowIds.has(row.row_id) ||
      typeof row.raw_name !== 'string' ||
      typeof row.source_image_id !== 'string' ||
      !imageIds.has(row.source_image_id) ||
      !['in_scope', 'out_of_scope', 'unresolved'].includes(String(row.scope_status)) ||
      (row.generic_name_raw != null && typeof row.generic_name_raw !== 'string') ||
      (row.active_ingredient_code != null && !isText(row.active_ingredient_code)) ||
      (row.scope_status === 'in_scope') !== (row.active_ingredient_code != null)
    )
      return false
    if (
      row.extraction_confidence != null &&
      (typeof row.extraction_confidence !== 'number' ||
        !Number.isFinite(row.extraction_confidence) ||
        row.extraction_confidence < 0 ||
        row.extraction_confidence > 1)
    )
      return false
    if (row.bbox != null) {
      if (!isRecord(row.bbox)) return false
      const { x, y, width, height } = row.bbox
      if (
        ![x, y, width, height].every((n) => typeof n === 'number' && Number.isInteger(n)) ||
        Number(x) < 0 ||
        Number(y) < 0 ||
        Number(width) <= 0 ||
        Number(height) <= 0
      )
        return false
    }
    rowIds.add(row.row_id)
  }
  return true
}

function saveReceivedBatch(): void {
  const batch = receivedBatch.value
  if (!batch || saveStatus.value !== 'pending') return
  errorMessages.value = []
  if (flow.drugBatches.some((item) => item.draft.draft_id === batch.draft.draft_id)) {
    saveStatus.value = 'duplicate'
    return
  }
  try {
    flow.addDrugBatch(batch.files, batch.draft)
    const saved = flow.drugBatches.find((item) => item.draft.draft_id === batch.draft.draft_id)
    if (
      !saved ||
      saved.files.length !== batch.files.length ||
      !saved.files.every((file, index) => file === batch.files[index]) ||
      !batch.draft.rows.every((row) =>
        flow.medicines.some((medicine) => medicine.id === `${batch.draft.draft_id}:${row.row_id}`),
      )
    ) {
      throw new Error('Batch not saved completely')
    }
    saveStatus.value = 'saved'
  } catch {
    // 若 action 中途失敗，移除本次新建的資料，保留其他批次與人工列。
    flow.drugBatches = flow.drugBatches.filter(
      (item) => item.draft.draft_id !== batch.draft.draft_id,
    )
    flow.medicines = flow.medicines.filter((medicine) => medicine.draftId !== batch.draft.draft_id)
    errorMessages.value = ['已收到後端回應，但本機批次保存失敗。請重試保存草稿，不需重新上傳圖片。']
  }
}

async function startRecognition(): Promise<void> {
  if (!canUpload.value) return
  isUploading.value = true // 在第一個 await 前設置，阻止快速連點。
  errorMessages.value = []
  const files = selectedImages.value.map((image) => image.file)
  try {
    const draft: unknown = await uploadDrugDraft(files)
    if (!isUsableDraft(draft, files.length)) {
      errorMessages.value = [
        '後端回應缺少必要欄位或圖片來源不一致，無法使用草稿；未加入本機批次。圖片已保留，可手動重試。',
      ]
      return
    }
    receivedBatch.value = { files, draft }
    saveStatus.value = 'pending'
    saveReceivedBatch()
  } catch (error: unknown) {
    const body: unknown = error instanceof ApiError ? error.body : null
    if (isRecord(body) && isRecord(body.error) && isText(body.error.message)) {
      errorMessages.value = [body.error.message]
      if (Array.isArray(body.error.details)) {
        errorMessages.value.push(...body.error.details.filter(isText))
      }
    } else {
      errorMessages.value = [
        '無法完成圖片上傳或讀取回應，請確認後端已啟動與網路連線。圖片已保留，請稍後手動重試。',
      ]
    }
  } finally {
    isUploading.value = false
  }
}

function startNextBatch(): void {
  if (
    isUploading.value ||
    isNavigating.value ||
    !receivedBatch.value ||
    saveStatus.value === 'pending'
  )
    return
  receivedBatch.value = null
  saveStatus.value = 'pending'
  clearImages()
}

async function goToReview(): Promise<void> {
  if (
    isUploading.value ||
    isNavigating.value ||
    !receivedBatch.value ||
    saveStatus.value === 'pending'
  )
    return
  isNavigating.value = true
  try {
    const failure = await router.push('/medicine-review')
    if (failure) errorMessages.value = ['尚未前往校對頁，批次仍保留，請再試一次。']
  } catch {
    errorMessages.value = ['無法前往校對頁，批次仍保留，請再試一次。']
  } finally {
    isNavigating.value = false
  }
}

onBeforeRouteLeave(() => {
  if (isUploading.value || (receivedBatch.value && saveStatus.value === 'pending')) {
    errorMessages.value = ['本批正在處理或等待本機保存，請完成後再離開此頁。']
    return false
  }
})

function releasePreview(image: SelectedImage): void {
  URL.revokeObjectURL(image.previewUrl)
}

function removeImage(id: number): void {
  if (isBatchFrozen.value) return
  discardImage(id)
}

function discardImage(id: number): void {
  const index = selectedImages.value.findIndex((image) => image.id === id)
  const image = selectedImages.value[index]
  if (!image) return
  selectedImages.value.splice(index, 1)
  releasePreview(image)
}

function clearImages(): void {
  if (isBatchFrozen.value) return
  releaseAllPreviews()
  errorMessages.value = []
}

function releaseAllPreviews(): void {
  selectedImages.value.forEach(releasePreview)
  selectedImages.value = []
}

function isSameFile(first: File, second: File): boolean {
  return (
    first.name === second.name &&
    first.size === second.size &&
    first.type === second.type &&
    first.lastModified === second.lastModified
  )
}

function handleFileChange(event: Event): void {
  if (isBatchFrozen.value) return
  const input = event.target
  if (!(input instanceof HTMLInputElement)) return

  const files = Array.from(input.files ?? [])
  // 取消選檔時保留原清單與訊息。
  if (files.length === 0) return

  // File 已保存在陣列中；清空原生欄位，讓重選同一檔案也能觸發 change。
  input.value = ''
  errorMessages.value = []
  const candidates: File[] = []
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      errorMessages.value.push(`${file.name}：檔案未標示為圖片類型，請選擇圖片檔。`)
      continue
    }
    if (file.size > MAX_FILE_BYTES) {
      errorMessages.value.push(`${file.name}：單張圖片不得超過 3,000,000 bytes（3 MB）。`)
      continue
    }
    if (
      selectedImages.value.some((image) => isSameFile(image.file, file)) ||
      candidates.some((candidate) => isSameFile(candidate, file))
    ) {
      errorMessages.value.push(
        `${file.name}：檔名、大小、類型及修改時間相同，已略過疑似重複圖片；未進行內容比對。`,
      )
      continue
    }
    candidates.push(file)
  }

  // 載入中的圖片也占名額；先檢查整次加入，超量時不改動原清單。
  if (selectedImages.value.length + candidates.length > MAX_IMAGES) {
    errorMessages.value.push('每批最多 3 張圖片；本次加入已取消，原有圖片保留。請減少選取數量。')
    return
  }

  for (const file of candidates) {
    try {
      const previewUrl = URL.createObjectURL(file)
      selectedImages.value.push({ id: nextImageId++, file, previewUrl, isLoaded: false })
    } catch {
      errorMessages.value.push(`${file.name}：本機預覽失敗，無法建立圖片預覽，請重新選擇圖片。`)
    }
  }
}

function findCurrentImage(event: Event, id: number): SelectedImage | undefined {
  const image = event.target
  const selected = selectedImages.value.find((item) => item.id === id)
  // 被移除或清空的舊圖片事件不能影響新清單。
  if (!(image instanceof HTMLImageElement) || image.src !== selected?.previewUrl) return
  return selected
}

function handlePreviewLoad(event: Event, id: number): void {
  const selected = findCurrentImage(event, id)
  if (!selected) return
  const image = event.target
  if (
    !(image instanceof HTMLImageElement) ||
    image.naturalWidth === 0 ||
    image.naturalHeight === 0
  ) {
    handlePreviewError(event, id)
    return
  }
  selected.isLoaded = true
}

function handlePreviewError(event: Event, id: number): void {
  const selected = findCurrentImage(event, id)
  if (!selected) return
  errorMessages.value.push(
    `${selected.file.name}：本機預覽失敗，瀏覽器無法讀取這張圖片，已移除，請選擇其他圖片。`,
  )
  discardImage(id)
}

onUnmounted(releaseAllPreviews)
</script>

<template>
  <main>
    <h1>藥圖片上傳</h1>
    <p id="upload-notice">
      選圖後按「開始辨識」會上傳圖片。目前後端使用 Stub 測試版本，並非真正 OCR。
    </p>

    <ul v-if="errorMessages.length" role="alert">
      <li v-for="(message, index) in errorMessages" :key="index">{{ message }}</li>
    </ul>
    <p>
      <label for="medicine-image">請上傳藥包圖片</label>
      <input
        id="medicine-image"
        type="file"
        accept="image/*"
        multiple
        :disabled="isBatchFrozen"
        aria-describedby="upload-notice upload-limits"
        @change="handleFileChange"
      />
    </p>
    <p id="upload-limits">每批最多 3 張；每張不超過 3,000,000 bytes（3 MB），不進行圖片壓縮。</p>
    <p role="status">
      目前已選擇 {{ selectedImages.length }} / 3 張，已完成載入驗證 {{ validImageCount }} 張。
    </p>
    <p v-if="selectedImages.length === 0">尚未選擇圖片。</p>

    <ul v-else>
      <li v-for="image in selectedImages" :key="image.id">
        <figure>
          <img
            :src="image.previewUrl"
            :alt="`${image.file.name} 的本機藥包圖片預覽`"
            @load="handlePreviewLoad($event, image.id)"
            @error="handlePreviewError($event, image.id)"
          />
          <figcaption>
            {{ image.file.name }}：{{
              image.isLoaded ? '本機預覽已載入' : '圖片載入驗證中，尚未視為有效圖片'
            }}
          </figcaption>
        </figure>
        <button
          type="button"
          :aria-label="`移除 ${image.file.name}`"
          :disabled="isBatchFrozen"
          @click="removeImage(image.id)"
        >
          移除
        </button>
      </li>
    </ul>
    <button
      type="button"
      :disabled="isBatchFrozen || selectedImages.length === 0"
      @click="clearImages"
    >
      清空目前圖片
    </button>

    <p>
      <button type="button" :disabled="!canUpload" @click="startRecognition">開始辨識</button>
    </p>
    <p v-if="isUploading" role="status">圖片上傳與測試辨識處理中</p>
    <p v-else-if="!receivedBatch">請等待所有圖片完成載入驗證後開始辨識。失敗時不會自動重送。</p>

    <section v-if="receivedBatch" aria-labelledby="next-batch-title">
      <p v-if="saveStatus === 'saved'" role="status">
        已收到後端 Stub 測試草稿，內容不是實際圖片辨識結果
      </p>
      <p v-else-if="saveStatus === 'duplicate'" role="status">
        後端回傳的 draft_id 已存在於本機，本次沒有新增批次，也不會重送這批圖片。
      </p>
      <template v-if="saveStatus === 'pending'">
        <h2 id="next-batch-title">本批草稿尚未完成本機保存</h2>
        <button type="button" :disabled="isUploading" @click="saveReceivedBatch">
          重試保存草稿（不上傳圖片）
        </button>
      </template>
      <template v-else>
        <h2 id="next-batch-title">是否還有其他藥包？</h2>
        <p>這個確認區塊會保留到你選擇下一步，不會因按 Esc 而關閉。</p>
        <button type="button" :disabled="isUploading || isNavigating" @click="startNextBatch">
          有
        </button>
        <button type="button" :disabled="isUploading || isNavigating" @click="goToReview">
          沒有
        </button>
        <p>
          已保存 {{ flow.drugBatches.length }} 批。PG-005 尚未接入
          Store，本次前往不會顯示這些草稿的藥品清單。
        </p>
      </template>
    </section>

    <p>
      <button type="button" disabled>前往辨識保健食品（頁面尚未建立）</button>
    </p>
    <p>沒有使用慢性病藥或腸胃藥時，未來可直接前往辨識保健食品；目前該頁尚未建立。</p>
  </main>
</template>
