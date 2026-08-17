/**
 * Demo 脚本 - 跑完会打印完整真实日志文件供查看
 *
 * 跑法:
 *   npx vitest run --reporter=verbose electron/logger/__demo.test.ts
 *
 * 看输出: stdout 会打印 logs 目录路径 + 文件完整内容
 * 跑完临时目录不自动清,看完自己 rm -rf
 */

import { describe, it } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { initLogger, getLogger } from './core'

describe('logger demo', () => {
  it('生成一组真实日志供查看', () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkark-log-demo-'))
    console.log('\n[LOG_DIR]:', logDir)

    initLogger({
      logDir,
      app: { ver: '0.9.4-demo', plat: process.platform, electron: '33.0.0', node: process.version },
      dev: false,
    })

    const l = getLogger()
    const a = (action: string, data: Record<string, unknown>) => l.warn(`audit.${action}`, action, data)

    // 启动期
    l.info('app.startup', 'database ready', { dbPath: path.join(logDir, 'inkark.db') })
    l.info('app.startup', 'consistency fixes applied', { count: 2, fixes: ['removed orphan chapter', 'rebuilt fts index'] })
    l.info('app.startup', 'fts index ready', { rebuilt: true })

    // 用户行为
    a('project.create', { projectId: 'p1', title: '龙族同人' })
    l.info('db.chapter.save', 'chapter auto-saved', { chapterId: 'c1', projectId: 'p1', wordCount: 3421 })

    // AI 流式(50 token,验证不刷屏 → 只 3 条 stream 日志)
    const ctx = l.streamStart('s1', { apiSource: 'custom', model: 'deepseek-v4-flash' })
    for (let i = 0; i < 50; i++) l.streamToken(ctx, 'x')
    l.streamEnd(ctx, { finishReason: 'stop' })

    // 错误路径
    l.errorObj('api.streamChat', 'stream error', new Error('connect ECONNREFUSED'), { apiSource: 'custom', model: 'gpt-4o' })
    l.warn('auth.login', 'server rejected', { serverUrl: 'https://api.example.com', email: 'someone@example.com', status: 401 })
    l.errorObj('ai.runStream', 'top-level error', new Error('user aborted'), { projectId: 'p1' })

    // 审计
    a('project.export', { projectId: 'p1', title: '龙族同人', chapters: 12, characters: 5, world: 3 })
    a('version.restore', { projectId: 'p1', commitId: 'cmt-abc' })
    a('log.export', { outFile: '/tmp/diag.tar.gz', bytes: 12345 })

    // 脱敏验证
    l.warn('audit.apiConfig.update', 'user changed API key', {
      configId: 'cfg-1',
      apiKey: 'sk-thisShouldBeRedacted1234567890abcdef',
      newModel: 'gpt-4o',
    })
    l.info('test', 'login attempt', {
      userEmail: 'someone@example.com',
      bearerToken: 'Bearer eyJhbGciOiabcdefghij1234567890',
    })

    l.flushSync()

    // 输出文件
    const files = fs.readdirSync(logDir)
    console.log('\n[FILES]:', files)
    for (const f of files) {
      const p = path.join(logDir, f)
      const stat = fs.statSync(p)
      console.log(`\n=== ${f} (${stat.size} bytes) ===`)
      console.log(fs.readFileSync(p, 'utf-8'))
    }

    console.log('\n[NOTE] 临时目录 ' + logDir + ' 跑完没清,看完自己 rm -rf 掉')
  }, 30_000)
})