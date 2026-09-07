import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { docTag, buildAskPath, httpOrigin, normalizeQuestions } from '../lib/qa.mjs'
import { createQaMiddleware } from '../scripts/qa-proxy.mjs'

const id = '01arz3ndektsv4rrffq69g5fav'

test('article questions always open within the Wiki origin', () => {
  const path = buildAskPath(id)
  assert.equal(path, `/ask/?article=${id}`)
  const url = new URL(path, 'https://wiki.feiyang.ac.cn')
  assert.equal(url.origin, 'https://wiki.feiyang.ac.cn')
  assert.equal(url.searchParams.get('article'), id)
})

test('question links reject invalid IDs, origins and paths', () => {
  assert.throws(() => docTag('../admin'))
  assert.throws(() => buildAskPath('//other.example.com'))
  assert.throws(() => httpOrigin('javascript:alert(1)'))
  assert.throws(() => httpOrigin('https://user:pass@qa.example.com'))
  assert.throws(() => httpOrigin('https://qa.example.com/admin'))
})

test('accepted answer is distinct from answer count', () => {
  const items = normalizeQuestions({ code: 200, data: { list: [
    { id: 'one', title: '问题一', answer_count: 2, accepted_answer_id: '0' },
    { id: 'two', title: '问题二', answer_count: 1, accepted_answer_id: '123' },
  ] } })
  assert.equal(items[0].accepted, false)
  assert.equal(items[1].accepted, true)
})

test('public proxy never forwards credentials, extra query parameters or write operations', async t => {
  const calls = []
  const middleware = createQaMiddleware('http://127.0.0.1:9080', async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ code: 200, data: { list: [], total: 0 } }), { headers: { 'Content-Type': 'application/json' } })
  })
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end() }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}`
  const response = await fetch(`${base}/_qa/questions?tag=${docTag(id)}&username=admin&page_size=1000`, {
    headers: { Cookie: 'session=secret', Authorization: 'Bearer secret' },
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(calls[0].url.searchParams.get('page_size'), '5')
  assert.equal(calls[0].url.searchParams.has('username'), false)
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json' })
  assert.equal((await fetch(`${base}/_qa/questions?tag=${docTag(id)}`, { method: 'POST' })).status, 405)
  assert.equal((await fetch(`${base}/_qa/questions?tag=bad`)).status, 400)
  assert.equal((await fetch(`${base}/_qa/admin`)).status, 404)
  assert.equal(calls.length, 1)
})

test('upstream failure is a bounded 503 response', async t => {
  const middleware = createQaMiddleware('http://127.0.0.1:9080', async () => { throw new Error('Offline') })
  const server = createServer((req, res) => middleware(req, res, () => res.end()))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const response = await fetch(`http://127.0.0.1:${server.address().port}/_qa/questions?tag=${docTag(id)}`)
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'qa_unavailable' })
})
