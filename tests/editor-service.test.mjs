import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import sharp from 'sharp'
import YAML from 'yaml'
import { createEditor, listenEditor } from '../editor/service.mjs'
import { createTickets } from '../editor/security.mjs'

const run = promisify(execFile)
const publicOrigin = 'https://wiki.example.invalid'
const administrator = { id: '42', username: 'editor-test', display_name: 'Test Editor', role_id: 2 }
const guideId = 'guide-article'
const original = Buffer.from('---\n# Keep this comment and quoting\ntitle: "Original guide"\ndoc_id: guide-article\nowners: [maintainer]\ntags: [reference]\ncustom: {enabled: true}\n---\n# Original guide\n\nOriginal bytes: \u4e2d\u6587.  \n\n')
const windowsOriginal = Buffer.from('\ufeff' + original.toString().replaceAll('\n', '\r\n'))
const historical = Buffer.from('---\ntitle: Historical guide\ndoc_id: guide-article\nowners: [first-author]\ntags: [archive]\n---\n# Historical guide\n\nAn earlier revision.\n')
const plain = Buffer.from('# Plain page\r\n\r\nNo front matter or final newline.  ')
const initialNavigation = [
  { id: 'home', title: 'Home', path: 'index.md' },
  { id: 'questions', title: 'Questions', path: 'questions.md' },
  { id: 'login', title: 'Login', path: 'login.md' },
  { id: 'reset', title: 'Reset password', path: 'users/password-reset.md' },
  { id: 'guides', title: 'Guides', children: [
    { id: 'guide-link', title: 'Original guide', path: 'guides/guide.md' },
    { id: 'plain-link', title: 'Plain page', path: 'plain.md' },
  ] },
]

async function put(path, bytes) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}

async function tree(root) {
  const result = {}
  async function visit(directory, prefix = '') {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue
      const name = prefix + entry.name
      if (entry.isDirectory()) await visit(join(directory, entry.name), name + '/')
      else result[name] = (await readFile(join(directory, entry.name))).toString('base64')
    }
  }
  await visit(root)
  return result
}

