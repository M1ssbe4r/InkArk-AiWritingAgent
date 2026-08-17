/**
 * Crash 兜底 - 钩住未捕获异常,写入独立的 crashes.log
 *
 * 主进程钩子:uncaughtException / unhandledRejection
 * 子进程钩子(在 main.ts 里调 installChildCrashHandlers):render-process-gone / child-process-gone
 *
 * 注意:这里写的是独立文件,不进 ring/sink,保证主 logger 自己也挂了也能落盘。
 */

import fs from 'fs'
import path from 'path'
import { getLogger, writeCrashRaw, type Logger } from './core'
import type { LoggerConfig } from './types'

function defaultApp(): LoggerConfig['app'] {
  return { ver: '0.0.0', plat: process.platform, electron: process.versions.electron || '', node: process.version }
}

/** 取 logger 实例,失败时返回 null(此时我们走 writeCrashRaw 兜底) */
function tryLogger(): Logger | null {
  try { return getLogger() } catch { return null }
}

function dump(entry: { kind: string; err: unknown }) {
  const t = Date.now()
  const app = defaultApp()
  const session = ''
  const logger = tryLogger()
  if (logger) {
    try {
      logger.writeCrash({ t, kind: entry.kind, err: entry.err, app, session })
      return
    } catch {}
  }
  // 兜底:绕过 logger 实例,直接写文件
  try {
    const logDir = (() => {
      // 优先环境变量;否则 cwd/logs(开发期)/app-data/logs(打包期,主进程会注入)
      const env = process.env.INKARK_LOG_DIR
      if (env) return env
      try {
        // require 可能失败,小心
        const { app } = require('electron') as typeof import('electron')
        return path.join(app.getPath('userData'), 'logs')
      } catch {
        return path.join(process.cwd(), 'logs')
      }
    })()
    const crashPath = path.join(logDir, 'crashes.log')
    writeCrashRaw({ crashPath, entry: { t, kind: entry.kind, err: entry.err, app, session } })
  } catch {
    // 写盘也失败,静默(无法再做什么)
  }
}

export function installMainCrashHandlers() {
  process.on('uncaughtException', (err) => {
    dump({ kind: 'uncaughtException', err })
  })
  process.on('unhandledRejection', (reason) => {
    dump({ kind: 'unhandledRejection', err: reason })
  })
}

/** 给 main.ts 调,绑定 Electron 子进程崩溃事件 */
export function installChildCrashHandlers(app: import('electron').App) {
  const writeChild = (kind: string, payload: Record<string, unknown>) => {
    const logger = tryLogger()
    const appMeta = defaultApp()
    if (logger) {
      try {
        logger.writeCrash({ t: Date.now(), kind, err: payload, app: appMeta, session: '' })
        return
      } catch {}
    }
    try {
      const logDir = path.join(app.getPath('userData'), 'logs')
      const crashPath = path.join(logDir, 'crashes.log')
      fs.mkdirSync(logDir, { recursive: true })
      fs.appendFileSync(crashPath, JSON.stringify({ t: Date.now(), kind, app: appMeta, error: payload }) + '\n', 'utf-8')
    } catch {}
  }

  app.on('render-process-gone', (_event, _webContents, details) => {
    writeChild('render-process-gone', { reason: details.reason, exitCode: details.exitCode })
  })
  app.on('child-process-gone', (_event, details) => {
    writeChild('child-process-gone', { type: details.type, reason: details.reason, exitCode: details.exitCode, serviceName: details.serviceName })
  })
}
