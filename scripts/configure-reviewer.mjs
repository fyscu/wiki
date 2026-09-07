import { readFile, writeFile } from 'node:fs/promises'
const credentials = JSON.parse(await readFile('runtime/credentials.json', 'utf8'))
const origin = process.env.QA_ORIGIN || 'http://127.0.0.1:9080'
async function request(path, method = 'GET', body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(origin + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000) })
  const result = await response.json()
  if (!response.ok || result.code !== 200) throw new Error(`${path}: ${response.status} ${result.msg}`)
  return result.data
}
const user = await request('/answer/api/v1/user/login/email', 'POST', { e_mail: credentials.admin_email, pass: credentials.admin_password })
const path = '/answer/admin/api/plugin/'
const current = await request(path + 'config?plugin_slug_name=basic_reviewer', 'GET', undefined, user.access_token)
await writeFile('runtime/reviewer-before.json', JSON.stringify(current, null, 2), { mode: 0o600 })
await request(path + 'config', 'PUT', { plugin_slug_name: 'basic_reviewer', config_fields: { review_post_option: 'first', review_post: true, review_post_all: false, review_post_keywords: '', disallowed_keywords: '' } }, user.access_token)
await request(path + 'status', 'PUT', { plugin_slug_name: 'basic_reviewer', enabled: true }, user.access_token)
const statuses = await request('/answer/api/v1/plugin/status')
console.log(JSON.stringify({ reviewer: statuses.find(item => item.slug_name === 'basic_reviewer') }))
