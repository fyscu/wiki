import { readFile, writeFile } from 'node:fs/promises'

const credentials = JSON.parse(await readFile('runtime/credentials.json', 'utf8'))
const origin = process.env.QA_ORIGIN || 'http://127.0.0.1:9080'
async function request(path, method = 'GET', data, token) {
  const response = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000) })
  const result = await response.json()
  if (!response.ok || result.code !== 200) throw new Error(`${path}: ${response.status} ${result.msg}`)
  return result.data
}
const admin = await request('/answer/api/v1/user/login/email', 'POST', { e_mail: credentials.admin_email, pass: credentials.admin_password })
const token = admin.access_token
const generalPath = '/answer/admin/api/siteinfo/general', loginPath = '/answer/admin/api/siteinfo/login'
const general = await request(generalPath, 'GET', undefined, token)
const login = await request(loginPath, 'GET', undefined, token)
const smtp = await request('/answer/admin/api/setting/smtp', 'GET', undefined, token)
console.log(JSON.stringify({ smtp_configured: Boolean(smtp.smtp_host), site_url: general.site_url, registrations: login.allow_new_registrations }))
if (process.argv.includes('--apply')) {
  await writeFile(`runtime/production-settings-before-${Date.now()}.json`, JSON.stringify({ general, login }, null, 2), { mode: 0o600 })
  await request(loginPath, 'PUT', { ...login, allow_new_registrations: false, allow_email_registrations: false, require_email_verification: true }, token)
  await request(generalPath, 'PUT', { ...general, site_url: 'https://wiki.feiyang.ac.cn' }, token)
  console.log(JSON.stringify({ site_url: 'https://wiki.feiyang.ac.cn', registrations: false, email_verification: true }))
}
