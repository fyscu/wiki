import { readFile } from 'node:fs/promises'
import { collectArticles } from './content.mjs'
import { httpOrigin } from '../lib/qa.mjs'

const origin = httpOrigin(process.env.QA_ORIGIN || 'http://127.0.0.1:9080')
const credentials = JSON.parse(await readFile('runtime/credentials.json', 'utf8'))
async function request(path, options = {}) {
  const response = await fetch(new URL(path, origin), { ...options, signal: AbortSignal.timeout(10000) })
  const body = await response.json()
  if (!response.ok || body.code !== 200) throw new Error(`Answer ${path}: ${response.status} ${body.msg || body.reason || ''}`)
  return body.data
}
const user = await request('/answer/api/v1/user/login/email', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ e_mail: credentials.admin_email, pass: credentials.admin_password }),
})
if (!user?.access_token) throw new Error('Admin login did not return a session')
let created = 0
const entries = [{ tag: 'general', title: '交流讨论', path: '/questions/', id: 'general' }, ...await collectArticles()]
for (const article of entries) {
  const tags = await request(`/answer/api/v1/tags?tags=${encodeURIComponent(article.tag)}`)
  if (tags?.some(tag => tag.slug_name === article.tag)) continue
  await request('/answer/api/v1/tag', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.access_token}` },
    body: JSON.stringify({ slug_name: article.tag, display_name: article.title.slice(0, 35),
      original_text: `关联飞扬 Wiki 文档：${article.path}\n\n文档 ID：${article.id}` }),
  })
  created++
}
console.log(`Admin login verified; ${created} article tag(s) created. No questions were seeded.`)
