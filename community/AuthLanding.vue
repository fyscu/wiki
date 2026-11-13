<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { clearSession, saveSession } from './api'
import { safeReturnPath } from '../lib/navigation.mjs'

// 统一登录（connector-basic）回调落地页。
// Answer 在 /answer/api/v1/connector/redirect/basic 完成登录后 302 到
// /users/auth-landing?access_token=...；若需补邮箱则带 binding_key。
// 这里把 Answer 签发的 token 落进与 /login/ 完全相同的会话结构，后续 /_community/me 等调用不变。
const message = ref('正在完成登录…')
const failed = ref(false)

onMounted(async () => {
  const params = new URLSearchParams(location.search)
  const token = params.get('access_token') || ''
  const bindingKey = params.get('binding_key') || ''
  const next = sessionStorage.getItem('feiyang-sso-next') || '/questions/'
  sessionStorage.removeItem('feiyang-sso-next')

  if (bindingKey) {
    message.value = '需要确认邮箱，正在跳转…'
    location.replace(`/users/confirm-email/?binding_key=${encodeURIComponent(bindingKey)}`)
    return
  }
  if (!/^[A-Za-z0-9._-]{8,2048}$/.test(token)) {
    failed.value = true
    message.value = '登录凭据无效或已过期，请重新登录。'
    return
  }
  try {
    // 先用 token 直接取用户资料，确认这张票真的属于 Answer，再落会话。
    const user = await apiWithToken(token)
    saveSession({ ...user, access_token: token })
    location.replace(safeReturnPath(next, location.origin))
  } catch (cause) {
    clearSession()
    failed.value = true
    message.value = (cause as Error).message || '登录未能完成，请重试。'
  }
})

async function apiWithToken(token: string) {
  const response = await fetch('/_community/me', {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000)
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.code !== 200) throw new Error(result.msg || '登录状态校验失败')
  return result.data
}
</script>
<template>
  <div class="qa-auth-page">
    <p :class="failed ? 'qa-alert' : 'qa-notice'" role="status">{{ message }}</p>
    <p v-if="failed"><a href="/login/">返回登录</a></p>
  </div>
</template>
