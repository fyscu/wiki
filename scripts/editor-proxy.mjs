import { request } from 'node:http'

export function editorProxy(origin = 'http://127.0.0.1:9090') {
  return (req, res, next) => {
    if (!req.url.startsWith('/_editor/')) return next()
    const target = new URL(req.url, origin)
    const upstream = request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res) })
    upstream.setTimeout(15000, () => upstream.destroy(new Error('Editor timeout')))
    upstream.on('error', () => { if (!res.headersSent) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: '内容服务暂时不可用' } })) } else res.end() })
    req.pipe(upstream)
  }
}
