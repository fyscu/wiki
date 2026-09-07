import { expect, test } from '@playwright/test'
import { fixture, originalBody } from './fixture'

const openArticle = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: /入门指南 guide\/start.md/ }).click()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('入门指南')
}

test('guest, moderator, and expired session gates', async ({ page }) => {
  const guest = await fixture(page, null)
  await expect(page.getByRole('link', { name: '登录', exact: true })).toHaveAttribute('href', '/login/?next=%2Feditor%2F')
  expect(guest.requests).toHaveLength(0)
  await page.unrouteAll()
  await fixture(page, 3)
  await expect(page.getByRole('alert')).toHaveText('仅管理员可访问')
  await page.unrouteAll()
  const admin = await fixture(page)
  await expect(page.getByRole('button', { name: '新建文章', exact: true }).first()).toBeVisible()
  admin.control.stateStatus = 401
  await page.getByRole('button', { name: '刷新列表' }).click()
  await expect(page.getByRole('link', { name: '登录', exact: true })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('feiyang-session-v2'))).toBeNull()
})

test('search, responsive layout, and intact Markdown', async ({ page }, testInfo) => {
  const model = await fixture(page)
  await page.getByRole('textbox', { name: '搜索文章' }).fill('dev.md')
  await expect(page.locator('.we-article-row')).toHaveCount(1)
  await page.getByRole('button', { name: '清空搜索' }).click()
  await openArticle(page)
  await expect(page.locator('.cm-content')).toContainText('# 原有标题')
  expect(model.control.saveRequests).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '分屏预览' }).click()
  await expect(page.getByRole('heading', { name: '原有标题', exact: true })).toBeVisible()
  expect(model.details.get('a1')!.body).toBe(originalBody)
  await page.evaluate(() => document.body.setAttribute('data-md-color-scheme', 'slate'))
  await page.screenshot({ path: testInfo.outputPath('editor-dark.png'), fullPage: true })
})

test('serial autosave retains edits made during a request', async ({ page }) => {
  const model = await fixture(page); model.control.putDelay = 600
  await openArticle(page)
  await page.getByRole('textbox', { name: '文章标题' }).fill('第一次修改')
  await expect.poll(() => model.control.saveRequests).toBe(1)
  await page.getByRole('textbox', { name: '文章标题' }).fill('保存过程中继续修改')
  await expect.poll(() => model.details.get('a1')!.title).toBe('保存过程中继续修改')
  const puts = model.requests.filter(item => item.method === 'PUT' && item.path === '/articles/a1')
  expect(puts.map(item => item.body.version)).toEqual([1, 2])
  expect(puts.every(item => item.body.body === originalBody)).toBe(true)
  expect(puts[0].headers.authorization).toBe('Bearer editor-test-token')
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('保存过程中继续修改')
})

test('save conflict keeps local draft and requires confirmation to reload', async ({ page }) => {
  const model = await fixture(page); model.control.conflict = true
  await openArticle(page)
  await page.getByRole('textbox', { name: '文章标题' }).fill('本地冲突草稿')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.we-save-status')).toContainText('版本冲突')
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('本地冲突草稿')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '载入服务器版本' }).click()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('本地冲突草稿')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '载入服务器版本' }).click()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('入门指南')
})

test('preview waits for save, uses an empty sandbox, and polling preserves local input', async ({ page }) => {
  const model = await fixture(page); model.control.putDelay = 500
  await openArticle(page)
  await page.getByRole('textbox', { name: '文章标题' }).fill('预览版本')
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '站点预览' })).toBeVisible()
  const saveIndex = model.requests.findIndex(item => item.method === 'PUT')
  const previewIndex = model.requests.findIndex(item => item.path === '/preview')
  expect(previewIndex).toBeGreaterThan(saveIndex)
  expect(model.requests[previewIndex].body.version).toBe(2)
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', '')
  await expect(page.frameLocator('iframe').getByRole('heading', { name: '入门指南' })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__previewScriptRan)).toBeUndefined()
  await page.getByRole('button', { name: '关闭对话框' }).click()
  model.control.jobStatus = 'building'
  await page.getByRole('button', { name: '发布', exact: true }).click()
  await expect.poll(() => model.requests.some(item => item.path === '/publish')).toBe(true)
  model.control.putDelay = 3000
  await page.getByRole('textbox', { name: '文章标题' }).fill('发布之后正在输入')
  model.control.jobStatus = 'succeeded'
  await expect.poll(() => model.requests.filter(item => item.path.startsWith('/jobs/')).length).toBeGreaterThan(1)
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('发布之后正在输入')
})

