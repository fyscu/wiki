import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify, parseArgs } from 'node:util'

const { values } = parseArgs({ options: { enable: { type: 'boolean', default: false }, disable: { type: 'boolean', default: false } } })
if (values.enable === values.disable) throw new Error('Specify exactly one of --enable or --disable')
const credentials = JSON.parse(await readFile('runtime/credentials.json', 'utf8'))
const origin = 'http://127.0.0.1:9080'
async function call(path, method = 'GET', data, token) {
  const response = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000) })
  const body = await response.json()
  if (!response.ok || body.code !== 200) throw new Error(`${path}: HTTP ${response.status}`)
  return body.data
}
const admin = await call('/answer/api/v1/user/login/email', 'POST', { e_mail: credentials.admin_email, pass: credentials.admin_password })
const path = '/answer/admin/api/siteinfo/login'
const before = await call(path, 'GET', undefined, admin.access_token)
const smtp = await call('/answer/admin/api/setting/smtp', 'GET', undefined, admin.access_token)
const general = await call('/answer/admin/api/siteinfo/general', 'GET', undefined, admin.access_token)
if (values.enable && (!smtp.smtp_host || !smtp.smtp_password || general.site_url !== 'https://wiki.feiyang.ac.cn')) throw new Error('Configure SMTP and the production site URL before enabling registration')
await writeFile(`runtime/registration-before-${Date.now()}.json`, JSON.stringify(before, null, 2), { mode: 0o600 })
await call(path, 'PUT', { ...before, allow_new_registrations: values.enable, allow_email_registrations: values.enable, require_email_verification: true }, admin.access_token)
try {
  await promisify(execFile)('ssh', ['-o', 'BatchMode=yes', 'ubuntu@45.40.247.178', `sudo python3 /opt/feiyang-wiki/tools/registration-gateway.py${values.enable ? ' --enable' : ''}`], { windowsHide: true, timeout: 20000 })
} catch {
  await call(path, 'PUT', before, admin.access_token)
  throw new Error('Gateway update failed; backend login settings were restored')
}
console.log(JSON.stringify({ registration_enabled: values.enable, require_email_verification: true }))
