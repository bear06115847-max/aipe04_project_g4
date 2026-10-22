import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { SupplementDraft } from '../api/supplements'

export const useSupplementFlowStore = defineStore('supplementFlow', () => {
  const products = ref<{ id: string; draft: SupplementDraft; files: File[] }[]>([])
  function addBatch(files: File[], draft: SupplementDraft) {
    if (products.value.some(product => product.id === draft.product_id)) return
    products.value.push({ id: draft.product_id, draft: structuredClone(draft), files: [...files] })
  }
  return { products, addBatch }
})
