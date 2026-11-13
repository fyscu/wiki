import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LOGIN_METHODS, PROBE_HINT, normalizeEmail,
  probeAccount, readProbeTicket, createState, readState,
  createAssertion, readAssertion, matchTicketAssertion,
  createAuthCode, readAuthCode, createAccessToken, readAccessToken,
  buildUserInfo,
} from '../lib/sso-core.mjs'

const SECRET = 'test-only-secret-not-for-production'
const NOW = 1_700_000_000_000

test('normalizeEmail 拒绝垃圾值并小写归一', () => {
  assert.equal(normalizeEmail('  Chen@Stu.SCU.edu.CN '), 'chen@stu.scu.edu.cn')
  for (const bad of [null, '', '0', 'not-an-email', 'a@', '@b.com', 'a b@c.com', 'x'.repeat(300) + '@a.com']) {
    assert.equal(normalizeEmail(bad), null, `should reject ${String(bad).slice(0, 20)}`)
  }
})

test('探测响应恒定，命中与否不产生任何可区分字段（防枚举）', () => {
  const a = probeAccount(SECRET, 'exists@example.test', { wiki: true, master: true }, NOW)
  const b = probeAccount(SECRET, 'missing@example.test', { wiki: false, master: false }, NOW)
  assert.equal(a.code, 200)
  assert.deepEqual(a.data.methods, LOGIN_METHODS)
  assert.equal(a.data.hint, PROBE_HINT)
  assert.equal(a.data.expires_in, b.data.expires_in)
  // 除签名票据外，所有字段完全一致；票据长度也一致（定长填充 + 命中结果定长 0/1）
  assert.deepEqual({ ...a.data, ticket: undefined }, { ...b.data, ticket: undefined })
  assert.equal(a.data.ticket.length, b.data.ticket.length)
  // 邮箱长度不同也不能改变票据长度
  const short = probeAccount(SECRET, 'a@b.co', { wiki: false, master: false }, NOW)
  const long = probeAccount(SECRET, 'a-very-long-address@sub.example.edu.cn', { wiki: true, master: true }, NOW)
  assert.equal(short.data.ticket.length, long.data.ticket.length)
  // 真实结果只存在于服务端票据内部
  const hit = readProbeTicket(SECRET, a.data.ticket, NOW)
  const miss = readProbeTicket(SECRET, b.data.ticket, NOW)
  assert.equal(hit.wiki, 1)
  assert.equal(hit.master, 1)
  assert.equal(miss.wiki, 0)
  assert.equal(miss.master, 0)
})

test('票据防篡改、防过期、防跨类型复用', () => {
  const ticket = probeAccount(SECRET, 'a@b.test', { wiki: false, master: true }, NOW).data.ticket
  const tampered = ticket.slice(0, 12) + 'X' + ticket.slice(13)
  assert.equal(readProbeTicket(SECRET, tampered, NOW), null)
  assert.equal(readProbeTicket('wrong-secret', ticket, NOW), null)
  assert.equal(readProbeTicket(SECRET, ticket, NOW + 5 * 60 * 1000 + 1), null)
  assert.equal(readState(SECRET, ticket, NOW), null)
  assert.equal(readAccessToken(SECRET, ticket, NOW), null)
})

test('state 原样保留 Answer 的 state，回调时取回', () => {
  const answerState = 'answer-generated-state-abc123'
  const state = createState(SECRET, 'https://wiki.feiyang.ac.cn/answer/api/v1/connector/redirect/basic', NOW, answerState)
  const read = readState(SECRET, state, NOW)
  assert.equal(read.answer_state, answerState)
  assert.equal(readState(SECRET, state, NOW + 5 * 60 * 1000 + 1), null)
  assert.equal(readProbeTicket(SECRET, state, NOW), null)
})

test('断言必须绑定同一个邮箱，且不可伪造验证方式', () => {
  const identity = { external_id: '108132', email: 'chen@stu.scu.edu.cn', display_name: '陈' }
  const assertion = createAssertion(SECRET, identity, 'qr', NOW)
  const read = readAssertion(SECRET, assertion, NOW)
  assert.equal(read.email, identity.email)
  assert.equal(read.method, 'qr')
  assert.equal(readAssertion(SECRET, assertion, NOW + 5 * 60 * 1000 + 1), null)
  const ticketA = readProbeTicket(SECRET, probeAccount(SECRET, 'a@x.test', {}, NOW).data.ticket, NOW)
  const ticketB = readProbeTicket(SECRET, probeAccount(SECRET, 'b@x.test', {}, NOW).data.ticket, NOW)
  assert.equal(matchTicketAssertion(ticketA, read), false)
  assert.equal(matchTicketAssertion(ticketB, read), false)
  const matching = readProbeTicket(SECRET, probeAccount(SECRET, identity.email, {}, NOW).data.ticket, NOW)
  assert.equal(matchTicketAssertion(matching, read), true)
})

test('授权码与访问令牌互不通用、到期失效', () => {
  const identity = { external_id: 'u-1', email: 'u1@x.test' }
  const code = createAuthCode(SECRET, identity, 'st', NOW)
  const token = createAccessToken(SECRET, identity, NOW)
  assert.ok(readAuthCode(SECRET, code, NOW))
  assert.equal(readAuthCode(SECRET, token, NOW), null)
  assert.ok(readAccessToken(SECRET, token, NOW))
  assert.equal(readAccessToken(SECRET, code, NOW), null)
  assert.equal(readAuthCode(SECRET, code, NOW + 61_000), null)
  assert.equal(readAccessToken(SECRET, token, NOW + 301_000), null)
})

test('userinfo 字段符合 connector-basic 的 JSON Path 配置', () => {
  const info = buildUserInfo({ external_id: '108132', email: 'chen@stu.scu.edu.cn', display_name: '陈树成', username: 'chenshucheng', avatar: '' })
  assert.equal(info.id, '108132')
  assert.equal(info.email, 'chen@stu.scu.edu.cn')
  assert.equal(info.name, '陈树成')
  assert.equal(info.username, 'chenshucheng')
  assert.equal(info.email_verified, true)
  assert.deepEqual(Object.keys(info).sort(), ['avatar_url', 'email', 'email_verified', 'id', 'name', 'username'])
  // 缺 display_name/username 时从邮箱兜底，不产生空字段
  const fallback = buildUserInfo({ external_id: 'u2', email: 'someone@x.test' })
  assert.equal(fallback.name, 'someone@x.test')
  assert.equal(fallback.username, 'someone')
})
