import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { auth } from '../api'
import { articlePath, editorApi, EditorError, errorMessage } from './api'
import { cloneTree, flattenTree, treeStructure } from './navigation'
import { terminal, type Article, type EditorState, type Job, type Media, type Navigation, type NavNode } from './types'

interface Draft { title: string; body: string; tagsText: string; ownersText: string }
const words = (value: string) => [...new Set(value.split(/[,，\n]/).map(word => word.trim()).filter(Boolean))]
const toDraft = (article: Article): Draft => ({ title: article.title, body: article.body, tagsText: article.tags.join(', '), ownersText: article.owners.join(', ') })

export function useEditor() {
  const state = ref<EditorState | null>(null)
  const current = ref<Article | null>(null)
  const draft = reactive<Draft>({ title: '', body: '', tagsText: '', ownersText: '' })
  const baseline = ref('')
  const loading = ref(false), busy = ref(false), saving = ref(false), uploading = ref(0)
  const error = ref(''), saveError = ref(''), notice = ref(''), conflict = ref(false), denied = ref(false)
  const navigation = ref<Navigation>({ version: 0, items: [], dirty: false })
  const navBaseline = ref('[]'), navSaving = ref(false), navConflict = ref(false), navError = ref('')
  const previewJobId = ref(''), pollError = ref('')
  const jobs = ref<Job[]>([])
  const fingerprint = () => JSON.stringify(draft)
  const unsaved = computed(() => !!current.value && fingerprint() !== baseline.value)
  const navDirty = computed(() => JSON.stringify(navigation.value.items) !== navBaseline.value)
  const admin = computed(() => !!auth.token && !!auth.user && Number(auth.user.role_id) === 2 && !denied.value)
  const activePublish = computed(() => jobs.value.some(job => job.kind === 'publish' && !terminal(job)))
  const previewJob = computed(() => jobs.value.find(job => job.id === previewJobId.value))
  let disposed = false, stateSequence = 0, polling = false, stateRefreshNeeded = false
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let savePromise: Promise<void> | null = null
  let navPromise: Promise<void> | null = null

  function report(cause: unknown) {
    error.value = errorMessage(cause)
    if (cause instanceof EditorError && cause.status === 403) denied.value = true
  }

  function setCurrent(article: Article | null) {
    clearTimeout(autosaveTimer)
    current.value = article
    if (article) Object.assign(draft, toDraft(article))
    baseline.value = fingerprint()
    conflict.value = !!article?.conflict
    saveError.value = article?.conflict ? '源文件已更新，请丢弃草稿或恢复历史版本' : ''
    previewJobId.value = ''
  }

  function mergeJob(job: Job) {
    const index = jobs.value.findIndex(item => item.id === job.id)
    if (index < 0) jobs.value.unshift(job)
    else jobs.value[index] = job
  }

  async function refreshState() {
    const sequence = ++stateSequence
    const data = await editorApi<EditorState>('/state')
    if (disposed || sequence !== stateSequence) return
    if (Number(data.user.role_id) !== 2) { denied.value = true; return }
    state.value = data
    if (!navSaving.value) {
      if (!navDirty.value) {
        navigation.value = { ...data.navigation, items: cloneTree(data.navigation.items) }
        navBaseline.value = JSON.stringify(data.navigation.items)
      } else if (treeStructure(JSON.parse(navBaseline.value)) === treeStructure(data.navigation.items)) {
        // Article title saves also update navigation. Merge those leaf titles into local tree edits.
        const titles = new Map(flattenTree(data.navigation.items).filter(row => row.node.path !== undefined).map(row => [row.node.id, row.node.title]))
        const items = cloneTree(navigation.value.items)
        for (const row of flattenTree(items)) if (row.node.path !== undefined && titles.has(row.node.id)) row.node.title = titles.get(row.node.id)!
        navigation.value = { ...data.navigation, items }
        navBaseline.value = JSON.stringify(data.navigation.items)
      } else if (navigation.value.version !== data.navigation.version) {
        navConflict.value = true; navError.value = '服务器目录已有更新，请重新载入后调整'
      }
    }
    for (const job of data.jobs) {
      const known = jobs.value.find(item => item.id === job.id)
      if (!known || !terminal(known)) mergeJob(job)
    }
    schedulePoll()
  }

  async function load() {
    if (!admin.value) return
    loading.value = true; error.value = ''
    try { await refreshState() } catch (cause) { report(cause) }
    finally { loading.value = false }
  }

  function updateSummary(article: Article) {
    if (!state.value) return
    const summary = { ...article, status: article.published && !article.dirty ? 'published' as const : 'draft' as const }
    const index = state.value.articles.findIndex(item => item.id === article.id)
    if (index < 0) state.value.articles.unshift(summary)
    else state.value.articles[index] = summary
  }

  async function saveDraft() {
    clearTimeout(autosaveTimer)
    if (savePromise) return savePromise
    if (!current.value || !unsaved.value) {
      if (stateRefreshNeeded) { await refreshState(); stateRefreshNeeded = false }
      return
    }
    if (conflict.value) throw new EditorError('版本冲突，请先处理草稿', 409)
    saving.value = true; saveError.value = ''
    savePromise = (async () => {
      // Save one immutable snapshot at a time. Edits made during the request remain pending.
      while (!disposed && admin.value && current.value && unsaved.value) {
        const id = current.value.id, version = current.value.version
        const snapshot = { ...draft }
        if (!snapshot.title.trim()) throw new Error('请填写标题')
        const saved = await editorApi<Article>(articlePath(id), 'PUT', {
          version, title: snapshot.title, body: snapshot.body, tags: words(snapshot.tagsText), owners: words(snapshot.ownersText),
        })
        if (disposed || current.value?.id !== id) return
        current.value = saved
        const canonical = toDraft(saved)
        baseline.value = JSON.stringify(canonical)
        // Accept canonical H1/metadata only for fields untouched since this request began.
        for (const key of Object.keys(canonical) as (keyof Draft)[]) {
          if (draft[key] === snapshot[key]) draft[key] = canonical[key]
        }
        updateSummary(saved)
        stateRefreshNeeded = true
        await refreshState()
        stateRefreshNeeded = false
      }
    })().catch(cause => {
      if (stateRefreshNeeded && !unsaved.value) error.value = `草稿已保存，状态刷新失败：${errorMessage(cause)}`
      else saveError.value = errorMessage(cause)
      conflict.value = cause instanceof EditorError && cause.status === 409
      if (cause instanceof EditorError && cause.status === 403) denied.value = true
      throw cause
    }).finally(() => { saving.value = false; savePromise = null })
    return savePromise
  }

  watch(draft, () => {
    clearTimeout(autosaveTimer)
    if (unsaved.value && !conflict.value && !busy.value && admin.value) {
      autosaveTimer = setTimeout(() => { void saveDraft().catch(() => {}) }, 1100)
    }
  }, { flush: 'sync' })

  async function saveNavigation() {
    if (navPromise) return navPromise
    if (!navDirty.value) return
    if (navConflict.value) throw new EditorError('目录版本冲突，请重新载入', 409)
    navSaving.value = true; navError.value = ''
    const items = cloneTree(navigation.value.items), version = navigation.value.version
    navPromise = editorApi<Navigation>('/navigation', 'PUT', { version, items }).then(saved => {
      navigation.value = { ...saved, items: cloneTree(saved.items) }
      navBaseline.value = JSON.stringify(saved.items)
    }).catch(cause => {
      navError.value = errorMessage(cause)
      navConflict.value = cause instanceof EditorError && cause.status === 409
      throw cause
    }).finally(() => { navSaving.value = false; navPromise = null })
    return navPromise
  }

  async function action(task: () => Promise<void>) {
    if (busy.value || uploading.value || !admin.value) return false
    busy.value = true; error.value = ''; notice.value = ''
    clearTimeout(autosaveTimer)
    try { await task(); return true }
    catch (cause) { report(cause); return false }
    finally { busy.value = false }
  }

  async function openArticle(id: string) {
    if (current.value?.id === id) return true
    return action(async () => {
      await saveDraft()
      const article = await editorApi<Article>(articlePath(id))
      setCurrent(article)
    })
  }

  async function explicitSave() {
    return action(async () => { await saveDraft(); notice.value = '草稿已保存' })
  }

  async function explicitSaveNavigation() {
    return action(async () => { await saveDraft(); await saveNavigation(); await refreshState(); notice.value = '目录已保存' })
  }

  async function createArticle(input: { title: string; path?: string; sectionId?: string }) {
    return action(async () => {
      await saveDraft(); await saveNavigation()
      const article = await editorApi<Article>('/articles', 'POST', input)
      setCurrent(article); updateSummary(article)
      await refreshState()
      notice.value = '文章已创建'
    })
  }

  async function discard() {
    if (!current.value || !window.confirm('丢弃当前草稿及未保存修改？此操作无法撤销。')) return
    await action(async () => {
      // Wait only for an already-issued save; never save edits merely to discard them.
      await savePromise?.catch(() => {})
      const article = current.value!
      await editorApi(articlePath(article.id) + '/discard', 'POST', { version: article.version })
      setCurrent(null)
      await refreshState()
      if (state.value?.articles.some(item => item.id === article.id)) setCurrent(await editorApi<Article>(articlePath(article.id)))
      notice.value = '草稿已丢弃'
    })
  }

  async function reloadArticle() {
    if (!current.value || !window.confirm('载入服务器版本？当前未保存修改将被替换。')) return
    await action(async () => {
      await savePromise?.catch(() => {})
      setCurrent(await editorApi<Article>(articlePath(current.value!.id)))
    })
  }

  async function restore(revision: string) {
    if (!current.value || !window.confirm(`将版本 ${revision.slice(0, 12)} 恢复为草稿？当前正文将被替换。`)) return false
    return action(async () => {
      if (conflict.value) await savePromise?.catch(() => {})
      else await saveDraft()
      const article = await editorApi<Article>(articlePath(current.value!.id) + '/restore', 'POST', { revision, version: current.value!.version })
      setCurrent(article); updateSummary(article)
      await refreshState()
      notice.value = '已恢复为草稿'
    })
  }

  async function reloadNavigation() {
    if (navDirty.value && !window.confirm('载入服务器目录？未保存的目录修改将被替换。')) return
    await action(async () => {
      const data = await editorApi<EditorState>('/state')
      navigation.value = { ...data.navigation, items: cloneTree(data.navigation.items) }
      navBaseline.value = JSON.stringify(data.navigation.items)
      navConflict.value = false; navError.value = ''
    })
  }

  async function refreshCleanArticle() {
    if (!current.value || unsaved.value || saving.value || busy.value) return
    const id = current.value.id, version = current.value.version, captured = fingerprint()
    if (!state.value?.articles.some(item => item.id === id)) return
    const article = await editorApi<Article>(articlePath(id))
    if (current.value?.id === id && current.value.version === version && !unsaved.value && !saving.value && !busy.value && fingerprint() === captured) {
      current.value = article
      Object.assign(draft, toDraft(article))
      baseline.value = fingerprint()
    }
  }

  function schedulePoll(delay = 1600) {
    if (disposed || !admin.value || polling || pollTimer || !jobs.value.some(job => !terminal(job))) return
    pollTimer = setTimeout(() => { pollTimer = undefined; void pollJobs() }, delay)
  }

  async function pollJobs() {
    polling = true
    const active = jobs.value.filter(job => !terminal(job))
    const results = await Promise.allSettled(active.map(job => editorApi<Job>(`/jobs/${encodeURIComponent(job.id)}`)))
    if (disposed || !admin.value) { polling = false; return }
    let finished = false
    pollError.value = ''
    for (const result of results) {
      if (result.status === 'fulfilled') { mergeJob(result.value); finished ||= terminal(result.value) }
      else { pollError.value = errorMessage(result.reason); if (result.reason instanceof EditorError && result.reason.status === 403) denied.value = true }
    }
    if (finished) {
      try { await refreshState(); await refreshCleanArticle() } catch (cause) { pollError.value = errorMessage(cause) }
    }
    polling = false
    schedulePoll(pollError.value ? 5000 : 1600)
  }

  async function preview() {
    if (!current.value) return false
    return action(async () => {
      await saveDraft(); await saveNavigation()
      const job = await editorApi<Job>('/preview', 'POST', { articleId: current.value!.id, version: current.value!.version })
      mergeJob(job); previewJobId.value = job.id; schedulePoll()
    })
  }

  async function publish(message: string) {
    return action(async () => {
      await saveDraft(); await saveNavigation()
      const job = await editorApi<Job>('/publish', 'POST', { navigationVersion: navigation.value.version, ...(message.trim() ? { message: message.trim() } : {}) })
      mergeJob(job); schedulePoll()
      notice.value = '发布任务已提交'
    })
  }

  async function upload(file: File): Promise<Media> {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('支持 PNG、JPEG、WebP 和 GIF 图片')
    if (file.size > 8 * 1024 * 1024) throw new Error('图片不能超过 8 MB')
    uploading.value++
    try {
      const media = await editorApi<Media>('/media', 'POST', file)
      if (state.value) {
        const index = state.value.media.findIndex(item => item.id === media.id)
        if (index < 0) state.value.media.unshift(media)
        else state.value.media[index] = media
      }
      return media
    } finally { uploading.value-- }
  }

  function updateNavigation(items: NavNode[]) { if (!navSaving.value) navigation.value.items = items }
  function beforeUnload(event: BeforeUnloadEvent) {
    if (unsaved.value || navDirty.value || saving.value || navSaving.value || uploading.value) { event.preventDefault(); event.returnValue = '' }
  }
  window.addEventListener('beforeunload', beforeUnload)
  watch(admin, value => { if (!value) { clearTimeout(autosaveTimer); clearTimeout(pollTimer) } })
  onBeforeUnmount(() => {
    disposed = true; clearTimeout(autosaveTimer); clearTimeout(pollTimer)
    window.removeEventListener('beforeunload', beforeUnload)
  })

  return { state, current, draft, loading, busy, saving, uploading, error, saveError, notice, conflict, denied, admin,
    unsaved, navigation, navDirty, navSaving, navConflict, navError, jobs, activePublish, previewJob, previewJobId, pollError,
    load, refreshState, openArticle, explicitSave, explicitSaveNavigation, createArticle, discard, reloadArticle, restore, saveNavigation,
    reloadNavigation, updateNavigation, preview, publish, upload, report }
}
