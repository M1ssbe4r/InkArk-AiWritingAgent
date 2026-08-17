/**
 * 日志模块 - 共享类型定义
 *
 * 主进程/渲染进程共用同一种 entry 结构。
 * 写入文件前必须走 redact() 脱敏。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 数字越小越详细,便于阈值比较 */
export const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export interface LogEntry {
  /** epoch millis */
  t: number
  lvl: LogLevel
  /** 点分命名,例如 'api.streamChat' / 'db.chapter.save' / 'react.errorBoundary' */
  scope: string
  msg: string
  /** 已脱敏,经 redact() 处理 */
  data?: Record<string, unknown>
  /** 启动 session id,用于在导出包里串多次运行 */
  session: string
  app: {
    ver: string
    plat: NodeJS.Platform
    electron: string
    node: string
  }
}

export interface LoggerConfig {
  /** 低于这个 level 的不写(默认 info) */
  level: LogLevel
  /** 日志目录绝对路径 */
  logDir: string
  /** 单文件最大字节,默认 5MB */
  maxFileBytes: number
  /** 文件保留天数,默认 7 */
  retainDays: number
  /** 内存 ring buffer 容量,默认 1000 */
  ringCapacity: number
  /** 脱敏开关,默认开;任何打包版本都关不掉 */
  redaction: boolean
  /** session id,启动时生成一次 */
  session: string
  /** 应用元信息 */
  app: LogEntry['app']
}

export const DEFAULT_CONFIG: Omit<LoggerConfig, 'logDir' | 'session' | 'app'> = {
  level: 'info',
  maxFileBytes: 5 * 1024 * 1024,
  retainDays: 7,
  ringCapacity: 1000,
  redaction: true,
}
