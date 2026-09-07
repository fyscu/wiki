import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

await mkdir('runtime', { recursive: true })
const path = resolve('runtime/credentials.json')
let credentials
try { credentials = JSON.parse(await readFile(path, 'utf8')) }
catch (error) {
  if (error.code !== 'ENOENT') throw error
  credentials = {
    admin_email: 'wiki-admin@feiyang.local', admin_name: 'feiyang-admin',
    admin_password: randomBytes(16).toString('base64url'),
    db_user: 'fy_wiki_qa', db_name: 'feiyang_wiki_qa', db_password: randomBytes(24).toString('hex'),
    site_url: 'http://127.0.0.1:9080',
  }
  await writeFile(path, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
}
const values = { AUTO_INSTALL: '1', DB_TYPE: 'sqlite3', DB_FILE: '/data/answer.db', LANGUAGE: 'zh_CN',
  SITE_NAME: '飞扬问答', SITE_URL: credentials.site_url, CONTACT_EMAIL: credentials.admin_email,
  ADMIN_NAME: credentials.admin_name, ADMIN_EMAIL: credentials.admin_email,
  ADMIN_PASSWORD: credentials.admin_password, EXTERNAL_CONTENT_DISPLAY: 'ask_before_display' }
await writeFile('runtime/answer.local.env', Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 })
console.log('Local credentials and Answer initialization environment are ready in runtime/.')
