import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import matter from 'gray-matter'
import YAML from 'yaml'
import MarkdownIt from 'markdown-it'
import { load } from 'cheerio'

const markdown = new MarkdownIt({ html: true })
const validationMarkdown = new MarkdownIt({ html: true })
validationMarkdown.validateLink = () => true
function unsafeURL(value) { return /^(?:javascript|vbscript|data|file):/i.test(String(value).replace(/[\u0000-\u0020]/g, '')) }
export const digest = value => createHash('sha256').update(value).digest('hex')
export function fail(message, status = 400, code = 'invalid') { throw Object.assign(new Error(message), { status, code }) }
export function documentPath(path) {
  if (typeof path !== 'string' || path.length > 160 || !/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*\.md$/.test(path)) fail('文章路径须使用小写英文、数字和连字符，以 .md 结尾')
  return path
}
export function editableDocumentPath(path) {
  documentPath(path)
  const parts = path.split('/')
  if (['index.md', 'ask.md', 'question.md', 'questions.md', 'login.md', 'register.md', 'review.md', 'editor.md'].includes(path) || ['users', 'assets', 'images', 'scripts', 'hooks', 'editor', '_static', 'public', 'ask', 'question', 'questions', 'login', 'register', 'review'].includes(parts[0]) || parts.some(part => /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) fail('该路径由系统保留，请选择其他路径')
  return path
}
export function parseArticle(raw, path) {
  const parsed = matter(raw, { engines: { yaml: value => YAML.parse(value.replace(/\r\n?/g, '\n'), { maxAliasCount: 20 }) } })
  const tokens = markdown.parse(parsed.content, {})
  const heading = tokens.findIndex(token => token.type === 'heading_open' && token.tag === 'h1')
  return { title: String(parsed.data.title || (heading >= 0 ? tokens[heading + 1].content : path.replace(/\.md$/, ''))), body: parsed.content,
    tags: Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [], owners: Array.isArray(parsed.data.owners) ? parsed.data.owners.map(String) : [], docId: parsed.data.doc_id || null,
    matter: parsed.matter, hasMatter: Boolean(parsed.matter), metadata: parsed.data }
}
export function validateArticle(input) {
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 150 || /[\r\n\0]/.test(input.title)) fail('请填写 150 字以内的标题')
  if (typeof input.body !== 'string' || Buffer.byteLength(input.body) > 300000 || input.body.includes('\0')) fail('正文过长或包含无效字符')
  for (const key of ['tags', 'owners']) if (!Array.isArray(input[key]) || input[key].length > 20 || input[key].some(value => typeof value !== 'string' || !value.trim() || value.length > 80 || /[\r\n\0]/.test(value))) fail(`${key === 'tags' ? '标签' : '负责人'}格式有误`)
  for (const token of validationMarkdown.parse(input.body, {})) {
    const parts = token.children || [token]
    for (const part of parts) {
      if (['link_open', 'image'].includes(part.type) && unsafeURL(part.attrGet(part.type === 'image' ? 'src' : 'href'))) fail('链接地址须使用网页地址或站内路径')
      if (part.type === 'html_block' || part.type === 'html_inline') {
      const $ = load(part.content)
      if ($('script,iframe,object,embed,form,input,style,link,meta,base').length) fail('可执行 HTML 请放入代码块')
      $('*').each((_, node) => { for (const [name, value] of Object.entries(node.attribs || {})) if (/^on/i.test(name) || (['href', 'src', 'xlink:href', 'action'].includes(name) && unsafeURL(value))) fail('HTML 含有可执行属性，请放入代码块') })
      }
    }
  }
}
export function serializeArticle(record, draft) {
  const base = record.publishedRaw ? parseArticle(record.publishedRaw, record.path) : null
  const document = YAML.parseDocument((base?.matter || '').replace(/\r\n?/g, '\n'))
  document.set('title', draft.title.trim())
  if (record.docId) document.set('doc_id', record.docId)
  if (record.docId || draft.owners.length || base?.metadata.owners) document.set('owners', draft.owners)
  if (draft.tags.length || base?.metadata.tags) document.set('tags', draft.tags)
  document.set('updated', new Date().toISOString().slice(0, 10))
  return '---\n' + document.toString() + '---\n' + draft.body
}
export function updateHeading(body, oldTitle, title) {
  if (title === oldTitle) return body
  const tokens = markdown.parse(body, {})
  const index = tokens.findIndex(token => token.type === 'heading_open' && token.tag === 'h1')
  if (index < 0 || tokens[index + 1].content !== oldTitle || tokens[index].map[1] - tokens[index].map[0] !== 1) return body
  const lines = body.split('\n'); lines[tokens[index].map[0]] = '# ' + title
  return lines.join('\n')
}
export async function readRepository(repoDir) {
  const docs = resolve(repoDir, 'docs'), articles = [], paths = new Set(), protectedPaths = new Set()
  for (const entry of await readdir(docs, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const absolute = resolve(entry.parentPath, entry.name), path = relative(docs, absolute).replaceAll('\\', '/')
    documentPath(path); paths.add(path)
    const raw = await readFile(absolute, 'utf8')
    if (path === 'index.md' || raw.includes('data-wiki-component=') || path.startsWith('users/')) { protectedPaths.add(path); continue }
    const parsed = parseArticle(raw, path)
    articles.push({ id: parsed.docId || 'page-' + digest(path).slice(0, 20), path, raw, ...parsed })
  }
  let items
  try { const document = YAML.parse(await readFile(resolve(repoDir, 'navigation.yml'), 'utf8'), { maxAliasCount: 20 }); items = document.items }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    const config = YAML.parseDocument(await readFile(resolve(repoDir, 'mkdocs.yml'), 'utf8'))
    function convert(nodes, ancestry = '') {
      return nodes.map((node, index) => { const [title, value] = Object.entries(node)[0], key = ancestry + '/' + index + '/' + title
        return Array.isArray(value) ? { id: 'section-' + digest(key).slice(0, 20), title, children: convert(value, key) } : { id: 'page-' + digest(value).slice(0, 20), title, path: value }
      })
    }
    items = convert(config.get('nav').toJSON())
  }
  return { articles, paths, protectedPaths, items }
}
export function validateNavigation(items, knownPaths, requiredPaths = new Set()) {
  const ids = new Set(), paths = new Set()
  function walk(nodes, depth) {
    if (!Array.isArray(nodes) || depth > 6) fail('目录层级过深或格式有误')
    return nodes.map(node => {
      if (!node || typeof node !== 'object' || typeof node.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(node.id) || ids.has(node.id) || ids.size > 1000) fail('目录编号重复或无效')
      if (typeof node.title !== 'string' || !node.title.trim() || node.title.length > 100 || /[\r\n\0]/.test(node.title)) fail('请填写 100 字以内的板块名称')
      ids.add(node.id)
      if (Array.isArray(node.children) && node.path === undefined) return { id: node.id, title: node.title.trim(), children: walk(node.children, depth + 1) }
      const path = documentPath(node.path)
      if (!knownPaths.has(path) || paths.has(path)) fail('目录引用了缺失或重复的文章')
      paths.add(path)
      return { id: node.id, title: node.title.trim(), path }
    })
  }
  const clean = walk(items, 0)
  if ([...requiredPaths].some(path => !paths.has(path))) fail('请保留首页和问答入口')
  return clean
}
export function findNode(items, id) { for (const node of items) { if (node.id === id) return node; const found = node.children && findNode(node.children, id); if (found) return found } }
export function visitNavigation(items, fn) { for (const node of items) { fn(node); if (node.children) visitNavigation(node.children, fn) } }
export function referencedMedia(raw) {
  const paths = new Set()
  const collect = value => { if (/^\/images\/uploads\/[a-f0-9]{64}\.webp$/.test(value || '')) paths.add('docs' + value) }
  for (const token of markdown.parse(raw, {})) for (const part of token.children || [token]) {
    if (part.type === 'image') collect(part.attrGet('src'))
    if (part.type === 'html_block' || part.type === 'html_inline') { const $ = load(part.content); $('[src]').each((_, element) => collect($(element).attr('src'))) }
  }
  return paths
}
