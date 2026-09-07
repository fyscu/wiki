import { computed, onUnmounted, ref } from 'vue'

export function useMailCooldown(key: string) {
  const storageKey = `feiyang-mail-cooldown:${key}`
  const now = ref(Date.now()), until = ref(Number(sessionStorage.getItem(storageKey)) || 0)
  const seconds = computed(() => Math.max(0, Math.ceil((until.value - now.value) / 1000)))
  const timer = setInterval(() => { now.value = Date.now() }, 1000)
  onUnmounted(() => clearInterval(timer))
  function start() { now.value = Date.now(); until.value = now.value + 60000; sessionStorage.setItem(storageKey, String(until.value)) }
  return { seconds, start }
}
