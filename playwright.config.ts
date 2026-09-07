import { defineConfig, devices } from '@playwright/test'
import dns from 'node:dns'
import { isIPv4 } from 'node:net'

const baseURL = process.env.WIKI_BASE_URL || 'http://127.0.0.1:5173'
const address = process.env.WIKI_TEST_ADDRESS
const hostname = new URL(baseURL).hostname
// A test-only override permits TLS checks before recursive DNS caches expire.
if (address) {
  if (!isIPv4(address)) throw new Error('WIKI_TEST_ADDRESS must be an IPv4 address')
  const original = dns.lookup.bind(dns)
  dns.lookup = ((name, options, callback) => {
    if (name !== hostname) return original(name, options, callback)
    const cb = typeof options === 'function' ? options : callback
    queueMicrotask(() => typeof options === 'object' && options?.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4))
  }) as typeof dns.lookup
  const originalAsync = dns.promises.lookup.bind(dns.promises)
  dns.promises.lookup = (async (name, options) => {
    if (name !== hostname) return originalAsync(name, options)
    return typeof options === 'object' && options?.all ? (options.family === 6 ? [] : [{ address, family: 4 }]) : { address, family: 4 }
  }) as typeof dns.promises.lookup
}

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL, channel: 'chrome', trace: 'off', screenshot: 'only-on-failure', launchOptions: { args: ['--no-proxy-server', ...(address ? [`--host-resolver-rules=MAP ${hostname} ${address}`] : [])] } },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
})
