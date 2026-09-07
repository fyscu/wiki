<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowLeft, Check, CircleAlert, Clock3, Download, Eye, FilePlus2, FileText, FolderTree, History, Image, LoaderCircle, RefreshCw, Save, Search, Trash2, Upload, X } from '@lucide/vue'
import { auth } from '../api'
import CodeEditor from './CodeEditor.vue'
import EditorDialog from './EditorDialog.vue'
import NavigationEditor from './NavigationEditor.vue'
import HistoryPanel from './HistoryPanel.vue'
import JobsPanel from './JobsPanel.vue'
import { flattenTree } from './navigation'
import { dateLabel, jobLabels, safeUrl, terminal, type Job, type Media } from './types'
import { useEditor } from './useEditor'
import './editor.css'

const editor = useEditor()
const { state, current, draft, loading, busy, saving, uploading, error, saveError, notice, conflict, denied, admin,
  unsaved, navigation, navDirty, navSaving, navConflict, navError, jobs, activePublish, previewJob, previewJobId, pollError } = editor
const tab = ref<'articles' | 'navigation' | 'jobs'>('articles')
const search = ref(''), filter = ref('all'), mobileDetail = ref(false), showHistory = ref(false), showMedia = ref(false)
const newOpen = ref(false), previewOpen = ref(false), message = ref(''), newTitle = ref(''), newPath = ref(''), newSection = ref(''), createError = ref('')
const codeEditor = ref<InstanceType<typeof CodeEditor>>()
const locked = computed(() => busy.value || navSaving.value)
const navigating = computed(() => locked.value || uploading.value > 0)
const articleList = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return (state.value?.articles || []).filter(article => (!query || `${article.title} ${article.path}`.toLocaleLowerCase().includes(query)) &&
    (filter.value === 'all' || (filter.value === 'draft' ? article.dirty || article.status === 'draft' : article.status === 'published' && !article.dirty)))
})
const sections = computed(() => flattenTree(navigation.value.items).filter(row => row.node.path === undefined))
const dirtyCount = computed(() => state.value?.articles.filter(article => article.dirty).length || 0)
const pendingNavigation = computed(() => navDirty.value || navigation.value.dirty)
const hasConflict = computed(() => conflict.value || navConflict.value || state.value?.articles.some(article => article.conflict))
const publishable = computed(() => dirtyCount.value > 0 || unsaved.value || pendingNavigation.value)
const activeJobs = computed(() => jobs.value.filter(job => !terminal(job)).length)
const lastPublish = computed(() => jobs.value.find(job => job.kind === 'publish'))
const saveLabel = computed(() => conflict.value ? '版本冲突' : saveError.value ? '保存失败' : saving.value ? '保存中' : unsaved.value ? '未保存' : '已保存')

