<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { MessageSquare } from '@lucide/vue'
import { api, auth, loginHref, formatDate } from './api'
const props = defineProps<{ objectId: string }>()
const items = ref<any[]>([]), text = ref(''), open = ref(false), error = ref(''), busy = ref(false)
async function load() {
  try {
    const data = await api(`comments?object_id=${props.objectId}&page=1&page_size=20`); items.value = data.list || []
    const target = new URLSearchParams(location.search).get('commentId')
    if (items.value.some(item => String(item.comment_id) === target)) {
      await nextTick()
      document.getElementById(`comment-${target}`)?.scrollIntoView({ block: 'center' })
    }
  } catch (cause) { error.value = cause.message }
}
async function submit() {
  if (!auth.user) { location.assign(loginHref()); return }
  busy.value = true; error.value = ''
  try { await api('comments', 'POST', { object_id: props.objectId, original_text: text.value }); text.value = ''; await load() }
  catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
onMounted(load)
</script>
<template>
  <div class="qa-comments"><div v-for="item in items" :key="item.comment_id" :id="`comment-${item.comment_id}`" class="qa-comment"><span>{{ item.original_text }}</span><small>{{ item.user_display_name || item.username }} · {{ formatDate(item.created_at) }}</small></div>
    <button class="qa-text-button" @click="open = !open"><MessageSquare :size="14" />补充讨论<span v-if="items.length">（{{ items.length }}）</span></button>
    <form v-if="open" class="qa-comment-form" @submit.prevent="submit"><textarea v-model="text" aria-label="补充讨论" rows="3" minlength="2" maxlength="600" required></textarea><button class="qa-secondary" :disabled="busy">提交</button></form><p v-if="error" class="qa-alert" role="alert">{{ error }}</p>
  </div>
</template>
