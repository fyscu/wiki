import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { validateSMTP } from '../lib/smtp.mjs'

const { values } = parseArgs({ options: { config: { type: 'string' }, apply: { type: 'boolean', default: false }, 'test-recipient': { type: 'string' } } })
if (!values.config) throw new Error('Use --config <protected-json-file> [--apply] [--test-recipient <email>]')
const config = validateSMTP(JSON.parse(await readFile(values.config, 'utf8')))
const recipient = values['test-recipient']
if (recipient && (!values.apply || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient))) throw new Error('An explicit --apply and valid test recipient are required for a test message')
if (!values.apply) {
  console.log(JSON.stringify({ configuration_valid: true, host: config.smtp_host, port: config.smtp_port, encryption: config.encryption, changed: false }))
} else {
  const credentials = JSON.parse(await readFile('runtime/credentials.json', 'utf8'))
  const origin = new URL(process.env.QA_ORIGIN || 'http://127.0.0.1:9080')
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Use a loopback SSH tunnel for SMTP administration')
  async function call(path, data, token) {
    const response = await fetch(new URL(path, origin), { method: path.endsWith('/smtp') ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000) })
    const body = await response.json()
    if (!response.ok || body.code !== 200) throw new Error(`SMTP administration failed: HTTP ${response.status}`)
    return body.data
  }
  const admin = await call('/answer/api/v1/user/login/email', { e_mail: credentials.admin_email, pass: credentials.admin_password })
  await call('/answer/admin/api/setting/smtp', { ...config, ...(recipient ? { test_email_recipient: recipient } : {}) }, admin.access_token)
  console.log(JSON.stringify({ configuration_saved: true, test_message_requested: Boolean(recipient), delivery_verified: false, registration_enabled: false }))
}
