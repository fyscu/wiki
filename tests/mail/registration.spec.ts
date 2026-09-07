import { test as base, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { startMailLab } from '../../scripts/mail-lab.mjs'

const test = base.extend<{}, { lab: Awaited<ReturnType<typeof startMailLab>> }>({
  lab: [async ({}, use) => { const lab = await startMailLab(); try { await use(lab) } finally { await lab.close() } }, { scope: 'worker' }],
})

async function emailLink(lab, page, recipient, pathname, after = 0) {
  await expect.poll(() => lab.messages.slice(after).filter(mail => mail.recipients.includes(recipient) && String(mail.html).includes(pathname)).length).toBeGreaterThan(0)
  const mail = lab.messages.slice(after).filter(mail => mail.recipients.includes(recipient) && String(mail.html).includes(pathname)).at(-1)
  // Parse the delivered HTML through the browser DOM, without saving the one-time link.
  const link = await page.evaluate(({ html, pathname }) => {
    const document = new DOMParser().parseFromString(html, 'text/html')
    return Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).find(href => href?.includes(pathname))
  }, { html: mail.html, pathname })
  expect(new URL(link).origin).toBe(lab.origin)
  return link
}

test('register, deliver activation, activate in another tab, and reset password with one-time links', async ({ page, browser, request, lab }, info) => {
  const email = `user-${randomBytes(5).toString('hex')}@wiki-mail.test`, password = 'Initial-Password-917', newPassword = 'Changed-Password-928'
  await page.goto(lab.origin + '/register/?next=%2Fask%2F')
  await page.getByLabel('用户名', { exact: true }).fill('邮箱验证用户')
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByLabel('确认密码', { exact: true }).fill(password)
  await page.screenshot({ path: `test-results-mail/register-${info.project.name}.png` })
  await page.getByRole('button', { name: '创建账号', exact: true }).click()
  await expect(page).toHaveURL(/account-activation/)
  await expect(page.locator('.qa-auth-page')).toContainText(email)
  await expect(page.getByRole('button', { name: /秒后可重发/ })).toBeDisabled()
  const firstLink = await emailLink(lab, page, email, '/users/account-activation')
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('feiyang-session-v2')!).token)
  const denied = await request.post(lab.origin + '/_community/questions', { headers: { Authorization: `Bearer ${token}` }, data: { title: '未激活账号提问验证', content: '未验证邮箱的账号不应发布内容', tags: [{ slug_name: 'general' }] } })
  expect(denied.status()).toBe(403)

  await page.evaluate(email => sessionStorage.removeItem(`feiyang-mail-cooldown:${email}`), email)
  await page.reload()
  await page.getByRole('button', { name: '重新发送验证邮件', exact: true }).click()
  await expect(page.getByRole('button', { name: /秒后可重发/ })).toBeDisabled()
  const latestLink = await emailLink(lab, page, email, '/users/account-activation', 1)
  expect(latestLink).not.toBe(firstLink)
  const old = await request.post(lab.origin + '/_community/email/verify', { data: { code: new URL(firstLink).searchParams.get('code') } })
  expect(old.status()).toBe(403)
  const separate = await browser.newContext()
  const activation = await separate.newPage()
  await activation.goto(latestLink)
  await expect(activation.getByRole('status')).toContainText('邮箱验证成功')
  expect(new URL(activation.url()).search).toBe('')
  const replay = await request.post(lab.origin + '/_community/email/verify', { data: { code: new URL(latestLink).searchParams.get('code') } })
  expect(replay.status()).toBe(403)
  await separate.close()
  await page.reload()
  await expect(page.getByRole('status')).toContainText('邮箱已验证')
  await expect(page.getByRole('link', { name: '继续访问', exact: true })).toHaveAttribute('href', '/ask/')

  await page.goto(lab.origin + '/login/')
  await page.evaluate(() => sessionStorage.removeItem('feiyang-session-v2'))
  await page.reload()
  await page.getByRole('link', { name: '忘记密码' }).click()
  await page.getByLabel('注册邮箱', { exact: true }).fill(email)
  const mailCount = lab.messages.length
  await page.getByRole('button', { name: '发送重置邮件', exact: true }).click()
  const resetLink = await emailLink(lab, page, email, '/users/password-reset', mailCount)
  await page.goto(resetLink)
  await page.getByLabel('新密码', { exact: true }).fill(newPassword)
  await page.getByLabel('确认密码', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: '更新密码', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('密码已更新')
  const oldPassword = await request.post(lab.origin + '/_community/login', { data: { e_mail: email, pass: password } })
  expect(oldPassword.status()).toBe(400)
  const replayPassword = await request.post(lab.origin + '/_community/password/replace', { data: { code: new URL(resetLink).searchParams.get('code'), pass: password } })
  expect(replayPassword.status()).toBe(403)
  await page.getByRole('link', { name: '返回登录' }).click()
  await page.getByLabel('邮箱或用户名', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(lab.origin + '/questions/')
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('feiyang-session-v2')!).user.mail_status)).toBe(1)
})
