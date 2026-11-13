// 云上飞扬统一登录 OAuth2 Provider（独立 HTTP 服务）
//
// 角色：给 Answer 官方 connector-basic 插件当 IdP，把「邮箱探测 → 主表查找 →
// 三选一登录（扫码 / 邮箱验证码 / wiki 账户密码）」收敛成一个标准 OAuth2 授权码。
// Answer 自己完成建号/绑定与会话签发，本服务不接触 Answer 数据库、不签发 Answer token。
//
// 所有外部依赖（foc 后端、主表查询、Answer）都以 adapters 注入，单测可完全离线。
// 凭据只从 sso.local.json 读（gitignore），不入仓。
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  normalizeEmail, probeAccount, readProbeTicket,
  createState, readState,
  createAssertion, readAssertion, matchTicketAssertion,
  createAuthCode, readAuthCode, createAccessToken, readAccessToken,
  buildUserInfo, CODE_TTL_MS,
} from '../lib/sso-core.mjs'
import { renderLoginPage } from './sso-login-page.mjs'

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }

function json(res, status, body) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(body))
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''))
  return x.length === y.length && timingSafeEqual(x, y)
}

async function readBody(req, limit = 262144) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limit) throw Object.assign(new Error('Request too large'), { status: 413 })
    chunks.push(chunk)
  }
  if (!total) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if ((req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text))
  }
  const parsed = JSON.parse(text)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Invalid JSON body')
  return parsed
}

function clientIp(req) {
  return String(req.headers['x-real-ip'] || req.socket.remoteAddress || '')
}

// 极简单进程限流：按 key 记窗口内次数。生产多实例时换成共享存储。
function createLimiter(limit, windowMs = 60_000) {
  const buckets = new Map()
  return key => {
    const now = Date.now()
    const item = buckets.get(key)
    if (!item || now - item.start >= windowMs) { buckets.set(key, { start: now, count: 1 }); return true }
    item.count += 1
    return item.count <= limit
  }
}

