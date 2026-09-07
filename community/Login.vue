<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Captcha from './Captcha.vue'
import { api, auth, saveSession, accountSettings } from './api'
import { safeReturnPath } from '../lib/navigation.mjs'
const mode = ref(location.pathname.startsWith('/register') ? 'register' : 'login'), name = ref(''), email = ref(''), password = ref(''), confirm = ref('')
const busy = ref(false), error = ref(''), notice = ref('')
const settings = ref<any>(null)
const captcha = ref<InstanceType<typeof Captcha>>()
const registrationOpen = computed(() => settings.value?.mail_ready && settings.value?.allow_new_registrations && settings.value?.allow_email_registrations)
onMounted(async () => { try { settings.value = await accountSettings() } catch (cause) { error.value = cause.message } })
async function submit() {
  if (busy.value || !captcha.value?.ready) return
  error.value = ''; notice.value = ''
  if (mode.value === 'register' && !(settings.value?.mail_ready && settings.value?.allow_new_registrations && settings.value?.allow_email_registrations)) { error.value = '自助注册暂未开放'; return }
  if (mode.value === 'register' && password.value !== confirm.value) { error.value = '两次输入的密码不一致'; return }
  busy.value = true
  try {
    if (!captcha.value) throw new Error('验证状态尚未就绪，请稍后重试')
    const user = await api(mode.value, 'POST', { name: name.value.trim(), e_mail: email.value.trim(), pass: password.value, ...captcha.value.fields() }, true)
    saveSession(user)
    const next = new URLSearchParams(location.search).get('next') || '/questions/'
    if (user.mail_status === 2) {
      sessionStorage.setItem('feiyang-verification-next', safeReturnPath(next, location.origin))
      if (mode.value === 'register') sessionStorage.setItem(`feiyang-mail-cooldown:${user.e_mail}`, String(Date.now() + 60000))
      location.assign('/users/account-activation/'); return
    }
    location.assign(safeReturnPath(next, location.origin))
  } catch (cause) { error.value = cause.message; await captcha.value?.refresh() }
  finally { busy.value = false }
}
</script>
<template>
  <div class="qa-auth-page">
    <p v-if="auth.user">已登录为 {{ auth.user.display_name || auth.user.username }}。<a v-if="auth.user.mail_status === 2" href="/users/account-activation/">验证邮箱</a><a v-else href="/questions/">返回知识问答</a></p>
    <template v-else>
      <div v-if="registrationOpen" class="qa-tabs" role="tablist" aria-label="账号"><button :aria-selected="mode === 'login'" role="tab" @click="mode = 'login'; error = ''">登录</button><button :aria-selected="mode === 'register'" role="tab" @click="mode = 'register'; error = ''">注册</button></div>
      <p v-else-if="settings" class="qa-notice">自助注册暂未开放。</p>
      <form v-if="mode === 'login' || registrationOpen" class="qa-form" @submit.prevent="submit">
        <label v-if="mode === 'register'" for="account-name">用户名<input id="account-name" v-model="name" autocomplete="username" minlength="2" maxlength="30" required /></label>
        <label for="account-email">{{ mode === 'login' ? '邮箱或用户名' : '邮箱' }}<input id="account-email" v-model="email" :type="mode === 'login' ? 'text' : 'email'" :autocomplete="mode === 'login' ? 'username' : 'email'" autocapitalize="none" :spellcheck="false" maxlength="500" required /></label>
        <label for="account-password">密码<input id="account-password" v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" minlength="8" maxlength="32" required /></label>
        <label v-if="mode === 'register'" for="account-confirm">确认密码<input id="account-confirm" v-model="confirm" type="password" autocomplete="new-password" required /></label>
        <p v-if="mode === 'register' && settings?.allow_email_domains?.length" class="qa-muted">允许的邮箱域名：{{ settings.allow_email_domains.join('、') }}</p>
        <Captcha ref="captcha" :action="mode === 'register' ? 'email' : 'password'" />
        <p v-if="error" class="qa-alert" role="alert">{{ error }}</p><p v-if="notice" class="qa-notice" role="status">{{ notice }}</p>
        <button class="qa-primary" type="submit" :disabled="busy || !captcha?.ready">{{ busy ? '正在提交…' : mode === 'login' ? '登录' : '创建账号' }}</button>
        <a v-if="settings?.mail_ready && mode === 'login'" href="/users/password-reset/">忘记密码</a>
      </form>
      <p v-else><a href="/login/">返回登录</a></p>
    </template>
  </div>
</template>
