/**
 * 诊断包导出 - tar.gz 格式(无第三方依赖)
 *
 * 为什么用 tar.gz 而不是 zip:Node 内置 zlib,不需要 yauzl/yazl 等依赖;
 * tar 头格式简单,80 行手写覆盖典型场景;Windows 10+/macOS 自带 tar 解压;
 * 用 PowerShell 用户也可: tar -xzf xxx.tar.gz
 *
 * 导出内容:
 *   manifest.json     - 元信息(版本/平台/启动时长/最近项目 ID,**不含敏感**)
 *   env.json          - 平台/electron/node/cpu/ram(不含 IP/hostname)
 *   db-stats.json     - 项目/章节/角色卡 计数(不导出正文)
 *   main.log          - 最近 24h 的 inkark-*.log(覆盖跨午夜)
 *   crashes.log       - crash 独立日志(若存在)
 *   session-meta.json - 启动 session 信息
 *   README.txt        - 告诉用户"已脱敏,可直接发到反馈群"
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import zlib from 'zlib'
import { type Logger } from './core'
import { redactEntry } from './redaction'

interface ExportOptions {
  /** 输出文件绝对路径(.tar.gz 结尾) */
  outFile: string
  /** app version */
  appVer: string
  /** 启动时长 ms */
  uptimeMs: number
  /** 当前激活项目 ID(可选) */
  activeProjectId: string | null
  /** 用于统计的 db hook(可选,异步函数) */
  dbStats?: () => Promise<DbStats> | DbStats
}

export interface DbStats {
  projects: number
  chapters: number
  characterCards: number
  worldCards: number
  knowledgeItems: number
  customStyles: number
  ftsEnabled: boolean
  dbBytes: number
}

const TAR_BLOCK = 512

/** tar 头:100 字节 name + 8 字节 mode + ... 详见 POSIX ustar */
function formatTarHeader(name: string, size: number, mtime: number): Buffer {
  const buf = Buffer.alloc(TAR_BLOCK)
  // name: 100 bytes, null-padded
  buf.write(name.slice(0, 99), 0, 'utf-8')
  // mode: 8 bytes octal "0000644\0"
  buf.write('0000644\0', 100, 'utf-8')
  // uid/gid: 8 bytes
  buf.write('0000000\0', 108, 'utf-8')
  buf.write('0000000\0', 116, 'utf-8')
  // size: 12 bytes octal
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 'utf-8')
  // mtime: 12 bytes octal
  buf.write(Math.floor(mtime).toString(8).padStart(11, '0') + '\0', 136, 'utf-8')
  // checksum: 8 bytes (先填 8 个空格,后面再算)
  for (let i = 148; i < 156; i++) buf[i] = 0x20
  // typeflag: '0' = regular file
  buf.write('0', 156, 'utf-8')
  // magic: 'ustar\0' for POSIX, 'ustar  \0' for GNU
  buf.write('ustar\0', 257, 'utf-8')
  buf.write('00', 263, 'utf-8')

  // 计算 checksum
  let sum = 0
  for (let i = 0; i < TAR_BLOCK; i++) sum += buf[i]
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf-8')
  return buf
}

function padToBlock(buf: Buffer): Buffer {
  const rem = buf.length % TAR_BLOCK
  if (rem === 0) return buf
  return Buffer.concat([buf, Buffer.alloc(TAR_BLOCK - rem)])
}

function buildEntry(name: string, content: string | Buffer, mtime = Date.now()): Buffer {
  const data = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
  const header = formatTarHeader(name, data.length, Math.floor(mtime / 1000))
  return Buffer.concat([header, padToBlock(data)])
}

function endOfArchive(): Buffer {
  // 连续两个 512 字节全 0 = EOF
  return Buffer.alloc(TAR_BLOCK * 2)
}

function jsonEntry(name: string, obj: unknown, mtime = Date.now()): Buffer {
  return buildEntry(name, JSON.stringify(obj, null, 2), mtime)
}

const README = `InkArk 诊断包
================

本包由 InkArk 桌面端一键导出,用于 BUG 排查。

已自动脱敏:章节正文、API key、邮箱、Token、密码 等敏感内容不会出现在本包中。
可以放心直接发送到 BUG 反馈群(群号见应用内"反馈问题"弹窗)。

包含内容:
  manifest.json      - 元信息
  env.json           - 运行环境(平台/版本/cpu/ram)
  db-stats.json      - 数据库统计(项目/章节/角色卡数量)
  main.log           - 应用运行日志
  crashes.log        - 崩溃日志(若有)
  session-meta.json  - 启动 session 信息
`

