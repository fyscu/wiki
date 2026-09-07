<script setup lang="ts">
import { ref, watch } from 'vue'
import { RotateCcw, RefreshCw, X } from '@lucide/vue'
import { articlePath, editorApi, errorMessage } from './api'
import { dateLabel, type HistoricalArticle, type HistoryEntry } from './types'

const props = defineProps<{ articleId: string; disabled: boolean }>()
const emit = defineEmits<{ restore: [revision: string]; close: [] }>()
const entries = ref<HistoryEntry[]>([]), selected = ref<HistoricalArticle | null>(null)
const loading = ref(false), reading = ref(''), error = ref('')
let sequence = 0, versionSequence = 0
async function load() {
  const request = ++sequence
  ++versionSequence; loading.value = true; selected.value = null; error.value = ''; reading.value = ''
  try { const data = await editorApi<HistoryEntry[]>(articlePath(props.articleId) + '/history'); if (request === sequence) entries.value = data }
  catch (cause) { if (request === sequence) error.value = errorMessage(cause) }
  finally { if (request === sequence) loading.value = false }
}
async function read(revision: string) {
  const request = ++versionSequence
  reading.value = revision; error.value = ''; selected.value = null
  try { const data = await editorApi<HistoricalArticle>(articlePath(props.articleId) + `/versions/${encodeURIComponent(revision)}`); if (request === versionSequence) selected.value = data }
  catch (cause) { if (request === versionSequence) error.value = errorMessage(cause) }
  finally { if (request === versionSequence) reading.value = '' }
}
watch(() => props.articleId, load, { immediate: true })
</script>

<template>
  <section class="we-history" aria-label="文章历史">
    <div class="we-section-head"><h2>历史</h2><div class="we-actions"><button class="we-icon" title="刷新历史" aria-label="刷新历史" :disabled="loading" @click="load"><RefreshCw :size="16" /></button><button class="we-icon" title="关闭历史" aria-label="关闭历史" @click="emit('close')"><X :size="17" /></button></div></div>
    <p v-if="error" class="we-alert" role="alert">{{ error }}</p>
    <p v-if="loading" class="we-empty" role="status">加载中</p>
    <p v-else-if="!entries.length" class="we-empty">暂无历史版本</p>
    <div class="we-history-layout">
      <div class="we-history-list"><button v-for="entry in entries" :key="entry.revision" class="we-history-entry" :aria-pressed="selected?.revision === entry.revision" @click="read(entry.revision)"><strong>{{ entry.message || entry.revision.slice(0, 12) }}</strong><span>{{ entry.author }} · {{ dateLabel(entry.date) }}</span><code>{{ entry.revision.slice(0, 12) }}</code></button></div>
      <p v-if="reading" role="status">加载中</p>
      <div v-else-if="selected" class="we-history-detail"><div class="we-section-head"><strong>{{ selected.title }}</strong><button class="we-button" :disabled="disabled" @click="emit('restore', selected.revision)"><RotateCcw :size="16" />恢复为草稿</button></div><div class="we-muted">{{ [...selected.tags, ...selected.owners].join(' · ') }}</div><pre aria-label="历史正文">{{ selected.body }}</pre></div>
    </div>
  </section>
</template>
