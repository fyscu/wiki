import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: '.',
  testMatch: 'editor.spec.ts',
  outputDir: '../.qa/results',
  timeout: 30000,
  workers: 2,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5188', channel: 'chrome', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node node_modules/vite/bin/vite.js --config community/editor/tests/vite.config.mjs', cwd: fileURLToPath(new URL('../../../', import.meta.url)), url: 'http://127.0.0.1:5188/community/editor/tests/index.html', reuseExistingServer: true },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1050 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
})
