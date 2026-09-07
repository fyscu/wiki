import { auth, clearSession } from '../api'

export class EditorError extends Error {
  constructor(message: string, public status = 0, public code = '') { super(message) }
}

export async function editorApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = auth.token
  if (!token) throw new EditorError('请重新登录', 401)
  const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${token}` }
  const file = body instanceof File
  if (file) {
    headers['Content-Type'] = body.type || 'application/octet-stream'
    headers['X-File-Name'] = encodeURIComponent(body.name)
  } else if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`/_editor${path}`, {
    method, headers, credentials: 'omit', cache: 'no-store',
    body: file ? body : body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(file ? 120000 : 30000),
  })
  if (response.status === 401 && auth.token === token) clearSession()
  const result = await response.json().catch(() => null)
  if (!response.ok || result?.error) {
    throw new EditorError(result?.error?.message || (response.status === 401 ? '请重新登录' : `请求失败 (${response.status})`), response.status, result?.error?.code)
  }
  if (!result || !Object.prototype.hasOwnProperty.call(result, 'data')) throw new EditorError('响应格式错误', response.status)
  // Ignore responses belonging to a session that has already signed out or changed.
  if (auth.token !== token) throw new EditorError('登录状态已变更', 401)
  return result.data as T
}

export const articlePath = (id: string) => `/articles/${encodeURIComponent(id)}`
export const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : '操作失败，请重试'
