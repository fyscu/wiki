import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/assets/community/',
  plugins: [vue()],
  build: {
    outDir: 'docs/assets/community', emptyOutDir: true, manifest: true,
    rollupOptions: { input: 'community/main.ts', output: { entryFileNames: 'app-[hash].js', assetFileNames: '[name]-[hash][extname]' } },
  },
})