async function open(id: string) {
  if (await editor.openArticle(id)) {
    tab.value = 'articles'; mobileDetail.value = true; showHistory.value = false
    const url = new URL(location.href)
    url.searchParams.set('article', id); url.searchParams.delete('id')
    history.replaceState(history.state, '', url)
  }
}
function openPath(path: string) {
  const article = state.value?.articles.find(item => item.path === path)
  if (article) void open(article.id)
  else notice.value = '此页面由系统维护'
}
async function create() {
  createError.value = ''
  const path = newPath.value.trim()
  if (path && (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..') || !path.endsWith('.md'))) {
    createError.value = '请输入相对路径，以 .md 结尾'; return
  }
  if (await editor.createArticle({ title: newTitle.value.trim(), ...(path ? { path } : {}), ...(newSection.value ? { sectionId: newSection.value } : {}) })) {
    newOpen.value = false; newTitle.value = ''; newPath.value = ''; newSection.value = ''
    tab.value = 'articles'; mobileDetail.value = true; showHistory.value = false
  }
}
async function preview() { if (await editor.preview()) previewOpen.value = true }
function viewPreview(job: Job) { previewJobId.value = job.id; previewOpen.value = true }
async function restore(revision: string) { if (await editor.restore(revision)) showHistory.value = false }
async function saveNav() { await editor.explicitSaveNavigation() }
function downloadDraft() {
  const url = URL.createObjectURL(new Blob([draft.body], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = (current.value?.path.split('/').pop() || 'draft.md'); link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function insertMedia(media: Media) { codeEditor.value?.insertMedia(media); showMedia.value = false }
onMounted(async () => {
  await editor.load()
  const params = new URLSearchParams(location.search), id = params.get('article') || params.get('id')
  if (id && state.value) {
    if (state.value.articles.some(article => article.id === id)) await open(id)
    else error.value = '文章不存在'
  }
})
</script>

<template>
  <div class="we-editor">
    <p v-if="!auth.user || !auth.token" class="we-empty"><a href="/login/?next=%2Feditor%2F">登录</a></p>
    <p v-else-if="!admin || denied" class="we-alert" role="alert">仅管理员可访问</p>
    <template v-else>
      <header class="we-header">
        <div class="we-heading"><FileText :size="22" /><h2>内容编辑</h2><span class="we-muted">{{ state?.articles.length || 0 }} 篇</span></div>
        <div class="we-publish-actions"><label class="we-publish-message"><span class="we-sr-only">发布说明</span><input v-model="message" aria-label="发布说明" placeholder="发布说明" maxlength="200" :disabled="locked || activePublish" /></label><button class="we-button we-primary" aria-label="发布" :disabled="navigating || activePublish || !state || hasConflict || !publishable" @click="editor.publish(message)"><LoaderCircle v-if="activePublish" :size="16" class="we-spin" /><Upload v-else :size="16" />{{ activePublish ? '发布中' : '发布' }}<span v-if="dirtyCount || unsaved" class="we-count">{{ dirtyCount + (unsaved && !current?.dirty ? 1 : 0) }}</span><span v-else-if="pendingNavigation" class="we-count">目录</span></button></div>
      </header>
      <div class="we-topbar"><nav class="we-tabs" aria-label="编辑管理"><button :aria-current="tab === 'articles' ? 'page' : undefined" :disabled="navigating" @click="tab = 'articles'"><FileText :size="16" />文章</button><button aria-label="目录" :aria-current="tab === 'navigation' ? 'page' : undefined" :disabled="navigating" @click="tab = 'navigation'"><FolderTree :size="16" />目录<span v-if="pendingNavigation" class="we-dot" :aria-label="navDirty ? '未保存' : '待发布'"></span></button><button :aria-current="tab === 'jobs' ? 'page' : undefined" :disabled="navigating" @click="tab = 'jobs'"><Clock3 :size="16" />任务<span v-if="activeJobs">{{ activeJobs }}</span></button></nav><button class="we-icon" title="刷新列表" aria-label="刷新列表" :disabled="loading || navigating" @click="editor.load"><RefreshCw :size="17" :class="{ 'we-spin': loading }" /></button></div>
      <p v-if="error" class="we-alert" role="alert">{{ error }}<button class="we-icon" title="关闭提示" aria-label="关闭错误提示" @click="error = ''"><X :size="15" /></button></p>
      <p v-if="notice" class="we-notice" role="status">{{ notice }}</p>
      <button v-if="lastPublish && tab !== 'jobs'" class="we-running" :class="{ 'we-error-text': lastPublish.status === 'failed' }" @click="tab = 'jobs'"><component :is="lastPublish.status === 'failed' ? CircleAlert : terminal(lastPublish) ? Check : LoaderCircle" :size="15" :class="{ 'we-spin': !terminal(lastPublish) }" /><span>发布 · {{ jobLabels[lastPublish.status] }}</span><span>{{ lastPublish.error || lastPublish.message }}</span></button>
      <p v-if="loading && !state" class="we-empty" role="status">加载中</p>
      <div v-else-if="state" v-show="tab === 'articles'" class="we-layout" :class="{ 'is-detail': mobileDetail && current }">
        <aside class="we-article-sidebar" aria-label="文章列表">
          <div class="we-sidebar-head"><strong>文章</strong><button class="we-icon" title="新建文章" aria-label="新建文章" :disabled="navigating" @click="newOpen = true"><FilePlus2 :size="18" /></button></div>
          <div class="we-search"><Search :size="15" /><input v-model="search" aria-label="搜索文章" placeholder="搜索标题、路径" /><button v-if="search" class="we-icon" aria-label="清空搜索" title="清空" @click="search = ''"><X :size="14" /></button></div>
          <div class="we-list-filter"><select v-model="filter" aria-label="文章状态"><option value="all">全部文章</option><option value="draft">草稿</option><option value="published">已发布</option></select><span>{{ articleList.length }}</span></div>
          <div class="we-article-list"><button v-for="article in articleList" :key="article.id" class="we-article-row" :class="{ 'is-selected': current?.id === article.id }" :disabled="navigating" :aria-current="current?.id === article.id ? 'page' : undefined" @click="open(article.id)"><span class="we-article-title">{{ article.title }}<CircleAlert v-if="article.conflict" :size="13" class="we-error-text" aria-label="版本冲突" /><span v-else-if="article.dirty || (current?.id === article.id && unsaved)" class="we-dot" aria-label="有草稿"></span></span><span class="we-article-path">{{ article.path }}</span><span class="we-article-meta">{{ article.conflict ? '版本冲突' : article.status === 'draft' || article.dirty ? '草稿' : '已发布' }}<time>{{ dateLabel(article.updatedAt) }}</time></span></button></div>
          <p v-if="!articleList.length" class="we-empty">{{ search ? '无匹配文章' : '暂无文章' }}</p>
        </aside>
        <main class="we-article-main">
          <template v-if="current">
            <div class="we-document-bar"><button class="we-icon we-back" title="返回列表" aria-label="返回文章列表" :disabled="navigating" @click="mobileDetail = false"><ArrowLeft :size="18" /></button><span class="we-save-status" role="status" :class="{ 'we-error-text': saveError || conflict }"><component :is="saveError || conflict ? CircleAlert : saving ? LoaderCircle : unsaved ? Clock3 : Check" :size="14" :class="{ 'we-spin': saving }" />{{ saveLabel }}</span><div class="we-actions"><button class="we-icon" title="历史" aria-label="文章历史" :disabled="navigating" :aria-pressed="showHistory" @click="showHistory = !showHistory"><History :size="17" /></button><button class="we-icon" title="图片库" aria-label="图片库" :disabled="navigating" :aria-pressed="showMedia" @click="showMedia = !showMedia"><Image :size="17" /></button><button class="we-icon we-danger" title="丢弃草稿" aria-label="丢弃草稿" :disabled="navigating || (!current.dirty && !unsaved)" @click="editor.discard"><Trash2 :size="17" /></button><button class="we-button" :disabled="navigating || conflict || navConflict" @click="preview"><Eye :size="16" />预览</button><button class="we-button we-primary" :disabled="navigating || conflict" @click="editor.explicitSave"><Save :size="16" />保存</button></div></div>
            <div v-if="saveError" class="we-alert" role="alert"><span>{{ saveError }}</span><template v-if="conflict"><button class="we-button" :disabled="navigating" @click="downloadDraft"><Download :size="15" />下载正文</button><button class="we-button" :disabled="navigating" @click="editor.reloadArticle"><RefreshCw :size="15" />载入服务器版本</button></template><button v-else class="we-button" :disabled="navigating" @click="editor.explicitSave">重试保存</button></div>
            <HistoryPanel v-if="showHistory" :article-id="current.id" :disabled="navigating" @close="showHistory = false" @restore="restore" />
            <div v-show="!showHistory">
              <div class="we-document-fields"><label class="we-title-label"><span class="we-sr-only">文章标题</span><input v-model="draft.title" aria-label="文章标题" :disabled="locked" /></label><div class="we-path"><span>{{ current.path }}</span><span>v{{ current.version }}</span><time>{{ dateLabel(current.updatedAt) }}</time></div><div class="we-metadata"><label>标签<input v-model="draft.tagsText" aria-label="标签" :disabled="locked" placeholder="标签，以逗号分隔" /></label><label>维护者<input v-model="draft.ownersText" aria-label="维护者" :disabled="locked" placeholder="维护者，以逗号分隔" /></label></div></div>
              <div v-if="showMedia" class="we-media-panel"><div class="we-section-head"><strong>图片库</strong><button class="we-icon" title="关闭图片库" aria-label="关闭图片库" @click="showMedia = false"><X :size="16" /></button></div><p v-if="!state.media.length" class="we-empty">暂无图片</p><div class="we-media-grid"><button v-for="media in state.media" :key="media.id" :disabled="navigating" class="we-media-item" :title="media.name" @click="insertMedia(media)"><img :src="safeUrl(media.url)" :alt="media.name" loading="lazy" /><span>{{ media.name }}</span><small>{{ media.width }} × {{ media.height }}</small></button></div></div>
              <CodeEditor :key="current.id" ref="codeEditor" v-model="draft.body" :disabled="locked" :media="state.media" :upload="editor.upload" @save="editor.explicitSave" @error="error = $event" />
            </div>
          </template>
          <div v-else class="we-no-selection"><FileText :size="30" /><span>选择文章</span><button class="we-button" :disabled="navigating" @click="newOpen = true"><FilePlus2 :size="16" />新建文章</button></div>
        </main>
      </div>
      <NavigationEditor v-if="state" v-show="tab === 'navigation'" :items="navigation.items" :dirty="navDirty" :disabled="navigating" :saving="navSaving" :conflict="navConflict" :error="navError" @change="editor.updateNavigation" @save="saveNav" @reload="editor.reloadNavigation" @open="openPath" />
      <JobsPanel v-if="state" v-show="tab === 'jobs'" :jobs="jobs" :error="pollError" @preview="viewPreview" />
      <EditorDialog :open="newOpen" title="新建文章" :disabled="locked" @close="newOpen = false"><form class="we-form" @submit.prevent="create"><label>标题<input v-model="newTitle" required autofocus :disabled="locked" /></label><label>路径<input v-model="newPath" placeholder="可选，如 guide/new.md" :disabled="locked" /></label><label>栏目<select v-model="newSection" :disabled="locked"><option value="">默认栏目</option><option v-for="row in sections" :key="row.node.id" :value="row.node.id">{{ '　'.repeat(row.depth) + row.node.title }}</option></select></label><p v-if="createError || error" class="we-alert" role="alert">{{ createError || error }}</p><div class="we-actions"><button type="button" class="we-button" :disabled="locked" @click="newOpen = false">取消</button><button class="we-button we-primary" :disabled="navigating || !newTitle.trim()"><FilePlus2 :size="16" />创建</button></div></form></EditorDialog>
      <EditorDialog :open="previewOpen" title="站点预览" wide @close="previewOpen = false"><template v-if="previewJob"><div class="we-preview-status" role="status"><LoaderCircle v-if="!terminal(previewJob)" class="we-spin" :size="16" /><span>{{ jobLabels[previewJob.status] }}</span><span>{{ previewJob.error || previewJob.message }}</span></div><p v-if="pollError" class="we-alert" role="alert">{{ pollError }}，正在重试</p><iframe v-if="previewOpen && previewJob.status === 'succeeded' && safeUrl(previewJob.url)" class="we-preview-frame" :src="safeUrl(previewJob.url)" sandbox="" referrerpolicy="no-referrer" title="MkDocs 文章预览"></iframe><p v-else-if="previewJob.status === 'succeeded'" class="we-alert" role="alert">预览地址不可用</p><button v-if="previewJob.status === 'failed'" class="we-button" :disabled="navigating || !current" @click="preview"><RefreshCw :size="16" />重新构建</button></template></EditorDialog>
    </template>
  </div>
</template>