async function fixture(t, articleBytes = original) {
  const root = await mkdtemp(join(tmpdir(), 'wiki-editor-service-test-'))
  const repoDir = join(root, 'repo'), dataDir = join(root, 'private'), siteDir = join(root, 'public')
  const editors = new Set(), cleanup = []
  t.after(async () => {
    for (const release of cleanup) await release()
    for (const editor of editors) await editor.close()
    const part = relative(resolve(tmpdir()), root)
    assert.ok(part.startsWith('wiki-editor-service-test-') && !part.includes(sep) && !isAbsolute(part))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)))
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'no-global-config'), GIT_TERMINAL_PROMPT: '0' })
  const git = async (...args) => (await run('git', [
    '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'commit.gpgSign=false',
    '-c', 'gc.auto=0', '-c', `core.hooksPath=${join(root, 'no-hooks')}`,
    '-c', 'user.name=Editor Test', '-c', 'user.email=editor@example.invalid', ...args,
  ], { cwd: repoDir, env, windowsHide: true, encoding: 'utf8' })).stdout
  await mkdir(repoDir)
  await git('init', '--initial-branch=main')
  await put(join(repoDir, 'docs', 'guides', 'guide.md'), historical)
  await put(join(repoDir, 'docs', 'plain.md'), plain)
  await put(join(repoDir, 'docs', 'index.md'), '# Home\n')
  await put(join(repoDir, 'docs', 'questions.md'), '<div data-wiki-component="questions"></div>\n')
  await put(join(repoDir, 'docs', 'login.md'), '<div data-wiki-component="login"></div>\n')
  await put(join(repoDir, 'docs', 'users', 'password-reset.md'), '# Password reset\n')
  await put(join(repoDir, 'navigation.yml'), YAML.stringify({ version: 1, items: initialNavigation }))
  await git('add', '.')
  await git('commit', '-m', 'Historical fixture')
  const oldCommit = (await git('rev-parse', 'HEAD')).trim()
  await put(join(repoDir, 'docs', 'guides', 'guide.md'), articleBytes)
  await git('add', '.')
  await git('commit', '-m', 'Current fixture')
  const head = (await git('rev-parse', 'HEAD')).trim()
  await put(join(siteDir, 'index.html'), '<html><body>Existing public site</body></html>')
  const beforeRepo = await tree(repoDir), beforePublic = await tree(siteDir)
  const executions = [], versionCalls = [], historyCalls = []
  const publisher = {
    sync: async () => {},
    head: async () => (await git('rev-parse', 'HEAD')).trim(),
    history: async path => {
      historyCalls.push(path)
      return (await git('log', '--format=%H', '--', path)).trim().split('\n').map(revision => ({ revision }))
    },
    version: async (path, revision) => {
      versionCalls.push({ path, revision })
      assert.match(revision, /^[a-f0-9]{40}$/)
      return git('show', `${revision}:${path}`)
    },
    execute: async snapshot => {
      executions.push(snapshot)
      if (snapshot.kind === 'publish') return { commit: head }
      const previewDir = join(dataDir, 'previews', snapshot.id)
      await put(join(previewDir, 'guides', 'guide', 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="../../assets/site.css"></head><body><h1>Private preview</h1><script>window.bad=true</script><form><input></form><a onclick="bad()" href="../../plain/">Plain</a><img src="../../assets/pixel.webp"></body></html>')
      await put(join(previewDir, 'assets', 'site.css'), 'body { color: green; }')
      return { previewDir }
    },
  }
  const options = { repoDir, dataDir, siteDir, publicOrigin, publisher,
    authenticate: async () => ({ user: administrator, authorization: 'Bearer test-admin-token' }) }
  async function start(overrides = {}, listen = true) {
    const editor = await (listen ? listenEditor : createEditor)({ ...options, ...overrides })
    editors.add(editor)
    return editor
  }
  async function stop(editor) { await editor.close(); editors.delete(editor) }
  async function unchanged() {
    assert.deepEqual(await tree(repoDir), beforeRepo, 'repository files must remain byte-identical')
    assert.deepEqual(await tree(siteDir), beforePublic, 'public output must remain byte-identical')
    assert.equal((await git('rev-parse', 'HEAD')).trim(), head)
    assert.equal((await git('status', '--porcelain=v1', '--untracked-files=all')).trim(), '')
  }
  return { root, repoDir, dataDir, siteDir, oldCommit, head, git, publisher, executions, versionCalls, historyCalls, cleanup, start, stop, unchanged }
}

async function request(editor, path, { method = 'GET', json, body, headers = {}, origin = publicOrigin } = {}) {
  const requestHeaders = new Headers(headers)
  if (origin !== null) requestHeaders.set('Origin', origin)
  if (json !== undefined) { requestHeaders.set('Content-Type', 'application/json'); body = JSON.stringify(json) }
  const response = await fetch(`http://127.0.0.1:${editor.port}${path}`, { method, headers: requestHeaders, body, signal: AbortSignal.timeout(5000) })
  const bytes = Buffer.from(await response.arrayBuffer())
  return { status: response.status, headers: response.headers, bytes,
    ...(response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes.toString()) : {}) }
}

async function ok(editor, path, options, status = 200) {
  const response = await request(editor, path, options)
  assert.equal(response.status, status, JSON.stringify(response.error || response.data))
  return response.data
}

async function save(editor, article, changes = {}) {
  return ok(editor, `/_editor/articles/${article.id}`, { method: 'PUT', json: {
    version: article.version, title: article.title, body: article.body, tags: article.tags, owners: article.owners, ...changes,
  } })
}

async function fakeAnswer(t) {
  const calls = []
  const accounts = {
    'Bearer test-admin-token': { ...administrator, status: 'normal', mail_status: 1 },
    'Bearer test-member-token': { ...administrator, role_id: 1, status: 'normal', mail_status: 1 },
    'Bearer test-suspended-token': { ...administrator, status: 'suspended', mail_status: 1 },
    'Bearer test-unverified-token': { ...administrator, status: 'normal', mail_status: 0 },
  }
  const server = createServer((req, res) => {
    calls.push({ path: req.url, method: req.method, headers: req.headers })
    const account = accounts[req.headers.authorization]
    res.setHeader('Content-Type', 'application/json')
    res.statusCode = req.url !== '/answer/api/v1/user/info' ? 404 : account ? 200 : 401
    res.end(JSON.stringify({ code: res.statusCode, data: account || null }))
  })
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolveClosed => server.close(resolveClosed)) })
  return { origin: `http://127.0.0.1:${server.address().port}`, calls }
}

