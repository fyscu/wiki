import { httpOrigin, DOC_ID } from '../lib/qa.mjs'

export function createQaMiddleware(origin, fetcher = fetch) {
  const upstream = httpOrigin(origin)
  return async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname !== '/_qa/questions') return next()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD')
      res.statusCode = 405
      return res.end(JSON.stringify({ error: 'method_not_allowed' }))
    }
    const tag = url.searchParams.get('tag') || ''
    if (!tag.startsWith('doc-') || !DOC_ID.test(tag.slice(4))) {
      res.statusCode = 400
      return res.end(JSON.stringify({ error: 'invalid_document' }))
    }
    const target = new URL('/answer/api/v1/question/page', upstream)
    target.search = new URLSearchParams({ tag, page: '1', page_size: '5', order: 'active' }).toString()
    try {
      const response = await fetcher(target, {
        method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error',
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) throw new Error(`Upstream ${response.status}`)
      const body = await response.json()
      if (body?.code !== 200 || !Array.isArray(body?.data?.list)) throw new Error('Invalid upstream response')
      res.statusCode = 200
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body))
    } catch {
      res.statusCode = 503
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: 'qa_unavailable' }))
    }
  }
}

export function qaProxy(origin) {
  const middleware = createQaMiddleware(origin)
  return {
    name: 'feiyang-public-qa',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}
