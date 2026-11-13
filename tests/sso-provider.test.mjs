import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createSsoHandler } from '../scripts/sso-provider.mjs'

const SECRET = 'test-only-secret'
const REDIRECT = 'https://wiki.feiyang.ac.cn/answer/api/v1/connector/redirect/basic'
const CLIENT_ID = 'feiyang-wiki'
const CLIENT_SECRET = 'test-client-secret'
const WIKI = 'https://wiki.feiyang.ac.cn'

function makeAdapters(overrides = {}) {
  const calls = []
  return {
    calls,
    methods: ['qr', 'email_code', 'password'],
    lookup: async email => {
      calls.push(['lookup', email])
      return { wiki: email.startsWith('known'), master: email.includes('@') }
    },
    qrStart: async () => { calls.push(['qrStart']); return { session_id: 's'.repeat(64), poll_token: 'p'.repeat(64), qr_payload: '[fylogin];abc', expires_in: 120 } },
    qrPoll: async () => { calls.push(['qrPoll']); return { status: 'login_ok', uid: '108132' } },
    emailSend: async ({ email }) => { calls.push(['emailSend', email]); return { request_id: 'r'.repeat(64), expires_in: 600 } },
    emailConfirm: async ({ email, code }) => { calls.push(['emailConfirm', email, code]); return { ok: code === '123456', uid: '108132' } },
    identityFromFoc: async ({ uid, email }) => {
      calls.push(['identityFromFoc', uid])
      return { external_id: uid, email, display_name: '测试用户', username: 'testuser', avatar: '' }
    },
    passwordLogin: async () => ({ access_token: 'native-answer-token', id: '7', username: 'olduser' }),
    ...overrides,
  }
}

async function fixture(t, adapters = makeAdapters()) {
  const handler = createSsoHandler({
    secret: SECRET, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT, loginOrigin: 'https://sso.feiyang.ac.cn', wikiOrigin: WIKI,
    adapters,
  })
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end() }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  return { base: `http://127.0.0.1:${server.address().port}`, adapters }
}

const post = (base, path, body, headers = {}) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}),
})

async function authorize(base, state = 'answer-state-001') {
  const url = new URL(base + '/authorize')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', REDIRECT)
  url.searchParams.set('state', state)
  url.searchParams.set('scope', 'openid,email')
  return fetch(url)
}

async function fullFlow(t, method, overrides = {}) {
  const { base, adapters } = await fixture(t, makeAdapters(overrides))
  const page = await authorize(base)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /云上飞扬统一登录/)
  const stateMatch = html.match(/const STATE="([^"]+)"/)
  assert.ok(stateMatch, '登录页应带内部 state')
  const innerState = stateMatch[1]

  const lookup = await post(base, '/api/lookup', { email: 'chen@stu.scu.edu.cn' })
  assert.equal(lookup.status, 200)
  const probed = await lookup.json()
  assert.equal(probed.data.methods.length, 3)
  const ticket = probed.data.ticket

  let assertion
  if (method === 'qr') {
    const start = await post(base, '/api/qr/start', { ticket })
    const session = await start.json()
    assert.equal(session.qr_payload, '[fylogin];abc')
    const poll = await post(base, '/api/qr/poll', { ticket, session_id: session.session_id, poll_token: session.poll_token })
    const result = await poll.json()
    assert.equal(result.status, 'verified')
    assertion = result.assertion
  } else {
    const sent = await post(base, '/api/email/send', { ticket })
    const challenge = await sent.json()
    const confirm = await post(base, '/api/email/confirm', { ticket, request_id: challenge.request_id, code: '123456' })
    const result = await confirm.json()
    assert.equal(result.status, 'verified')
    assertion = result.assertion
  }
  return { base, adapters, innerState, ticket, assertion }
}

test('authorize 校验 client_id / redirect_uri / state，并渲染登录页', async t => {
  const { base } = await fixture(t)
  const badClient = new URL(base + '/authorize')
  badClient.searchParams.set('response_type', 'code')
  badClient.searchParams.set('client_id', 'evil')
  badClient.searchParams.set('redirect_uri', REDIRECT)
  badClient.searchParams.set('state', 's')
  assert.equal((await fetch(badClient)).status, 400)

  const badRedirect = new URL(badClient)
  badRedirect.searchParams.set('client_id', CLIENT_ID)
  badRedirect.searchParams.set('redirect_uri', 'https://evil.example/cb')
  assert.equal((await fetch(badRedirect)).status, 400)

  const noState = new URL(badRedirect)
  noState.searchParams.set('redirect_uri', REDIRECT)
  noState.searchParams.delete('state')
  assert.equal((await fetch(noState)).status, 400)
})

