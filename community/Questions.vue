<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Plus, Search, Check, ChevronLeft, ChevronRight, RefreshCw } from '@lucide/vue'
import { api, auth, articles, questionHref, formatDate } from './api'
const query = new URLSearchParams(location.search)
const order = ref(query.get('order') || 'newest'), search = ref(query.get('q') || '')
const article = ref(query.get('article') || ''), choices = ref<any[]>([]), items = ref<any[]>([])
const page = ref(Math.max(1, Number(query.get('page')) || 1)), total = ref(0), loading = ref(true), error = ref('')
const username = query.get('username') || ''
const tabs = [{ value: 'newest', label: '最新' }, { value: 'active', label: '最近活跃' }, { value: 'unanswered', label: '等待回答' }]
async function load(reset = false) {
  if (reset) page.value = 1
  loading.value = true; error.value = ''
  try {
    const params = new URLSearchParams({ page: String(page.value), page_size: '20', order: order.value })
    const linked = choices.value.find(item => item.id === article.value)
    if (linked) params.set('tag', linked.tag)
    if (username) params.set('username', username)
    if (search.value.trim()) {
      params.set('q', `is:question ${search.value.trim()}`); params.set('order', 'relevance')
      const data = await api(`search?${params}`)
      items.value = (data.list || []).map(item => ({ ...item.object, operator: item.object.user_info, description: item.object.excerpt, accepted_answer_id: item.object.accepted ? 'accepted' : '0' }))
      total.value = data.count || 0
    } else {
      const data = await api(`questions?${params}`)
      items.value = (data.list || []).filter(item => item.show !== 2)
      total.value = data.count || 0
    }
  } catch (cause) { error.value = cause.message }
  finally { loading.value = false }
}
onMounted(async () => { try { choices.value = await articles() } finally { await load() } })
</script>
<template>
  <div class="qa-page">
    <div class="qa-page-top"><p class="qa-muted">{{ username ? `${username} 的提问` : '提出具体问题，分享经过验证的解答。' }}</p><a class="qa-primary" href="/ask/"><Plus :size="16" />发起提问</a></div>
    <form class="qa-list-search" @submit.prevent="load(true)"><Search :size="18" /><input v-model="search" type="search" aria-label="搜索问答" placeholder="搜索问答" maxlength="200" /><button type="submit">搜索</button></form>
    <div class="qa-filter-bar"><div class="qa-tabs" role="tablist" aria-label="问题排序"><button v-for="tab in tabs" :key="tab.value" role="tab" :aria-selected="order === tab.value" @click="order = tab.value; load(true)">{{ tab.label }}</button></div><select v-model="article" aria-label="关联文章筛选" @change="load(true)"><option value="">全部文章</option><option v-for="item in choices" :key="item.id" :value="item.id">{{ item.title }}</option></select></div>
    <p v-if="loading" class="qa-empty" role="status">正在加载问题…</p>
    <div v-else-if="error" class="qa-empty"><p role="alert">{{ error }}</p><button class="qa-secondary" @click="load()"><RefreshCw :size="15" />重新加载</button></div>
    <div v-else-if="!items.length" class="qa-empty"><p>{{ search ? '没有找到相关问题。' : '暂无问题。' }}</p><a href="/ask/">发起一个新问题</a></div>
    <div v-else class="qa-list">
      <article v-for="item in items" :key="item.id" class="qa-list-item">
        <div class="qa-list-count" :class="{ 'is-accepted': item.accepted_answer_id && item.accepted_answer_id !== '0' }"><Check v-if="item.accepted_answer_id && item.accepted_answer_id !== '0'" :size="14" /><strong>{{ item.answer_count }}</strong><span>回答</span></div>
        <div class="qa-list-summary"><h2><a :href="questionHref(item.id)">{{ item.title }}</a></h2><p>{{ item.description?.replace(/<[^>]+>/g, '').slice(0, 140) }}</p><div class="qa-list-meta"><span v-for="tag in item.tags" :key="tag.slug_name" class="qa-tag">{{ tag.display_name }}</span><span class="qa-author">{{ item.operator?.display_name || item.operator?.username }} · {{ formatDate(item.created_at) }}</span></div></div>
      </article>
    </div>
    <nav v-if="page > 1 || total > 20" class="qa-pagination" aria-label="分页"><button class="qa-icon-button" :disabled="page === 1" aria-label="上一页" @click="page--; load()"><ChevronLeft :size="18" /></button><span>第 {{ page }} 页</span><button class="qa-icon-button" :disabled="page * 20 >= total" aria-label="下一页" @click="page++; load()"><ChevronRight :size="18" /></button></nav>
  </div>
</template>
