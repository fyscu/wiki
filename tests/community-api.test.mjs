import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { communityApi } from '../scripts/community-api.mjs'

async function fixture(t, fetcher) {
  const api = communityApi('http://127.0.0.1:9080', fetcher)
  const server = createServer((req, res) => api(req, res, () => { res.statusCode = 404; res.end() }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  return `http://127.0.0.1:${server.address().port}`
}

test('authenticated same-origin write forwards only the caller token and documented fields', async t => {
  let call
  const base = await fixture(t, async (url, options) => { call = { url, options }; return Response.json({ code: 200, data: { id: 'new' } }) })
  const response = await fetch(base + '/_community/questions', { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: 'Bearer example-user-token', Cookie: 'privileged=cookie', Origin: base,
  }, body: JSON.stringify({ title: 'Example title', content: 'Question body', tags: [], user_id: 'admin', role_id: 2 }) })
  assert.equal(response.status, 200)
  assert.equal(call.url.pathname, '/answer/api/v1/question')
  assert.equal(call.options.headers.Authorization, 'Bearer example-user-token')
  assert.equal(call.options.headers.Cookie, undefined)
  assert.deepEqual(JSON.parse(call.options.body), { title: 'Example title', content: 'Question body', tags: [] })
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('API rejects anonymous writes, cross-origin writes, oversized JSON and arbitrary backend routes', async t => {
  const base = await fixture(t, async () => { throw new Error('Should not be reached') })
  assert.equal((await fetch(base + '/_community/questions', { method: 'POST' })).status, 401)
  assert.equal((await fetch(base + '/_community/questions', { method: 'POST', headers: { Authorization: 'Bearer example-user-token', Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403)
  assert.equal((await fetch(base + '/_community/../../answer/admin/api/user')).status, 404)
  assert.equal((await fetch(base + '/_community/questions', { method: 'POST', headers: { Authorization: 'Bearer example-user-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x'.repeat(270000) }) })).status, 413)
})