test('navigation CRUD, reparenting, save and publish include the current navigation version', async ({ page }) => {
  const model = await fixture(page)
  await page.getByRole('button', { name: '目录', exact: true }).click()
  await page.getByRole('button', { name: '新建栏目' }).click()
  await page.getByRole('textbox', { name: '栏目名称', exact: true }).fill('新栏目')
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await page.getByRole('combobox', { name: '入门指南的上级栏目' }).selectOption({ label: '新栏目' })
  await page.getByRole('button', { name: '重命名新栏目' }).click()
  await page.getByRole('textbox', { name: '栏目名称', exact: true }).fill('资料')
  await page.getByRole('button', { name: '确认名称' }).click()
  await page.getByRole('button', { name: '上移资料' }).click()
  await page.getByRole('button', { name: '保存目录' }).click()
  await expect.poll(() => model.data.navigation.version).toBe(2)
  const section = model.data.navigation.items.find(item => item.title === '资料')!
  expect(section.id).toMatch(/^[\da-f-]{36}$/)
  expect(section.children![0].path).toBe('guide/start.md')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '删除资料' }).click()
  await page.getByRole('button', { name: '发布', exact: true }).click()
  await expect.poll(() => model.requests.some(item => item.path === '/publish')).toBe(true)
  const publish = model.requests.find(item => item.path === '/publish')!
  expect(publish.body.navigationVersion).toBe(3)
  expect(publish.body).not.toHaveProperty('articleIds')
  expect(model.data.navigation.items.some(item => item.path === 'guide/start.md')).toBe(true)
  expect(model.data.navigation.items.some(item => item.path === 'login.md')).toBe(true)
})

test('raw image upload inserts persistent path and uses signed URL only in preview', async ({ page }) => {
  const model = await fixture(page); model.control.uploadDelay = 300
  await openArticle(page)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.locator('input[type=file]').setInputFiles({ name: '示例.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) })
  await expect(page.locator('.cm-content')).toContainText('/images/uploads/hash.webp')
  const upload = model.requests.find(item => item.path === '/media')!
  expect(upload.headers['x-file-name']).toBe(encodeURIComponent('示例.png'))
  expect(upload.headers['content-type']).toBe('image/png')
  expect(Buffer.isBuffer(upload.body)).toBe(true)
  await page.getByRole('button', { name: '分屏预览' }).click()
  await expect(page.locator('.we-inline-preview img')).toHaveAttribute('src', /test-image.webp\?capability=secret/)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(() => model.details.get('a1')!.body).toContain('/images/uploads/hash.webp')
  expect(model.details.get('a1')!.body).not.toContain('capability')
})

test('history restoration and draft discard both require confirmation', async ({ page }) => {
  const model = await fixture(page)
  await openArticle(page)
  await page.getByRole('button', { name: '文章历史' }).click()
  await page.getByRole('button', { name: /最初版本/ }).click()
  await expect(page.getByLabel('历史正文')).toContainText('# 历史正文')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '恢复为草稿' }).click()
  expect(model.requests.some(item => item.path.endsWith('/restore'))).toBe(false)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '恢复为草稿' }).click()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('历史标题')
  expect(model.details.get('a1')!.dirty).toBe(true)
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: '丢弃草稿' }).click()
  expect(model.requests.some(item => item.path.endsWith('/discard'))).toBe(false)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '丢弃草稿' }).click()
  await expect(page.locator('.cm-content')).toContainText('# 原有标题')
})

test('create uses selected section and keeps the returned full body', async ({ page }) => {
  const model = await fixture(page)
  await page.getByRole('button', { name: '新建文章', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '新建文章' })
  await dialog.getByRole('textbox', { name: '标题', exact: true }).fill('新文章')
  await dialog.getByRole('textbox', { name: '路径', exact: true }).fill('guide/new.md')
  await dialog.getByRole('combobox', { name: '栏目', exact: true }).selectOption('root')
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('新文章')
  await expect(page.locator('.cm-content')).toContainText('# 新文章')
  expect(model.requests.find(item => item.path === '/articles')!.body).toEqual({ title: '新文章', path: 'guide/new.md', sectionId: 'root' })
})