test('import preserves original article bytes and protected pages across restart', async t => {
  const f = await fixture(t, windowsOriginal)
  const editor = await f.start({}, false)
  const records = editor.store.list('article')
  assert.deepEqual(records.map(record => record.path).sort(), ['guides/guide.md', 'plain.md'])
  assert.deepEqual(Buffer.from(records.find(record => record.id === guideId).publishedRaw), windowsOriginal)
  assert.deepEqual(Buffer.from(records.find(record => record.path === 'plain.md').publishedRaw), plain)
  assert.ok(records.every(record => !record.draft))
  assert.deepEqual(editor.store.get('config', 'navigation').items, initialNavigation)
  await f.stop(editor)
  const reopened = await f.start()
  assert.deepEqual(Buffer.from(reopened.store.get('article', guideId).publishedRaw), windowsOriginal)
  assert.equal((await ok(reopened, '/_editor/state')).articles.length, 2)
  await f.unchanged()
})

test('saved and newly created drafts persist privately without changing Git or public files', async t => {
  const f = await fixture(t), editor = await f.start()
  const initial = await ok(editor, `/_editor/articles/${guideId}`)
  const saved = await save(editor, initial, { title: 'Private title', body: '# Private title\n\nPrivate draft body.\n' })
  assert.equal(saved.status, 'draft')
  assert.equal(saved.version, initial.version + 1)
  const created = await ok(editor, '/_editor/articles', { method: 'POST', json: { title: 'Unpublished page', path: 'guides/unpublished.md', sectionId: 'guides' } }, 201)
  assert.equal(created.published, false)
  assert.equal(created.dirty, true)
  assert.match(created.docId, /^[a-z0-9]{26}$/)
  assert.equal(f.executions.length, 0)
  await f.stop(editor)
  const reopened = await f.start()
  assert.equal((await ok(reopened, `/_editor/articles/${guideId}`)).body, saved.body)
  assert.equal((await ok(reopened, `/_editor/articles/${created.id}`)).published, false)
  for (const path of ['/guides/unpublished/', '/docs/guides/unpublished.md', '/editor.db', '/private/editor.db']) {
    assert.equal((await request(reopened, path)).status, 404)
  }
  await f.unchanged()
})

test('stale article and navigation versions cannot overwrite, discard, restore, or preview newer work', async t => {
  const f = await fixture(t), editor = await f.start()
  const initial = await ok(editor, `/_editor/articles/${guideId}`)
  const navigation = (await ok(editor, '/_editor/state')).navigation
  const saved = await save(editor, initial, { title: 'Newer title', body: '# Newer title\n' })
  const attempts = [
    [`/_editor/articles/${guideId}`, 'PUT', { ...initial, body: 'Stale overwrite' }],
    [`/_editor/articles/${guideId}/discard`, 'POST', { version: initial.version }],
    [`/_editor/articles/${guideId}/restore`, 'POST', { version: initial.version, revision: f.oldCommit }],
    ['/_editor/preview', 'POST', { articleId: guideId, version: initial.version }],
    ['/_editor/navigation', 'PUT', navigation],
    ['/_editor/publish', 'POST', { articleIds: [guideId], navigationVersion: navigation.version }],
  ]
  for (const [path, method, json] of attempts) {
    const result = await request(editor, path, { method, json })
    assert.equal(result.status, 409, path)
    assert.equal(result.error.code, 'conflict', path)
  }
  assert.deepEqual(await ok(editor, `/_editor/articles/${guideId}`), saved)
  assert.equal(f.executions.length, 0)
  assert.equal(f.versionCalls.length, 0)
  await f.unchanged()
})

