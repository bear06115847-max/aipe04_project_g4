<script setup lang="ts">
import { ref } from 'vue'

const message = ref('尚未測試')
const loading = ref(false)

async function checkBackend() {
  loading.value = true
  message.value = '連線中...'

  try {
    const response = await fetch('/api/health')

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data: {status: string} = await response.json()
    message.value = `後端回傳:${data.status}`
  } catch (error) {
    message.value = error instanceof Error ? `連線失敗:${error.message}` : '發生未知錯誤'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main>
    <h1>補對了嗎?</h1>
    <h2>FastAPI 連線測試</h2>

    <button type="button" :disabled="loading" @click="checkBackend">{{ loading ? '連線中...' : '測試連線' }}</button>

    <p>{{ message }}</p>
  </main>
</template>

<style scoped></style>
