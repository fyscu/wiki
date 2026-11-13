// 云上飞扬统一登录：纯逻辑层（零外部依赖，便于单测）
// 设计要点：账号探测必须防枚举——任何邮箱拿到的响应结构、文案、字段长度都一致，
// 真实的「wiki 层 / 主表层」命中结果只放进 HMAC 签名票据，由服务端后续步骤自行读取。
import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto'

export const LOGIN_METHODS = Object.freeze(['qr', 'email_code', 'password'])
export const PROBE_HINT = '若该邮箱已有账户，请选择一种方式登录；否则可按页面提示继续'
export const TICKET_TTL_MS = 5 * 60 * 1000
export const CODE_TTL_MS = 60 * 1000
export const TOKEN_TTL_MS = 5 * 60 * 1000

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[\x21-\x7e]+$/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

function mac(secret, body) {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

// 所有票据定长填充：响应长度不得随邮箱长度或命中结果变化，否则形成侧信道。
// JSON 末尾允许空白，JSON.parse 会忽略；补齐后再签名，填充内容同样受完整性保护。
const TICKET_BODY_BYTES = 512
function sign(secret, payload) {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8')
  if (raw.length > TICKET_BODY_BYTES) throw new Error('SSO ticket payload too large')
  const padded = Buffer.alloc(TICKET_BODY_BYTES, 0x20)
  raw.copy(padded)
  const body = padded.toString('base64url')
  return `${body}.${mac(secret, body)}`
}

function verify(secret, token) {
  if (typeof token !== 'string') return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const want = Buffer.from(mac(secret, body))
  const got = Buffer.from(sig)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

// 恒定探测响应。found 只影响票据内容，不影响任何对外字段的长度或文案。
export function probeAccount(secret, email, found, now = Date.now()) {
  const ticket = sign(secret, {
    v: 1,
    kind: 'probe',
    email,
    wiki: found?.wiki === true ? 1 : 0,
    master: found?.master === true ? 1 : 0,
    exp: now + TICKET_TTL_MS,
    nonce: randomBytes(8).toString('hex'),
  })
  return {
    code: 200,
    data: {
      methods: [...LOGIN_METHODS],
      hint: PROBE_HINT,
      ticket,
      expires_in: TICKET_TTL_MS / 1000,
    },
  }
}

export function readProbeTicket(secret, ticket, now = Date.now()) {
  const payload = verify(secret, ticket)
  if (!payload || payload.v !== 1 || payload.kind !== 'probe') return null
  if (typeof payload.email !== 'string' || !Number.isFinite(payload.exp) || payload.exp <= now) return null
  return payload
}

// OAuth2 state：把 Answer 生成的 state 原样签进内部票据。
// 回调时必须使用 answer_state，否则 Answer 的 ConsumeOAuthState 会判定 state 无效。
export function createState(secret, redirectUri, now = Date.now(), answerState = '') {
  return sign(secret, {
    v: 1, kind: 'state', redirect: redirectUri,
    answer_state: String(answerState || ''),
    exp: now + TICKET_TTL_MS, nonce: randomBytes(8).toString('hex'),
  })
}

export function readState(secret, state, now = Date.now()) {
  const payload = verify(secret, state)
  if (!payload || payload.v !== 1 || payload.kind !== 'state') return null
  if (typeof payload.redirect !== 'string' || !Number.isFinite(payload.exp) || payload.exp <= now) return null
  return payload
}

// 授权码：一次性（消费由 Provider 记录），短时效，内部携带已验证身份
export function createAuthCode(secret, identity, state, now = Date.now()) {
  // 只绑定 state 的短哈希：整张票据约 700 字节，会让授权码超出定长上限。
  const stateKey = createHash('sha256').update(String(state || '')).digest('hex').slice(0, 16)
  return sign(secret, {
    v: 1,
    kind: 'code',
    state: stateKey,
    external_id: String(identity.external_id || ''),
    email: String(identity.email || ''),
    display_name: String(identity.display_name || ''),
    username: String(identity.username || ''),
    avatar: String(identity.avatar || ''),
    method: String(identity.method || ''),
    exp: now + CODE_TTL_MS,
    nonce: randomBytes(8).toString('hex'),
  })
}

export function readAuthCode(secret, code, now = Date.now()) {
  const payload = verify(secret, code)
  if (!payload || payload.v !== 1 || payload.kind !== 'code') return null
  if (!Number.isFinite(payload.exp) || payload.exp <= now) return null
  if (!payload.email || !payload.external_id) return null
  return payload
}

// 验证断言：三种方式任一种成功后由服务端签发，客户端无法自行伪造「已验证」状态。
export function createAssertion(secret, identity, method, now = Date.now()) {
  return sign(secret, {
    v: 1,
    kind: 'assert',
    email: String(identity.email || ''),
    external_id: String(identity.external_id || ''),
    display_name: String(identity.display_name || ''),
    username: String(identity.username || ''),
    avatar: String(identity.avatar || ''),
    method: String(method || ''),
    exp: now + TICKET_TTL_MS,
    nonce: randomBytes(8).toString('hex'),
  })
}

export function readAssertion(secret, assertion, now = Date.now()) {
  const payload = verify(secret, assertion)
  if (!payload || payload.v !== 1 || payload.kind !== 'assert') return null
  if (!Number.isFinite(payload.exp) || payload.exp <= now) return null
  if (!payload.email || !payload.external_id) return null
  if (!LOGIN_METHODS.includes(payload.method)) return null
  return payload
}

// 票据与断言必须指向同一个邮箱，避免用 A 的探测结果换 B 的登录码。
export function matchTicketAssertion(ticket, assertion) {
  return Boolean(ticket && assertion && ticket.email === assertion.email)
}

export function createAccessToken(secret, identity, now = Date.now()) {
  return sign(secret, {
    v: 1,
    kind: 'access',
    external_id: String(identity.external_id || ''),
    email: String(identity.email || ''),
    exp: now + TOKEN_TTL_MS,
    nonce: randomBytes(8).toString('hex'),
  })
}

export function readAccessToken(secret, token, now = Date.now()) {
  const payload = verify(secret, token)
  if (!payload || payload.v !== 1 || payload.kind !== 'access') return null
  if (!Number.isFinite(payload.exp) || payload.exp <= now) return null
  return payload
}

// 把三种验证方式的输出归一化成 connector-basic 需要的 userinfo JSON。
// email_verified 恒为 true：三种方式都已完成邮箱所有权验证（密码方式由 Answer 侧账号状态保证）。
export function buildUserInfo(identity) {
  return {
    id: String(identity.external_id || ''),
    name: String(identity.display_name || identity.email || ''),
    username: String(identity.username || (identity.email || '').split('@')[0] || ''),
    email: String(identity.email || ''),
    avatar_url: String(identity.avatar || ''),
    email_verified: true,
  }
}

// 依据探测结果决定「已有账户」提示文案：对外恒定，仅用于页面渲染措辞，
// 不把「不存在」暴露成可区分状态。
export function accountNotice() {
  return PROBE_HINT
}
