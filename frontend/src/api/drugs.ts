import { apiRequest } from './client'

// 對照 app/schemas/drug_label.py、label.py、common.py 與 enums.py。
// UUID 和 datetime 在 JSON 中以字串傳遞，不需要建立特殊物件。
export type ScopeStatus = 'in_scope' | 'out_of_scope' | 'unresolved'

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface SourceImage {
  image_id: string
  quality_status: 'accepted' | 'rejected'
  reject_reason?:
    | 'blur'
    | 'glare'
    | 'truncated'
    | 'skew'
    | 'low_resolution'
    | 'unsupported_label'
    | 'low_light'
    | null
  image_kind?: 'drug_package' | 'supplement_ingredients' | 'supplement_nutrition' | null
}

export interface ExtractionMeta {
  ocr_version: string
  rule_layer_version: string
  synonym_table_version: string
  extracted_at: string
}

export interface DrugDraftRow {
  row_id: string
  raw_name: string
  generic_name_raw?: string | null
  source_image_id: string
  bbox?: BoundingBox | null
  extraction_confidence?: number | null
  active_ingredient_code?: string | null
  scope_status: ScopeStatus
}

export interface DrugDraft {
  draft_id: string
  source_images: SourceImage[]
  rows: DrugDraftRow[]
  extraction_meta: ExtractionMeta
}

// 對照 case.py 的 ConfirmedDrug；來源與劑量各自必須成對。
export type ConfirmedDrug = {
  name: string
} & (
  | { draft_id: string; row_id: string }
  | { draft_id?: null; row_id?: null }
) & (
  | { dose_mg: number; times_per_day: number }
  | { dose_mg?: null; times_per_day?: null }
)

// 只負責呼叫 API；目前後端回的是 Stub 草稿，不代表真實 OCR 成功。
// 呼叫端應在 await 前保留本批 File[] 快照，成功後用同一份快照加入 Store。
export function uploadDrugDraft(files: readonly File[]): Promise<DrugDraft> {
  const body = new FormData()
  for (const file of files) {
    body.append('images', file)
  }
  return apiRequest<DrugDraft>('/api/drug-drafts', { method: 'POST', body })
}