test('source changes preserve drafts and reject publishing a stale base', async t => {
  const f = await fixture(t), editor = await f.start()
  const initial = await ok(editor, `/_editor/articles/${guideId}`)
  const draft = await save(editor, initial, { body: '# Original guide\n\nPrivate work.\n' })
  const upstream = original.toString().replace('Original bytes:', 'Upstream change:')
  await put(join(f.repoDir, 'docs', 'guides', 'guide.md'), upstream)
  await f.git('add', '.')
  await f.git('commit', '-m', 'Concurrent source change')
  await editor.refresh(true)
  const refreshed = await ok(editor, `/_editor/articles/${guideId}`)
  assert.equal(refreshed.body, draft.body)
  assert.equal(refreshed.conflict, true)
  assert.ok(refreshed.version > draft.version)
  for (const path of ['/_editor/publish', '/_editor/preview']) {
    const result = await request(editor, path, { method: 'POST', json: { articleIds: [guideId], articleId: guideId, version: refreshed.version } })
    assert.equal(result.status, 409)
  }
  assert.equal(f.executions.length, 0)
  assert.equal(await readFile(join(f.repoDir, 'docs', 'guides', 'guide.md'), 'utf8'), upstream)
})

test('Answer authentication rejects anonymous, nonadmin, invalid sessions, and forged identity headers', async t => {
  const f = await fixture(t), answer = await fakeAnswer(t)
  const editor = await f.start({ authenticate: undefined, answerOrigin: answer.origin })
  const forged = { 'X-User-Id': '42', 'X-Role-Id': '2', 'X-Answer-Role': 'admin', 'X-Forwarded-User': 'admin', 'X-Authenticated-User': 'admin' }
  for (const [authorization, expected] of [
    [null, 401], ['Bearer short', 401], ['Bearer forged-admin-token', 401],
    ['Bearer test-member-token', 403], ['Bearer test-suspended-token', 403], ['Bearer test-unverified-token', 403],
  ]) {
    const headers = { ...forged, ...(authorization ? { Authorization: authorization } : {}) }
    const requestsBefore = answer.calls.length
    for (const [path, method, json] of [
      ['/_editor/state', 'GET'], [`/_editor/articles/${guideId}`, 'GET'],
      ['/_editor/articles', 'POST', { title: 'Unauthorized', sectionId: 'guides' }],
    ]) assert.equal((await request(editor, path, { method, json, headers })).status, expected, `${authorization}: ${method} ${path}`)
    if (authorization === null || authorization === 'Bearer short') assert.equal(answer.calls.length, requestsBefore)
  }
  const headers = { Authorization: 'Bearer test-admin-token' }
  const response = await request(editor, '/_editor/state', { headers })
  assert.equal(response.status, 200)
  assert.equal(response.data.user.id, administrator.id)
  assert.match(response.headers.get('cache-control'), /private.*no-store/)
  assert.equal(response.data.articles.length, 2)
  assert.ok(answer.calls.every(call => call.path === '/answer/api/v1/user/info' && call.method === 'GET'))
  assert.ok(answer.calls.every(call => !call.headers['x-role-id'] && !call.headers['x-forwarded-user']))
  assert.equal(answer.calls.at(-1).headers.authorization, headers.Authorization)
  assert.equal(editor.store.list('article').some(record => record.draft), false)
  await f.unchanged()
})

test('cross-origin and missing-Origin POST requests fail before authentication or mutation', async t => {
  const f = await fixture(t), answer = await fakeAnswer(t)
  const editor = await f.start({ authenticate: undefined, answerOrigin: answer.origin })
  const headers = { Authorization: 'Bearer test-admin-token' }
  for (const origin of [null, 'null', 'https://attacker.example.invalid', publicOrigin + '.attacker.invalid', 'http://wiki.example.invalid']) {
    assert.equal((await request(editor, '/_editor/articles', { method: 'POST', origin, headers, json: { title: 'Cross origin', sectionId: 'guides' } })).status, 403)
  }
  assert.equal(answer.calls.length, 0)
  await ok(editor, '/_editor/articles', { method: 'POST', headers, json: { title: 'Same origin', sectionId: 'guides' } }, 201)
  assert.equal(answer.calls.length, 1)
  await f.unchanged()
})

