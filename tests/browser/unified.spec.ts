import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

const backend = 'http://127.0.0.1:9080'
const wikiOrigin = new URL(process.env.WIKI_BASE_URL || 'http://127.0.0.1:5173').origin
const credentials = JSON.parse(await readFile('runtime/credentials.json', 'utf8'))
const docId = '01arz3ndektsv4rrffq69g5fav'

async function backendCall(request, path, method = 'GET', data?, token?) {
  const response = await request.fetch(backend + path, { method, data, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const body = await response.json()
  expect(response.ok(), JSON.stringify({ path, msg: body.msg })).toBeTruthy()
  expect(body.code).toBe(200)
  return body.data
}
async function signIn(page, email = credentials.admin_email, password = credentials.admin_password, next = '/questions/') {
  await page.goto('/questions/')
  await expect(page.locator('[data-wiki-component="account-menu"] a, [data-wiki-component="account-menu"] button').first()).toBeVisible()
  const menu = page.getByRole('button', { name: '用户菜单', exact: true })
  if (await menu.isVisible()) {
    await menu.click()
    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await expect(page).toHaveURL(wikiOrigin + '/')
    await expect(menu).toHaveCount(0)
  }
  await page.goto(`/login/?next=${encodeURIComponent(next)}`)
  await page.getByLabel('邮箱或用户名', { exact: true }).fill(email)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test('uses OI Wiki templates, same-origin navigation and local Chinese search', async ({ page }, info) => {
  const errors = [], external = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/search\.oi-wiki|giscus\.app|fonts\.google/.test(request.url())) external.push(request.url()) })
  await page.goto('/')
  await expect(page.locator('meta[name=generator]')).toHaveAttribute('content', /OI Wiki Material b80fbeb/)
  await expect(page.locator('.md-header')).toBeVisible()
  await expect(page.locator('.md-content h1')).toHaveText('飞扬 Wiki')
  if (info.project.name === 'desktop') {
    await expect(page.locator('.md-tabs')).toBeVisible()
    await expect(page.locator('.md-sidebar--primary')).toBeVisible()
    await expect(page.locator('.md-sidebar--secondary')).toBeVisible()
  }
  expect(await page.locator('.feiyang-wordmark img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  await page.screenshot({ path: `test-results/oi-home-${info.project.name}.png`, fullPage: true })
  if (info.project.name === 'mobile') await page.locator('.md-header__button[for="__search"]').click()
  await page.locator('[data-md-component=search-query]').fill('启动')
  await page.locator('[data-md-component=search-query]').press('ArrowRight')
  await expect(page.locator('.md-search-result__list')).toContainText('计算机启动与排障')
  expect(external).toEqual([])
  await page.goto('/handbook/startup/')
  await expect(page.getByRole('heading', { name: '本文问答' })).toBeVisible()
  await expect(page.getByRole('link', { name: '针对本文提问' })).toHaveAttribute('href', `/ask/?article=${docId}`)
  await page.goto('/questions/')
  await expect(page.locator('.qa-page')).toBeVisible()
  await expect(page.locator('.qa-page')).not.toContainText('正在加载问题')
  await page.screenshot({ path: `test-results/oi-questions-${info.project.name}.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false)
  expect(await page.locator('iframe').count()).toBe(0)
  expect(errors).toEqual([])
})

test('ask, moderate, answer and accept stay in the Wiki interface', async ({ page, request }, info) => {
  const admin = await backendCall(request, '/answer/api/v1/user/login/email', 'POST', { e_mail: credentials.admin_email, pass: credentials.admin_password })
  const unique = randomBytes(5).toString('hex')
  const email = `wiki-test-${unique}@feiyang.local`, password = randomBytes(14).toString('base64url')
  await backendCall(request, '/answer/admin/api/user', 'POST', { display_name: `验证用户${unique}`, email, password }, admin.access_token)
  const user = await backendCall(request, '/answer/api/v1/user/login/email', 'POST', { e_mail: email, pass: password })
  const title = `启动问题联调 ${info.project.name} ${unique}`
  let peer
  let questionId = ''
  try {
    await signIn(page, email, password, `/ask/?article=${docId}`)
    await page.getByLabel('问题标题', { exact: true }).fill(title)
    await page.getByRole('textbox', { name: '问题描述', exact: true }).fill('测试场景：固件能够识别系统盘，但没有可用的启动项。已记录设备型号和当前启动方式。')
    const submitted = page.waitForResponse(response => response.url().endsWith('/_community/questions') && response.request().method() === 'POST')
    await page.getByRole('button', { name: '发布问题', exact: true }).click()
    const submittedResponse = await submitted
    if (submittedResponse.status() !== 200) expect(submittedResponse.status(), JSON.stringify(await submittedResponse.json())).toBe(200)
    await expect(page).toHaveURL(/\/question\/\?id=/)
    questionId = new URL(page.url()).searchParams.get('id')!
    await expect(page.locator('#question-title')).toHaveText(title)
    await expect(page.getByText('待审核', { exact: true })).toBeVisible()
    expect(new URL(page.url()).origin).toBe(wikiOrigin)
    const guest = await request.get(`/_community/question?id=${questionId}`)
    expect(guest.status()).toBeGreaterThanOrEqual(400)
    const forbidden = await request.put('/_community/reviews', { headers: { Authorization: `Bearer ${user.access_token}` }, data: { review_id: 1, status: 'approve' } })
    expect(forbidden.status()).toBe(403)
    await signIn(page, credentials.admin_email, credentials.admin_password, `/review/?object=${questionId}`)
    const review = page.locator('.qa-review-item').filter({ hasText: title })
    await expect(review).toBeVisible()
    await review.getByRole('button', { name: '通过', exact: true }).click()
    await expect(review).toHaveCount(0)
    await page.goto(`/question/?id=${questionId}`)
    await page.getByRole('button', { name: '赞同问题', exact: true }).click()
    await expect(page.locator('#question .qa-votes strong')).toHaveText('1')
    await page.getByRole('textbox', { name: '你的回答', exact: true }).fill('先核对 UEFI 启动方式与系统盘的分区布局，再检查 EFI 系统分区及现有引导项。修改前先备份数据。')
    await page.getByRole('button', { name: '提交回答', exact: true }).click()
    await expect(page.locator('.qa-answer')).toHaveCount(1)
    await page.locator('#question').getByRole('button', { name: '补充讨论' }).click()
    await page.locator('#question').getByRole('textbox', { name: '补充讨论', exact: true }).fill('补充确认：重要数据已经备份。')
    await page.locator('#question').getByRole('button', { name: '提交', exact: true }).click()
    await expect(page.locator('#question .qa-comment')).toContainText('重要数据已经备份')
    await signIn(page, email, password, `/question/?id=${questionId}`)
    await page.getByRole('button', { name: '采纳回答', exact: true }).click()
    await expect(page.locator('.qa-answer-top')).toContainText('已采纳')
    const headingBox = await page.locator('#question-title').boundingBox()
    const metaBox = await page.locator('.qa-page > .qa-detail-meta').boundingBox()
    expect(metaBox!.y - headingBox!.y - headingBox!.height).toBeGreaterThanOrEqual(8)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false)
    await page.screenshot({ path: `test-results/oi-question-detail-${info.project.name}.png`, fullPage: true })
    await page.goto('/handbook/startup/')
    await expect(page.locator('.qa-article-section')).toContainText(title)
    const peerEmail = `wiki-test-peer-${unique}@feiyang.local`
    await backendCall(request, '/answer/admin/api/user', 'POST', { display_name: `互助用户${unique}`, email: peerEmail, password }, admin.access_token)
    peer = await backendCall(request, '/answer/api/v1/user/login/email', 'POST', { e_mail: peerEmail, pass: password })
    await signIn(page, peerEmail, password, `/question/?id=${questionId}`)
    await page.getByRole('textbox', { name: '你的回答', exact: true }).fill('也可以先使用系统恢复介质确认启动分区状态，并记录诊断结果供进一步排查。')
    const peerSubmission = page.waitForResponse(response => response.url().endsWith('/_community/answers') && response.request().method() === 'POST')
    await page.getByRole('button', { name: '提交回答', exact: true }).click()
    const peerAnswer = (await (await peerSubmission).json()).data
    await expect(page.locator('.qa-answer .qa-status-pending')).toHaveText('待审核')
    const beforeReview = await request.get(`/_community/answers?question_id=${questionId}&page=1&page_size=20`)
    expect((await beforeReview.json()).data.list).toHaveLength(1)
    expect(peerAnswer.info.id).toBeTruthy()
    await signIn(page, credentials.admin_email, credentials.admin_password, `/review/?object=${peerAnswer.info.id}`)
    const peerReview = page.locator('.qa-review-item').filter({ hasText: '也可以先使用系统恢复介质' })
    await expect(peerReview).toBeVisible()
    await peerReview.getByRole('button', { name: '通过', exact: true }).click()
    await expect(peerReview).toHaveCount(0)
    const afterReview = await request.get(`/_community/answers?question_id=${questionId}&page=1&page_size=20`)
    expect((await afterReview.json()).data.list).toHaveLength(2)
  } finally {
    if (!questionId && new URL(page.url()).pathname === '/question/') questionId = new URL(page.url()).searchParams.get('id') || ''
    if (questionId) await backendCall(request, '/answer/api/v1/question', 'DELETE', { id: questionId }, admin.access_token)
    await backendCall(request, '/answer/admin/api/user/status', 'PUT', { user_id: user.id, status: 'deleted', remove_all_content: false }, admin.access_token)
    if (peer) await backendCall(request, '/answer/admin/api/user/status', 'PUT', { user_id: peer.id, status: 'deleted', remove_all_content: false }, admin.access_token)
  }
})
