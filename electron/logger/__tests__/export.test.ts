import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import zlib from 'zlib'

/**
 * 验证 tar.gz 导出的关键属性:
 *   - 解压后能看到 manifest.json / env.json / db-stats.json / main.log / README.txt
 *   - manifest 不包含任何敏感字段
 *   - main.log 即使 raw 写了敏感数据,导出时也会二次脱敏
 *
 * 不依赖 initLogger: 直接构造一个最简单的 Logger 接口对象传入 exportDiagnosticBundle。
 * Logger 接口由 core.ts 定义,这里用 duck-typing 写一个最小实现。
 */

import { exportDiagnosticBundle } from '../export'
import type { Logger } from '../core'

function makeStubLogger(opts: { logDir: string; ring: any[]; crash?: string }): Logger {
  const cfg = {
    session: 'test-session-abc',
    app: { ver: '0.9.3-test', plat: process.platform, electron: '33.0.0', node: process.version },
  }
  const stub = {
    log() {}, debug() {}, info() {}, warn() {}, error() {}, errorObj() {},
    streamStart() { return { tokens: 0, firstLogged: false, done: false } },
    streamToken() {},
    streamEnd() {},
    streamError() {},
    flushSync() {},
    flush: async () => {},
    tail() { return opts.ring },
    getLogDir() { return opts.logDir },
    snapshot() { return opts.ring },
    getLogFiles() {
      try {
        return fs.readdirSync(opts.logDir)
          .filter((f) => f.startsWith('inkark-') && f.endsWith('.log'))
          .map((f) => path.join(opts.logDir, f))
      } catch { return [] }
    },
    getCrashFilePath() { return path.join(opts.logDir, 'crashes.log') },
    writeCrash() {},
    // export.ts 通过 (logger as any).cfg?.session 取 session,把 cfg 挂在实例上即可
    cfg,
  }
  return stub as unknown as Logger
}

describe('export - tar.gz 解析', () => {
  let tmpDir: string
  let outFile: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkark-export-test-'))
    outFile = path.join(tmpDir, 'out.tar.gz')
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it('生成的 tar.gz 可被 gunzipSync + tar 解析,包含必需文件', async () => {
    const logger = makeStubLogger({ logDir: tmpDir, ring: [] })
    await exportDiagnosticBundle(logger, {
      outFile,
      appVer: '0.9.4',
      uptimeMs: 1234,
      activeProjectId: 'proj-1',
    })
    expect(fs.existsSync(outFile)).toBe(true)
    // 解析: gzip → tar → 多个 512 字节块
    const gz = fs.readFileSync(outFile)
    const tar = zlib.gunzipSync(gz)
    expect(tar.length).toBeGreaterThan(0)
    const files = parseTar(tar)
    const names = files.map((f) => f.name)
    expect(names).toContain('manifest.json')
    expect(names).toContain('env.json')
    expect(names).toContain('db-stats.json')
    expect(names).toContain('main.log')
    expect(names).toContain('crashes.log')
    expect(names).toContain('session-meta.json')
    expect(names).toContain('README.txt')

    // 校验 manifest 内容
    const manifest = JSON.parse(files.find((f) => f.name === 'manifest.json')!.content.toString('utf-8'))
    expect(manifest).toMatchObject({
      tool: 'inkark-diagnostic',
      schema: 1,
      appVersion: '0.9.4',
      session: 'test-session-abc',
      activeProjectId: 'proj-1',
    })
  })

  it('manifest 不含敏感字段(IP/hostname/apiKey/email 等)', async () => {
    const logger = makeStubLogger({ logDir: tmpDir, ring: [] })
    await exportDiagnosticBundle(logger, {
      outFile,
      appVer: '0.9.4',
      uptimeMs: 100,
      activeProjectId: 'p1',
    })
    const tar = zlib.gunzipSync(fs.readFileSync(outFile))
    const allContent = parseTar(tar).map((f) => f.content.toString('utf-8')).join('\n')
    expect(allContent).not.toMatch(/api[_-]?key/i)
    expect(allContent).not.toMatch(/password/i)
    expect(allContent).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/) // email
    expect(allContent).not.toMatch(/sk-[A-Za-z0-9]{16,}/) // sk- key
  })

  it('main.log 在导出前再过一次脱敏', async () => {
    // 准备 main.log,里面写了看似没脱敏的数据(模拟万一 raw path 漏了)
    const mainLogName = `inkark-${new Date().toISOString().slice(0, 10)}.log`
    const mainLogPath = path.join(tmpDir, mainLogName)
    fs.writeFileSync(
      mainLogPath,
      // 故意写一个含 sk- 的"未脱敏"JSON
      JSON.stringify({
        t: Date.now(),
        lvl: 'info',
        scope: 'test',
        msg: 'x',
        data: { apiKey: 'sk-zzzzzzzzzzzzzzzzzzzzzzzzzzzz' },
      }) + '\n',
      'utf-8',
    )
    const logger = makeStubLogger({ logDir: tmpDir, ring: [] })
    await exportDiagnosticBundle(logger, {
      outFile,
      appVer: '0.9.4',
      uptimeMs: 100,
      activeProjectId: null,
    })
    const tar = zlib.gunzipSync(fs.readFileSync(outFile))
    const mainLog = parseTar(tar).find((f) => f.name === 'main.log')!.content.toString('utf-8')
    expect(mainLog).not.toContain('sk-zzzzzzzzzz')
    expect(mainLog).toContain('***REDACTED***')
  })

  it('env.json 不含 hostname', async () => {
    const logger = makeStubLogger({ logDir: tmpDir, ring: [] })
    await exportDiagnosticBundle(logger, {
      outFile,
      appVer: '0.9.4',
      uptimeMs: 100,
      activeProjectId: null,
    })
    const tar = zlib.gunzipSync(fs.readFileSync(outFile))
    const env = JSON.parse(parseTar(tar).find((f) => f.name === 'env.json')!.content.toString('utf-8'))
    expect(env).toHaveProperty('platform')
    expect(env).toHaveProperty('electron')
    expect(env).toHaveProperty('node')
    expect(env).not.toHaveProperty('hostname')
    expect(env).not.toHaveProperty('userInfo')
  })
})

/**
 * 最小 tar 解析器 - 只支持普通文件(我们生成的就是),格式:
 *   每条 entry: 512 字节头 + 内容(padded 到 512 边界)
 *   结束: 连续两个 512 字节全 0
 */
function parseTar(buf: Buffer): Array<{ name: string; size: number; content: Buffer }> {
  const out: Array<{ name: string; size: number; content: Buffer }> = []
  const BLOCK = 512
  let i = 0
  while (i < buf.length) {
    if (i + BLOCK > buf.length) break
    const header = buf.subarray(i, i + BLOCK)
    // 全 0 视为结束
    if (header.every((b) => b === 0)) break
    const name = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/, '')
    const sizeOct = header.subarray(124, 136).toString('utf-8').replace(/\0.*$/, '').trim()
    const size = parseInt(sizeOct, 8)
    if (Number.isNaN(size) || size < 0) break
    i += BLOCK
    const content = buf.subarray(i, i + size)
    out.push({ name, size, content: Buffer.from(content) })
    // 内容 padded 到 BLOCK 边界
    i += Math.ceil(size / BLOCK) * BLOCK
  }
  return out
}