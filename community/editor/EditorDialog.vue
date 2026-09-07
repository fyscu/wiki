<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { X } from '@lucide/vue'
const props = defineProps<{ open: boolean; title: string; wide?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
watch(() => props.open, async open => {
  await nextTick()
  if (open && !dialog.value?.open) dialog.value?.showModal()
  else if (!open && dialog.value?.open) dialog.value.close()
}, { immediate: true })
</script>

<template>
  <dialog ref="dialog" class="we-dialog" :class="{ 'we-dialog-wide': wide }" :aria-label="title" @cancel.prevent="!disabled && emit('close')" @click="event => { if (event.target === dialog && !disabled) emit('close') }">
    <div class="we-section-head"><h2>{{ title }}</h2><button type="button" class="we-icon" :disabled="disabled" title="关闭" aria-label="关闭对话框" @click="emit('close')"><X :size="18" /></button></div>
    <slot></slot>
  </dialog>
</template>
