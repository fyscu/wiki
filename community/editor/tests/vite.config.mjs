import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  cacheDir: 'community/editor/.qa/vite',
  server: { host: '127.0.0.1', port: 5188, strictPort: true, proxy: { '/_editor': 'http://127.0.0.1:5173' } },
  build: { outDir: 'community/editor/.qa/build', emptyOutDir: true, rollupOptions: { input: 'community/editor/tests/index.html' } },
})
