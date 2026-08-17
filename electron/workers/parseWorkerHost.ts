import { Worker } from 'worker_threads'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

interface PendingCall {
  resolve: (value: any) => void
  reject: (err: Error) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, PendingCall>()

function resolveWorkerPath(): string {
  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'parseWorker.cjs')
    if (fs.existsSync(unpacked)) return unpacked
  }

  const dst = path.join(__dirname, 'parseWorker.cjs')
  if (fs.existsSync(dst)) return dst
  const srcCandidates = [
    path.resolve(__dirname, '..', '..', 'electron', 'workers', 'parseWorker.cjs'),
    path.resolve(__dirname, '..', 'electron', 'workers', 'parseWorker.cjs'),
    path.resolve(process.cwd(), 'electron', 'workers', 'parseWorker.cjs'),
  ]
  for (const src of srcCandidates) {
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, dst)
        console.log('[parseWorker] copied', src, 'to', dst)
        return dst
      } catch (e: any) {
        console.warn('[parseWorker] copy failed:', e?.message)
      }
    }
  }
  return dst
}

function workerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (app.isPackaged) {
    const unpackedNodeModules = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
    env.NODE_PATH = env.NODE_PATH
      ? `${unpackedNodeModules}${path.delimiter}${env.NODE_PATH}`
      : unpackedNodeModules
  }
  return env
}

function ensureWorker(): Worker {
  if (worker) return worker
  const workerPath = resolveWorkerPath()
  const w = new Worker(workerPath, { env: workerEnv() })
  w.on('message', (msg: { id: number; ok: boolean; data?: any; error?: string }) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.data)
    else p.reject(new Error(msg.error || 'worker error'))
  })
  w.on('error', (err) => {
    for (const [, p] of pending) p.reject(err)
    pending.clear()
    worker = null
  })
  w.on('exit', (code) => {
    if (code !== 0) {
      const err = new Error(`parseWorker exited with code ${code}`)
      for (const [, p] of pending) p.reject(err)
      pending.clear()
    }
    worker = null
  })
  worker = w
  return w
}

function call<T = any>(type: string, payload: any): Promise<T> {
  const w = ensureWorker()
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, type, payload })
  })
}

export interface ParseFileResult {
  text: string
  fileName: string
  ext: string
}

export function parseProjectFile(filePath: string): Promise<ParseFileResult> {
  return call<ParseFileResult>('parseFile', { filePath })
}

export interface ChapterSplitResult {
  chapters: Array<{ title: string; content: string; charCount: number }>
  matchedRule: string
  totalChars: number
}

export function splitChaptersInWorker(
  text: string,
  splitOptions: { mode: 'auto' | 'pattern' | 'blankline' | 'whole'; pattern?: string; minChapterLength?: number },
  fallbackTitle: string,
): Promise<ChapterSplitResult> {
  return call<ChapterSplitResult>('splitChapters', { text, splitOptions, fallbackTitle })
}

export function tokenizeBatchInWorker(texts: string[]): Promise<string[]> {
  return call<string[]>('tokenizeBatch', { texts })
}

export function disposeParseWorker() {
  if (worker) {
    worker.terminate()
    worker = null
  }
}
