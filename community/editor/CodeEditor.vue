<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup, EditorView } from 'codemirror'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { redo, undo } from '@codemirror/commands'
import { Bold, Italic, Heading2, Code, Link, List, ListOrdered, Quote, ImagePlus, Undo2, Redo2, Columns2, FileCode2 } from '@lucide/vue'
import { renderMarkdown } from '../markdown'
import { errorMessage } from './api'
import { safeUrl, type Media } from './types'

const props = defineProps<{ modelValue: string; disabled: boolean; media: Media[]; upload: (file: File) => Promise<Media> }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; save: []; error: [message: string] }>()
const host = ref<HTMLElement>(), fileInput = ref<HTMLInputElement>()
const mode = ref<'edit' | 'split'>('edit'), pendingCount = ref(0)
let view: EditorView | undefined, external = false, disposed = false, bookmarkId = 0
const readOnly = new Compartment()
const bookmarks = new Map<number, { from: number; to: number }>()
const tools = [
  { name: '加粗', icon: Bold, left: '**', right: '**' }, { name: '斜体', icon: Italic, left: '*', right: '*' },
  { name: '二级标题', icon: Heading2, prefix: '## ' }, { name: '代码块', icon: Code, left: '\n```text\n', right: '\n```\n' },
  { name: '链接', icon: Link, left: '[', right: '](https://)' }, { name: '无序列表', icon: List, prefix: '- ' },
  { name: '有序列表', icon: ListOrdered, prefix: '1. ' }, { name: '引用', icon: Quote, prefix: '> ' },
]
const preview = computed(() => {
  const document = new DOMParser().parseFromString(renderMarkdown(props.modelValue), 'text/html')
  const media = new Map(props.media.map(item => [item.path, safeUrl(item.url)]))
  for (const image of document.querySelectorAll('img')) {
    const url = media.get(image.getAttribute('src') || '')
    if (url) image.setAttribute('src', url)
    image.setAttribute('loading', 'lazy')
  }
  return document.body.innerHTML
})

function format(tool: typeof tools[number]) {
  if (!view || props.disabled) return
  const { from, to } = view.state.selection.main
  if (tool.prefix) {
    const start = view.state.doc.lineAt(from).from
    const end = view.state.doc.lineAt(to > from && view.state.doc.lineAt(to).from === to ? to - 1 : to).to
    const replacement = view.state.doc.sliceString(start, end).split('\n').map(line => tool.prefix + line).join('\n')
    view.dispatch({ changes: { from: start, to: end, insert: replacement }, selection: { anchor: start, head: start + replacement.length }, userEvent: 'input' })
  } else {
    const left = tool.left || '', right = tool.right || '', selected = view.state.sliceDoc(from, to)
    view.dispatch({ changes: { from, to, insert: left + selected + right }, selection: EditorSelection.range(from + left.length, to + left.length), userEvent: 'input' })
  }
  view.focus()
}

function imageMarkdown(media: Media) {
  const name = media.name.replace(/[\\\[\]\r\n]/g, ' ')
  return `![${name}](<${media.path}>)`
}

function insertMedia(media: Media) {
  if (!view || props.disabled) return
  view.dispatch(view.state.replaceSelection(imageMarkdown(media)))
  view.focus()
}

async function insertFiles(files: File[], position?: number) {
  if (!view || props.disabled || !files.length) return
  const images = files.filter(file => file.type.startsWith('image/'))
  if (!images.length) { emit('error', '请选择图片文件'); return }
  const id = ++bookmarkId
  const selection = view.state.selection.main
  bookmarks.set(id, { from: position ?? selection.from, to: position ?? selection.to })
  pendingCount.value++
  try {
    for (const file of images) {
      const media = await props.upload(file)
      if (disposed || !view) return
      const mark = bookmarks.get(id)!
      const text = imageMarkdown(media) + '\n'
      const anchor = mark.from + text.length
      view.dispatch({ changes: { from: mark.from, to: mark.to, insert: text }, selection: { anchor }, userEvent: 'input' })
      bookmarks.set(id, { from: anchor, to: anchor })
    }
    view?.focus()
  } catch (cause) { emit('error', errorMessage(cause)) }
  finally { bookmarks.delete(id); pendingCount.value-- }
}

function chooseFiles(event: Event) {
  const input = event.target as HTMLInputElement
  void insertFiles(Array.from(input.files || [])); input.value = ''
}

