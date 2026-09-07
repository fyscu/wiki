export type Version = number

export interface ArticleSummary {
  id: string
  title: string
  path: string
  docId: string | null
  version: Version
  status: 'published' | 'draft'
  dirty: boolean
  conflict?: boolean
  updatedAt: string | number
}

export interface Article extends Omit<ArticleSummary, 'status'> {
  body: string
  tags: string[]
  owners: string[]
  published: boolean
}

export interface NavNode {
  id: string
  title: string
  path?: string
  children?: NavNode[]
}

export interface Navigation { version: Version; items: NavNode[]; dirty: boolean }
export interface Media { id: string; path: string; url: string; width: number; height: number; name: string }
export interface Job {
  id: string
  kind: 'preview' | 'publish'
  status: 'queued' | 'building' | 'committing' | 'publishing' | 'succeeded' | 'failed'
  message?: string
  error?: string
  url?: string
  commit?: string
  createdAt: string | number
  finishedAt?: string | number
}
export interface EditorState {
  user: { id: string; role_id: number; display_name?: string; username?: string }
  revision: string
  articles: ArticleSummary[]
  navigation: Navigation
  jobs: Job[]
  media: Media[]
}
export interface HistoryEntry { revision: string; author: string; date: string; message: string }
export interface HistoricalArticle { title: string; body: string; tags: string[]; owners: string[]; revision: string }

export const terminal = (job: Job) => job.status === 'succeeded' || job.status === 'failed'
export const jobLabels: Record<Job['status'], string> = {
  queued: '排队中', building: '构建中', committing: '提交中', publishing: '发布中', succeeded: '已完成', failed: '失败',
}

export function dateLabel(value?: string | number) {
  if (!value) return ''
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

export function safeUrl(value?: string) {
  if (!value) return ''
  try {
    const url = new URL(value, location.origin)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : ''
  } catch { return '' }
}