test('article creation rejects traversal and ambiguous paths without storing partial records', async t => {
  const f = await fixture(t), editor = await f.start()
  const before = await ok(editor, '/_editor/state')
  for (const path of ['../escape.md', 'guides/../../escape.md', '/escape.md', 'guides\\escape.md', 'guides//escape.md', 'guides/./escape.md', '%2e%2e/escape.md', 'guides/.hidden.md', 'guide.md:stream', 'guides/a\0.md']) {
    const result = await request(editor, '/_editor/articles', { method: 'POST', json: { title: 'Bad path', path, sectionId: 'guides' } })
    assert.equal(result.status, 400, JSON.stringify(path))
  }
  assert.equal((await request(editor, '/_editor/articles', { method: 'POST', json: { title: 'Duplicate', path: 'plain.md', sectionId: 'guides' } })).status, 409)
  assert.deepEqual(await ok(editor, '/_editor/state'), before)
  await f.unchanged()
})

test('image uploads validate real raster bytes, reencode privately, and scope media tickets', async t => {
  const f = await fixture(t), editor = await f.start()
  for (const [type, body, expected] of [
    ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>', 415],
    ['image/png', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>', 400],
    ['image/png', 'this is not an image', 400], ['image/jpeg', Buffer.alloc(0), 400],
  ]) assert.equal((await request(editor, '/_editor/media', { method: 'POST', headers: { 'Content-Type': type }, body })).status, expected)
  assert.equal(editor.store.list('media').length, 0)
  const input = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#27a050' } }).png().toBuffer()
  const media = await ok(editor, '/_editor/media', { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('../../outside.png') }, body: input }, 201)
  assert.match(media.id, /^[a-f0-9]{64}$/)
  assert.equal(media.path, `/images/uploads/${media.id}.webp`)
  assert.deepEqual([media.width, media.height], [3, 2])
  const stored = editor.store.get('media', media.id)
  assert.equal(dirname(stored.source), join(f.dataDir, 'media'))
  assert.equal((await sharp(await readFile(stored.source)).metadata()).format, 'webp')
  const download = await request(editor, media.url, { origin: null })
  assert.equal(download.status, 200)
  assert.equal(download.headers.get('content-type'), 'image/webp')
  assert.deepEqual(download.bytes, await readFile(stored.source))
  const ticket = new URL(media.url, publicOrigin).searchParams.get('ticket')
  assert.equal((await request(editor, `/_editor/media/${'a'.repeat(64)}?ticket=${ticket}`)).status, 403)
  assert.equal((await request(editor, `/_editor/media/${media.id}`)).status, 403)
  assert.equal((await request(editor, `/_editor/preview/${ticket}/guides/guide/`)).status, 403)
  await f.unchanged()
})

test('article validation rejects executable HTML and URL protocols while permitting code examples', async t => {
  const f = await fixture(t), editor = await f.start()
  const initial = await ok(editor, `/_editor/articles/${guideId}`)
  for (const [name, body] of [
    ['script', '<script>alert(1)</script>'],
    ['iframe', '<iframe src="https://example.invalid"></iframe>'],
    ['event attribute', '<img src="/safe.png" onerror="alert(1)">'],
    ['javascript URL', '<a href="javascript:alert(1)">link</a>'],
    ['vbscript URL', '<a href="VbScRiPt:msgbox(1)">link</a>'],
    ['entity-encoded javascript URL', '<a href="&#106;avascript:alert(1)">link</a>'],
    ['tab-normalized javascript URL', '<a href="java&#x09;script:alert(1)">link</a>'],
    ['newline-normalized javascript URL', '<a href="java&#x0a;script:alert(1)">link</a>'],
    ['executable data URL', '<a href="data:text/html,<script>alert(1)</script>">link</a>'],
    ['local file URL', '<a href="file:///private/example.txt">link</a>'],
    ['Markdown javascript URL', '[link](javascript:alert%281%29)'],
    ['Markdown data URL', '[link](data:text/html;base64,PHNjcmlwdD4=)'],
    ['Markdown file URL', '[link](file:///private/example.txt)'],
  ]) await t.test(name, async () => {
    const current = await ok(editor, `/_editor/articles/${guideId}`)
    const result = await request(editor, `/_editor/articles/${guideId}`, { method: 'PUT', json: { ...current, body } })
    assert.equal(result.status, 400, body)
    assert.deepEqual(await ok(editor, `/_editor/articles/${guideId}`), current)
  })
  const body = '# Original guide\n\n```html\n<script>alert(1)</script>\n```\n\n<a href="https://example.invalid/reference">Reference</a>\n'
  const current = await ok(editor, `/_editor/articles/${guideId}`)
  assert.equal((await save(editor, current, { body })).body, body)
  assert.deepEqual(Buffer.from(editor.store.get('article', initial.id).publishedRaw), original)
  await f.unchanged()
})

