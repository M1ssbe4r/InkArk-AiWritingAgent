import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import fs from 'fs'

function copyWorkerPlugin() {
  return {
    name: 'copy-parse-worker',
    closeBundle() {
      const src = path.resolve(__dirname, 'electron/workers/parseWorker.cjs')
      const dst = path.resolve(__dirname, 'dist-electron/parseWorker.cjs')
      try {
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.copyFileSync(src, dst)
        console.log('[copy-plugin] copied parseWorker.cjs to dist-electron/')
      } catch (e: any) {
        console.warn('[copy-plugin] failed to copy parseWorker.cjs:', e?.message)
      }
    },
  }
}

export default defineConfig({
  logLevel: 'error',
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          plugins: [copyWorkerPlugin()],
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['fts5-sql-bundle', 'jieba-wasm', 'chardet', 'iconv-lite', 'mammoth'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
