import type { NavNode } from './types'

export interface NavRow { node: NavNode; depth: number; parentId: string; index: number; count: number }
export const cloneTree = (items: NavNode[]): NavNode[] => JSON.parse(JSON.stringify(items))

export function treeStructure(items: NavNode[]): string {
  return JSON.stringify(items.map(node => node.path === undefined
    ? { id: node.id, title: node.title, children: JSON.parse(treeStructure(node.children || [])) }
    : { id: node.id, path: node.path }))
}

export function flattenTree(items: NavNode[], depth = 0, parentId = ''): NavRow[] {
  return items.flatMap((node, index) => [
    { node, depth, parentId, index, count: items.length },
    ...flattenTree(node.children || [], depth + 1, node.id),
  ])
}

export function siblingsOf(items: NavNode[], parentId: string): NavNode[] | undefined {
  if (!parentId) return items
  return flattenTree(items).find(row => row.node.id === parentId)?.node.children
}

export function moveNode(items: NavNode[], id: string, parentId: string, offset?: number): NavNode[] {
  const result = cloneTree(items)
  const source = flattenTree(result).find(row => row.node.id === id)
  if (!source) throw new Error('目录项不存在')
  if (parentId === id || flattenTree(source.node.children || []).some(row => row.node.id === parentId)) throw new Error('不能移入自身或子栏目')
  const siblings = siblingsOf(result, source.parentId)!
  const target = siblingsOf(result, parentId)
  if (!target) throw new Error('目标栏目不存在')
  if (offset !== undefined) {
    const index = source.index + offset
    if (target !== siblings || index < 0 || index >= siblings.length) return result
    siblings.splice(source.index, 1)
    siblings.splice(index, 0, source.node)
  } else if (siblings !== target) {
    siblings.splice(source.index, 1)
    target.push(source.node)
  }
  return result
}

export function removeSection(items: NavNode[], id: string): NavNode[] {
  const result = cloneTree(items)
  const row = flattenTree(result).find(item => item.node.id === id)
  if (!row || row.node.path !== undefined) throw new Error('只能删除栏目')
  // Keep every existing page and its order when removing a containing section.
  siblingsOf(result, row.parentId)!.splice(row.index, 1, ...(row.node.children || []))
  return result
}
