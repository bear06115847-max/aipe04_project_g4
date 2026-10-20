<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { createReport, type Report } from '../api/reports'
import { errorMessage } from '../api/client'
import ReportContent from '../components/ReportContent.vue'
const route = useRoute()
const report = ref<Report | null>(null)
const error = ref('')
const busy = ref(false)
let request = 0
async function load() {
  const current = ++request
  busy.value = true
  error.value = ''
  report.value = null
  try {
    const result = await createReport(String(route.params.caseId))
    if (current === request) report.value = result
  } catch (reason) {
    if (current === request) error.value = errorMessage(reason)
  } finally {
    if (current === request) busy.value = false
  }
}
function printReport() {
  window.print()
}
watch(() => route.fullPath, load, { immediate: true })
</script>
<template>
  <main>
    <p><RouterLink to="/">回主頁</RouterLink></p>
    <p v-if="busy" role="status">正在載入報告…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-if="error" type="button" @click="load">重試</button>
    <ReportContent v-if="report" :report="report" />
    <button v-if="report" type="button" @click="printReport">列印／另存 PDF</button>
    <p v-if="report">在瀏覽器列印視窗選擇「另存為 PDF」。</p>
    <p><button type="button" disabled>報告記錄（尚未開放）</button></p>
  </main>
</template>
