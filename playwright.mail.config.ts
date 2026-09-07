import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/mail', workers: 1, timeout: 45000, outputDir: 'test-results-mail',
  use: { channel: 'chrome', trace: 'off', screenshot: 'only-on-failure', launchOptions: { args: ['--no-proxy-server'] } },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
})
