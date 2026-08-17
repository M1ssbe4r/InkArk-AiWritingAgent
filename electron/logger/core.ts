/**
 * Logger 核心
 *
 * - log(): 主入口,内部做 level 过滤、redact、ring push、sink 派发
 * - streamStart(streamId, meta): AI 流式开始,返回 streamCtx
 * - streamCtx.token(text): 累计 token,仅在首 token 触发 1 次 info
 * - streamCtx.end(meta): 流结束,info 记统计
 * - streamCtx.error(err): 错误路径,error 级
 *
 * 业务侧不直接调 streamStart/End,在 api.streamChat 包装即可。
 * 不会在循环里打 token 级日志 → 不会刷屏。
 *
 * 单例:整个 app 一个 logger,通过 getLogger() / initLogger() 使用。
 */

import path from 'path'
import { redactEntry, errorToObject } from './redaction'
import { RingBuffer } from './ring'
import { FileSink } from './sinks/file'
import { ConsoleSink } from './sinks/console'
import {
  type LogEntry, type LogLevel, type LoggerConfig,
  LEVEL_RANK, DEFAULT_CONFIG,
} from './types'

export interface StreamContext {
  tokens: number
  firstLogged: boolean
  done: boolean
}

export interface Logger {
  log(lvl: LogLevel, scope: string, msg: string, data?: Record<string, unknown>): void
  debug(scope: string, msg: string, data?: Record<string, unknown>): void
  info(scope: string, msg: string, data?: Record<string, unknown>): void
  warn(scope: string, msg: string, data?: Record<string, unknown>): void
  error(scope: string, msg: string, data?: Record<string, unknown>): void
  errorObj(scope: string, msg: string, err: unknown, extra?: Record<string, unknown>): void

  /** AI 流式开始/累计 token / 结束/错误,只在关键节点打日志 */
  streamStart(_streamId: string, meta?: Record<string, unknown>): StreamContext
  streamToken(ctx: StreamContext, text: string): void
  streamEnd(ctx: StreamContext, meta?: Record<string, unknown>): void
  streamError(ctx: StreamContext, err: unknown, meta?: Record<string, unknown>): void

  flushSync(): void
  flush(): Promise<void>
  tail(n: number): LogEntry[]
  getLogDir(): string
  snapshot(): LogEntry[]
  getLogFiles(): string[]
  getCrashFilePath(): string
  writeCrash(entry: { t: number; kind: string; err: unknown; app: LoggerConfig['app']; session: string }): void
}

class LoggerImpl implements Logger {
  private cfg: LoggerConfig
  private ring: RingBuffer<LogEntry>
  private fileSink: FileSink
  private consoleSink: ConsoleSink | null
  private crashPath: string

  constructor(cfg: LoggerConfig, opts: { consoleEnabled: boolean }) {
    this.cfg = cfg
    this.ring = new RingBuffer<LogEntry>(cfg.ringCapacity)
    this.fileSink = new FileSink({
      logDir: cfg.logDir,
      maxBytes: cfg.maxFileBytes,
      retainDays: cfg.retainDays,
    })
    this.fileSink.pruneOld()
    this.consoleSink = opts.consoleEnabled ? new ConsoleSink(cfg.level) : null
    this.crashPath = path.join(cfg.logDir, 'crashes.log')
  }

  log(lvl: LogLevel, scope: string, msg: string, data?: Record<string, unknown>) {
    if (LEVEL_RANK[lvl] < LEVEL_RANK[this.cfg.level]) return
    const entry: LogEntry = {
      t: Date.now(),
      lvl,
      scope,
      msg,
      data,
      session: this.cfg.session,
      app: this.cfg.app,
    }
    const safe = this.cfg.redaction ? redactEntry(entry) : entry
    this.ring.push(safe)
    try { this.fileSink.write(safe) } catch {}
    try { this.consoleSink?.write(safe) } catch {}
  }
  debug(s: string, m: string, d?: Record<string, unknown>) { this.log('debug', s, m, d) }
  info(s: string, m: string, d?: Record<string, unknown>) { this.log('info', s, m, d) }
  warn(s: string, m: string, d?: Record<string, unknown>) { this.log('warn', s, m, d) }
  error(s: string, m: string, d?: Record<string, unknown>) { this.log('error', s, m, d) }
  errorObj(scope: string, msg: string, err: unknown, extra?: Record<string, unknown>) {
    const data: Record<string, unknown> = { ...(extra || {}), error: errorToObject(err) }
    this.log('error', scope, msg, data)
  }