onMounted(() => {
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({ doc: props.modelValue, extensions: [
      basicSetup, markdown(), EditorView.lineWrapping,
      syntaxHighlighting(HighlightStyle.define([
        { tag: tags.heading, color: 'var(--md-default-fg-color)', fontWeight: 'bold' },
        { tag: tags.emphasis, fontStyle: 'italic' }, { tag: tags.strong, fontWeight: 'bold' },
        { tag: [tags.link, tags.url], color: 'var(--md-typeset-a-color)', textDecoration: 'underline' },
        { tag: [tags.keyword, tags.atom, tags.meta], color: 'var(--we-syntax-keyword)' },
        { tag: [tags.string, tags.inserted], color: 'var(--we-syntax-string)' },
        { tag: [tags.number, tags.bool, tags.typeName], color: 'var(--we-syntax-number)' },
        { tag: [tags.comment, tags.quote], color: 'var(--md-default-fg-color--light)' },
      ])),
      readOnly.of(EditorState.readOnly.of(props.disabled)),
      EditorView.contentAttributes.of({ 'aria-label': 'Markdown 正文', spellcheck: 'false' }),
      keymap.of([{ key: 'Mod-s', run: () => { emit('save'); return true } }]),
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return
        for (const mark of bookmarks.values()) {
          mark.from = update.changes.mapPos(mark.from, 1)
          mark.to = Math.max(mark.from, update.changes.mapPos(mark.to, 1))
        }
        if (!external) emit('update:modelValue', update.state.doc.toString())
      }),
      EditorView.domEventHandlers({
        paste(event) {
          const files = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => !!file && file.type.startsWith('image/'))
          if (!files.length || props.disabled) return false
          event.preventDefault(); void insertFiles(files); return true
        },
        dragover(event) { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); return true } return false },
        drop(event) {
          const files = Array.from(event.dataTransfer?.files || [])
          if (!files.length || props.disabled) return false
          event.preventDefault()
          void insertFiles(files, view?.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined)
          return true
        },
      }),
      EditorView.theme({
        '&': { height: '100%', color: 'var(--md-default-fg-color)', backgroundColor: 'var(--md-default-bg-color)' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--md-code-font-family, monospace)', fontSize: '14px', lineHeight: '1.7' },
        '.cm-content': { padding: '12px 0', minHeight: '100%', caretColor: 'var(--md-typeset-a-color)' },
        '.cm-line': { padding: '0 12px' },
        '.cm-gutters': { backgroundColor: 'var(--md-code-bg-color)', color: 'var(--md-default-fg-color--light)', borderRight: '1px solid var(--md-default-fg-color--lightest)' },
        '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--md-default-fg-color--lightest)' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--md-typeset-a-color) 22%, transparent)' },
        '.cm-cursor': { borderLeftColor: 'var(--md-typeset-a-color)' },
        '.cm-panels, .cm-tooltip': { color: 'var(--md-default-fg-color)', backgroundColor: 'var(--md-default-bg-color)', borderColor: 'var(--md-default-fg-color--lightest)' },
      }),
    ] }),
  })
})
watch(() => props.modelValue, value => {
  if (!view || view.state.doc.toString() === value) return
  external = true
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  external = false
})
watch(() => props.disabled, value => view?.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(value)) }))
onBeforeUnmount(() => { disposed = true; view?.destroy() })
defineExpose({ insertMedia })
</script>

<template>
  <div class="we-code-editor">
    <div class="we-toolbar" role="toolbar" aria-label="正文工具">
      <button v-for="tool in tools" :key="tool.name" type="button" class="we-icon" :aria-label="tool.name" :title="tool.name" :disabled="disabled" @mousedown.prevent @click="format(tool)"><component :is="tool.icon" :size="17" /></button>
      <span class="we-tool-divider"></span>
      <button type="button" class="we-icon" title="撤销" aria-label="撤销" :disabled="disabled" @mousedown.prevent @click="view && undo(view)"><Undo2 :size="17" /></button>
      <button type="button" class="we-icon" title="重做" aria-label="重做" :disabled="disabled" @mousedown.prevent @click="view && redo(view)"><Redo2 :size="17" /></button>
      <button type="button" class="we-icon" title="上传图片" aria-label="上传图片" :disabled="disabled || pendingCount > 0" @mousedown.prevent @click="fileInput?.click()"><ImagePlus :size="17" /></button>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden aria-label="选择图片" @change="chooseFiles" />
      <span class="we-toolbar-spacer"></span>
      <div class="we-segment" aria-label="正文视图">
        <button type="button" class="we-icon" title="编辑" aria-label="仅编辑" :aria-pressed="mode === 'edit'" @click="mode = 'edit'"><FileCode2 :size="17" /></button>
        <button type="button" class="we-icon" title="分屏预览" aria-label="分屏预览" :aria-pressed="mode === 'split'" @click="mode = 'split'"><Columns2 :size="17" /></button>
      </div>
    </div>
    <div class="we-code-panes" :class="{ 'is-split': mode === 'split' }">
      <div ref="host" class="we-code-host"></div>
      <div v-if="mode === 'split'" class="we-inline-preview md-typeset" aria-label="正文预览" v-html="preview"></div>
    </div>
    <div class="we-code-footer"><span>{{ modelValue.length }} 字符</span><span v-if="pendingCount" role="status">图片上传中</span><span>Markdown</span></div>
  </div>
</template>
