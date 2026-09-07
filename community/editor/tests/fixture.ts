import type { Page } from '@playwright/test'
import type { Article, EditorState, Job, Navigation } from '../types'

export const originalBody = '# 原有标题\n\n完整正文，保持原样。\n\n```cpp\nint main() {}\n```\n'
const stamp = '2026-09-07T02:00:00Z'
export async function fixture(page: Page, role: number | null = 2) {
  const article: Article = { id: 'a1', title: '入门指南', path: 'guide/start.md', body: originalBody, tags: ['入门'], owners: ['飞扬'], docId: 'doc1', version: 1, dirty: false, published: true, updatedAt: stamp }
  const data: EditorState = {
    user: { id: 'admin', role_id: 2, display_name: '管理员' }, revision: 'r1',
    articles: [{ ...article, status: 'published' }, { ...article, id: 'a2', title: '开发规范', path: 'guide/dev.md', status: 'published' }],
    navigation: { version: 1, dirty: false, items: [{ id: 'root', title: '指南', children: [{ id: 'leaf1', title: '入门指南', path: 'guide/start.md' }, { id: 'leaf2', title: '开发规范', path: 'guide/dev.md' }] }, { id: 'system', title: '登录', path: 'login.md' }] },
    jobs: [], media: [],
  }
  const details = new Map<string, Article>([[article.id, article], ['a2', { ...article, id: 'a2', title: '开发规范', path: 'guide/dev.md' }]])
  const requests: { path: string; method: string; body: any; headers: Record<string, string> }[] = []
  const control = { putDelay: 0, uploadDelay: 0, conflict: false, navConflict: false, stateStatus: 200, jobStatus: 'succeeded' as Job['status'], failPolls: 0, saveRequests: 0 }
  await page.addInitScript(role => {
    if (role === null) sessionStorage.removeItem('feiyang-session-v2')
    else sessionStorage.setItem('feiyang-session-v2', JSON.stringify({ token: 'editor-test-token', user: { id: 'admin', role_id: role } }))
  }, role)
  await page.route('**/_editor/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.slice('/_editor'.length), method = request.method()
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : request.postDataBuffer()
    requests.push({ path, method, body, headers: request.headers() })
    const ok = (value: unknown) => route.fulfill({ status: 200, json: { data: value } })
    const fail = (status: number, message: string) => route.fulfill({ status, json: { error: { message, code: String(status) } } })
    if (path === '/state') return control.stateStatus === 200 ? ok(data) : fail(control.stateStatus, '会话不可用')
    if (path === '/navigation' && method === 'PUT') {
      if (control.navConflict || body.version !== data.navigation.version) return fail(409, '目录已更新')
      data.navigation = { version: body.version + 1, items: body.items, dirty: true } as Navigation
      return ok(data.navigation)
    }
    if (path === '/articles' && method === 'POST') {
      const item = { ...article, id: 'new1', title: body.title, path: body.path || 'new.md', body: `# ${body.title}\n`, published: false, dirty: true, version: 1 }
      details.set(item.id, item); data.articles.push({ ...item, status: 'draft' })
      return ok(item)
    }
    if (path === '/media') {
      if (control.uploadDelay) await new Promise(resolve => setTimeout(resolve, control.uploadDelay))
      const item = { id: 'm1', path: '/images/uploads/hash.webp', url: '/test-image.webp?capability=secret', width: 1, height: 1, name: decodeURIComponent(request.headers()['x-file-name']) }
      data.media.push(item); return ok(item)
    }
    if (path === '/publish' || path === '/preview') {
      const job: Job = { id: `job${data.jobs.length + 1}`, kind: path === '/publish' ? 'publish' : 'preview', status: 'queued', createdAt: stamp }
      data.jobs.unshift(job); return ok(job)
    }
    if (path.startsWith('/jobs/')) {
      if (control.failPolls > 0) { control.failPolls--; return fail(503, '任务暂时不可用') }
      const job = data.jobs.find(item => item.id === path.split('/')[2])!
      job.status = control.jobStatus
      if (job.status === 'succeeded') { job.url = '/test-preview?capability=secret'; job.finishedAt = stamp }
      if (job.status === 'failed') job.error = '构建失败：无效的目录引用'
      return ok(job)
    }
    const match = /^\/articles\/([^/]+)(.*)$/.exec(path)
    if (match) {
      const item = details.get(match[1])!, rest = match[2]
      if (!rest && method === 'GET') return ok(item)
      if (!rest && method === 'PUT') {
        control.saveRequests++
        if (control.putDelay) await new Promise(resolve => setTimeout(resolve, control.putDelay))
        if (control.conflict || body.version !== item.version) return fail(409, '文章已被更新')
        const oldTitle = item.title
        const canonicalBody = body.body.replace(/^# (.+)$/m, (heading: string, title: string) => title === oldTitle ? '# ' + body.title : heading)
        Object.assign(item, body, { body: canonicalBody, version: item.version + 1, dirty: true })
        if (oldTitle !== item.title) {
          data.navigation.version++; data.navigation.dirty = true
          const visit = (items: Navigation['items']) => items.forEach(node => { if (node.path === item.path) node.title = item.title; if (node.children) visit(node.children) })
          visit(data.navigation.items)
        }
        data.articles = data.articles.map(row => row.id === item.id ? { ...item, status: 'draft' } : row)
        return ok(item)
      }
      if (rest === '/discard') { item.body = originalBody; item.dirty = false; item.version++; return ok({ discarded: true }) }
      if (rest === '/history') return ok([{ revision: 'old-revision', author: '维护者', date: stamp, message: '最初版本' }])
      if (rest.startsWith('/versions/')) return ok({ title: '历史标题', body: '# 历史正文\n', tags: [], owners: [], revision: 'old-revision' })
      if (rest === '/restore') {
        Object.assign(item, { title: '历史标题', body: '# 历史正文\n', version: item.version + 1, dirty: true })
        return ok(item)
      }
    }
    return fail(404, `Unknown test route: ${method} ${path}`)
  })
  await page.route('**/test-preview?*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><h1>入门指南</h1><p>静态预览</p><script>window.parent.__previewScriptRan = true</script></body></html>' }))
  await page.route('**/test-image.webp?*', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }))
  await page.goto('/community/editor/tests/index.html')
  return { data, details, requests, control }
}
