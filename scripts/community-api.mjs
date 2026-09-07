import { httpOrigin } from '../lib/qa.mjs'
import { routes, resolveRoute, cleanQuery } from '../lib/api-routes.mjs'

async function readBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > 262144) throw Object.assign(new Error('Request too large'), { status: 413 })
    chunks.push(chunk)
  }
  return total ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

export function communityApi(origin, fetcher = fetch) {
  const upstream = httpOrigin(origin)
  return async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (!url.pathname.startsWith('/_community/')) return next()
    const path = url.pathname.slice('/_community/'.length)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    const respond = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)) }
    const route = resolveRoute(path, req.method)
    if (!route) return respond(routes.some(item => item.path === path) ? 405 : 404, { code: 404, msg: '接口不可用' })
    const authorization = req.headers.authorization || ''
    if (route.auth && !/^Bearer [A-Za-z0-9._-]{8,2048}$/.test(authorization)) return respond(401, { code: 401, msg: '请先登录' })
    if (!['GET', 'HEAD'].includes(req.method)) {
      const requestOrigin = req.headers.origin
      if (requestOrigin && new URL(requestOrigin).host !== req.headers.host) return respond(403, { code: 403, msg: '请求来源不匹配' })
      if (!String(req.headers['content-type']).startsWith('application/json')) return respond(415, { code: 415, msg: '请求格式错误' })
    }
    try {
      const target = new URL(`/answer/api/v1/${route.upstream}`, upstream)
      target.search = cleanQuery(route, url.searchParams).toString()
      const method = route.upstreamMethod || route.method
      const headers = { Accept: 'application/json', 'Accept-Language': 'zh-CN' }
      if (authorization && !['login', 'register'].includes(path)) headers.Authorization = authorization
      let body
      if (route.fields && method !== 'GET') {
        const input = await readBody(req)
        if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('Invalid JSON body')
        body = JSON.stringify(Object.fromEntries(route.fields.filter(key => key in input).map(key => [key, input[key]])))
        headers['Content-Type'] = 'application/json'
      }
      const response = await fetcher(target, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(12000) })
      const payload = await response.json()
      respond(response.status, payload)
    } catch (error) {
      const status = error.status || (error instanceof SyntaxError || /Invalid|too long|pagination/.test(error.message) ? 400 : 503)
      respond(status, { code: status, msg: status === 503 ? '服务暂时无法连接，请稍后重试' : '请求内容无效' })
    }
  }
}
