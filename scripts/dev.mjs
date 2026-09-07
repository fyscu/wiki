import { createServer } from 'node:http'
import { watch, readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { serveStaticSite } from './static-site.mjs'
import { communityApi } from './community-api.mjs'
import { createQaMiddleware } from './qa-proxy.mjs'
import { buildSite } from './build-site.mjs'

const port = Number(process.env.PORT || 5173)
const upstream = process.env.QA_ORIGIN || 'http://127.0.0.1:9080'
await buildSite()
const api = communityApi(upstream)
const publicApi = createQaMiddleware(upstream)
function staticFiles(req, res) {
  const directory = JSON.parse(readFileSync('.cache/site-current.json', 'utf8')).directory
  if (!relative(resolve('.cache'), directory).startsWith('site-build-')) { res.statusCode = 503; res.end(); return }
  return serveStaticSite(req, res, directory)
}
const server = createServer((req, res) => api(req, res, () => publicApi(req, res, () => staticFiles(req, res))))
server.listen(port, '127.0.0.1', () => console.log(`Feiyang Wiki: http://127.0.0.1:${port}/`))
if (!process.argv.includes('--no-watch')) {
  let timer, running = false, pending = false
  async function rebuild() {
    if (running) { pending = true; return }
    running = true
    try { await buildSite(); console.log('Wiki rebuilt. Refresh to view changes.') }
    catch (error) { console.error(error.message) }
    finally { running = false; if (pending) { pending = false; timer = setTimeout(rebuild, 300) } }
  }
  for (const root of ['community', 'overrides', 'hooks', 'docs']) {
    watch(root, { recursive: true }, (_, file) => {
      if (String(file).includes('assets') || String(file).includes('article-manifest.json') || String(file).includes('__pycache__')) return
      if (root === 'docs' && !String(file).endsWith('.md') && !/feiyang\.css$|oi-extra\.css$/.test(String(file))) return
      clearTimeout(timer); timer = setTimeout(rebuild, 400)
    })
  }
}
