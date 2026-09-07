import { test as base, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { startMailLab } from '../../scripts/mail-lab.mjs'

const test = base.extend<{}, { lab: Awaited<ReturnType<typeof startMailLab>> }>({
  lab: [async ({}, use) => { const lab = await startMailLab(); try { await use(lab) } finally { await lab.close() } }, { scope: 'worker' }],
})

test('a delivered answer notification opens its answer and unsubscribes only after confirmation', async ({ lab, page, request }) => {
  const email = `notification-${randomBytes(5).toString('hex')}@wiki-mail.test`, password = 'Notification-Test-813'
  await lab.adminCall('/answer/admin/api/user', 'POST', { display_name: '通知验证用户', email, password })
  const user = (await (await request.post(lab.backend + '/answer/api/v1/user/login/email', { data: { e_mail: email, pass: password } })).json()).data
  const headers = { Authorization: `Bearer ${user.access_token}` }
  const settingsPath = lab.backend + '/answer/api/v1/user/notification/config'
  const before = (await (await request.get(settingsPath, { headers })).json()).data
  before.inbox = { key: 'email', enable: true }
  expect((await request.put(settingsPath, { headers, data: before })).status()).toBe(200)
  expect(before.inbox.enable).toBe(true)
  await lab.adminCall('/answer/api/v1/tag', 'POST', { slug_name: 'notification-test', display_name: '通知联调', original_text: '验证邮件中的问题链接。' })
  const created = await request.post(lab.backend + '/answer/api/v1/question', { headers, data: { title: '通知邮件中的回答定位测试', content: '请检查邮件中的问题与回答地址。', tags: [{ slug_name: 'notification-test', display_name: '通知联调' }] } })
  expect(created.status()).toBe(200)
  const question = (await created.json()).data
  const answer = await lab.adminCall('/answer/api/v1/answer', 'POST', { question_id: question.id, content: '这条回答用于验证邮件链接与退订功能。' })
  await expect.poll(() => lab.messages.some(mail => mail.recipients.includes(email) && String(mail.html).includes('/questions/')), { timeout: 15000 }).toBe(true)
  const mail = lab.messages.find(mail => mail.recipients.includes(email) && String(mail.html).includes('/questions/'))
  await page.goto(lab.origin)
  const links = await page.evaluate(html => Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a[href]')).map(a => a.getAttribute('href')), mail.html)
  const answerLink = links.find(link => link.includes('/questions/'))
  const unsubscribeLink = links.find(link => link.includes('/users/unsubscribe'))
  expect(new URL(answerLink).origin).toBe(lab.origin)
  await page.goto(answerLink)
  await expect(page.locator(`#answer-${answer.info.id}`)).toContainText('这条回答用于验证邮件链接与退订功能')
  await expect(page.locator(`#answer-${answer.info.id}`)).toBeInViewport()
  await page.goto(unsubscribeLink)
  await expect(page.getByRole('button', { name: '确认退订', exact: true })).toBeVisible()
  expect((await (await request.get(settingsPath, { headers })).json()).data.inbox.enable).toBe(true)
  await page.getByRole('button', { name: '确认退订', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已停止接收这类通知邮件')
  const after = (await (await request.get(settingsPath, { headers })).json()).data
  expect(after.inbox.enable).toBe(false)
  expect(after.all_new_question).toEqual(before.all_new_question)
  expect(after.all_new_question_for_following_tags).toEqual(before.all_new_question_for_following_tags)
})
