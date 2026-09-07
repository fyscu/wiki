<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from './api'
const code = new URLSearchParams(location.search).get('code') || ''
const busy = ref(false), done = ref(false), error = ref('')
onMounted(() => {
  if (code) history.replaceState(history.state, '', location.pathname)
  else error.value = '退订链接不完整，请使用通知邮件中的退订链接。'
})
async function unsubscribe() {
  if (busy.value || !code) return
  busy.value = true; error.value = ''
  try { await api('email/unsubscribe', 'PUT', { code }, true); done.value = true }
  catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
</script>
<template>
  <div class="qa-auth-page">
    <p v-if="done" class="qa-notice" role="status">已停止接收这类通知邮件。</p>
    <template v-else-if="code"><p>停止接收这类通知邮件？</p><button class="qa-primary" :disabled="busy" @click="unsubscribe">{{ busy ? '正在提交…' : '确认退订' }}</button></template>
    <p v-if="error" class="qa-alert" role="alert">{{ error }}</p>
    <p><a href="/questions/">返回知识问答</a></p>
  </div>
</template>
