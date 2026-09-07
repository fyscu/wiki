export const DOC_ID = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/

export function docTag(id) {
  if (!DOC_ID.test(id)) throw new Error('Invalid document ID')
  return `doc-${id}`
}

export function httpOrigin(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') {
    throw new Error('Expected an HTTP origin without credentials or subpath')
  }
  return url.origin
}

export function buildAskPath(id) {
  docTag(id)
  return `/ask/?article=${encodeURIComponent(id)}`
}

export function normalizeQuestions(body) {
  if (body?.code !== 200 || !Array.isArray(body?.data?.list)) throw new Error('Unexpected Answer response')
  return body.data.list.map(item => {
    if (typeof item.id !== 'string' || typeof item.title !== 'string') throw new Error('Invalid question')
    return { id: item.id, title: item.title, answers: Number(item.answer_count) || 0,
      accepted: Boolean(item.accepted_answer_id && item.accepted_answer_id !== '0') }
  })
}
