import { test, expect } from '@playwright/test'
const registrationOpen = process.env.WIKI_REGISTRATION_OPEN === '1' || (process.env.WIKI_REGISTRATION_OPEN !== '0' && process.env.WIKI_BASE_URL?.startsWith('https://'))

test('account pages match the Wiki and reject expired links', async ({ page }, info) => {
  await page.goto('/login/')
  if (registrationOpen) {
    await expect(page.getByRole('tab', { name: '注册', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '忘记密码', exact: true })).toBeVisible()
    await page.goto('/register/')
    await expect(page.getByLabel('用户名', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '创建账号', exact: true })).toBeVisible()
    await page.screenshot({ path: `test-results/registration-open-${info.project.name}.png`, fullPage: true })
  } else {
    await expect(page.getByText('自助注册暂未开放。', { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: '注册', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '忘记密码', exact: true })).toHaveCount(0)
  }
  await page.goto('/users/account-activation?code=expired-deployment-check')
  await expect(page.locator('.md-content h1')).toHaveText('验证邮箱')
  await expect(page.locator('.qa-auth-page [role=alert]')).toBeVisible()
  expect(new URL(page.url()).search).toBe('')
  await page.goto('/users/password-reset?code=expired-deployment-check')
  await expect(page.locator('.md-content h1')).toHaveText('重置密码')
  await page.getByLabel('新密码', { exact: true }).fill('Unused-Test-Password-729')
  await page.getByLabel('确认密码', { exact: true }).fill('Unused-Test-Password-729')
  await page.getByRole('button', { name: '更新密码', exact: true }).click()
  await expect(page.locator('.qa-auth-page [role=alert]')).toBeVisible()
  await page.screenshot({ path: `test-results/account-reset-${info.project.name}.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false)
  await page.goto('/users/password-reset/')
  if (registrationOpen) {
    await expect(page.getByLabel('注册邮箱', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '发送重置邮件', exact: true })).toBeVisible()
  } else await expect(page.getByText('邮件服务暂未开放，请联系管理员。', { exact: true })).toBeVisible()
})

test('production API enforces registration policy and keeps admin routes private', async ({ request }) => {
  test.skip(!process.env.WIKI_BASE_URL?.startsWith('https://'), 'Production gateway only')
  for (const path of ['register', 'password/reset', 'email/resend']) {
    expect((await request.post('/_community/' + path, { data: {} })).status()).toBe(registrationOpen ? path === 'email/resend' ? 401 : 400 : 503)
  }
  const site = (await (await request.get('/_community/siteinfo')).json()).data
  expect(site.login.allow_new_registrations).toBe(Boolean(registrationOpen))
  expect(site.login.require_email_verification).toBe(true)
  expect((await request.get('/answer/admin/api/user')).status()).toBe(404)
  expect((await request.get('/_community/admin/api/user')).status()).toBe(404)
  expect((await request.get('/_community/reviews')).status()).toBe(401)
  expect((await request.post('/_community/questions', { data: {}, headers: { Origin: 'https://other.example', Authorization: 'Bearer example-user-token' } })).status()).toBe(403)
})
