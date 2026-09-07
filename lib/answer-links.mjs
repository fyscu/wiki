export const answerLinkRoutes = [
  { pattern: '^/questions/(?<wiki_question_id>[0-9]{1,20})/(?:[^/]+/)?(?<wiki_answer_id>[0-9]{1,20})/?$', answer: true },
  { pattern: '^/questions/(?<wiki_question_id>[0-9]{1,20})(?:/[^/]+)?/?$', answer: false },
]

export function resolveAnswerLink(url) {
  for (const route of answerLinkRoutes) {
    const match = new RegExp(route.pattern).exec(url.pathname)
    if (!match) continue
    const params = new URLSearchParams({ id: match.groups.wiki_question_id })
    if (route.answer) params.set('answer', match.groups.wiki_answer_id)
    const comment = url.searchParams.get('commentId')
    if (/^[0-9]{1,20}$/.test(comment || '')) params.set('commentId', comment)
    return '/question/?' + params
  }
  return null
}
