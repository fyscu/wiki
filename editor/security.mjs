import { createHmac, timingSafeEqual } from 'node:crypto'
import { fail } from './content.mjs'

export function createTickets(secret) {
  function sign(value) { return createHmac('sha256', secret).update(value).digest('base64url') }
  return {
    issue(kind, id, lifetime = 3600000) { const data = Buffer.from(JSON.stringify({ kind, id, exp: Date.now() + lifetime })).toString('base64url'); return data + '.' + sign(data) },
    verify(ticket, kind, id) {
      if (typeof ticket !== 'string' || ticket.length > 600) fail('预览链接已失效', 403)
      const [data, signature, extra] = ticket.split('.'), expected = sign(data || '')
      if (extra || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) fail('预览链接已失效', 403)
      let payload; try { payload = JSON.parse(Buffer.from(data, 'base64url').toString()) } catch { fail('预览链接已失效', 403) }
      if (payload.kind !== kind || (id && payload.id !== id) || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) fail('预览链接已失效', 403)
      return payload
    },
  }
}
export function checkOrigin(req, origin) {
  if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin) fail('请求来源不匹配', 403)
}
export async function answerAdministrator(req, answerOrigin) {
  const authorization = req.headers.authorization || ''
  if (!/^Bearer [A-Za-z0-9._-]{8,2048}$/.test(authorization)) fail('请先登录', 401)
  let response, body
  try { response = await fetch(answerOrigin + '/answer/api/v1/user/info', { headers: { Authorization: authorization }, redirect: 'error', signal: AbortSignal.timeout(5000) }); body = await response.json() }
  catch { fail('账号服务暂时不可用', 503) }
  if (!response.ok || body.code !== 200) fail('请重新登录', 401)
  const user = body.data
  if (Number(user.role_id) !== 2 || user.status !== 'normal' || Number(user.mail_status) !== 1) fail('此页面仅向管理员开放', 403)
  return { user: { id: user.id, username: user.username, display_name: user.display_name, role_id: user.role_id }, authorization }
}
