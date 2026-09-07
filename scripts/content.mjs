import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { parse } from 'yaml'
import { DOC_ID, docTag } from '../lib/qa.mjs'

export async function collectArticles(root = process.cwd()) {
  const directory = resolve(root, 'docs')
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  const articles = []
  const seen = new Set()
  for (const item of entries) {
    if (!item.isFile() || !item.name.endsWith('.md')) continue
    const path = resolve(item.parentPath, item.name)
    const source = await readFile(path, 'utf8')
    const { data } = matter(source, { engines: { yaml: input => parse(input, { maxAliasCount: 20 }) } })
    if (!data.doc_id) continue
    if (!DOC_ID.test(data.doc_id) || seen.has(data.doc_id)) throw new Error(`Invalid or duplicate doc_id: ${path}`)
    if (!data.title || !Array.isArray(data.owners) || !data.owners.length) throw new Error(`Missing article metadata: ${path}`)
    const route = '/' + relative(directory, path).split(sep).join('/').replace(/\.md$/, '').replace(/index$/, '') .replace(/\/$/, '') + '/'
    if (!/^\/[a-z0-9/-]+$/.test(route)) throw new Error(`Unsupported article route: ${route}`)
    seen.add(data.doc_id)
    articles.push({ id: data.doc_id, title: data.title, path: route, tag: docTag(data.doc_id),
      source: relative(root, path).split(sep).join('/'),
      revision: 'sha256:' + createHash('sha256').update(source).digest('hex'),
      owners: data.owners, manual_pages: data.manual_pages || [], tags: data.tags || [] })
  }
  return articles.sort((a, b) => a.path.localeCompare(b.path))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const articles = await collectArticles()
  if (!articles.length) throw new Error('No articles found')
  await writeFile('docs/article-manifest.json', JSON.stringify({ version: 1, articles }, null, 2) + '\n')
  console.log(`Validated ${articles.length} article(s)`)
}
