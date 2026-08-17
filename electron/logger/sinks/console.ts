/**
 * 控制台 sink - dev 模式打 stdout,带 codepage 转码兼容中文 Windows
 *
 * 打包版本默认关闭 console sink,避免在用户终端喷日志(他们不会看终端)。
 * 通过 INKARK_LOG_CONSOLE=1 或 dev 模式开启。
 */

import { format } from 'util'
import iconv from 'iconv-lite'
import { execSync } from 'child_process'
import { type LogEntry, LEVEL_RANK } from '../types'

let codepage: string | null = null
let initDone = false

function ensureCodepage() {
  if (initDone) return codepage
  initDone = true
  if (process.platform !== 'win32' || !process.stdout.isTTY) {
    codepage = 'utf8'
    return codepage
  }
  let cp = 'cp936'
  try {
    const out = execSync('chcp', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    const m = out.match(/:\s*(\d+)/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n === 65001) cp = 'utf8'
      else if (n === 936) cp = 'cp936'
    }
  } catch {}
  codepage = cp
  return codepage
}

function writeStdout(s: string) {
  const cp = ensureCodepage() || 'utf8'
  if (cp === 'utf8') {
    process.stdout.write(s + '\n')
  } else {
    process.stdout.write(Buffer.concat([iconv.encode(s, cp), Buffer.from('\n')]))
  }
}

function writeStderr(s: string) {
  const cp = ensureCodepage() || 'utf8'
  if (cp === 'utf8') {
    process.stderr.write(s + '\n')
  } else {
    process.stderr.write(Buffer.concat([iconv.encode(s, cp), Buffer.from('\n')]))
  }
}

function formatLine(e: LogEntry): string {
  const d = new Date(e.t)
  const t = d.toISOString()
  const tag = `[${e.lvl.toUpperCase()}]`
  const head = `${t} ${tag} ${e.scope}`
  if (e.data && Object.keys(e.data).length > 0) {
    return `${head} ${e.msg} ${format('%j', e.data)}`
  }
  return `${head} ${e.msg}`
}

export class ConsoleSink {
  /** level: 最低输出级别,debug / info / warn / error */
  constructor(private level: 'debug' | 'info' | 'warn' | 'error' = 'info') {}

  setLevel(level: 'debug' | 'info' | 'warn' | 'error') {
    this.level = level
  }

  write(entry: LogEntry) {
    if (LEVEL_RANK[entry.lvl] < LEVEL_RANK[this.level]) return
    const line = formatLine(entry)
    if (entry.lvl === 'error' || entry.lvl === 'warn') writeStderr(line)
    else writeStdout(line)
  }
}
