import { extname } from 'node:path'
import serveHandler from 'serve-handler'
import { resolveAnswerLink } from '../lib/answer-links.mjs'

export function serveStaticSite(req, res, directory) {
  const url = new URL(req.url, 'http://127.0.0.1')
  const answerLink = resolveAnswerLink(url)
  if (answerLink) {
    res.writeHead(['GET', 'HEAD'].includes(req.method) ? 302 : 405, { Location: answerLink, 'Cache-Control': 'no-store' })
    res.end()
    return
  }
  // serve-handler drops the query when normalizing directory URLs.
  if (!url.pathname.endsWith('/') && !extname(url.pathname)) {
    res.writeHead(308, { Location: url.pathname + '/' + url.search })
    res.end()
    return
  }
  return serveHandler(req, res, { public: directory, cleanUrls: true, trailingSlash: true, headers: [{ source: '**', headers: [{ key: 'Cache-Control', value: 'no-store' }, { key: 'Referrer-Policy', value: 'no-referrer' }] }] })
}
