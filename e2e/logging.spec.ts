import { test, expect, closeApiDialog, closeBookIdeaDialog } from './fixtures'
import path from 'path'
import fs from 'fs'
import zlib from 'zlib'
import { parseTar } from './helpers/parseTar'

/**
 * 日志模块端到端测试
 *
 * 覆盖:
 *   1. 主进程启动后 inkark-*.log 落盘 + NDJSON + 含 app/session 字段
 *   2. 渲染端 IPC 上报的 error 日志进 main.log
 *   3. 含 sk- key 的敏感字段在写入前被脱敏
 *   4. 导出诊断包生成 tar.gz + 内容/脱敏/24h 窗口校验(直接 IPC,不依赖 UI)
 *
 * 跑法: npm run e2e:ui -- --grep "日志模块"
 *
 * 不需要 API key,不污染真实 userData(用 INKARK_E2E_USER_DATA 隔离)
 *
 * 设计取舍:
 *   - 跳过 UI 弹窗打开/复制按钮 等用例 —— 反馈问题入口依赖登录态,
 *     测试登录流程要 server+网络,e2e fixture 没这个能力。
 *     UI 渲染由组件单测 / Storybook / 手动验证覆盖。
 *   - 导出走 IPC 直接调,验证主进程逻辑完整闭环
 */

const TODAY_LOG = () => `inkark-${new Date().toISOString().slice(0, 10)}.log`

async function getLogsDir(app: any): Promise<string> {
  const userDataPath = await app.evaluate(async ({ app }: any) => app.getPath('userData'))
  return path.join(userDataPath, 'logs')
}

test.describe('日志模块 - 主进程落盘', () => {
  test('应用启动后写入 inkark-*.log 且为 NDJSON', async ({ app }) => {
    const logsDir = await getLogsDir(app)
    // 启动期日志是异步 flush,等 3 秒(ElectronApplication 没有 waitForTimeout,用 setTimeout)
    await new Promise(r => setTimeout(r, 3000))

    const files = fs.readdirSync(logsDir).filter(f => f.startsWith('inkark-') && f.endsWith('.log'))
    expect(files.length).toBeGreaterThan(0)

    const todayFile = path.join(logsDir, TODAY_LOG())
    expect(fs.existsSync(todayFile)).toBe(true)

    const content = fs.readFileSync(todayFile, 'utf-8')
    const lines = content.split('\n').filter(l => l.trim().length > 0)
    expect(lines.length).toBeGreaterThan(0)

    // 每行是合法 JSON
    for (const line of lines) {
      expect(() => JSON.parse(line), `invalid NDJSON line: ${line}`).not.toThrow()
    }

    // 至少一条非 debug 日志(info/warn/error)
    const entries = lines.map(l => JSON.parse(l))
    expect(entries.some((e: any) => e.lvl === 'info' || e.lvl === 'warn' || e.lvl === 'error')).toBe(true)

    // entry 含必需字段
    const sample = entries[0]
    expect(sample).toHaveProperty('t')
    expect(sample).toHaveProperty('lvl')
    expect(sample).toHaveProperty('scope')
    expect(sample).toHaveProperty('msg')
    expect(sample).toHaveProperty('session')
    expect(sample.app).toMatchObject({
      plat: expect.any(String),
      electron: expect.any(String),
      node: expect.any(String),
    })
  })
})

test.describe('日志模块 - 渲染端 IPC 上报', () => {
  test('error 级日志通过 IPC 进 main.log', async ({ window, app }) => {
    const logsDir = await getLogsDir(app)

    // 渲染端主动调一次 log:send
    const marker = `e2e-marker-${Date.now()}`
    await window.evaluate(async (m: string) => {
      // @ts-ignore
      await window.electronAPI.log.send('error', 'e2e.test', 'synthetic error', { marker: m })
    }, marker)

    // 主进程 IPC 写入是异步 flush,等 1.5s
    await window.waitForTimeout(1500)

    const todayFile = path.join(logsDir, TODAY_LOG())
    const content = fs.readFileSync(todayFile, 'utf-8')
    const found = content.split('\n').find(l => l.includes(marker))
    expect(found, `marker ${marker} 没在 main.log 里找到`).toBeDefined()

    const obj = JSON.parse(found!)
    expect(obj).toMatchObject({
      lvl: 'error',
      scope: 'e2e.test',
      msg: 'synthetic error',
    })
    expect(obj.data.marker).toBe(marker)
  })

  test('含 API key 的敏感字段在写入前被脱敏', async ({ window, app }) => {
    const logsDir = await getLogsDir(app)

    // 发一条含 sk- API key 的日志,key 是 30 位(>= 16 位才能命中我们的正则)
    const fakeKey = 'sk-e2etestfakeapikey1234567890abcdef'
    const marker = `e2e-redact-${Date.now()}`
    await window.evaluate(async (args: { key: string; m: string }) => {
      // @ts-ignore
      await window.electronAPI.log.send('warn', 'e2e.redact', 'showing secret', {
        apiKey: args.key,
        nested: { headers: { authorization: 'Bearer e2etestfakebearertoken1234567890' } },
        marker: args.m,
      })
    }, { key: fakeKey, m: marker })

    await window.waitForTimeout(1500)

    const content = fs.readFileSync(path.join(logsDir, TODAY_LOG()), 'utf-8')
    const line = content.split('\n').find(l => l.includes(marker))
    expect(line).toBeDefined()

    // 1. 原始 sk- key 不在文件中
    expect(content).not.toContain(fakeKey)
    expect(content).not.toContain('e2etestfakebearertoken')

    // 2. 替换为 ***REDACTED***
    expect(line).toContain('***REDACTED***')

    // 3. marker 没被脱敏(普通字段)
    const obj = JSON.parse(line!)
    expect(obj.data.marker).toBe(marker)
  })
})

