export const routes = [
  { path: 'siteinfo', method: 'GET', upstream: 'siteinfo', query: [] },
  { path: 'captcha', method: 'GET', upstream: 'user/action/record', query: ['action'] },
  { path: 'email/verify', method: 'POST', upstream: 'user/email/verification', fields: ['code'] },
  { path: 'email/unsubscribe', method: 'PUT', upstream: 'user/notification/unsubscribe', fields: ['code'] },
  { path: 'email/resend', method: 'POST', upstream: 'user/email/verification/send', auth: true, fields: ['captcha_id', 'captcha_code'] },
  { path: 'password/reset', method: 'POST', upstream: 'user/password/reset', fields: ['e_mail', 'captcha_id', 'captcha_code'] },
  { path: 'password/replace', method: 'POST', upstream: 'user/password/replacement', fields: ['code', 'pass'] },
  { path: 'questions', method: 'GET', upstream: 'question/page', query: ['tag', 'order', 'page', 'page_size', 'username'] },
  { path: 'question', method: 'GET', upstream: 'question/info', query: ['id'] },
  { path: 'answers', method: 'GET', upstream: 'answer/page', query: ['question_id', 'order', 'page', 'page_size'] },
  { path: 'answer', method: 'GET', upstream: 'answer/info', query: ['id'] },
  { path: 'tags', method: 'GET', upstream: 'tags/page', query: ['page', 'page_size', 'query_cond'] },
  { path: 'search', method: 'GET', upstream: 'search', query: ['q', 'order', 'page', 'page_size'] },
  { path: 'me', method: 'GET', upstream: 'user/info', query: [], auth: true },
  { path: 'logout', method: 'POST', upstream: 'user/logout', upstreamMethod: 'GET', auth: true, fields: [] },
  { path: 'login', method: 'POST', upstream: 'user/login/email', fields: ['e_mail', 'pass', 'captcha_id', 'captcha_code'] },
  { path: 'register', method: 'POST', upstream: 'user/register/email', fields: ['name', 'e_mail', 'pass', 'captcha_id', 'captcha_code'] },
  { path: 'questions', method: 'POST', upstream: 'question', auth: true, fields: ['title', 'content', 'tags', 'captcha_id', 'captcha_code'] },
  { path: 'question', method: 'PUT', upstream: 'question', auth: true, fields: ['id', 'title', 'content', 'tags', 'edit_summary'] },
  { path: 'question', method: 'DELETE', upstream: 'question', auth: true, fields: ['id'] },
  { path: 'answers', method: 'POST', upstream: 'answer', auth: true, fields: ['question_id', 'content', 'captcha_id', 'captcha_code'] },
  { path: 'answer', method: 'PUT', upstream: 'answer', auth: true, fields: ['id', 'content', 'edit_summary'] },
  { path: 'answer', method: 'DELETE', upstream: 'answer', auth: true, fields: ['id'] },
  { path: 'accept', method: 'POST', upstream: 'answer/acceptance', auth: true, fields: ['question_id', 'answer_id'] },
  { path: 'vote/up', method: 'POST', upstream: 'vote/up', auth: true, fields: ['object_id', 'is_cancel'] },
  { path: 'vote/down', method: 'POST', upstream: 'vote/down', auth: true, fields: ['object_id', 'is_cancel'] },
  { path: 'comments', method: 'GET', upstream: 'comment/page', query: ['object_id', 'page', 'page_size'] },
  { path: 'comments', method: 'POST', upstream: 'comment', auth: true, fields: ['object_id', 'original_text', 'reply_comment_id'] },
  { path: 'reviews', method: 'GET', upstream: 'review/pending/post/page', auth: true, query: ['page', 'object_id'] },
  { path: 'reviews', method: 'PUT', upstream: 'review/pending/post', auth: true, fields: ['review_id', 'status'] },
]

export function resolveRoute(path, method) { return routes.find(route => route.path === path && route.method === method) }

export function cleanQuery(route, params) {
  const result = new URLSearchParams()
  for (const key of route.query || []) {
    const value = params.get(key)
    if (value === null || value === '') continue
    if (route.path === 'captcha' && !['email', 'password'].includes(value)) throw new Error('Invalid captcha action')
    if (key === 'page' || key === 'page_size') {
      if (!/^\d+$/.test(value)) throw new Error('Invalid pagination')
      result.set(key, String(Math.min(Math.max(1, Number(value)), key === 'page_size' ? 20 : 10000)))
    } else {
      if (value.length > (key === 'q' ? 300 : 100)) throw new Error('Query is too long')
      result.set(key, value)
    }
  }
  return result
}