test('navigation retains system links, accepts valid draft references, and rejects invalid references atomically', async t => {
  const f = await fixture(t), editor = await f.start()
  const created = await ok(editor, '/_editor/articles', { method: 'POST', json: { title: 'New guide', path: 'guides/new.md', sectionId: 'guides' } }, 201)
  let navigation = (await ok(editor, '/_editor/state')).navigation
  for (const path of ['index.md', 'questions.md', 'login.md', 'users/password-reset.md']) {
    const result = await request(editor, '/_editor/navigation', { method: 'PUT', json: { version: navigation.version, items: navigation.items.filter(node => node.path !== path) } })
    assert.equal(result.status, 400, `must retain ${path}`)
  }
  for (const extra of [
    { id: 'missing', title: 'Missing', path: 'missing.md' },
    { id: 'duplicate-path', title: 'Duplicate', path: 'plain.md' },
    { id: 'home', title: 'Duplicate ID', children: [] },
    { id: 'traversal', title: 'Traversal', path: '../outside.md' },
  ]) {
    assert.equal((await request(editor, '/_editor/navigation', { method: 'PUT', json: { version: navigation.version, items: [...navigation.items, extra] } })).status, 400)
    assert.deepEqual((await ok(editor, '/_editor/state')).navigation, navigation)
  }
  const items = structuredClone(navigation.items)
  items.find(node => node.id === 'guides').children.reverse()
  navigation = await ok(editor, '/_editor/navigation', { method: 'PUT', json: { version: navigation.version, items } })
  assert.deepEqual(navigation.items, items)
  assert.equal(items.find(node => node.id === 'guides').children[0].path, created.path)
  assert.deepEqual(items.filter(node => node.path), initialNavigation.filter(node => node.path))
  await f.unchanged()
})

test('history and restore read real Git revisions and create a draft without publishing', async t => {
  const f = await fixture(t), editor = await f.start()
  const current = await ok(editor, `/_editor/articles/${guideId}`)
  const history = await ok(editor, `/_editor/articles/${guideId}/history`)
  assert.deepEqual(history.map(entry => entry.revision), [f.head, f.oldCommit])
  const version = await ok(editor, `/_editor/articles/${guideId}/versions/${f.oldCommit}`)
  const restored = await ok(editor, `/_editor/articles/${guideId}/restore`, { method: 'POST', json: { revision: f.oldCommit, version: current.version } })
  assert.equal(restored.title, 'Historical guide')
  assert.equal(restored.body, version.body)
  assert.deepEqual(restored.tags, ['archive'])
  assert.deepEqual(restored.owners, ['first-author'])
  assert.equal(restored.version, current.version + 1)
  assert.equal(restored.status, 'draft')
  assert.equal(restored.published, true)
  assert.equal(restored.docId, current.docId)
  assert.deepEqual(Buffer.from(editor.store.get('article', guideId).publishedRaw), original)
  assert.deepEqual(f.historyCalls, ['docs/guides/guide.md'])
  assert.deepEqual(f.versionCalls, Array(2).fill({ path: 'docs/guides/guide.md', revision: f.oldCommit }))
  assert.equal(f.executions.length, 0)
  await f.unchanged()
})

test('restore rechecks the version after the asynchronous Git read', async t => {
  const f = await fixture(t), editor = await f.start()
  const current = await ok(editor, `/_editor/articles/${guideId}`)
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  f.cleanup.push(() => release.resolve())
  const readVersion = f.publisher.version
  f.publisher.version = async (...args) => { entered.resolve(); await release.promise; return readVersion(...args) }
  const pending = request(editor, `/_editor/articles/${guideId}/restore`, { method: 'POST', json: { revision: f.oldCommit, version: current.version } })
  await entered.promise
  const saved = await save(editor, current, { body: '# Original guide\n\nConcurrent draft.\n' })
  release.resolve()
  assert.equal((await pending).status, 409)
  assert.deepEqual(await ok(editor, `/_editor/articles/${guideId}`), saved)
  await f.unchanged()
})