export async function exportDiagnosticBundle(logger: Logger, opts: ExportOptions): Promise<string> {
  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true })

  const manifest = {
    tool: 'inkark-diagnostic',
    schema: 1,
    exportedAt: new Date().toISOString(),
    appVersion: opts.appVer,
    session: (logger as any).cfg?.session || '',
    uptimeMs: opts.uptimeMs,
    activeProjectId: opts.activeProjectId,
  }

  const env = {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osType: os.type(),
    electron: process.versions.electron || '',
    node: process.version,
    chrome: process.versions.chrome || '',
    cpus: os.cpus()?.length || 0,
    totalMemMB: Math.round((os.totalmem() || 0) / 1024 / 1024),
    freeMemMB: Math.round((os.freemem() || 0) / 1024 / 1024),
  }

  const dbStats: DbStats = opts.dbStats ? await Promise.resolve(opts.dbStats()) : {
    projects: 0, chapters: 0, characterCards: 0, worldCards: 0,
    knowledgeItems: 0, customStyles: 0, ftsEnabled: false, dbBytes: 0,
  }

  // 取 mtime 在 24 小时内的所有 inkark-*.log(覆盖跨午夜的边缘情况)
  // 不取 7 天窗口 - 用户复现 bug 一般就是当天,7 天的内容无谓增大包体积和隐私面
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000
  const recentLogs = logger.getLogFiles()
    .map((p) => ({ p, m: fs.statSync(p).mtimeMs }))
    .filter((f) => f.m >= cutoffMs)
    .sort((a, b) => a.m - b.m) // 按时间正序,导出时最旧的在前

  // 拼接所有近期文件,按时间正序;每条 JSON 行再过一次 redact(写入时已脱敏,这里是双保险)
  const safeMainLogParts: string[] = []
  for (const { p } of recentLogs) {
    const content = fs.readFileSync(p).toString('utf-8')
    if (!content) continue
    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    const safe = lines.map((l) => {
      try {
        return JSON.stringify(redactEntry(JSON.parse(l) as any))
      } catch {
        // 理论上不会,文件是 NDJSON 格式;万一不是 JSON 行,原样保留
        return l
      }
    })
    safeMainLogParts.push(`# ${path.basename(p)}\n` + safe.join('\n') + '\n')
  }
  const safeMainLog = safeMainLogParts.join('\n')

  // crashes.log
  const crashPath = logger.getCrashFilePath()
  const crashContent = fs.existsSync(crashPath) ? fs.readFileSync(crashPath).toString('utf-8') : ''
  // crashes.log 内容走脱敏(栈里可能藏 token)
  const safeCrashLog = crashContent.length
    ? crashContent.split('\n').filter((l) => l.trim().length > 0).map((l) => {
        try {
          return JSON.stringify(redactEntry(JSON.parse(l) as any))
        } catch { return l }
      }).join('\n') + '\n'
    : ''

  // session meta(从 ring 取一些高频信息,统计用)
  const ring = logger.snapshot()
  const scopeCounts: Record<string, number> = {}
  for (const e of ring) scopeCounts[e.scope] = (scopeCounts[e.scope] || 0) + 1
  const sessionMeta = {
    ringLength: ring.length,
    scopeCounts,
    firstEntryAt: ring[0]?.t,
    lastEntryAt: ring[ring.length - 1]?.t,
  }

  // 拼 tar
  const tar = Buffer.concat([
    jsonEntry('manifest.json', manifest),
    jsonEntry('env.json', env),
    jsonEntry('db-stats.json', dbStats),
    buildEntry('main.log', safeMainLog),
    buildEntry('crashes.log', safeCrashLog),
    jsonEntry('session-meta.json', sessionMeta),
    buildEntry('README.txt', README),
    endOfArchive(),
  ])

  // gzip - 内存中压缩后写盘,避免 stream 复杂度
  const compressed = await new Promise<Buffer>((resolve, reject) => {
    zlib.gzip(tar, { level: zlib.constants.Z_BEST_SPEED }, (err, c) => {
      if (err) reject(err)
      else resolve(c)
    })
  })
  fs.writeFileSync(opts.outFile, compressed)

  return opts.outFile
}
