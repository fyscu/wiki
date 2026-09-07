<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { FileText, Send } from '@lucide/vue'
import MarkdownEditor from './MarkdownEditor.vue'
import { api, auth, articles, loginHref, questionHref } from './api'
const choices = ref<any[]>([]), selection = ref(new URLSearchParams(location.search).get('article') || '')
const title = ref(''), content = ref(''), error = ref(''), busy = ref(false), ready = ref(false)
const related = computed(() => choices.value.find(item => item.id === selection.value))
const draftKey = 'feiyang-question-draft'
onMounted(async () => {
  try { choices.value = await articles(); ready.value = true } catch { error.value = '文章列表未能加载，请刷新后重试。' }
  try { const saved = JSON.parse(sessionStorage.getItem(draftKey) || '{}'); title.value = saved.title || ''; content.value = saved.content || '' } catch {}
})
function saveDraft() { sessionStorage.setItem(draftKey, JSON.stringify({ title: title.value, content: content.value })) }
async function submit() {
  if (busy.value || !ready.value) return
  saveDraft()
  if (!auth.user) { location.assign(loginHref()); return }
  if (title.value.trim().length < 6) { error.value = '标题至少需要 6 个字符。'; return }
  if (content.value.trim().length < 6) { error.value = '请补充问题描述，至少 6 个字符。'; return }
  busy.value = true; error.value = ''
  try {
    const source = related.value
    const body = source ? `${content.value}\n\n---\n来源文章：[${source.title}](${source.path})\n\n文档版本：${source.revision}` : content.value
    const data = await api('questions', 'POST', { title: title.value.trim(), content: body,
      tags: source ? [{ slug_name: source.tag, display_name: source.title }] : [{ slug_name: 'general', display_name: '交流讨论' }] })
    const id = data.id || data.question_id
    if (!id) throw new Error('问题已提交，但未返回问题编号。请在我的提问中查看。')
    sessionStorage.removeItem(draftKey)
    location.assign(questionHref(id))
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false }
}
</script>
<template>
  <div class="qa-page">
    <p v-if="!auth.user" class="qa-notice"><a :href="loginHref()">登录</a>后可发布问题。</p>
    <form class="qa-form" @submit.prevent="submit">
      <label for="question-article">关联文章<select id="question-article" v-model="selection" :disabled="!ready"><option value="">不关联特定文章</option><option v-for="item in choices" :key="item.id" :value="item.id">{{ item.title }}</option></select></label>
      <p v-if="related" class="qa-related-source"><FileText :size="16" /><a :href="related.path">{{ related.title }}</a></p>
      <label for="question-title-input">问题标题<input id="question-title-input" v-model="title" minlength="6" maxlength="150" required placeholder="用一句话概括你的问题" @input="saveDraft" /></label>
      <div><label class="qa-label">问题描述</label><MarkdownEditor v-model="content" label="问题描述" :rows="10" @update:model-value="saveDraft" /></div>
      <p v-if="error" role="alert" class="qa-alert">{{ error }}</p>
      <div class="qa-form-actions"><button class="qa-primary" :disabled="busy || !ready" type="submit"><Send :size="16" />{{ busy ? '正在发布…' : '发布问题' }}</button><a href="/questions/">取消</a></div>
    </form>
  </div>
</template>
