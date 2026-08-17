import fs from 'fs'
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getDatabase } from './db'
import { runProjectImport, runDeferredFtsRebuild } from './projectImport'
import {
  ChapterSplitMode,
  BuiltChapter,
  buildChapters,
  buildBackupFromChapters,
} from './importSplit'
import { parseProjectFile as parseProjectFileInWorker, splitChaptersInWorker } from '../workers/parseWorkerHost'

const MAX_PARSE_FILE_SIZE = 200 * 1024 * 1024

const PROGRESS_CHANNEL = 'import:progress'

export interface ImportProgress {
  phase: 'parse' | 'split' | 'commit' | 'done' | 'error'
  current: number
  total: number
  message: string
}

function sendProgress(win: BrowserWindow, payload: ImportProgress) {
  if (!win || win.isDestroyed()) return
  try {
    win.webContents.send(PROGRESS_CHANNEL, payload)
  } catch {
  }
}

export interface ParseFileResult {
  text: string
  ext: string
  fileName: string
}

export async function parseProjectFile(filePath: string): Promise<ParseFileResult> {
  return parseProjectFileInWorker(filePath)
}

export interface ImportProjectResult {
  success: boolean
  projectId?: string
  error?: string
  chapterCount?: number
  matchedRule?: string
  fileName?: string
  totalChars?: number
}

export function registerImportHandlers(win: BrowserWindow) {
  ipcMain.handle(
    'import:openFile',
    async (_e, options: { filterName?: string } = {}) => {
      const result = await dialog.showOpenDialog(win, {
        filters: [
          { name: options.filterName || '文本文档 / Word / Markdown', extensions: ['txt', 'md', 'doc', 'docx'] },
          { name: '纯文本', extensions: ['txt'] },
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Word 文档', extensions: ['doc', 'docx'] },
        ],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false }
      }
      const filePath = result.filePaths[0]
      const stat = fs.statSync(filePath)
      if (stat.size > MAX_PARSE_FILE_SIZE) {
        return {
          success: false,
          error: `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB),上限 ${MAX_PARSE_FILE_SIZE / 1024 / 1024}MB`,
        }
      }
      try {
        sendProgress(win, { phase: 'parse', current: 0, total: 1, message: '正在读取文件...' })
        const parsed = await parseProjectFile(filePath)
        sendProgress(win, {
          phase: 'parse',
          current: 1,
          total: 1,
          message: `已读取 ${(parsed.text.length / 10000).toFixed(1)} 万字`,
        })
        return {
          success: true,
          path: filePath,
          fileName: parsed.fileName,
          text: parsed.text,
          totalChars: parsed.text.length,
        }
      } catch (e: any) {
        sendProgress(win, { phase: 'error', current: 0, total: 0, message: e?.message || '文件解析失败' })
        return { success: false, error: e?.message || '文件解析失败' }
      }
    },
  )

  ipcMain.handle(
    'import:splitChapters',
    async (_e, options: {
      text: string
      fileName: string
      projectTitle?: string
      splitOptions: { mode: ChapterSplitMode; pattern?: string; minChapterLength?: number }
    }) => {
      sendProgress(win, { phase: 'split', current: 0, total: 1, message: '正在识别章节...' })
      const fallbackTitle = options.projectTitle || options.fileName.replace(/\.[^.]+$/, '')
      const split = await splitChaptersInWorker(options.text, options.splitOptions, fallbackTitle)
      const chapters = buildChapters(split)
      sendProgress(win, {
        phase: 'split',
        current: 1,
        total: 1,
        message: `识别到 ${chapters.length} 章`,
      })
      return {
        success: true,
        chapters,
        matchedRule: split.matchedRule,
        totalChars: split.totalChars,
      }
    },
  )

  ipcMain.handle(
    'import:commitProject',
    async (_e, options: {
      fileName: string
      projectTitle?: string
      chapters: BuiltChapter[]
    }) => {
      const db = getDatabase()
      const backup = buildBackupFromChapters(
        options.fileName,
        options.projectTitle || options.fileName.replace(/\.[^.]+$/, ''),
        options.chapters,
      )
      const result = await runProjectImport(db, backup, {
        deferFts: true,
        onProgress: (info) => {
          sendProgress(win, {
            phase: (info.phase as any) || 'commit',
            current: info.current,
            total: info.total || options.chapters.length || 1,
            message: info.message,
          })
        },
        shouldYield: () => new Promise<void>((r) => setTimeout(r, 0)),
      })
      if (result.success && result.projectId) {
        const newProjectId = result.projectId
        const projectTitle = options.projectTitle || options.fileName.replace(/\.[^.]+$/, '')
        setImmediate(() => {
          runDeferredFtsRebuild(db, newProjectId, backup, {
            onProgress: (info) => {
              sendProgress(win, {
                phase: (info.phase as any) || 'fts-background',
                current: info.current,
                total: info.total || 1,
                message: info.message,
              })
            },
            shouldYield: () => new Promise<void>((r) => setTimeout(r, 0)),
            // tokenize 批量加大, 减少 worker IPC 往返; worker 内部对每条文本流式处理, 不会撑爆内存
            batchSize: 100,
          }).then((r) => {
            if (r.success) {
              sendProgress(win, { phase: 'done', current: 1, total: 1, message: '导入完成' })
            } else {
              sendProgress(win, { phase: 'fts-background-error', current: 0, total: 0, message: `后台索引失败:${r.error || '搜索可能不完整'}` })
              sendProgress(win, { phase: 'done', current: 1, total: 1, message: '导入完成(索引不完整)' })
            }
          }).catch((e) => {
            console.error('[import] 后台 FTS 重建失败:', e)
            sendProgress(win, { phase: 'fts-background-error', current: 0, total: 0, message: '后台索引失败,搜索可能不完整' })
            sendProgress(win, { phase: 'done', current: 1, total: 1, message: '导入完成(索引不完整)' })
          })
          void projectTitle
        })
      }
      if (result.success) {
        sendProgress(win, { phase: 'committed', current: 1, total: 1, message: '数据已写入,后台索引中...' })
      } else {
        sendProgress(win, { phase: 'error', current: 0, total: 0, message: result.error || '导入失败' })
      }
      return result
    },
  )
}
