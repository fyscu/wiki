<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api, auth, saveSession, clearSession, accountSettings } from './api'
import Captcha from './Captcha.vue'
import { useMailCooldown } from './useMailCooldown'
import { safeReturnPath } from '../lib/navigation.mjs'

const activation = location.pathname.includes('account-activation')
const code = new URLSearchParams(location.search).get('code') || ''
const email = ref(''), password = ref(''), confirm = ref('')
const busy = ref(false), error = ref(''), notice = ref(''), done = ref(false), mailReady = ref(false)
const captcha = ref<InstanceType<typeof Captcha>>()
const cooldown = useMailCooldown(activation ? auth.user?.e_mail || 'activation' : 'password-reset')
const returnPath = safeReturnPath(sessionStorage.getItem('feiyang-verification-next'), location.origin)
watch(() => auth.user?.mail_status, status => {
  if (activation && !code && status === 1) { done.value = true; notice.value = '邮箱已验证。' }
}, { immediate: true })
onMounted(async () => {
  // Remove one-time credentials before subsequent navigation or copied links.
  if (code) history.replaceState(history.state, '', location.pathname)
  try { mailReady.value = (await accountSettings()).mail_ready } catch (cause) { error.value = cause.message }
  if (activation && code) await submit()
})
async function submit(verifyLink = true) {
  if (busy.value || (!code && cooldown.seconds.value)) return
  error.value = ''; notice.value = ''
  if (!activation && code && password.value !== confirm.value) { error.value = '两次输入的密码不一致'; return }
  if ((!code || !verifyLink) && !mailReady.value) { error.value = '邮件服务暂未开放'; return }
  busy.value = true
  try {
    if (activation && code && verifyLink) {
      const user = await api('email/verify', 'POST', { code }, true)
      clearSession(); saveSession(user)
      done.value = true; notice.value = '邮箱验证成功。'
    } else if (activation) {
      if (!auth.user || cooldown.seconds.value) return
      if (!captcha.value) throw new Error('验证状态尚未就绪，请稍后重试')
      await api('email/resend', 'POST', captcha.value.fields())
      cooldown.start()
      notice.value = '验证邮件发送请求已提交，请检查邮箱。'
    } else if (code) {
      await api('password/replace', 'POST', { code, pass: password.value }, true)
      clearSession(); done.value = true; notice.value = '密码已更新，请重新登录。'
    } else {
      if (!captcha.value) throw new Error('验证状态尚未就绪，请稍后重试')
      await api('password/reset', 'POST', { e_mail: email.value.trim(), ...captcha.value.fields() }, true)
      cooldown.start()
      notice.value = '如果该邮箱已注册，你将收到重置密码邮件。'
    }
  } catch (cause) { error.value = cause.message }
  finally { busy.value = false; if ((!code || !verifyLink) && captcha.value) await captcha.value.refresh() }
}
</script>
<template>
  <div class="qa-auth-page">
    <p v-if="busy" role="status">正在处理…</p>
    <p v-if="error" class="qa-alert" role="alert">{{ error }}</p>
    <p v-if="notice" class="qa-notice" role="status">{{ notice }}</p>
    <template v-if="!done">
      <template v-if="activation">
        <p v-if="!code">请验证注册邮箱<span v-if="auth.user?.e_mail"> {{ auth.user.e_mail }}</span>。</p>
        <form v-if="auth.user && mailReady" class="qa-form" @submit.prevent="submit(false)">
          <Captcha ref="captcha" action="email" />
          <button class="qa-primary" :disabled="busy || cooldown.seconds.value > 0 || !captcha?.ready">{{ cooldown.seconds.value > 0 ? `${cooldown.seconds.value} 秒后可重发` : '重新发送验证邮件' }}</button>
        </form>
        <p v-else-if="mailReady && !auth.user">请先<a href="/login/?next=%2Fusers%2Faccount-activation%2F">登录</a>后重新发送验证邮件。</p>
      </template>
      <form v-else-if="code || mailReady" class="qa-form" @submit.prevent="submit()">
        <template v-if="code">
          <label for="new-password">新密码<input id="new-password" v-model="password" type="password" autocomplete="new-password" minlength="8" maxlength="32" required /></label>
          <label for="confirm-password">确认密码<input id="confirm-password" v-model="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="32" required /></label>
        </template>
        <label v-else for="reset-email">注册邮箱<input id="reset-email" v-model="email" type="email" autocomplete="email" required /></label>
        <Captcha v-if="!code" ref="captcha" action="email" />
        <button class="qa-primary" :disabled="busy || (!code && (cooldown.seconds.value > 0 || !captcha?.ready))">{{ code ? '更新密码' : cooldown.seconds.value > 0 ? `${cooldown.seconds.value} 秒后可重发` : '发送重置邮件' }}</button>
      </form>
      <p v-if="!code && !mailReady" class="qa-notice">邮件服务暂未开放，请联系管理员。</p>
    </template>
    <p><a :href="done && activation ? returnPath : '/login/'">{{ done && activation ? '继续访问' : '返回登录' }}</a></p>
  </div>
</template>
