/**
 * IPC handlers - 暴露给渲染进程的日志能力
 *
 * 通道:
 *   log:send        - 渲染进程打一条日志
 *   log:tail        - 拉取最近 N 条(给 UI 调试面板,可选)
 *   log:getLogDir   - 拿到日志目录绝对路径(给 UI 显示)
 *   log:openDir     - 在系统文件管理器打开日志目录
 *   log:export      - 触发诊断包导出
 *
 * 设计:每个 handler 都 try/catch,绝不向渲染进程抛错(否则渲染端会显示为 IPC 失败,
 * 进一步掩盖真实日志错误)。
 */

import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { getLogger, type Logger } from './core'
import { exportDiagnosticBundle, type DbStats } from './export'

interface DbStatsProvider {
  (): Promise<DbStats> | DbStats
}

export interface RegisterLogIpcOptions {
  /** 用于导出时填 dbStats;不传则全 0 */
  dbStats?: DbStatsProvider
  /** 拿到当前激活项目 id */
  getActiveProjectId?: () => string | null
  /** 拿到 app version(默认从 package.json 读) */
  appVer?: string
}

function resolveAppVer(fallback?: string): string {
  if (fallback) return fallback
  try {
    const pkg = require(path.join(app.getAppPath(), 'package.json')) as { version?: string }
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export function registerLogIpc(opts: RegisterLogIpcOptions = {}) {
  const appVer = resolveAppVer(opts.appVer)
  const startedAt = Date.now()

  ipcMain.handle('log:send', (_e, payload: { level: 'debug' | 'info' | 'warn' | 'error'; scope: string; msg: string; data?: Record<string, unknown> }) => {
    try {
      const logger = getLoggerSafe()
      if (!logger) return { ok: false }
      const { level, scope, msg, data } = payload || {} as any
      if (!level || !scope) return { ok: false }
      // 渲染进程的 level 限制:warn 以上必收,info 可被忽略(防滥用)
      if (level === 'info' && process.env.INKARK_LOG_REDACTION !== 'off') {
        // 走 logger 但允许被 threshold 过滤;logger 内部已经按 level 过滤
      }
      logger.log(level, scope, msg, data)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('log:tail', (_e, n: number) => {
    try {
      const logger = getLoggerSafe()
      if (!logger) return []
      return logger.tail(Math.min(Math.max(0, n | 0), 5000))
    } catch { return [] }
  })

  ipcMain.handle('log:getLogDir', () => {
    try {
      const logger = getLoggerSafe()
      return logger?.getLogDir() || ''
    } catch { return '' }
  })

  ipcMain.handle('log:openDir', async () => {
    try {
      const logger = getLoggerSafe()
      if (!logger) return { ok: false }
      const dir = logger.getLogDir()
      fs.mkdirSync(dir, { recursive: true })
      const err = await shell.openPath(dir)
      return { ok: err === '', error: err || undefined }
    } catch (e: any) {
      return { ok: false, error: e?.message }
    }
  })

  ipcMain.handle('log:export', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || undefined
    try {
      const logger = getLoggerSafe()
      if (!logger) return { ok: false, error: 'logger 未初始化' }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const defaultName = `inkark-diag-${stamp}.tar.gz`
      const result = win
        ? await dialog.showSaveDialog(win, {
            title: '导出诊断包',
            defaultPath: path.join(os.homedir(), 'Downloads', defaultName),
            filters: [{ name: '诊断包', extensions: ['tar.gz', 'gz'] }],
          })
        : await dialog.showSaveDialog({
            title: '导出诊断包',
            defaultPath: path.join(os.homedir(), defaultName),
            filters: [{ name: '诊断包', extensions: ['tar.gz', 'gz'] }],
          })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      const outFile = await exportDiagnosticBundle(logger, {
        outFile: result.filePath,
        appVer,
        uptimeMs: Date.now() - startedAt,
        activeProjectId: opts.getActiveProjectId?.() ?? null,
        dbStats: opts.dbStats,
      })
      logger.info('log.export', 'diagnostic bundle exported', { path: outFile, bytes: fs.statSync(outFile).size })
      return { ok: true, path: outFile }
    } catch (err: any) {
      try { getLoggerSafe()?.error('log.export', 'export failed', { error: err?.message }) } catch {}
      return { ok: false, error: err?.message || String(err) }
    }
  })
}

function getLoggerSafe(): Logger | null {
  try { return getLogger() } catch { return null }
}
