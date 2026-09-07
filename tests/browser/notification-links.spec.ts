import { test, expect } from '@playwright/test'

const question = { id: '104', title: '通知链接定位测试', content: '通知内容', tags: [], user_info: { id: '1', display_name: '测试作者' }, vote_count: 0, answer_count: 21 }
const answer = { id: '105', content: '邮件中指定的回答', user_info: { id: '2', display_name: '测试回答者' }, vote_count: 0 }
async function mockPosts(page, outsideFirstPage = false, wrongQuestion = false) {
  await page.route('**/_community/question?*', route => route.fulfill({ json: { code: 200, data: question } }))
  await page.route('**/_community/answers?*', route => route.fulfill({ json: { code: 200, data: { count: 21, list: outsideFirstPage ? Array.from({ length: 20 }, (_, i) => ({ ...answer, id: String(200 + i), content: `其他回答 ${i}` })) : [answer] } } }))
  await page.route('**/_community/answer?*', route => route.fulfill({ json: { code: 200, data: { info: answer, question: { ...question, id: wrongQuestion ? '999' : question.id } } } }))
  await page.route('**/_community/comments?*', route => route.fulfill({ json: { code: 200, data: { list: [] } } }))
}

test('native notification links redirect without changing origin and locate the answer', async ({ page, request }) => {
  for (const path of ['/questions/104/105', '/questions/104/title/105/']) {
    const response = await request.get(path + '?commentId=106&id=999', { maxRedirects: 0 })
    expect(response.status()).toBe(302)
    const target = new URL(response.headers().location, response.url())
    expect(target.pathname).toBe('/question/')
    expect(target.search).toBe('?id=104&answer=105&commentId=106')
    expect(target.origin).toBe(new URL(response.url()).origin)
  }
  await mockPosts(page)
  await page.goto('/questions/104/105')
  await expect(page.locator('#question-title')).toHaveText(question.title)
  await expect(page.locator('#answer-105')).toContainText(answer.content)
  await expect(page.locator('#answer-105')).toBeInViewport()
})

test('a linked answer outside the first page is loaded and remains visible on mobile', async ({ page }, info) => {
  await mockPosts(page, true)
  await page.goto('/questions/104/title/105')
  await expect(page.locator('.qa-answer')).toHaveCount(21)
  await expect(page.locator('#answer-105')).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false)
  await page.screenshot({ path: `test-results/notification-target-${info.project.name}.png` })
})

test('a reply from another question is not inserted into the linked question', async ({ page }) => {
  await mockPosts(page, true, true)
  await page.goto('/questions/104/105')
  await expect(page.locator('.qa-alert')).toContainText('不属于当前问题')
  await expect(page.locator('#answer-105')).toHaveCount(0)
})

test('unsubscribe links render in the Wiki and only submit after confirmation', async ({ page }) => {
  let submissions = 0
  page.on('request', request => { if (request.url().endsWith('/_community/email/unsubscribe')) submissions++ })
  await page.goto('/users/unsubscribe?code=expired-notification-test')
  await expect(page.getByRole('button', { name: '确认退订', exact: true })).toBeVisible()
  expect(new URL(page.url()).search).toBe('')
  expect(submissions).toBe(0)
  await page.getByRole('button', { name: '确认退订', exact: true }).click()
  await expect(page.locator('.qa-auth-page [role=alert]')).toBeVisible()
  expect(submissions).toBe(1)
})
