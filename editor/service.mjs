import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, realpath, stat, rm } from 'node:fs/promises'
import { resolve, dirname, extname, sep } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { ulid } from 'ulid'
import sharp from 'sharp'
import YAML from 'yaml'
import { load } from 'cheerio'
import { EditorStore } from './store.mjs'
import { createPublisher } from './publisher.mjs'
import { createTickets, checkOrigin, answerAdministrator } from './security.mjs'
import { digest, fail, editableDocumentPath, parseArticle, serializeArticle, validateArticle, updateHeading, readRepository, validateNavigation, findNode, visitNavigation, referencedMedia } from './content.mjs'

const now = () => new Date().toISOString()
const activeStatuses = new Set(['queued', 'building', 'committing', 'publishing'])
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

export async function createEditor(options) {
  const dataDir = resolve(options.dataDir), workDir = resolve(options.workDir || dataDir, 'workspaces')
  await mkdir(dataDir, { recursive: true, mode: 0o700 }); await mkdir(workDir, { recursive: true, mode: 0o700 })
  const store = new EditorStore(resolve(dataDir, 'editor.db'))
  const secretPath = resolve(dataDir, 'ticket.key')
  let secret
  try { secret = await readFile(secretPath) } catch (error) { if (error.code !== 'ENOENT') throw error; secret = randomBytes(32); await writeFile(secretPath, secret, { mode: 0o600, flag: 'wx' }) }
  const tickets = createTickets(secret), tokens = new Map()
  let queue = Promise.resolve(), busyJob = '', lastSync = 0, refreshing = null
  const onProgress = async (id, status, extra = {}) => {
    const job = store.get('job', id)
    if (job) store.put('job', id, { ...job, ...extra, status, updatedAt: now() })
  }
  async function syncTags(snapshot) {
    const authorization = tokens.get(snapshot.id)
    if (!authorization) fail('发布会话已结束，请重新发布', 401)
    for (const file of snapshot.files.filter(file => file.path.endsWith('.md') && file.content !== null)) {
      const article = parseArticle(file.content, file.path)
      if (!article.docId) continue
      const slug = 'doc-' + article.docId
      const headers = { Authorization: authorization, 'Content-Type': 'application/json' }
      const existing = await fetch(options.answerOrigin + '/answer/api/v1/tags?tags=' + encodeURIComponent(slug), { headers, signal: AbortSignal.timeout(10000) })
      const result = await existing.json()
      if (!existing.ok || result.code !== 200) throw new Error('文章问答标签读取失败')
      if (result.data?.some(tag => tag.slug_name === slug)) continue
      const response = await fetch(options.answerOrigin + '/answer/api/v1/tag', { method: 'POST', headers, body: JSON.stringify({ slug_name: slug, display_name: article.title.slice(0, 35), original_text: '关联文章：/' + file.path.slice(5).replace(/\.md$/, '').replace(/index$/, '') }), signal: AbortSignal.timeout(10000) })
      if (!response.ok || (await response.json()).code !== 200) throw new Error('文章问答标签创建失败')
    }
  }
  const publisher = options.publisher || createPublisher({ repoDir: options.repoDir, workDir, siteDir: options.siteDir, python: options.python, depsDir: options.depsDir, gitSshCommand: options.gitSshCommand, onProgress, syncTags })
  const touch = () => store.put('config', 'revision', (store.get('config', 'revision') || 0) + 1)
  function detail(record) {
    const value = record.draft || parseArticle(record.publishedRaw, record.path)
    return { id: record.id, path: record.path, title: value.title, body: value.body, tags: value.tags, owners: value.owners, docId: record.docId, version: record.version, dirty: Boolean(record.draft), published: Boolean(record.publishedRaw), status: record.draft ? 'draft' : 'published', updatedAt: record.updatedAt, conflict: Boolean(record.draft && record.draft.baseHash !== digest(record.publishedRaw || '')) }
  }
  function article(id) { const value = store.get('article', id); if (!value) fail('文章不存在', 404); return value }
  function checkVersion(record, version) { if (!Number.isInteger(version) || record.version !== version) fail('内容已有更新，请重新载入后编辑', 409, 'conflict') }
  function navigation() { const value = store.get('config', 'navigation'); return { version: value.version, items: value.items, dirty: value.dirty, conflict: Boolean(value.conflict), ...(value.conflict ? { publishedItems: value.publishedItems } : {}) } }
  function knownPaths() { return new Set([...(store.get('config', 'paths') || []), ...store.list('article').map(item => item.path)]) }
  async function refresh(force = false) {
    if (busyJob || (!force && Date.now() - lastSync < 15000)) return
    if (refreshing) return refreshing
    refreshing = (async () => {
      await publisher.sync()
      const head = await publisher.head()
      if (store.get('config', 'head') !== head) {
        const source = await readRepository(options.repoDir)
        store.transaction(() => {
          const existing = store.list('article'), present = new Set()
          for (const incoming of source.articles) {
            present.add(incoming.id)
            const old = store.get('article', incoming.id)
            if (old && old.publishedRaw === incoming.raw) continue
            store.put('article', incoming.id, { id: incoming.id, path: incoming.path, docId: incoming.docId, publishedRaw: incoming.raw, draft: old?.draft || null, version: (old?.version || 0) + 1, updatedAt: now() })
          }
          for (const old of existing) if (old.publishedRaw && !present.has(old.id)) {
            if (old.draft) store.put('article', old.id, { ...old, publishedRaw: null, version: old.version + 1 })
            else store.remove('article', old.id)
          }
          const nav = store.get('config', 'navigation')
          const navChanged = nav && JSON.stringify(nav.publishedItems) !== JSON.stringify(source.items)
          store.put('config', 'navigation', nav?.dirty ? { ...nav, publishedItems: source.items, conflict: Boolean(nav.conflict || navChanged), version: nav.version + (navChanged ? 1 : 0) } : { items: source.items, publishedItems: source.items, version: (nav?.version || 0) + 1, dirty: false })
          store.put('config', 'paths', [...source.paths])
          const required = []
          visitNavigation(source.items, node => { if (source.protectedPaths.has(node.path)) required.push(node.path) })
          store.put('config', 'requiredPaths', required)
          store.put('config', 'head', head); touch()
        })
      }
      lastSync = Date.now()
    })().finally(() => { refreshing = null })
    return refreshing
  }
  for (const job of store.list('job')) if (activeStatuses.has(job.status)) store.put('job', job.id, { ...job, status: 'failed', error: '服务重启，请重新执行任务', finishedAt: now() })
  try { await refresh(true) } catch (error) { store.close(); throw error }
  function jobView(job) { return { id: job.id, kind: job.kind, status: job.status, message: job.message, error: job.error, url: job.url, commit: job.commit, createdAt: job.createdAt, finishedAt: job.finishedAt } }
  function mediaView(value) { return { id: value.id, path: value.path, width: value.width, height: value.height, name: value.name, url: `/_editor/media/${value.id}?ticket=${tickets.issue('media', value.id)}` } }
  function snapshot(input, user, kind) {
    if (input.articleIds !== undefined && (!Array.isArray(input.articleIds) || input.articleIds.some(id => typeof id !== 'string') || new Set(input.articleIds).size !== input.articleIds.length)) fail('文章选择格式有误')
    if (kind === 'preview' && typeof input.articleId !== 'string') fail('请选择预览文章')
    const nav = store.get('config', 'navigation'), records = kind === 'preview' ? [article(input.articleId)] : input.articleIds ? input.articleIds.map(article) : store.list('article').filter(item => item.draft)
    if (kind === 'publish' && nav.conflict) fail('源目录已有更新，请处理目录冲突后发布', 409, 'conflict')
    if (kind === 'preview') checkVersion(records[0], input.version)
    if (input.navigationVersion !== undefined) checkVersion(nav, input.navigationVersion)
    if (records.length > 200) fail('一次最多发布 200 篇文章')
    if (kind === 'publish' && !records.some(record => record.draft) && !nav.dirty) fail('暂无待发布的修改')
    const files = [], versions = {}, referenced = new Set()
    for (const record of records) {
      if (record.draft?.baseHash !== undefined && record.draft.baseHash !== digest(record.publishedRaw || '')) fail('文章源文件已有更新，请重新载入：' + record.path, 409, 'conflict')
      const raw = record.draft ? serializeArticle(record, record.draft) : record.publishedRaw
      if (record.draft || kind === 'preview') { files.push({ path: 'docs/' + record.path, content: raw }); versions[record.id] = record.version }
      for (const path of referencedMedia(parseArticle(raw, record.path).body)) referenced.add(path)
    }
    let navItems = structuredClone(nav.items)
    const selected = new Set(records.map(record => record.id))
    for (const record of store.list('article')) if (record.draft && record.publishedRaw && !selected.has(record.id)) {
      const publishedTitle = parseArticle(record.publishedRaw, record.path).title
      visitNavigation(navItems, node => { if (node.path === record.path) node.title = publishedTitle })
    }
    const includedPaths = new Set([...store.list('article').filter(record => record.publishedRaw).map(record => record.path), ...records.map(record => record.path), ...(store.get('config', 'paths') || [])])
    function prune(nodes) { return nodes.filter(node => node.children || includedPaths.has(node.path)).map(node => node.children ? { ...node, children: prune(node.children) } : node) }
    navItems = prune(navItems)
    if (nav.dirty || kind === 'preview') files.push({ path: 'navigation.yml', content: YAML.stringify({ version: 1, items: navItems }) })
    const media = store.list('media').filter(value => referenced.has('docs' + value.path)).map(value => ({ path: 'docs' + value.path, source: value.source }))
    return { id: randomUUID(), kind, baseCommit: store.get('config', 'head'), actor: user, targetPath: kind === 'preview' ? 'docs/' + records[0].path : undefined, files, media, versions, navVersion: nav.version, navItems, message: String(input.message || '').slice(0, 200) }
  }
  function enqueue(value, authorization) {
    tokens.set(value.id, authorization)
    const job = { id: value.id, kind: value.kind, status: 'queued', createdAt: now(), snapshot: value }
    store.put('job', value.id, job)
    queue = queue.then(async () => {
      busyJob = value.id
      try {
        await onProgress(value.id, 'building')
        const result = await publisher.execute(value)
        let url
        if (value.kind === 'preview') {
          const route = value.targetPath.slice(5).replace(/\.md$/, '').replace(/index$/, '').replace(/\/$/, '')
          url = `/_editor/preview/${tickets.issue('preview', value.id)}/${route}/`
        } else {
          store.transaction(() => {
            for (const [id, version] of Object.entries(value.versions)) {
              const record = store.get('article', id)
              if (!record) continue
              const raw = value.files.find(file => file.path === 'docs/' + record.path)?.content
              if (!raw) continue
              record.publishedRaw = raw
              if (record.version === version) record.draft = null
              else if (record.draft) record.draft.baseHash = digest(raw)
              record.version++; record.updatedAt = now(); store.put('article', id, record)
            }
            const nav = store.get('config', 'navigation')
            nav.publishedItems = value.navItems
            nav.dirty = JSON.stringify(nav.items) !== JSON.stringify(value.navItems)
            store.put('config', 'navigation', nav)
            if (result.commit) store.put('config', 'head', result.commit)
            store.put('config', 'paths', [...new Set([...(store.get('config', 'paths') || []), ...store.list('article').filter(record => record.publishedRaw).map(record => record.path)])])
            touch()
          })
          url = options.publicOrigin + '/'
          lastSync = 0
        }
        store.put('job', value.id, { ...store.get('job', value.id), result, commit: result.commit, status: 'succeeded', url, finishedAt: now() })
        if (value.kind === 'preview') {
          const previews = store.list('job').filter(job => job.kind === 'preview' && job.result?.previewDir).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          for (const expired of previews.slice(20)) {
            const path = resolve(expired.result.previewDir), expected = resolve(workDir, 'previews', expired.id)
            if (path === expected) await rm(path, { recursive: true, force: true })
            expired.result = {}; expired.url = undefined; store.put('job', expired.id, expired)
          }
        }
      } catch (error) {
        if (error.pushed && error.commit) store.put('config', 'head', error.commit)
        store.put('job', value.id, { ...store.get('job', value.id), status: 'failed', error: String(error.message || '任务失败').slice(0, 1200), finishedAt: now() })
      } finally { tokens.delete(value.id); busyJob = '' }
    })
    return jobView(job)
  }
  async function readBody(req, limit = 512000) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > limit) fail('文件或请求过大', 413); chunks.push(chunk) } return Buffer.concat(chunks) }
  async function jsonBody(req) {
    if (!String(req.headers['content-type']).startsWith('application/json')) fail('请使用 JSON 请求', 415)
    try { const value = JSON.parse((await readBody(req)).toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) fail('请求格式有误'); return value }
    catch (error) { if (error.status) throw error; fail('请求格式有误') }
  }
  async function serveFile(res, path, preview) {
    const info = await stat(path)
    if (!info.isFile() || info.size > 12 * 1024 * 1024) fail('文件不存在', 404)
    let body = await readFile(path)
    const type = mime[extname(path)] || 'application/octet-stream'
    if (preview && type.startsWith('text/html')) {
      const $ = load(body.toString())
      $('script,iframe,object,embed,form,base,meta[http-equiv="refresh"]').remove()
      $('*').each((_, element) => {
        for (const attribute of Object.keys(element.attribs || {})) {
          if (/^on/i.test(attribute)) $(element).removeAttr(attribute)
          if (['src', 'href', 'poster'].includes(attribute)) {
            const value = $(element).attr(attribute)
            if (!value || value.startsWith('#') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) continue
            const target = new URL(value, 'https://preview.invalid/' + preview.relative)
            $(element).attr(attribute, preview.prefix + target.pathname + target.search + target.hash)
          }
        }
      })
      body = Buffer.from($.html())
    }
    res.setHeader('Content-Type', type)
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'")
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(body)
  }
  const handler = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff')
    const respond = (data, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ data })) }
    try {
      const url = new URL(req.url, options.publicOrigin)
      if (url.pathname === '/health') return respond({ ready: true })
      let match
      if (req.method === 'GET' && (match = /^\/_editor\/preview\/([A-Za-z0-9._-]+)\/(.*)$/.exec(url.pathname))) {
        const payload = tickets.verify(match[1], 'preview'), job = store.get('job', payload.id)
        if (!job || job.status !== 'succeeded' || !job.result?.previewDir) fail('预览已失效，请重新生成', 404)
        const relative = decodeURIComponent(match[2])
        if (relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => part === '..' || part.startsWith('.'))) fail('文件路径有误')
        const root = await realpath(job.result.previewDir)
        const file = await realpath(resolve(root, relative.endsWith('/') || !relative ? relative + 'index.html' : relative))
        if (!file.startsWith(root + sep)) fail('文件路径有误', 403)
        return await serveFile(res, file, { prefix: '/_editor/preview/' + match[1], relative: relative || 'index.html' })
      }
      if (req.method === 'GET' && (match = /^\/_editor\/media\/([a-f0-9]{64})$/.exec(url.pathname))) {
        tickets.verify(url.searchParams.get('ticket'), 'media', match[1])
        const media = store.get('media', match[1]); if (!media) fail('图片不存在', 404)
        return await serveFile(res, media.source)
      }
      if (!url.pathname.startsWith('/_editor/')) fail('接口不存在', 404)
      checkOrigin(req, options.publicOrigin)
      const { user, authorization } = options.authenticate ? await options.authenticate(req) : await answerAdministrator(req, options.answerOrigin)
      const path = url.pathname.slice('/_editor'.length)
      if (req.method === 'GET' && path === '/state') {
        await refresh()
        return respond({ user, revision: store.get('config', 'revision'), articles: store.list('article').map(record => { const { body, tags, owners, ...summary } = detail(record); return summary }), navigation: navigation(), jobs: store.list('job').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30).map(jobView), media: store.list('media').map(mediaView) })
      }
      if (req.method === 'GET' && (match = /^\/jobs\/([a-zA-Z0-9-]+)$/.exec(path))) { const job = store.get('job', match[1]); if (!job) fail('任务不存在', 404); return respond(jobView(job)) }
      if (req.method === 'GET' && (match = /^\/articles\/([a-zA-Z0-9-]+)$/.exec(path))) return respond(detail(article(match[1])))
      if (req.method === 'GET' && (match = /^\/articles\/([a-zA-Z0-9-]+)\/history$/.exec(path))) { await refresh(true); return respond(await publisher.history('docs/' + article(match[1]).path)) }
      if (req.method === 'GET' && (match = /^\/articles\/([a-zA-Z0-9-]+)\/versions\/([a-f0-9]{40,64})$/.exec(path))) {
        const record = article(match[1]), raw = await publisher.version('docs/' + record.path, match[2])
        const { title, body, tags, owners } = parseArticle(raw, record.path)
        return respond({ title, body, tags, owners, revision: match[2] })
      }
      if (req.method === 'POST' && path === '/media') {
        if (store.list('media').reduce((bytes, item) => bytes + item.bytes, 0) > 1024 * 1024 * 1024) fail('图片库已达容量上限，请联系维护者整理', 413)
        if (!/^image\/(png|jpeg|webp|gif)$/.test(String(req.headers['content-type']))) fail('支持 PNG、JPEG、WebP 和 GIF 图片', 415)
        const input = await readBody(req, 8 * 1024 * 1024)
        let output, info
        try { const image = sharp(input, { limitInputPixels: 32000000 }); const metadata = await image.metadata(); if (!['png', 'jpeg', 'webp', 'gif'].includes(metadata.format)) fail('图片格式有误'); ({ data: output, info } = await image.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer({ resolveWithObject: true })) }
        catch { fail('图片无法读取或尺寸过大') }
        const id = digest(output), directory = resolve(dataDir, 'media'); await mkdir(directory, { recursive: true, mode: 0o700 })
        const source = resolve(directory, id + '.webp'); await writeFile(source, output, { mode: 0o600 })
        const media = { id, source, path: '/images/uploads/' + id + '.webp', width: info.width, height: info.height, name: decodeURIComponent(String(req.headers['x-file-name'] || 'image')).slice(0, 160), bytes: output.length, createdAt: now() }
        store.put('media', id, media); return respond(mediaView(media), 201)
      }
      if (req.method === 'GET' || req.method === 'HEAD') fail('接口不存在', 404)
      const input = await jsonBody(req)
      if (req.method === 'POST' && path === '/articles') {
        const title = String(input.title || '').trim(), id = ulid().toLowerCase(), file = editableDocumentPath(input.path || 'articles/' + id + '.md')
        if (knownPaths().has(file)) fail('文章路径已存在', 409)
        const value = { title, body: '# ' + title + '\n\n', tags: [], owners: [user.username], baseHash: digest('') }; validateArticle(value)
        const nav = store.get('config', 'navigation'), section = input.sectionId ? findNode(nav.items, input.sectionId) : nav.items.find(node => node.children)
        if (!section?.children) fail('请选择有效板块')
        const record = { id, docId: id, path: file, version: 1, publishedRaw: null, draft: value, updatedAt: now() }
        store.transaction(() => { store.put('article', id, record); section.children.push({ id: 'page-' + digest(file).slice(0, 20), title, path: file }); nav.version++; nav.dirty = true; store.put('config', 'navigation', nav); touch() })
        return respond(detail(record), 201)
      }
      if (req.method === 'PUT' && (match = /^\/articles\/([a-zA-Z0-9-]+)$/.exec(path))) {
        const record = article(match[1]); checkVersion(record, input.version); validateArticle(input)
        const old = detail(record)
        if (old.conflict) fail('源文章已有更新，请先处理版本冲突', 409, 'conflict')
        const draft = { title: input.title.trim(), body: updateHeading(input.body, old.title, input.title.trim()), tags: input.tags, owners: input.owners, baseHash: digest(record.publishedRaw || ''), sourceRaw: record.draft?.sourceRaw }
        validateArticle(draft)
        if (record.docId && !draft.owners.length) fail('请填写文章负责人')
        store.transaction(() => {
          record.draft = draft; record.version++; record.updatedAt = now(); store.put('article', record.id, record)
          if (old.title !== draft.title) { const nav = store.get('config', 'navigation'); visitNavigation(nav.items, node => { if (node.path === record.path) node.title = draft.title }); nav.version++; nav.dirty = true; store.put('config', 'navigation', nav) }
          touch()
        })
        return respond(detail(record))
      }
      if (req.method === 'POST' && (match = /^\/articles\/([a-zA-Z0-9-]+)\/discard$/.exec(path))) {
        const record = article(match[1]); checkVersion(record, input.version)
        if (store.list('job').some(job => activeStatuses.has(job.status) && job.snapshot.versions[record.id])) fail('该文章正在处理，请等待任务完成', 409)
        store.transaction(() => {
          const nav = store.get('config', 'navigation')
          if (record.publishedRaw) { record.draft = null; record.version++; store.put('article', record.id, record); visitNavigation(nav.items, node => { if (node.path === record.path) node.title = parseArticle(record.publishedRaw, record.path).title }) }
          else { store.remove('article', record.id); function prune(items) { return items.filter(node => node.path !== record.path).map(node => node.children ? { ...node, children: prune(node.children) } : node) }; nav.items = prune(nav.items) }
          nav.version++; nav.dirty = JSON.stringify(nav.items) !== JSON.stringify(nav.publishedItems); store.put('config', 'navigation', nav); touch()
        })
        return respond({ discarded: true })
      }
      if (req.method === 'POST' && (match = /^\/articles\/([a-zA-Z0-9-]+)\/restore$/.exec(path))) {
        const record = article(match[1]); checkVersion(record, input.version)
        const raw = await publisher.version('docs/' + record.path, input.revision), parsed = parseArticle(raw, record.path)
        checkVersion(article(record.id), input.version)
        validateArticle(parsed)
        record.draft = { title: parsed.title, body: parsed.body, tags: parsed.tags, owners: parsed.owners, baseHash: digest(record.publishedRaw || ''), sourceRaw: raw }; record.version++; record.updatedAt = now()
        store.transaction(() => { store.put('article', record.id, record); const nav = store.get('config', 'navigation'); visitNavigation(nav.items, node => { if (node.path === record.path) node.title = parsed.title }); nav.version++; nav.dirty = true; store.put('config', 'navigation', nav); touch() })
        return respond(detail(record))
      }
      if (req.method === 'PUT' && path === '/navigation') {
        const nav = store.get('config', 'navigation'); checkVersion(nav, input.version)
        const items = validateNavigation(input.items, knownPaths(), new Set(store.get('config', 'requiredPaths')))
        store.put('config', 'navigation', { ...nav, items, version: nav.version + 1, dirty: JSON.stringify(items) !== JSON.stringify(nav.publishedItems), conflict: false }); touch()
        return respond(navigation())
      }
      if (req.method === 'POST' && ['/preview', '/publish'].includes(path)) {
        if (store.list('job').filter(job => activeStatuses.has(job.status)).length >= 5) fail('任务队列已满，请稍后提交', 429)
        await refresh()
        return respond(enqueue(snapshot(input, user, path === '/preview' ? 'preview' : 'publish'), authorization), 202)
      }
      fail('接口不存在', 404)
    } catch (error) {
      if (res.writableEnded) return
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500)
      res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: { code: error.code || 'error', message: status === 500 ? '内容服务发生错误，请稍后重试' : error.message } }))
      if (status === 500) console.error('Editor request error:', error.message)
    }
  }
  return { handler, store, publisher, refresh, idle: () => queue, close: async () => { await queue; store.close() } }
}

export async function listenEditor(options) {
  const editor = await createEditor(options), server = createServer(editor.handler)
  await new Promise(resolve => server.listen(options.port || 0, '127.0.0.1', resolve))
  return { ...editor, server, port: server.address().port, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await editor.close() } }
}
