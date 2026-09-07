import { test as base, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { startMailLab } from '../../scripts/mail-lab.mjs'

const test = base.extend<{}, { lab: Awaited<ReturnType<typeof startMailLab>> }>({
  lab: [async ({}, use) => { const lab = await startMailLab(); try { await use(lab) } finally { await lab.close() } }, { scope: 'worker' }],
})

test('email and username sign in to the same account, while invalid and disabled accounts remain blocked', async ({ lab, page, request }, info) => {
  const suffix = randomBytes(5).toString('hex'), email = `login-${suffix}@wiki-mail.test`, password = 'Login-Test-Password-815'
  await lab.adminCall('/answer/admin/api/user', 'POST', { display_name: `Login-${suffix}`, email, password })
  async function login(identifier, pass = password) {
    return request.post(lab.origin + '/_community/login', { data: { e_mail: identifier, pass } })
  }
  const emailResponse = await login(email)
  expect(emailResponse.status()).toBe(200)
  const user = (await emailResponse.json()).data
  for (const identifier of [user.username, user.username.toUpperCase(), `  ${user.username}  `]) {
    const response = await login(identifier)
    expect(response.status()).toBe(200)
    const data = (await response.json()).data
    expect(data.id).toBe(user.id)
    expect(data.role_id).toBe(1)
  }
  const wrong = await login(user.username, 'Wrong-Test-Password-816')
  const missing = await login(`missing-${suffix}`)
  expect(wrong.status()).toBe(400)
  expect(missing.status()).toBe(400)
  expect((await wrong.json()).reason).toBe((await missing.json()).reason)

  await page.goto(lab.origin + '/login/?next=%2Fask%2F')
  await page.getByLabel('邮箱或用户名', { exact: true }).fill(user.username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.screenshot({ path: `test-results-mail/username-login-${info.project.name}.png` })
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(lab.origin + '/ask/')
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('feiyang-session-v2')!).user.id)).toBe(user.id)
  await page.getByRole('button', { name: '用户菜单', exact: true }).click()
  await expect(page.locator('.qa-account-identity')).toContainText(user.username)

  await lab.adminCall('/answer/admin/api/user/status', 'PUT', { user_id: user.id, status: 'suspended', suspend_duration: '24h', remove_all_content: false })
  expect((await login(user.username)).status()).toBe(403)
  expect((await login(email)).status()).toBe(403)
  await lab.adminCall('/answer/admin/api/user/status', 'PUT', { user_id: user.id, status: 'deleted', remove_all_content: false })
  expect((await login(user.username)).status()).toBe(400)
  expect((await login(email)).status()).toBe(400)
})

test('username login preserves pending email verification and the password-login switch', async ({ lab, request }) => {
  const suffix = randomBytes(5).toString('hex'), password = 'Pending-Test-Password-817'
  const register = await request.post(lab.origin + '/_community/register', { data: { name: `Pending-${suffix}`, e_mail: `pending-${suffix}@wiki-mail.test`, pass: password } })
  expect(register.status()).toBe(200)
  const user = (await register.json()).data
  const response = await request.post(lab.origin + '/_community/login', { data: { e_mail: user.username, pass: password } })
  expect(response.status()).toBe(200)
  const data = (await response.json()).data
  expect(data.mail_status).toBe(2)
  expect((await request.post(lab.origin + '/_community/questions', { headers: { Authorization: `Bearer ${data.access_token}` }, data: { title: '未验证账号测试', content: '验证邮箱后才允许发布', tags: [] } })).status()).toBe(403)
  const path = '/answer/admin/api/siteinfo/login'
  const settings = await lab.adminCall(path)
  try {
    await lab.adminCall(path, 'PUT', { ...settings, allow_password_login: false })
    for (const identifier of [user.username, user.e_mail]) expect((await request.post(lab.origin + '/_community/login', { data: { e_mail: identifier, pass: password } })).status()).toBe(400)
  } finally { await lab.adminCall(path, 'PUT', settings) }
})