test('publishing captures immutable article and navigation versions and preserves later edits', async t => {
  const f = await fixture(t), editor = await f.start()
  const initial = await ok(editor, `/_editor/articles/${guideId}`)
  const first = await save(editor, initial, { title: 'Queued title', body: '# Queued title\n\nQueued body.\n' })
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  f.cleanup.push(() => release.resolve())
  const execute = f.publisher.execute
  let captured
  f.publisher.execute = async snapshot => { captured = snapshot; entered.resolve(); await release.promise; return execute(snapshot) }
  const job = await ok(editor, '/_editor/publish', { method: 'POST', json: { articleIds: [guideId], message: 'Publish captured draft' } }, 202)
  await entered.promise
  const frozen = structuredClone(captured)
  const second = await save(editor, first, { title: 'Later title', body: '# Later title\n\nLater private body.\n' })
  assert.deepEqual(captured, frozen)
  assert.equal(captured.versions[guideId], first.version)
  assert.equal(captured.baseCommit, f.head)
  assert.equal(captured.actor.id, administrator.id)
  assert.match(captured.files.find(file => file.path === 'docs/guides/guide.md').content, /Queued body/)
  assert.doesNotMatch(JSON.stringify(captured), /Later private body|test-admin-token/)
  assert.equal(captured.navItems.find(node => node.id === 'guides').children[0].title, 'Queued title')
  release.resolve()
  await editor.idle()
  assert.equal((await ok(editor, `/_editor/jobs/${job.id}`)).status, 'succeeded')
  const after = await ok(editor, `/_editor/articles/${guideId}`)
  assert.equal(after.body, second.body)
  assert.equal(after.dirty, true)
  assert.equal(after.conflict, false)
  assert.ok(after.version > second.version)
  assert.equal(editor.store.get('article', guideId).publishedRaw, captured.files.find(file => file.path === 'docs/guides/guide.md').content)
  assert.equal((await ok(editor, '/_editor/state')).navigation.items.find(node => node.id === 'guides').children[0].title, 'Later title')
  f.publisher.execute = execute
  const next = await ok(editor, '/_editor/publish', { method: 'POST', json: { articleIds: [guideId] } }, 202)
  await editor.idle()
  assert.equal((await ok(editor, `/_editor/jobs/${next.id}`)).status, 'succeeded')
  assert.equal((await ok(editor, `/_editor/articles/${guideId}`)).dirty, false)
  assert.equal(f.executions[1].versions[guideId], after.version)
  assert.match(f.executions[1].files.find(file => file.path.endsWith('guide.md')).content, /Later private body/)
  await f.unchanged()
})

test('preview tickets limit access to their build, reject traversal and expiry, and serve inert private HTML', async t => {
  const f = await fixture(t), editor = await f.start()
  const current = await ok(editor, `/_editor/articles/${guideId}`)
  const job = await ok(editor, '/_editor/preview', { method: 'POST', json: { articleId: guideId, version: current.version } }, 202)
  await editor.idle()
  const completed = await ok(editor, `/_editor/jobs/${job.id}`)
  assert.equal(completed.status, 'succeeded')
  const prefix = completed.url.slice(0, completed.url.indexOf('/guides/guide/'))
  const response = await request(editor, completed.url, { origin: null })
  assert.equal(response.status, 200)
  assert.match(response.bytes.toString(), /Private preview/)
  assert.doesNotMatch(response.bytes.toString(), /<script|<form|onclick=/i)
  assert.ok(response.bytes.toString().includes(`${prefix}/assets/site.css`))
  assert.match(response.headers.get('content-security-policy'), /script-src 'none'/)
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.match(response.headers.get('cache-control'), /private.*no-store/)
  assert.equal((await request(editor, `${prefix}/assets/site.css`, { origin: null })).status, 200)
  for (const suffix of ['%2e%2e%2fsecret.txt', 'assets/%2e%2e%2f%2e%2e%2fsecret.txt', '.hidden', 'assets%5csecret.txt']) {
    assert.equal((await request(editor, `${prefix}/${suffix}`)).status, 400, suffix)
  }
  const outside = join(f.root, 'outside-preview')
  await put(join(outside, 'secret.txt'), 'Never expose this sibling directory')
  const previewDir = editor.store.get('job', job.id).result.previewDir
  await symlink(outside, join(previewDir, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await request(editor, `${prefix}/escape/secret.txt`)).status, 403)
  const second = await ok(editor, '/_editor/preview', { method: 'POST', json: { articleId: guideId, version: current.version } }, 202)
  await editor.idle()
  await put(join(editor.store.get('job', second.id).result.previewDir, 'second-only.txt'), 'Second preview only')
  assert.equal((await request(editor, `${prefix}/second-only.txt`)).status, 404)
  const signer = createTickets(await readFile(join(f.dataDir, 'ticket.key')))
  for (const ticket of [signer.issue('media', job.id), signer.issue('preview', job.id, -1), signer.issue('preview', job.id) + '.extra']) {
    assert.equal((await request(editor, `/_editor/preview/${ticket}/guides/guide/`)).status, 403)
  }
  const ticket = prefix.split('/').at(-1)
  const tampered = (ticket[0] === 'a' ? 'b' : 'a') + ticket.slice(1)
  assert.equal((await request(editor, `/_editor/preview/${tampered}/guides/guide/`)).status, 403)
  assert.deepEqual(await ok(editor, `/_editor/articles/${guideId}`), current)
  await f.unchanged()
})