export function createSsoHandler(config) {
  const {
    secret, clientId, clientSecret,
    redirectUri,            // 允许回调的 Answer connector redirect URL
    loginOrigin,            // 本服务对外 origin，用于生成登录页内 API 地址
    adapters,               // { lookup, qrStart, qrPoll, emailSend, emailConfirm, passwordLogin }
    now = () => Date.now(),
  } = config
  if (!secret || !clientId || !clientSecret || !redirectUri) throw new Error('SSO config incomplete')
  const codes = new Map()      // code -> { consumed, identity }
  const tokens = new Map()     // access_token -> identity
  const assertions = new Set() // 一次性消费，防重放
  const lookupLimit = createLimiter(12)
  const verifyLimit = createLimiter(30)

  const allowedMethods = adapters.methods || ['qr', 'email_code', 'password']

  return async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const path = url.pathname

    if (path === '/healthz') return json(res, 200, { ok: true, methods: allowedMethods })

    // ---------- 统一登录页 ----------
    if (path === '/authorize') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' })
      const responseType = url.searchParams.get('response_type')
      const cid = url.searchParams.get('client_id')
      const uri = url.searchParams.get('redirect_uri')
      const state = url.searchParams.get('state') || ''
      if (responseType !== 'code' || !safeEqual(cid, clientId) || !uri || uri !== redirectUri) {
        return json(res, 400, { error: 'invalid_request' })
      }
      if (!state) return json(res, 400, { error: 'invalid_request' })
      // 保留 Answer 的原始 state，回调时原样回传（见 sso-core.createState）
      const innerState = createState(secret, uri, now(), state)
      const html = renderLoginPage({
        state: innerState,
        methods: allowedMethods,
        wikiOrigin: config.wikiOrigin,
      })
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' })
      return res.end(req.method === 'HEAD' ? undefined : html)
    }

    // ---------- 以下均为同源 JSON API ----------
    if (path.startsWith('/api/')) {
      if (!['GET', 'POST', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'method_not_allowed' })
      const origin = req.headers.origin
      if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'origin_mismatch' })
      if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
        return json(res, 415, { error: 'unsupported_media_type' })
      }
    }

    try {
      // 账号探测：恒定响应，真实命中结果只进签名票据
      if (path === '/api/lookup' && req.method === 'POST') {
        if (!lookupLimit(`lookup:${clientIp(req)}`)) return json(res, 429, { error: 'rate_limited' })
        const input = await readBody(req)
        const email = normalizeEmail(input.email)
        if (!email) return json(res, 400, { error: 'invalid_email' })
        // 主表 / wiki 层查询失败不向调用方泄露差异
        let found = { wiki: false, master: false }
        try { found = (await adapters.lookup(email)) || found } catch { /* 降级为未命中 */ }
        return json(res, 200, probeAccount(secret, email, found, now()))
      }

      // 扫码：出码 / 轮询
      if (path === '/api/qr/start' && req.method === 'POST') {
        if (!verifyLimit(`qr:${clientIp(req)}`)) return json(res, 429, { error: 'rate_limited' })
        const input = await readBody(req)
        const ticket = readProbeTicket(secret, input.ticket, now())
        if (!ticket) return json(res, 400, { error: 'invalid_ticket' })
        const session = await adapters.qrStart({ platform: '飞扬 Wiki 统一登录' })
        return json(res, 200, { ...session, ticket: input.ticket })
      }
      if (path === '/api/qr/poll' && req.method === 'POST') {
        const input = await readBody(req)
        const ticket = readProbeTicket(secret, input.ticket, now())
        if (!ticket) return json(res, 400, { error: 'invalid_ticket' })
        const result = await adapters.qrPoll({ sessionId: input.session_id, pollToken: input.poll_token })
        if (result.status !== 'login_ok') return json(res, 200, { status: result.status })
        const identity = await adapters.identityFromFoc({ uid: result.uid, email: ticket.email })
        const assertion = createAssertion(secret, identity, 'qr', now())
        return json(res, 200, { status: 'verified', assertion, ticket: input.ticket,
          email: identity.email, method: 'qr' })
      }

      // 邮箱验证码：发送 / 确认
      if (path === '/api/email/send' && req.method === 'POST') {
        if (!verifyLimit(`mail:${clientIp(req)}`)) return json(res, 429, { error: 'rate_limited' })
        const input = await readBody(req)
        const ticket = readProbeTicket(secret, input.ticket, now())
        if (!ticket) return json(res, 400, { error: 'invalid_ticket' })
        const sent = await adapters.emailSend({ email: ticket.email })
        return json(res, 200, sent)
      }
      if (path === '/api/email/confirm' && req.method === 'POST') {
        const input = await readBody(req)
        const ticket = readProbeTicket(secret, input.ticket, now())
        if (!ticket) return json(res, 400, { error: 'invalid_ticket' })
        const verified = await adapters.emailConfirm({ email: ticket.email, requestId: input.request_id, code: input.code })
        if (!verified?.ok) return json(res, 400, { error: 'invalid_code' })
        const identity = await adapters.identityFromFoc({ uid: verified.uid, email: ticket.email })
        const assertion = createAssertion(secret, identity, 'email_code', now())
        return json(res, 200, { status: 'verified', assertion, ticket: input.ticket,
          email: identity.email, method: 'email_code' })
      }

      // wiki 账户密码：直接复用 Answer 原生登录，成功后不走 connector（避免撞「邮箱已存在」）
      if (path === '/api/password' && req.method === 'POST') {
        if (!verifyLimit(`pw:${clientIp(req)}`)) return json(res, 429, { error: 'rate_limited' })
        const input = await readBody(req)
        const user = await adapters.passwordLogin({ account: input.account, pass: input.pass,
          captchaId: input.captcha_id, captchaCode: input.captcha_code })
        return json(res, 200, { status: 'native_session', user })
      }

      // 完成：校验票据 + 断言，签发一次性授权码并给出回调地址
      if (path === '/api/finish' && req.method === 'POST') {
        const input = await readBody(req)
        const state = readState(secret, input.state, now())
        const ticket = readProbeTicket(secret, input.ticket, now())
        const assertion = readAssertion(secret, input.assertion, now())
        if (!state || !ticket || !assertion || !matchTicketAssertion(ticket, assertion)) {
          return json(res, 400, { error: 'invalid_assertion' })
        }
        if (assertions.has(input.assertion)) return json(res, 400, { error: 'assertion_replayed' })
        assertions.add(input.assertion)
        const identity = {
          external_id: assertion.external_id, email: assertion.email,
          display_name: assertion.display_name, username: assertion.username,
          avatar: assertion.avatar, method: assertion.method,
        }
        const code = createAuthCode(secret, identity, input.state, now())
        codes.set(code, { consumed: false, identity })
        const target = new URL(redirectUri)
        target.searchParams.set('code', code)
        target.searchParams.set('state', state.answer_state)
        return json(res, 200, { redirect: target.toString() })
      }
    } catch (error) {
      const status = error.status || (error instanceof SyntaxError ? 400 : 502)
      return json(res, status, { error: status === 502 ? 'upstream_unavailable' : 'bad_request' })
    }

    // ---------- OAuth2 token ----------
    if (path === '/token' && req.method === 'POST') {
      let input
      try { input = await readBody(req) } catch { return json(res, 400, { error: 'invalid_request' }) }
      let id = input.client_id, secretValue = input.client_secret
      const auth = req.headers.authorization || ''
      if (auth.startsWith('Basic ')) {
        const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
        const colon = decoded.indexOf(':')
        id = decoded.slice(0, colon); secretValue = decoded.slice(colon + 1)
      }
      if (!safeEqual(id, clientId) || !safeEqual(secretValue, clientSecret)) {
        return json(res, 401, { error: 'invalid_client' })
      }
      if (input.grant_type !== 'authorization_code') return json(res, 400, { error: 'unsupported_grant_type' })
      const entry = codes.get(input.code)
      const payload = readAuthCode(secret, input.code, now())
      if (!entry || entry.consumed || !payload) return json(res, 400, { error: 'invalid_grant' })
      if (input.redirect_uri && input.redirect_uri !== redirectUri) return json(res, 400, { error: 'invalid_grant' })
      entry.consumed = true
      const accessToken = createAccessToken(secret, entry.identity, now())
      tokens.set(accessToken, entry.identity)
      return json(res, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: Math.floor(CODE_TTL_MS / 1000) })
    }

    // ---------- OAuth2 userinfo ----------
    if (path === '/userinfo') {
      const auth = String(req.headers.authorization || '')
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
      const payload = readAccessToken(secret, token, now())
      const identity = tokens.get(token)
      if (!payload || !identity) return json(res, 401, { error: 'invalid_token' })
      return json(res, 200, buildUserInfo(identity))
    }

    return json(res, 404, { error: 'not_found' })
  }
}

