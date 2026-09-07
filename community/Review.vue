<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, X, ChevronLeft, ChevronRight } from '@lucide/vue'
import { api, auth, isModerator, loginHref, formatDate, questionHref } from './api'
import { renderMarkdown } from './markdown'
const items = ref<any[]>([]), loading = ref(true), error = ref(''), page = ref(1), total = ref(0), busy = ref(false)
async function load() {
  if (!isModerator()) { loading.value = false; return }
  loading.value = true; error.value = ''
  try { const object = new URLSearchParams(location.search).get('object'); const data = await api(`reviews?page=${page.value}${object ? `&object_id=${encodeURIComponent(object)}` : ''}`); items.value = data.list || []; total.value = data.count || 0 }
  catch (cause) { error.value = cause.message }
  finally { loading.value = false }
}
async function review(item, status) {
  busy.value = true
  try { await api('reviews', 'PUT', { review_id: item.review_id, status }); page.value = 1; await load() }
  catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
onMounted(load)
</script>
<template>
  <div class="qa-page">
    <p v-if="!auth.user" class="qa-notice"><a :href="loginHref()">登录</a>后查看审核队列。</p>
    <p v-else-if="!isModerator()" class="qa-notice">此页面仅向管理员和版主开放。</p>
    <template v-else><p class="qa-muted">待审核内容 {{ total }} 条</p><p v-if="loading" role="status">正在加载…</p><p v-else-if="!items.length" class="qa-empty">暂无待审核内容。</p>
      <article v-for="item in items" :key="item.review_id" class="qa-review-item"><div class="qa-detail-meta"><span>{{ { question: '问题', answer: '回答', comment: '讨论' }[item.object_type] }}</span><span>{{ item.author_user_info?.display_name }}</span><time>{{ formatDate(item.created_at) }}</time></div><h2><a :href="questionHref(item.question_id || item.object_id)">{{ item.title || '待审核内容' }}</a></h2><div class="qa-rendered" v-html="renderMarkdown(item.original_text)"></div><p class="qa-muted">{{ item.reason }}</p><div class="qa-form-actions"><button class="qa-primary" :disabled="busy" @click="review(item, 'approve')"><Check :size="16" />通过</button><button class="qa-secondary" :disabled="busy" @click="review(item, 'reject')"><X :size="16" />拒绝</button></div></article>
      <nav v-if="total > 1" class="qa-pagination" aria-label="审核分页"><button class="qa-icon-button" :disabled="page === 1" aria-label="上一条" @click="page--; load()"><ChevronLeft :size="18" /></button><span>{{ page }} / {{ total }}</span><button class="qa-icon-button" :disabled="page >= total" aria-label="下一条" @click="page++; load()"><ChevronRight :size="18" /></button></nav>
    </template><p v-if="error" role="alert" class="qa-alert">{{ error }}</p>
  </div>
</template>