test('publishing new drafts separately retains navigation changes for the remaining draft', async t => {
  const f = await fixture(t), editor = await f.start()
  const drafts = []
  for (const name of ['first', 'second']) {
    drafts.push(await ok(editor, '/_editor/articles', { method: 'POST', json: { title: name, path: `guides/${name}.md`, sectionId: 'guides' } }, 201))
  }
  for (const draft of drafts) {
    const job = await ok(editor, '/_editor/publish', { method: 'POST', json: { articleIds: [draft.id] } }, 202)
    await editor.idle()
    assert.equal((await ok(editor, `/_editor/jobs/${job.id}`)).status, 'succeeded')
  }
  const firstNavigation = YAML.parse(f.executions[0].files.find(file => file.path === 'navigation.yml').content)
  const firstPaths = firstNavigation.items.find(node => node.id === 'guides').children.map(node => node.path)
  assert.ok(firstPaths.includes(drafts[0].path))
  assert.ok(!firstPaths.includes(drafts[1].path), 'the first publication must not link to an unpublished draft')
  const secondFile = f.executions[1].files.find(file => file.path === 'navigation.yml')
  assert.ok(secondFile, 'the remaining draft still needs its navigation link published')
  const secondPaths = YAML.parse(secondFile.content).items.find(node => node.id === 'guides').children.map(node => node.path)
  assert.ok(secondPaths.includes(drafts[0].path))
  assert.ok(secondPaths.includes(drafts[1].path))
  await f.unchanged()
})

test('tickets enforce type, object identity, signature, and expiration', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1700000000000 })
  const tickets = createTickets(Buffer.alloc(32, 7))
  const ticket = tickets.issue('preview', 'job-a', 1000)
  assert.equal(tickets.verify(ticket, 'preview', 'job-a').id, 'job-a')
  const forbidden = error => error.status === 403
  assert.throws(() => tickets.verify(ticket, 'media', 'job-a'), forbidden)
  assert.throws(() => tickets.verify(ticket, 'preview', 'job-b'), forbidden)
  assert.throws(() => createTickets(Buffer.alloc(32, 8)).verify(ticket, 'preview'), forbidden)
  for (const malformed of [null, '', 'bad.signature', 'x'.repeat(601), ticket + '.extra']) {
    assert.throws(() => tickets.verify(malformed, 'preview'), forbidden)
  }
  t.mock.timers.tick(999)
  assert.equal(tickets.verify(ticket, 'preview', 'job-a').id, 'job-a')
  t.mock.timers.tick(2)
  assert.throws(() => tickets.verify(ticket, 'preview', 'job-a'), forbidden)
})

test('a ticket is already expired at its exact expiration timestamp', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1700000000000 })
  const tickets = createTickets(Buffer.alloc(32, 9))
  const ticket = tickets.issue('preview', 'job-a', 1000)
  t.mock.timers.tick(1000)
  assert.throws(() => tickets.verify(ticket, 'preview', 'job-a'), error => error.status === 403)
})