test('article deep link accepts canonical H1 without an extra write', async ({ page }) => {
  const model = await fixture(page)
  model.details.get('a1')!.body = '# 入门指南\n\n原有内容\n'
  await page.goto('/community/editor/tests/index.html?article=a1')
  await expect(page.getByRole('textbox', { name: '文章标题' })).toHaveValue('入门指南')
  expect(model.control.saveRequests).toBe(0)
  await page.getByRole('textbox', { name: '文章标题' }).fill('新的标题')
  await expect.poll(() => model.details.get('a1')!.title).toBe('新的标题')
  await expect(page.locator('.cm-content')).toContainText('# 新的标题')
  await expect(page.locator('.we-save-status')).toContainText('已保存')
  expect(model.control.saveRequests).toBe(1)
  expect(model.details.get('a1')!.body).toBe('# 新的标题\n\n原有内容\n')
  await page.getByRole('button', { name: '发布', exact: true }).click()
  await expect.poll(() => model.requests.some(item => item.path === '/publish')).toBe(true)
  expect(model.requests.find(item => item.path === '/publish')!.body.navigationVersion).toBe(2)
})

test('canonical H1 merge preserves body input made during autosave', async ({ page }) => {
  const model = await fixture(page)
  model.details.get('a1')!.body = '# 入门指南\n\n原有内容\n'
  model.control.putDelay = 800
  await openArticle(page)
  await page.getByRole('textbox', { name: '文章标题' }).fill('新的标题')
  await expect.poll(() => model.control.saveRequests).toBe(1)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('继续写入')
  await expect.poll(() => model.details.get('a1')!.body).toContain('继续写入')
  await expect(page.locator('.cm-content')).toContainText('继续写入')
  expect(model.control.saveRequests).toBe(2)
})

test('saved directory-only changes publish and a failed job stays visible', async ({ page }) => {
  const model = await fixture(page)
  model.data.navigation.dirty = true
  model.control.jobStatus = 'failed'
  await page.getByRole('button', { name: '刷新列表' }).click()
  await expect(page.getByRole('button', { name: '发布', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '发布', exact: true }).click()
  await expect(page.locator('.we-running')).toContainText('构建失败')
  expect(model.control.saveRequests).toBe(0)
  expect(model.requests.find(item => item.path === '/publish')!.body).toEqual({ navigationVersion: 1 })
})

test('local section edits survive article title saves and directory conflicts', async ({ page }) => {
  const model = await fixture(page)
  await openArticle(page)
  await page.getByRole('button', { name: '目录', exact: true }).click()
  await page.getByRole('button', { name: '重命名指南' }).click()
  await page.getByRole('textbox', { name: '栏目名称', exact: true }).fill('本地栏目')
  await page.getByRole('button', { name: '确认名称' }).click()
  await page.getByRole('button', { name: '文章', exact: true }).click()
  await page.getByRole('textbox', { name: '文章标题' }).fill('修改后的文章标题')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.we-save-status')).toContainText('已保存')
  await page.getByRole('button', { name: '目录', exact: true }).click()
  await expect(page.getByRole('button', { name: '重命名本地栏目' })).toBeVisible()
  model.control.navConflict = true
  await page.getByRole('button', { name: '保存目录' }).click()
  await expect(page.getByRole('button', { name: '保存目录' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '重命名本地栏目' })).toBeVisible()
  const request = model.requests.find(item => item.path === '/navigation')!
  expect(request.body.version).toBe(2)
  expect(request.body.items[0].title).toBe('本地栏目')
  expect(request.body.items[0].children[0].title).toBe('修改后的文章标题')
})

test('pasted and dropped images retain their insertion points during upload', async ({ page }) => {
  const model = await fixture(page); model.control.uploadDelay = 600
  await openArticle(page)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.locator('.cm-content').evaluate(element => {
    const clipboardData = new DataTransfer()
    clipboardData.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'paste.png', { type: 'image/png' }))
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })
  await page.keyboard.press('Control+Home')
  await page.keyboard.insertText('新增前缀\n')
  await expect(page.locator('.cm-content')).toContainText('![paste.png]')
  await page.locator('.cm-content').evaluate(element => {
    const dataTransfer = new DataTransfer(), rect = element.getBoundingClientRect()
    dataTransfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'drop.png', { type: 'image/png' }))
    element.dispatchEvent(new DragEvent('drop', { dataTransfer, clientX: rect.left + 20, clientY: rect.top + 15, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.cm-content')).toContainText('![drop.png]')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(() => model.details.get('a1')!.body).toContain('![drop.png]')
  const body = model.details.get('a1')!.body
  expect(body.indexOf('新增前缀')).toBeLessThan(body.indexOf('![paste.png]'))
  expect(body.indexOf('![paste.png]')).toBeGreaterThan(body.indexOf('int main()'))
  expect(body).not.toContain('capability')
  expect(model.requests.filter(item => item.path === '/media')).toHaveLength(2)
})
