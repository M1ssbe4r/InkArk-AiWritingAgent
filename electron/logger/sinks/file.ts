/**
 * 文件 sink - 按天滚动 + 按大小切分
 *
 * NDJSON 格式 (每行一个 JSON),便于 tail / 第三方工具解析。
 * 写盘走批量缓冲:每 500ms 或 50 条 flush 一次;flushLogger() / 退出时同步冲掉。
 *
 * 路径: <logDir>/inkark-YYYY-MM-DD.log
 * 切分: 单文件超 maxFileBytes 时关闭当前文件,改名为 .1,新建当日文件
 * 启动时清理 retainDays 天前的文件
 */

import fs from 'fs'
import path from 'path'
import { type LogEntry } from '../types'

const FLUSH_MS = 500
const FLUSH_COUNT = 50

function dateStamp(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export class FileSink {
  private currentPath: string
  private currentBytes = 0
  private currentDate: string
  private queue: string[] = []
  private timer: NodeJS.Timeout | null = null
  private writing = false
  private stopped = false
  readonly logDir: string
  private readonly maxBytes: number
  private readonly retainDays: number

  constructor(opts: { logDir: string; maxBytes: number; retainDays: number }) {
    this.logDir = opts.logDir
    this.maxBytes = opts.maxBytes
    this.retainDays = opts.retainDays
    this.currentDate = dateStamp()
    this.currentPath = this.filePathFor(this.currentDate)
    fs.mkdirSync(this.logDir, { recursive: true })
    // 启动时已经有这个文件(上次运行),沿用其大小
    try {
      const stat = fs.statSync(this.currentPath)
      this.currentBytes = stat.size
    } catch {
      this.currentBytes = 0
    }
  }

  private filePathFor(date: string): string {
    return path.join(this.logDir, `inkark-${date}.log`)
  }

  write(entry: LogEntry) {
    if (this.stopped) return
    const date = dateStamp(new Date(entry.t))
    if (date !== this.currentDate) this.rotateDate(date)
    const line = JSON.stringify(entry) + '\n'
    this.queue.push(line)
    if (this.queue.length >= FLUSH_COUNT) this.flushNow()
    else if (!this.timer) this.timer = setTimeout(() => this.flushNow(), FLUSH_MS)
  }

  private rotateDate(newDate: string) {
    this.flushNow()
    this.currentDate = newDate
    this.currentPath = this.filePathFor(newDate)
    this.currentBytes = 0
  }

  private rotateSize() {
    this.flushNow()
    this.currentBytes = 0
  }

  /** 立即把缓冲刷到磁盘。同步版本,用于 before-quit。 */
  flushSync() {
    if (this.queue.length === 0) return
    const data = this.queue.join('')
    this.queue = []
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    try {
      fs.appendFileSync(this.currentPath, data, 'utf-8')
      this.currentBytes += Buffer.byteLength(data, 'utf-8')
      if (this.currentBytes >= this.maxBytes) this.rotateSize()
    } catch (e) {
      // 写盘失败不能再走 logger,直接吞掉(否则会循环)
    }
  }

  private flushNow() {
    if (this.writing || this.queue.length === 0) return
    this.writing = true
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    const data = this.queue.join('')
    this.queue = []
    fs.appendFile(this.currentPath, data, 'utf-8', (err) => {
      this.writing = false
      if (!err) {
        this.currentBytes += Buffer.byteLength(data, 'utf-8')
        if (this.currentBytes >= this.maxBytes) this.rotateSize()
      }
      // 期间又积累了:继续冲
      if (this.queue.length > 0) {
        if (this.queue.length >= FLUSH_COUNT) this.flushNow()
        else if (!this.timer) this.timer = setTimeout(() => this.flushNow(), FLUSH_MS)
      }
    })
  }

  /** 启动时清理过期的旧文件 */
  pruneOld() {
    if (this.retainDays <= 0) return
    const cutoff = Date.now() - this.retainDays * 24 * 60 * 60 * 1000
    let entries: string[]
    try {
      entries = fs.readdirSync(this.logDir)
    } catch {
      return
    }
    for (const name of entries) {
      if (!name.startsWith('inkark-') || !name.endsWith('.log')) continue
      // inkark-YYYY-MM-DD.log
      const m = name.match(/^inkark-(\d{4}-\d{2}-\d{2})\.log$/)
      if (!m) continue
      const fileDate = new Date(m[1] + 'T00:00:00').getTime()
      if (Number.isFinite(fileDate) && fileDate < cutoff) {
        try { fs.unlinkSync(path.join(this.logDir, name)) } catch {}
      }
    }
  }

  /** 关闭 sink,不再接收新 entry */
  close() {
    this.stopped = true
    this.flushSync()
  }
}
