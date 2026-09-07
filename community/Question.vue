<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { ChevronUp, ChevronDown, Check, FileText, Send, Pencil, Trash2, RefreshCw } from '@lucide/vue'
import { api, auth, articles, formatDate, loginHref, isModerator } from './api'
import { renderMarkdown } from './markdown'
import MarkdownEditor from './MarkdownEditor.vue'
import Comments from './Comments.vue'
const id = new URLSearchParams(location.search).get('id') || ''
const requestedAnswer = new URLSearchParams(location.search).get('answer') || location.hash.replace(/^#answer-/, '')
const answerId = /^[0-9]{1,20}$/.test(requestedAnswer) ? requestedAnswer : ''
const question = ref<any>(null), answers = ref<any[]>([]), sources = ref<any[]>([])
const error = ref(''), loading = ref(true), content = ref(''), busy = ref(false), editing = ref(''), edited = ref('')
const canAccept = computed(() => String(question.value?.user_info?.id) === String(auth.user?.id))
function canEdit(item) { return String(item.user_info?.id) === String(auth.user?.id) || isModerator() }
async function load() {
  loading.value = true; error.value = ''
  try {
    if (!/^[A-Za-z0-9]{1,40}$/.test(id)) throw new Error('问题编号无效。')
    const [item, response, manifest] = await Promise.all([api(`question?id=${id}`), api(`answers?question_id=${id}&page=1&page_size=20&order=default`), articles()])
    question.value = item; answers.value = response.list || (Array.isArray(response) ? response : [])
    if (answerId && !answers.value.some(answer => answer.id === answerId)) {
      try {
        const linked = await api(`answer?id=${answerId}`)
        if (String(linked.question?.id) !== String(item.id)) throw new Error('链接中的回答不属于当前问题。')
        answers.value.push(linked.info)
      } catch (cause) { error.value = cause.message }
    }
    sources.value = manifest.filter(article => item.tags?.some(tag => tag.slug_name === article.tag))
    const heading = document.getElementById('question-title')
    if (heading) heading.textContent = item.title
    document.title = `${item.title} - 飞扬 Wiki`
    loading.value = false
    await nextTick()
    if (answerId) document.getElementById(`answer-${answerId}`)?.scrollIntoView({ block: 'start' })
  } catch (cause) { error.value = cause.message }
  finally { loading.value = false }
}
async function vote(item, direction) {
  if (!auth.user) { location.assign(loginHref()); return }
  try { const data = await api(`vote/${direction}`, 'POST', { object_id: item.id, is_cancel: String(item.vote_status).includes(direction) }); item.vote_count = data.votes; item.vote_status = data.vote_status }
  catch (cause) { error.value = cause.message }
}
async function submitAnswer() {
  if (!auth.user) { location.assign(loginHref()); return }
  busy.value = true; error.value = ''
  try { await api('answers', 'POST', { question_id: id, content: content.value }); content.value = ''; await load() }
  catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
async function accept(answer) {
  try { await api('accept', 'POST', { question_id: id, answer_id: answer.accepted === 2 ? '' : answer.id }); await load() }
  catch (cause) { error.value = cause.message }
}
async function saveAnswer(answer) {
  try { await api('answer', 'PUT', { id: answer.id, content: edited.value, edit_summary: '补充解答' }); editing.value = ''; await load() }
  catch (cause) { error.value = cause.message }
}
async function removeAnswer(answer) {
  if (!confirm('确认删除这条回答？')) return
  try { await api('answer', 'DELETE', { id: answer.id }); await load() }
  catch (cause) { error.value = cause.message }
}
onMounted(load)
</script>
<template>
  <div class="qa-page">
    <p v-if="loading" class="qa-muted" role="status">正在加载问题…</p>
    <p v-if="error" class="qa-alert" role="alert">{{ error }}</p>
    <template v-if="question && !loading">
      <div class="qa-detail-meta"><span>{{ question.user_info?.display_name || question.user_info?.username }}</span><span>{{ formatDate(question.create_time) }}</span><span>{{ question.view_count }} 次浏览</span><span v-if="question.status === 11" class="qa-status-pending">待审核</span><a class="qa-detail-back" href="/questions/">全部问题</a></div>
      <div v-for="source in sources" :key="source.id" class="qa-related-source"><FileText :size="17" /><span>关联文章：<a :href="source.path">{{ source.title }}</a></span></div>
      <div id="question" class="qa-post"><div class="qa-votes"><button :class="{ selected: String(question.vote_status).includes('up') }" aria-label="赞同问题" title="赞同" @click="vote(question, 'up')"><ChevronUp :size="24" /></button><strong>{{ question.vote_count }}</strong><button aria-label="不赞同问题" title="不赞同" @click="vote(question, 'down')"><ChevronDown :size="24" /></button></div><div class="qa-post-body"><div class="qa-rendered" v-html="renderMarkdown(question.content)"></div><Comments :object-id="question.id" /></div></div>
      <h2 id="answers" class="qa-answers-heading">{{ answers.length }} 个回答</h2>
      <p v-if="!answers.length" class="qa-muted">还没有回答。</p>
      <article v-for="answer in answers" :key="answer.id" class="qa-answer" :class="{ 'qa-linked-answer': answer.id === answerId }" :id="`answer-${answer.id}`">
        <div class="qa-answer-top"><span class="qa-avatar">{{ (answer.user_info?.display_name || answer.user_info?.username || '用').slice(0, 1) }}</span><span>{{ answer.user_info?.display_name || answer.user_info?.username }}</span><time>{{ formatDate(answer.create_time) }}</time><span v-if="answer.accepted === 2" class="qa-accepted-text"><Check :size="16" />已采纳</span><span v-if="answer.status === 11" class="qa-status-pending">待审核</span></div>
        <div class="qa-post"><div class="qa-votes"><button :class="{ selected: String(answer.vote_status).includes('up') }" aria-label="赞同回答" title="赞同" @click="vote(answer, 'up')"><ChevronUp :size="24" /></button><strong>{{ answer.vote_count }}</strong><button aria-label="不赞同回答" title="不赞同" @click="vote(answer, 'down')"><ChevronDown :size="24" /></button></div><div class="qa-post-body">
          <template v-if="editing === answer.id"><MarkdownEditor v-model="edited" label="编辑回答" /><div class="qa-form-actions"><button class="qa-primary" @click="saveAnswer(answer)">保存修改</button><button class="qa-text-button" @click="editing = ''">取消</button></div></template>
          <div v-else class="qa-rendered" v-html="renderMarkdown(answer.content)"></div>
          <div class="qa-post-actions"><button v-if="canAccept" class="qa-text-button" @click="accept(answer)"><Check :size="15" />{{ answer.accepted === 2 ? '取消采纳' : '采纳回答' }}</button><button v-if="canEdit(answer)" class="qa-text-button" @click="editing = answer.id; edited = answer.content"><Pencil :size="14" />编辑</button><button v-if="canEdit(answer)" class="qa-icon-button" aria-label="删除回答" title="删除回答" @click="removeAnswer(answer)"><Trash2 :size="14" /></button></div><Comments :object-id="answer.id" />
        </div></div>
      </article>
      <h2 id="write-answer">你的回答</h2>
      <p v-if="!auth.user" class="qa-notice"><a :href="loginHref()">登录</a>后参与解答。</p>
      <form v-else class="qa-form" @submit.prevent="submitAnswer"><MarkdownEditor v-model="content" label="你的回答" /><button class="qa-primary" :disabled="busy || content.trim().length < 6"><Send :size="16" />{{ busy ? '正在提交…' : '提交回答' }}</button></form>
    </template>
    <button v-if="error && !question" class="qa-secondary" @click="load"><RefreshCw :size="16" />重试</button>
  </div>
</template>
