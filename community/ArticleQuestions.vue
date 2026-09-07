<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { MessageCircle, Plus, Check, RefreshCw } from '@lucide/vue'
import { questionHref } from './api'
import { docTag, buildAskPath, normalizeQuestions } from '../lib/qa.mjs'
const props = defineProps<{ article: { id: string; title: string; revision: string; path: string } }>()
const state = ref('loading'), items = ref<any[]>([])
async function load() {
  state.value = 'loading'
  try {
    const response = await fetch(`/_qa/questions?tag=${docTag(props.article.id)}`, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(7000) })
    if (!response.ok) throw new Error()
    items.value = normalizeQuestions(await response.json()); state.value = 'ready'
  } catch { state.value = 'error' }
}
onMounted(load)
</script>
<template>
  <section class="qa-article-section" aria-labelledby="related-questions"><div class="qa-section-head"><h2 id="related-questions"><MessageCircle :size="21" />本文问答</h2><a :href="buildAskPath(article.id)"><Plus :size="15" />针对本文提问</a></div>
    <p v-if="state === 'loading'" class="qa-muted">正在加载…</p>
    <div v-else-if="state === 'error'" class="qa-inline-error"><span>问答暂时无法加载。</span><button class="qa-icon-button" title="重新加载" aria-label="重新加载问答" @click="load"><RefreshCw :size="16" /></button></div>
    <p v-else-if="!items.length" class="qa-muted">还没有与本文关联的问题。</p>
    <a v-for="item in items" :key="item.id" class="qa-related-row" :href="questionHref(item.id)"><span :class="{ 'qa-accepted-text': item.accepted }"><Check v-if="item.accepted" :size="14" />{{ item.answers }} 回答</span><span>{{ item.title }}</span></a>
    <p v-if="items.length"><a :href="`/questions/?article=${article.id}`">查看全部相关问题</a></p>
  </section>
</template>
