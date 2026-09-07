<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bold, Italic, Code, Link, List, Quote } from '@lucide/vue'
import { renderMarkdown } from './markdown'
const props = defineProps<{ modelValue: string; label?: string; rows?: number }>()
const emit = defineEmits(['update:modelValue'])
const field = ref<HTMLTextAreaElement>()
const mode = ref('edit')
const preview = computed(() => renderMarkdown(props.modelValue))
const tools = [{ name: '加粗', icon: Bold, left: '**', right: '**' }, { name: '斜体', icon: Italic, left: '*', right: '*' },
  { name: '代码', icon: Code, left: '\n```text\n', right: '\n```\n' }, { name: '链接', icon: Link, left: '[', right: '](https://)' },
  { name: '列表', icon: List, left: '\n- ', right: '' }, { name: '引用', icon: Quote, left: '\n> ', right: '' }]
function insert(tool) {
  const input = field.value
  if (!input) return
  const start = input.selectionStart, end = input.selectionEnd
  emit('update:modelValue', props.modelValue.slice(0, start) + tool.left + props.modelValue.slice(start, end) + tool.right + props.modelValue.slice(end))
  requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + tool.left.length, end + tool.left.length) })
}
</script>
<template>
  <div class="qa-editor">
    <div class="qa-editor-bar">
      <div class="qa-mode" role="tablist" aria-label="编辑模式"><button type="button" role="tab" :aria-selected="mode === 'edit'" @click="mode = 'edit'">编辑</button><button type="button" role="tab" :aria-selected="mode === 'preview'" @click="mode = 'preview'">预览</button></div>
      <div v-if="mode === 'edit'" class="qa-format"><button v-for="tool in tools" :key="tool.name" type="button" :title="tool.name" :aria-label="tool.name" @click="insert(tool)"><component :is="tool.icon" :size="16" /></button></div>
    </div>
    <textarea v-if="mode === 'edit'" ref="field" :aria-label="label || '内容'" :rows="rows || 8" :value="modelValue" maxlength="30000" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"></textarea>
    <div v-else class="qa-preview" v-html="preview || '<p class=qa-muted>暂无内容</p>'"></div>
  </div>
</template>