  streamStart(_streamId: string, _meta?: Record<string, unknown>): StreamContext {
    this.log('info', 'api.streamChat', 'stream.start', _meta)
    return { tokens: 0, firstLogged: false, done: false }
  }
  streamToken(ctx: StreamContext, text: string) {
    ctx.tokens += text.length
    if (!ctx.firstLogged) {
      ctx.firstLogged = true
      this.log('info', 'api.streamChat', 'stream.firstToken', { tokens: ctx.tokens })
    }
  }
  streamEnd(ctx: StreamContext, meta?: Record<string, unknown>) {
    if (ctx.done) return
    ctx.done = true
    this.log('info', 'api.streamChat', 'stream.end', { tokens: ctx.tokens, ...(meta || {}) })
  }
  streamError(ctx: StreamContext, err: unknown, meta?: Record<string, unknown>) {
    if (ctx.done) return
    ctx.done = true
    this.log('error', 'api.streamChat', 'stream.error', { tokens: ctx.tokens, error: errorToObject(err), ...(meta || {}) })
  }

  flushSync() { this.fileSink.flushSync() }
  flush(): Promise<void> {
    return new Promise<void>((resolve) => { this.fileSink.flushSync(); resolve() })
  }
  tail(n: number) {
    const arr = this.ring.toArray()
    return arr.slice(-Math.max(0, n))
  }
  snapshot() { return this.ring.toArray() }
  getLogDir() { return this.cfg.logDir }
  getLogFiles() {
    const fs = require('fs') as typeof import('fs')
    try {
      return fs.readdirSync(this.cfg.logDir)
        .filter((f: string) => f.startsWith('inkark-') && f.endsWith('.log'))
        .map((f: string) => path.join(this.cfg.logDir, f))
    } catch { return [] }
  }
  getCrashFilePath() { return this.crashPath }

  writeCrash(entry: { t: number; kind: string; err: unknown; app: LoggerConfig['app']; session: string }) {
    const fs = require('fs') as typeof import('fs')
    const line = JSON.stringify({
      t: entry.t,
      kind: entry.kind,
      session: entry.session,
      app: entry.app,
      error: errorToObject(entry.err),
    }) + '\n'
    try {
      fs.mkdirSync(this.cfg.logDir, { recursive: true })
      fs.appendFileSync(this.crashPath, line, 'utf-8')
    } catch {}
  }
}

/**
 * 模块级 writeCrash - 在 logger 实例不可用时(例如 logger 自身初始化失败)也能落盘
 * 直接 append 到 crashPath,绕过实例方法。
 */
export function writeCrashRaw(opts: { crashPath: string; entry: { t: number; kind: string; err: unknown; app: LoggerConfig['app']; session: string } }): void {
  try {
    const fs = require('fs') as typeof import('fs')
    const line = JSON.stringify({
      t: opts.entry.t,
      kind: opts.entry.kind,
      session: opts.entry.session,
      app: opts.entry.app,
      error: errorToObject(opts.entry.err),
    }) + '\n'
    fs.mkdirSync(require('path').dirname(opts.crashPath), { recursive: true })
    fs.appendFileSync(opts.crashPath, line, 'utf-8')
  } catch {}
}

let _instance: Logger | null = null

export function initLogger(opts: { logDir: string; app: LoggerConfig['app']; dev: boolean }): Logger {
  const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  // 脱敏:
  //   - 打包版本 → 永远开,INKARK_LOG_REDACTION=off 也无效
  //   - dev → 可通过 INKARK_LOG_REDACTION=off 关闭(仅调试用)
  const redaction = opts.dev ? process.env.INKARK_LOG_REDACTION !== 'off' : true
  // 控制台 sink:
  //   - dev 默认开
  //   - 打包版本默认关,可通过 INKARK_LOG_CONSOLE=1 打开(仅调试)
  const consoleEnabled = opts.dev ? true : process.env.INKARK_LOG_CONSOLE === '1'
  const level: LogLevel = opts.dev ? 'debug' : 'info'
  const cfg: LoggerConfig = {
    ...DEFAULT_CONFIG,
    level,
    logDir: opts.logDir,
    session,
    app: opts.app,
    redaction,
  }
  _instance = new LoggerImpl(cfg, { consoleEnabled })
  return _instance
}

export function getLogger(): Logger {
  if (!_instance) throw new Error('logger not initialized; call initLogger() first')
  return _instance
}

export function tryGetLogger(): Logger | null { return _instance }