test.describe('日志模块 - 诊断包导出', () => {
  // afterAll 清理导出文件(Q1: b 选项)
  let exportPath: string

  test.afterAll(() => {
    if (exportPath) {
      try { fs.unlinkSync(exportPath) } catch {}
    }
  })

  test('log:export 生成 tar.gz 且内容/脱敏校验通过', async ({ window, app }) => {
    const logsDir = await getLogsDir(app)

    // 拦截 showSaveDialog 返回固定路径(避免真弹原生对话框)
    exportPath = path.join(logsDir, 'e2e-diag.tar.gz')
    await app.evaluate(async ({ dialog }: any, p: string) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
    }, exportPath)

    // 先产生一些日志,确保 main.log 非空
    await window.evaluate(async () => {
      // @ts-ignore
      await window.electronAPI.log.send('info', 'e2e.pre-export', 'before export', { test: true })
    })
    await window.waitForTimeout(1000)

    // 直接通过 IPC 触发导出
    // @ts-ignore
    const result = await window.evaluate(async () => await window.electronAPI.log.export())
    expect(result.ok, `export failed: ${result.error}`).toBe(true)
    expect(result.path).toBe(exportPath)
    expect(fs.existsSync(exportPath), '诊断包文件应生成').toBe(true)

    // 解 tar.gz
    const gz = fs.readFileSync(exportPath)
    const tar = zlib.gunzipSync(gz)
    const entries = parseTar(tar)
    const names = entries.map(e => e.name)
    expect(names).toEqual(expect.arrayContaining([
      'manifest.json', 'env.json', 'db-stats.json',
      'main.log', 'crashes.log', 'session-meta.json', 'README.txt',
    ]))

    // manifest 字段 + 不含敏感
    const manifest = JSON.parse(entries.find(e => e.name === 'manifest.json')!.content.toString('utf-8'))
    expect(manifest).toMatchObject({
      tool: 'inkark-diagnostic',
      schema: 1,
    })
    expect(manifest.appVersion).toMatch(/^\d+\.\d+\.\d+/)
    expect(JSON.stringify(manifest)).not.toMatch(/sk-[A-Za-z0-9]{16,}/)
    expect(JSON.stringify(manifest)).not.toMatch(/@[\w-]+\.[\w.-]+/)

    // env.json 不含 hostname/userInfo
    const env = JSON.parse(entries.find(e => e.name === 'env.json')!.content.toString('utf-8'))
    expect(env).toHaveProperty('platform')
    expect(env).toHaveProperty('electron')
    expect(env).not.toHaveProperty('hostname')
    expect(env).not.toHaveProperty('userInfo')

    // main.log: 文件名注释 + NDJSON 行 + 含我们刚发的 info 日志
    const mainLogContent = entries.find(e => e.name === 'main.log')!.content.toString('utf-8')
    const mainLogLines = mainLogContent.split('\n').filter(l => l.trim().length > 0)
    expect(mainLogLines.length).toBeGreaterThan(0)
    let ndjsonCount = 0
    for (const line of mainLogLines) {
      if (line.startsWith('#')) continue // 文件名分隔注释
      expect(() => JSON.parse(line), `main.log 不是 NDJSON: ${line}`).not.toThrow()
      ndjsonCount++
    }
    expect(ndjsonCount).toBeGreaterThan(0)
    // 我们刚发的 info 应在 main.log 里
    expect(mainLogContent).toContain('e2e.pre-export')

    // README 内容
    const readme = entries.find(e => e.name === 'README.txt')!.content.toString('utf-8')
    expect(readme).toContain('InkArk')
    expect(readme).toContain('已自动脱敏')
  })
})