export async function loadConfig(file = process.env.SSO_CONFIG || 'sso.local.json') {
  const raw = JSON.parse(await readFile(file, 'utf8'))
  if (!raw.secret || !raw.client_id || !raw.client_secret) throw new Error('Missing SSO credentials')
  return {
    secret: raw.secret,
    clientId: raw.client_id,
    clientSecret: raw.client_secret,
    redirectUri: raw.redirect_uri,
    loginOrigin: raw.login_origin,
    wikiOrigin: raw.wiki_origin,
    adapters: await createLiveAdapters(raw),
  }
}

// 生产适配器：全部走内网 HTTP，不直接持有 wiki 数据库凭据。
async function createLiveAdapters(raw) {
  const foc = (raw.foc_origin || '').replace(/\/$/, '')
  const answer = (raw.answer_origin || '').replace(/\/$/, '')
  const call = async (origin, path, body, headers = {}) => {
    const response = await fetch(origin + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body || {}), signal: AbortSignal.timeout(12_000),
    })
    return response.json()
  }
  return {
    methods: raw.methods,
    lookup: async email => {
      const result = await call(foc, '/v1/sso/lookup.php', { email },
        { 'X-SSO-Key': raw.lookup_key || '' })
      return { wiki: Boolean(result.wiki), master: Boolean(result.master) }
    },
    qrStart: async ({ platform }) => call(foc, '/v1/user/qrlogin_create.php', { platform }),
    qrPoll: async ({ sessionId, pollToken }) => call(foc, '/v1/user/qrlogin_poll.php',
      { session_id: sessionId, poll_token: pollToken }),
    // 登录发码走 emailsend.php（login purpose）；emailregsend.php 是注册发码，不能混用。
    emailSend: async ({ email }) => call(foc, '/v1/user/emailsend.php', { email }),
    emailConfirm: async ({ email, requestId, code }) => {
      const result = await call(foc, '/v1/user/emaillogin.php', { email, request_id: requestId, code })
      return { ok: result?.success === true && result?.status === 'login_ok', uid: result?.uid }
    },
    identityFromFoc: async ({ uid, email }) => call(foc, '/v1/sso/identity.php', { uid, email },
      { 'X-SSO-Key': raw.lookup_key || '' }),
    passwordLogin: async ({ account, pass, captchaId, captchaCode }) =>
      call(answer, '/answer/api/v1/user/login/email',
        { e_mail: account, pass, captcha_id: captchaId, captcha_code: captchaCode }),
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const config = await loadConfig()
  const server = createServer(createSsoHandler(config))
  const port = Number(process.env.SSO_PORT || 8787)
  server.listen(port, process.env.SSO_HOST || '127.0.0.1', () => {
    console.log(`[sso] listening on ${process.env.SSO_HOST || '127.0.0.1'}:${port}`)
  })
}

// 便于测试构造稳定 token，不参与业务逻辑
export const __internal = { createHash, randomBytes }
