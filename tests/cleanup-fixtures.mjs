import { readFile, writeFile } from 'node:fs/promises'
const credentials = JSON.parse(await readFile('runtime/credentials.json', 'utf8'))
const origin = 'http://127.0.0.1:9080'
let token = ''
async function call(path, method = 'GET', data) {
  const response = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' }, body: method === 'GET' ? undefined : JSON.stringify(data) })
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`${path}: Expected JSON, received ${response.status}`)
  const result = await response.json()
  if (!response.ok || result.code !== 200) throw new Error(`${path}: ${result.msg}`)
  return result.data
}
token = (await call('/answer/api/v1/user/login/email', 'POST', { e_mail: credentials.admin_email, pass: credentials.admin_password })).access_token
const first = await call('/answer/api/v1/review/pending/post/page?page=1')
const entries = [...first.list]
for (let page = 2; page <= Math.min(first.count, 20); page++) entries.push(...(await call(`/answer/api/v1/review/pending/post/page?page=${page}`)).list)
const own = entries.filter(item => {
  const match = /^启动问题联调 (desktop|mobile) ([0-9a-f]{10})$/.exec(item.title)
  if (!match) return false
  const author = item.author_user_info
  if (item.object_type === 'question') return author?.display_name === `验证用户${match[2]}` && item.original_text.startsWith('测试场景：')
  return item.object_type === 'answer'
    && item.original_text === '也可以先使用系统恢复介质确认启动分区状态，并记录诊断结果供进一步排查。'
    && (author?.display_name === `互助用户${match[2]}` || (author?.status === 'deleted' && /^huzhuyonghu/.test(author.username)))
})
await writeFile('.cache/own-pending-fixtures.json', JSON.stringify(own, null, 2))
for (const item of own) await call('/answer/api/v1/review/pending/post', 'PUT', { review_id: item.review_id, status: 'reject' })
const users = await call('/answer/admin/api/users/page?page=1&page_size=100&status=normal')
const candidates = [...(users.list || [])]
for (let page = 2; page <= Math.ceil(users.count / 100); page++) candidates.push(...(await call(`/answer/admin/api/users/page?page=${page}&page_size=100&status=normal`)).list)
const ownUsers = candidates.filter(user => {
  const match = /^wiki-test-(peer-)?([0-9a-f]{10})@feiyang\.local$/.exec(user.e_mail)
  return match && Number(user.role_id) === 1 && user.display_name === `${match[1] ? '互助用户' : '验证用户'}${match[2]}`
})
await writeFile('.cache/own-active-fixtures.json', JSON.stringify(ownUsers.map(user => ({ id: user.user_id, name: user.display_name })), null, 2))
for (const user of ownUsers) await call('/answer/admin/api/user/status', 'PUT', { user_id: user.user_id, status: 'deleted', remove_all_content: true })
console.log(`Closed ${own.length} abandoned review(s) and ${ownUsers.length} verified test account(s).`)
