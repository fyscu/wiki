import { createApp, defineAsyncComponent } from 'vue'
import AccountMenu from './AccountMenu.vue'
import Login from './Login.vue'
import AccountRecovery from './AccountRecovery.vue'
import Unsubscribe from './Unsubscribe.vue'
import Questions from './Questions.vue'
import Question from './Question.vue'
import Ask from './Ask.vue'
import Review from './Review.vue'
import ArticleQuestions from './ArticleQuestions.vue'
import { api, auth, clearSession, saveSession } from './api'
import './style.css'
const Editor = defineAsyncComponent(() => import('./editor/Editor.vue'))

const components = { 'account-menu': AccountMenu, login: Login, 'account-recovery': AccountRecovery, unsubscribe: Unsubscribe, editor: Editor, questions: Questions, question: Question, ask: Ask, review: Review, 'article-questions': ArticleQuestions }
const mounted = new Map<HTMLElement, ReturnType<typeof createApp>>()
function mount() {
  for (const [element, app] of mounted) { if (!element.isConnected) { app.unmount(); mounted.delete(element) } }
  document.querySelectorAll<HTMLElement>('[data-wiki-component]').forEach(element => {
    if (mounted.has(element)) return
    const component = components[element.dataset.wikiComponent || '']
    if (!component) return
    let props = {}
    if (element.dataset.article) { try { props = { article: JSON.parse(element.dataset.article) } } catch { return } }
    const app = createApp(component, props); app.mount(element); mounted.set(element, app)
  })
}
mount()
if ((window as any).document$) (window as any).document$.subscribe(mount)
function refreshAccount() {
  const token = auth.token
  if (token) api('me').then(user => { if (auth.token === token) saveSession(user) }).catch(error => { if (error.status === 401 && auth.token === token) clearSession() })
}
refreshAccount()
window.addEventListener('focus', refreshAccount)
