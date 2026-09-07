<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RefreshCw } from '@lucide/vue'
import { api } from './api'

const props = defineProps<{ action: 'email' | 'password' }>()
const challenge = ref<any>(null), code = ref(''), loading = ref(false), error = ref('')
const image = computed(() => /^data:image\/(png|jpeg|gif|webp);base64,/.test(challenge.value?.captcha_img || '') ? challenge.value.captcha_img : '')
const ready = computed(() => !loading.value && !error.value && challenge.value !== null && (!challenge.value.verify || Boolean(image.value)))
async function refresh() {
  loading.value = true; error.value = ''; code.value = ''
  try { challenge.value = await api(`captcha?action=${props.action}`) }
  catch (cause) { error.value = cause.message }
  finally { loading.value = false }
}
function fields() {
  if (loading.value || error.value || !challenge.value) throw new Error('验证状态尚未就绪，请稍后重试')
  if (!challenge.value.verify) return {}
  if (!image.value) throw new Error('验证码暂时无法加载，请联系管理员')
  if (!code.value.trim()) throw new Error('请输入图形验证码')
  return { captcha_id: challenge.value.captcha_id, captcha_code: code.value.trim() }
}
onMounted(refresh)
watch(() => props.action, refresh)
defineExpose({ fields, refresh, ready })
</script>
<template>
  <div v-if="challenge?.verify || error" class="qa-captcha">
    <template v-if="challenge?.verify">
      <label>图形验证码<input v-model="code" autocomplete="off" maxlength="20" required /></label>
      <div class="qa-captcha-image"><img v-if="image" :src="image" alt="图形验证码" width="180" height="60" /><span v-else>验证码不可用</span><button type="button" class="qa-icon-button" title="更换验证码" aria-label="更换验证码" :disabled="loading" @click="refresh"><RefreshCw :size="18" /></button></div>
    </template>
    <p v-if="error" role="alert" class="qa-alert">{{ error }} <button class="qa-text-button" type="button" @click="refresh">重试</button></p>
  </div>
</template>
