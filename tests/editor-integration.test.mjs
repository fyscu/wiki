import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readlink, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { listenEditor } from '../editor/service.mjs'

const exec = promisify(execFile)

test('real MkDocs preview, publication and history work together on Linux', { skip: process.platform === 'win32', timeout: 240000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'wiki-editor-integration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = async (cwd, ...args) => (await exec('git', args, { cwd, windowsHide: true })).stdout.trim()
  const remote = join(root, 'remote.git'), repoDir = join(root, 'repo'), siteDir = join(root, 'public')
  await git(root, 'clone', '--bare', '--no-hardlinks', resolve('.'), remote)
  await git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  await git(root, 'clone', remote, repoDir)
  const original = await git(repoDir, 'rev-parse', 'HEAD')
  const admin = { id: 'integration-admin', username: 'integration-admin', role_id: 2, status: 'normal', mail_status: 1 }
  const tags = [], statuses = []
  const answer = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer integration-admin-token')
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/answer/api/v1/user/info') return res.end(JSON.stringify({ code: 200, data: admin }))
    if (req.url.startsWith('/answer/api/v1/tags?')) return res.end(JSON.stringify({ code: 200, data: tags }))
    if (req.url === '/answer/api/v1/tag' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      tags.push(JSON.parse(Buffer.concat(chunks).toString()))
      return res.end(JSON.stringify({ code: 200, data: {} }))
    }
    res.writeHead(404).end()
  })
  await new Promise(resolveReady => answer.listen(0, '127.0.0.1', resolveReady))
  t.after(() => new Promise(resolveClosed => { answer.closeAllConnections(); answer.close(resolveClosed) }))
  const publicOrigin = 'http://127.0.0.1:5173'
  const editor = await listenEditor({ repoDir, siteDir, dataDir: join(root, 'state'), workDir: join(root, 'jobs'), depsDir: resolve('.'), python: process.env.WIKI_PYTHON || resolve('.venv/bin/python'), publicOrigin, answerOrigin: `http://127.0.0.1:${answer.address().port}` })
  t.after(() => editor.close())
  const put = editor.store.put.bind(editor.store)
  editor.store.put = (kind, id, value) => { if (kind === 'job') statuses.push(value.status); return put(kind, id, value) }
  const origin = `http://127.0.0.1:${editor.port}`
  async function api(path, method = 'GET', input) {
    const response = await fetch(origin + '/_editor' + path, { method, headers: { Authorization: 'Bearer integration-admin-token', Origin: publicOrigin, 'Content-Type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input) })
    const result = await response.json()
    assert.ok(response.ok, JSON.stringify(result.error))
    return result.data
  }
  async function runJob(path, input) {
    const queued = await api(path, 'POST', input)
    await editor.idle()
    const job = await api('/jobs/' + queued.id)
    assert.equal(job.status, 'succeeded', job.error)
    return job
  }
  const state = await api('/state')
  const section = { id: 'section-integration', title: 'Integration', children: [] }
  await api('/navigation', 'PUT', { version: state.navigation.version, items: [...state.navigation.items, section] })
  let article = await api('/articles', 'POST', { title: 'Integration article', path: 'integration/article.md', sectionId: section.id })
  const upload = await fetch(origin + '/_editor/media', { method: 'POST', headers: { Authorization: 'Bearer integration-admin-token', Origin: publicOrigin, 'Content-Type': 'image/png', 'X-File-Name': 'integration.png' }, body: await sharp({ create: { width: 20, height: 20, channels: 3, background: '#4051b5' } }).png().toBuffer() })
  assert.equal(upload.status, 201)
  const media = (await upload.json()).data
  const firstBody = `# Integration article\n\nFirst published version.\n\n!!! note "Integration"\n    Full MkDocs rendering.\n\n![integration](${media.path})\n`
  article = await api('/articles/' + article.id, 'PUT', { ...article, body: firstBody })
  const preview = await runJob('/preview', { articleId: article.id, version: article.version })
  const html = await (await fetch(origin + preview.url)).text()
  assert.match(html, /Full MkDocs rendering/)
  assert.match(html, /class="admonition note"/)
  const asset = html.match(/href="([^\"]+\.css[^\"]*)"/)?.[1]
  assert.ok(asset)
  assert.equal((await fetch(new URL(asset.replaceAll('&amp;', '&'), origin + preview.url))).status, 200)
  const image = html.match(/src="([^\"]+\/images\/uploads\/[^\"]+)"/)?.[1]
  assert.ok(image)
  assert.equal((await fetch(origin + image)).status, 200)
  assert.equal(await git(remote, 'rev-parse', 'main'), original, 'preview keeps Git unchanged')
  const first = await runJob('/publish', {})
  assert.equal(await git(remote, 'rev-parse', 'main'), first.commit)
  const firstRelease = await readlink(join(siteDir, 'index'))
  assert.match(await readFile(join(siteDir, 'index/integration/article/index.html'), 'utf8'), /First published version/)
  assert.equal((await stat(join(siteDir, 'index/integration/article/index.html'))).mode & 0o777, 0o644)
  assert.equal(tags.length, 1)
  assert.equal(tags[0].slug_name, 'doc-' + article.id)
  article = await api('/articles/' + article.id)
  article = await api('/articles/' + article.id, 'PUT', { ...article, body: firstBody.replace('First published version.', 'Second published version.') })
  const second = await runJob('/publish', {})
  assert.notEqual(second.commit, first.commit)
  assert.notEqual(await readlink(join(siteDir, 'index')), firstRelease)
  assert.match(await readFile(join(siteDir, 'index/integration/article/index.html'), 'utf8'), /Second published version/)
  const history = await api('/articles/' + article.id + '/history')
  assert.ok(history.some(entry => entry.revision === first.commit))
  article = await api('/articles/' + article.id)
  const restored = await api('/articles/' + article.id + '/restore', 'POST', { version: article.version, revision: first.commit })
  assert.equal(restored.body, firstBody)
  assert.equal(restored.dirty, true)
  assert.match(await readFile(join(siteDir, 'index/integration/article/index.html'), 'utf8'), /Second published version/)
  assert.equal(await git(remote, 'rev-parse', 'main'), second.commit)
  const changed = (await git(repoDir, 'diff', '--name-only', original, second.commit)).split('\n')
  assert.deepEqual(changed.sort(), ['docs/integration/article.md', 'docs' + media.path, 'navigation.yml'].sort())
  assert.ok(statuses.every(status => ['queued', 'building', 'committing', 'publishing', 'succeeded', 'failed'].includes(status)))
})
