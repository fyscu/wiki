import { spawnSync } from 'node:child_process'
import { mkdir, cp, writeFile, readFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { build } from 'vite'
import { collectArticles } from './content.mjs'

export async function buildSite({ assets = true } = {}) {
  if (assets) {
    await build({ configFile: resolve('vite.config.mjs') })
    await mkdir('docs/assets/fonts', { recursive: true })
    let css = ':root{--md-text-font:"Fira Sans";--md-code-font:"Fira Mono"}\n'
    for (const [font, family, weights] of [['fira-sans', 'Fira Sans', [300, 400, 700]], ['fira-mono', 'Fira Mono', [400]]]) {
      for (const weight of weights) {
        const filename = `${font}-latin-${weight}-normal.woff2`
        await cp(`node_modules/@fontsource/${font}/files/${filename}`, `docs/assets/fonts/${filename}`)
        css += `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url("${filename}") format("woff2")}\n`
      }
    }
    await writeFile('docs/assets/fonts/fonts.css', css)
  }
  await writeFile('docs/article-manifest.json', JSON.stringify({ version: 1, articles: await collectArticles() }, null, 2) + '\n')
  const python = process.env.WIKI_PYTHON || (process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
  const generation = randomUUID()
  const destination = resolve('.cache', `site-build-${generation}`)
  const result = spawnSync(python, ['-m', 'mkdocs', 'build', '--clean', '--site-dir', destination], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error('MkDocs build failed')
  for (const page of ['index.html', 'questions/index.html', 'ask/index.html', 'question/index.html', 'login/index.html', 'register/index.html', 'editor/index.html', 'users/account-activation/index.html', 'users/password-reset/index.html', 'users/unsubscribe/index.html']) {
    if (!(await readFile(resolve(destination, page), 'utf8')).includes('</html>')) throw new Error(`Incomplete build: ${page}`)
  }
  const pointer = resolve('.cache', `site-current-${generation}.json`)
  await writeFile(pointer, JSON.stringify({ directory: destination, generation }) + '\n')
  await rename(pointer, resolve('.cache/site-current.json'))
  console.log(`Complete static build: ${destination}`)
  return destination
}

if (process.argv[1]?.endsWith('build-site.mjs')) await buildSite()