test('扫码方式：完整 OAuth2 授权码流程并把 Answer 的 state 原样回传', async t => {
  const { base, innerState, ticket, assertion } = await fullFlow(t, 'qr')
  const finish = await post(base, '/api/finish', { state: innerState, ticket, assertion })
  assert.equal(finish.status, 200)
  const { redirect } = await finish.json()
  const target = new URL(redirect)
  assert.equal(target.origin + target.pathname, REDIRECT)
  assert.equal(target.searchParams.get('state'), 'answer-state-001')
  const code = target.searchParams.get('code')
  assert.ok(code)

  const tokenRes = await post(base, '/token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
  assert.equal(tokenRes.status, 200)
  const token = await tokenRes.json()
  assert.equal(token.token_type, 'Bearer')
  assert.ok(token.access_token)

  const info = await fetch(base + '/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } })
  assert.equal(info.status, 200)
  assert.deepEqual(await info.json(), {
    id: '108132', name: '测试用户', username: 'testuser',
    email: 'chen@stu.scu.edu.cn', avatar_url: '', email_verified: true,
  })

  // 授权码一次性，重放必须失败
  const replay = await post(base, '/token', { grant_type: 'authorization_code', code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
  assert.equal(replay.status, 400)
})

test('邮箱验证码方式：同样能完成授权码流程', async t => {
  const { base, innerState, ticket, assertion } = await fullFlow(t, 'email')
  const finish = await post(base, '/api/finish', { state: innerState, ticket, assertion })
  assert.equal(finish.status, 200)
  const code = new URL((await finish.json()).redirect).searchParams.get('code')
  const tokenRes = await post(base, '/token', { grant_type: 'authorization_code', code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
  assert.equal(tokenRes.status, 200)
})

test('密码方式直接落 Answer 原生会话，不进入 connector 流程', async t => {
  const { base } = await fixture(t)
  const res = await post(base, '/api/password', { account: 'olduser', pass: 'correct-horse' })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.status, 'native_session')
  assert.equal(body.user.access_token, 'native-answer-token')
})

test('防枚举：存在与不存在的邮箱返回完全相同的字段结构', async t => {
  const { base } = await fixture(t)
  const a = await (await post(base, '/api/lookup', { email: 'known@x.test' })).json()
  const b = await (await post(base, '/api/lookup', { email: 'nobody@x.test' })).json()
  assert.deepEqual({ ...a.data, ticket: undefined }, { ...b.data, ticket: undefined })
  assert.equal(a.data.hint, b.data.hint)
})

test('断言不可重放、不可跨邮箱、票据不可伪造', async t => {
  const { base, innerState, ticket, assertion } = await fullFlow(t, 'qr')
  const first = await post(base, '/api/finish', { state: innerState, ticket, assertion })
  assert.equal(first.status, 200)
  const replay = await post(base, '/api/finish', { state: innerState, ticket, assertion })
  assert.equal(replay.status, 400)
  assert.equal((await replay.json()).error, 'assertion_replayed')

  const otherTicket = (await (await post(base, '/api/lookup', { email: 'other@x.test' })).json()).data.ticket
  const mismatch = await post(base, '/api/finish', { state: innerState, ticket: otherTicket, assertion })
  assert.equal(mismatch.status, 400)

  const forged = await post(base, '/api/finish', { state: 'forged', ticket, assertion })
  assert.equal(forged.status, 400)
})

test('token 端点校验客户端凭据与 grant_type', async t => {
  const { base, innerState, ticket, assertion } = await fullFlow(t, 'qr')
  const code = new URL((await (await post(base, '/api/finish', { state: innerState, ticket, assertion })).json()).redirect).searchParams.get('code')
  assert.equal((await post(base, '/token', { grant_type: 'authorization_code', code, client_id: CLIENT_ID, client_secret: 'wrong' })).status, 401)
  assert.equal((await post(base, '/token', { grant_type: 'client_credentials', code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET })).status, 400)
  const basic = await post(base, '/token', { grant_type: 'authorization_code', code }, { Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64') })
  // 上一个 client_credentials 未消费 code，Basic 认证应能通过
  assert.equal(basic.status, 200)
})

test('校验码错误、探测票据过期与跨域写请求都被拒绝', async t => {
  const { base } = await fixture(t, makeAdapters({
    emailConfirm: async () => ({ ok: false }),
  }))
  const ticket = (await (await post(base, '/api/lookup', { email: 'a@x.test' })).json()).data.ticket
  const confirm = await post(base, '/api/email/confirm', { ticket, request_id: 'r'.repeat(64), code: '000000' })
  assert.equal(confirm.status, 400)
  assert.equal((await post(base, '/api/qr/start', { ticket: 'bogus' })).status, 400)
  const cross = await post(base, '/api/lookup', { email: 'a@x.test' }, { Origin: 'https://evil.example' })
  assert.equal(cross.status, 403)
  assert.equal((await post(base, '/api/lookup', { email: 'not-an-email' })).status, 400)
})

test('userinfo 拒绝无效 token', async t => {
  const { base } = await fixture(t)
  assert.equal((await fetch(base + '/userinfo')).status, 401)
  assert.equal((await fetch(base + '/userinfo', { headers: { Authorization: 'Bearer bogus' } })).status, 401)
})
