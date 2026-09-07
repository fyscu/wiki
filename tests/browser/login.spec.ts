import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const credentials = JSON.parse(await readFile('runtime/credentials.json', 'utf8'))

test('login waits for the backend verification state before enabling submission', async ({ page }) => {
  let release: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/_community/captcha?*', async route => { await gate; await route.continue() })
  await page.goto('/login/')
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled()
  release!()
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled()
})

test('the existing administrator can sign in by username and retain review access', async ({ page }, info) => {
  await page.goto('/login/?next=%2Freview%2F')
  await page.getByLabel('邮箱或用户名', { exact: true }).fill(credentials.admin_name)
  await page.getByLabel('密码', { exact: true }).fill(credentials.admin_password)
  await page.screenshot({ path: `test-results/username-login-${info.project.name}.png` })
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/review\/$/)
  await expect(page.locator('.qa-page')).toContainText('待审核内容')
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('feiyang-session-v2')!).user.role_id)).toBe(2)
  await page.getByRole('button', { name: '用户菜单', exact: true }).click()
  await expect(page.locator('.qa-account-identity')).toContainText(credentials.admin_name)
})
