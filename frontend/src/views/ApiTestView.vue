<script setup lang="ts">
import { ref } from 'vue'

// 聯集型別限制狀態只能是 idle、loading、success、error，避免拼錯或產生不合法狀態。
type ConnectionStatus = 'idle' | 'loading' | 'success' | 'error'

/**
 * status 記錄連線狀態；responseText 保存回應；errorMessage 保存錯誤。
 * 修改這些響應式資料時，Vue 會更新畫面。Script 中透過 .value 存取，template 中會自動解包。
 */
const status = ref<ConnectionStatus>('idle')
const responseText = ref('')
const errorMessage = ref('')

/**
 * 非同步函式使用 await 等待 API。開頭避免重複請求，接著切換成載入狀態並清除上次結果。
 */
async function testConnection(): Promise<void> {
  if (status.value === 'loading') return

  status.value = 'loading'
  responseText.value = ''
  errorMessage.value = ''

  try {
    /**
     * 使用相對路徑，預設方法就是 GET。開發時由 Vite Proxy 轉送至 FastAPI
     */
    const response = await fetch('/api/health', {
      // 幫程式設定一個 10 秒的倒數計時器，時間到了，就要求正在進行的工作停止。
      signal: AbortSignal.timeout(10000),
    })

    /**
     * 先保存回應文字，讓 HTTP 錯誤內容也能顯示。
     * fetch 遇到 404、500 不會自動拋錯，因此另外檢查 response.ok。
     */
    responseText.value = await response.text()

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    const data: unknown = JSON.parse(responseText.value)
    responseText.value = JSON.stringify(data, null, 2) // 將 JSON 排版成容易閱讀的形式。

    /**
     * JSON 是外部資料，不能只靠 TypeScript 保證格式。
     * 程式逐步確認它是非空物件、包含 status，而且值為 "ok"，才判定成功。
     */
    if (typeof data !== 'object' || data === null || !('status' in data) || data.status !== 'ok') {
      throw new Error('API 回應不符合預期，應為 {"status":"ok"}')
    }

    status.value = 'success'
  } catch (error: unknown) {
    /**
     * 網路、逾時、HTTP、JSON 或回應格式錯誤都會進入這裡，切換成失敗狀態。
     * instanceof Error 確認可以安全讀取錯誤訊息。
     */
    status.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : '發生未知錯誤'
  }
}
</script>

<template>
  <main>
    <h1>Vue 與 FastAPI 連線測試</h1>
    <p>測試端點：GET /api/health</p>

    <button type="button" :disabled="status === 'loading'" @click="testConnection">
      {{ status === 'loading' ? '載入中…' : '測試連線' }}
    </button>

    <div role="status" aria-live="polite">
      <p v-if="status === 'idle'">尚未測試</p>
      <p v-else-if="status === 'loading'">載入中，正在連線…</p>
      <p v-else-if="status === 'success'">連線成功</p>
      <p v-else>連線失敗：{{ errorMessage }}</p>
    </div>

    <h2>API 回應結果</h2>
    <pre v-if="responseText">{{ responseText }}</pre>
    <p v-else>尚無回應資料</p>
  </main>
</template>
