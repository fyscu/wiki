<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUp, ArrowDown, Folder, FileText, FolderPlus, Pencil, Trash2, Save, RefreshCw, Check, X } from '@lucide/vue'
import { cloneTree, flattenTree, moveNode, removeSection, siblingsOf } from './navigation'
import type { NavNode } from './types'

const props = defineProps<{ items: NavNode[]; dirty: boolean; disabled: boolean; saving: boolean; conflict: boolean; error: string }>()
const emit = defineEmits<{ change: [items: NavNode[]]; save: []; reload: []; open: [path: string] }>()
const rows = computed(() => flattenTree(props.items))
const sections = computed(() => rows.value.filter(row => row.node.path === undefined))
const selected = ref(''), renameId = ref(''), renameTitle = ref(''), newTitle = ref(''), newParent = ref(''), adding = ref(false), localError = ref('')

function change(task: () => NavNode[]) {
  if (props.disabled) return
  try { emit('change', task()); localError.value = '' } catch (cause) { localError.value = (cause as Error).message }
}
function add() {
  if (!newTitle.value.trim()) return
  change(() => {
    const tree = cloneTree(props.items), parent = siblingsOf(tree, newParent.value)
    if (!parent) throw new Error('目标栏目不存在')
    parent.push({ id: crypto.randomUUID(), title: newTitle.value.trim(), children: [] })
    return tree
  })
  newTitle.value = ''; adding.value = false
}
function rename() {
  if (!renameTitle.value.trim()) return
  change(() => {
    const tree = cloneTree(props.items), row = flattenTree(tree).find(row => row.node.id === renameId.value)
    if (row && row.node.path === undefined) row.node.title = renameTitle.value.trim()
    return tree
  })
  renameId.value = ''
}
function remove(node: NavNode) {
  if (!window.confirm(`删除栏目「${node.title}」？其中的页面与子栏目将上移一级。`)) return
  change(() => removeSection(props.items, node.id))
}
function availableParents(node: NavNode) {
  const excluded = new Set([node.id, ...flattenTree(node.children || []).map(row => row.node.id)])
  return sections.value.filter(row => !excluded.has(row.node.id))
}
</script>

<template>
  <section class="we-navigation" aria-label="目录管理">
    <div class="we-section-head">
      <h2>目录</h2><span class="we-muted" role="status">{{ dirty ? '未保存' : '已保存' }}</span>
      <div class="we-actions">
        <button class="we-button" :disabled="disabled" @click="adding = !adding"><FolderPlus :size="16" />新建栏目</button>
        <button class="we-icon" title="重新载入目录" aria-label="重新载入目录" :disabled="disabled" @click="emit('reload')"><RefreshCw :size="17" /></button>
        <button class="we-button we-primary" :disabled="disabled || !dirty || conflict" @click="emit('save')"><Save :size="16" />{{ saving ? '保存中' : '保存目录' }}</button>
      </div>
    </div>
    <p v-if="error || localError" class="we-alert" role="alert">{{ error || localError }}</p>
    <form v-if="adding" class="we-inline-form" @submit.prevent="add">
      <label>栏目名称<input v-model="newTitle" autofocus required :disabled="disabled" /></label>
      <label>上级栏目<select v-model="newParent" :disabled="disabled"><option value="">根目录</option><option v-for="row in sections" :key="row.node.id" :value="row.node.id">{{ '　'.repeat(row.depth) + row.node.title }}</option></select></label>
      <button class="we-button we-primary" :disabled="disabled || !newTitle.trim()">添加</button>
      <button type="button" class="we-icon" aria-label="取消新建栏目" title="取消" @click="adding = false"><X :size="17" /></button>
    </form>
    <div class="we-tree" role="list" aria-label="页面目录">
      <div v-for="row in rows" :key="row.node.id" class="we-tree-row" :class="{ 'is-selected': selected === row.node.id }" role="listitem" :style="{ '--we-depth': Math.min(row.depth, 6) }" @focusin="selected = row.node.id">
        <div class="we-tree-name">
          <component :is="row.node.path === undefined ? Folder : FileText" :size="16" />
          <form v-if="renameId === row.node.id" class="we-rename" @submit.prevent="rename"><input v-model="renameTitle" required aria-label="栏目名称" :disabled="disabled" /><button class="we-icon" title="确认名称" aria-label="确认名称" :disabled="disabled"><Check :size="16" /></button><button type="button" class="we-icon" title="取消改名" aria-label="取消改名" @click="renameId = ''"><X :size="16" /></button></form>
          <template v-else><button v-if="row.node.path !== undefined" class="we-tree-link" @click="emit('open', row.node.path)">{{ row.node.title }}</button><strong v-else>{{ row.node.title }}</strong><small v-if="row.node.path">{{ row.node.path }}</small></template>
        </div>
        <div class="we-tree-controls">
          <select :value="row.parentId" :aria-label="`${row.node.title}的上级栏目`" :disabled="disabled" @change="change(() => moveNode(items, row.node.id, ($event.target as HTMLSelectElement).value))"><option value="">根目录</option><option v-for="parent in availableParents(row.node)" :key="parent.node.id" :value="parent.node.id">{{ parent.node.title }}</option></select>
          <button class="we-icon" :title="`上移${row.node.title}`" :aria-label="`上移${row.node.title}`" :disabled="disabled || row.index === 0" @click="change(() => moveNode(items, row.node.id, row.parentId, -1))"><ArrowUp :size="16" /></button>
          <button class="we-icon" :title="`下移${row.node.title}`" :aria-label="`下移${row.node.title}`" :disabled="disabled || row.index === row.count - 1" @click="change(() => moveNode(items, row.node.id, row.parentId, 1))"><ArrowDown :size="16" /></button>
          <template v-if="row.node.path === undefined">
            <button class="we-icon" :title="`重命名${row.node.title}`" :aria-label="`重命名${row.node.title}`" :disabled="disabled" @click="renameId = row.node.id; renameTitle = row.node.title"><Pencil :size="15" /></button>
            <button class="we-icon we-danger" :title="`删除${row.node.title}`" :aria-label="`删除${row.node.title}`" :disabled="disabled" @click="remove(row.node)"><Trash2 :size="15" /></button>
          </template>
        </div>
      </div>
    </div>
    <p v-if="!rows.length" class="we-empty">暂无目录</p>
  </section>
</template>
