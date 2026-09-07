import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true })
export function renderMarkdown(value = '') {
  return DOMPurify.sanitize(markdown.render(value), { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'iframe'], FORBID_ATTR: ['style'] })
}
