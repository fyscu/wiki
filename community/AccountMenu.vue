<script setup lang="ts">
import { ref } from 'vue'
import { UserRound, LogOut, MessageCircle, ShieldCheck, BookOpen } from '@lucide/vue'
import { auth, api, clearSession, loginHref, isModerator } from './api'
const open = ref(false)
async function logout() { try { await api('logout', 'POST') } finally { clearSession(); open.value = false; location.assign('/') } }
</script>
<template>
  <a v-if="!auth.user" :href="loginHref()" class="md-header__button md-icon" title="登录" aria-label="登录"><UserRound :size="24" /></a>
  <div v-else class="qa-account">
    <button class="md-header__button qa-user-button" type="button" :aria-expanded="open" aria-label="用户菜单" @click="open = !open"><UserRound :size="20" /><span>{{ auth.user.display_name || auth.user.username }}</span></button>
    <nav v-if="open" class="qa-account-menu" aria-label="用户菜单">
      <div class="qa-account-identity"><small>用户名</small><span>{{ auth.user.username }}</span></div>
      <a :href="`/questions/?username=${encodeURIComponent(auth.user.username)}`"><MessageCircle :size="16" />我的提问</a>
      <a v-if="auth.user.mail_status === 2" href="/users/account-activation/"><ShieldCheck :size="16" />验证邮箱</a>
      <a v-if="isModerator()" href="/review/"><ShieldCheck :size="16" />审核队列</a>
      <a v-if="Number(auth.user.role_id) === 2" href="/editor/"><BookOpen :size="16" />内容管理</a>
      <button @click="logout"><LogOut :size="16" />退出登录</button>
    </nav>
  </div>
</template>
