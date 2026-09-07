import { reactive } from 'vue'
import { safeReturnPath } from '../lib/navigation.mjs'

export const auth = reactive<{ user: any; token: string }>({ user: null, token: '' })
const key = 'feiyang-session-v2'
try { Object.assign(auth, JSON.parse(sessionStorage.getItem(key) || '{}')) } catch { sessionStorage.removeItem(key) }

export function saveSession(user: any) {
  auth.token = user.access_token || auth.token
  auth.user = { id: user.id, username: user.username, display_name: user.display_name, role_id: user.role_id, e_mail: user.e_mail, mail_status: user.mail_status }
  sessionStorage.setItem(key, JSON.stringify(auth))
}

export function clearSession() { auth.user = null; auth.token = ''; sessionStorage.removeItem(key) }

export async function api(path: string, method = 'GET', body?: unknown, anonymous = false) {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = anonymous ? '' : auth.token
  if (method !== 'GET') headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`/_community/${path}`, { method, headers, credentials: 'omit', cache: 'no-store',
    body: method === 'GET' ? undefined : JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) })
  let result
  try { result = await response.json() } catch { result = { code: response.status, msg: response.status === 401 ? '请重新登录' : response.status === 429 ? '操作过于频繁，请稍后重试' : response.status === 503 ? '服务暂未开放或暂时不可用' : '请求未能完成' } }
  if (!response.ok || result.code !== 200) {
    if (response.status === 401 && token && auth.token === token && !['login', 'register'].includes(path)) clearSession()
    const fields = Array.isArray(result.data) ? result.data.map(item => item.error_msg).filter(Boolean).join('；') : ''
    const message = path === 'login' && result.reason === 'error.object.email_or_password_incorrect' ? '邮箱、用户名或密码不正确' : fields || result.msg || '操作未完成，请重试'
    const error = new Error(message)
    Object.assign(error, { status: response.status, details: result.data })
    throw error
  }
  return result.data
}

export function loginHref(next = location.pathname + location.search) {
  const safe = safeReturnPath(next, location.origin)
  return `/login/?next=${encodeURIComponent(safe)}`
}
export function isModerator() { return [2, 3].includes(Number(auth.user?.role_id)) }
export function questionHref(id: string) { return `/question/?id=${encodeURIComponent(id)}` }
export function formatDate(time?: number) { return time ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(time * 1000)) : '' }
export async function articles() { return (await (await fetch('/article-manifest.json')).json()).articles }
export async function accountSettings() {
  const [site, response] = await Promise.all([api('siteinfo'), fetch('/account-status.json', { cache: 'no-store' })])
  if (!response.ok) throw new Error('账号设置暂时无法加载，请刷新重试')
  const status = await response.json()
  return { ...site.login, mail_ready: status.mail_ready === true }
}
