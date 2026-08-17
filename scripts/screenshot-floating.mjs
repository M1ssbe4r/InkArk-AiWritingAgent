// Screenshot script for the floating UI version
// Usage: node scripts/screenshot-floating.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const URL = process.env.URL || 'http://127.0.0.1:5177'
const OUT_DIR = resolve(process.cwd(), '设计稿截图')
mkdirSync(OUT_DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Mock electronAPI for browser dev mode
const MOCK_ELECTRON = `
  (() => {
    if (window.__INKARK_MOCK__) return
    window.__INKARK_MOCK__ = true
    const noop = () => {}
    const noopAsync = () => Promise.resolve()
    const seedProjects = [{ id: 'demo', title: '雾港夜话', outline: '<p>主线：民国上海，三个身份各异的陌生人在一艘从香港开来的夜航货轮上相遇。</p><p>副线：留白，等待用户补充。</p>' }]
    const seedChapters = [1,2,3,4,5,6].map((i) => ({
      id: 'ch-' + i,
      project_id: 'demo',
      title: i === 1 ? '第一章·陌生的来客' : i === 2 ? '第二章·雨夜对话' : i === 3 ? '第三章·真相一角' : i === 4 ? '第四章·未解的谜' : i === 5 ? '第五章·新的线索' : '第六章·告别',
      content: i === 1 ? '<p>黄浦江的夜风带着盐味，一艘老旧的货轮缓缓靠岸。</p><p>——这是 <strong>版本 A 悬浮 UI</strong> 的演示。左边是章节树，中间是纸张般的编辑区，右边是玻璃质感的 AI 面板。</p>' : '',
      chapter_outline: i === 1 ? '主角登场，设定氛围，埋下伏笔。' : '',
      sort_order: i - 1,
      status: 'draft',
      word_count: 0,
    }))
    const emptyList = () => Promise.resolve([])
    window.electronAPI = {
      setFullscreen: noop,
      project: {
        list: () => Promise.resolve(seedProjects),
        getStyle: () => Promise.resolve({ guidance: '', customStyleId: null }),
        create: (p) => Promise.resolve(p),
        update: (p) => Promise.resolve(p),
        delete: noopAsync,
        import: () => Promise.resolve({ success: true, projectId: 'demo' }),
      },
      chapter: {
        list: () => Promise.resolve(seedChapters),
        save: (c) => Promise.resolve(c),
        updateMeta: (m) => Promise.resolve(m),
        delete: noopAsync,
      },
      apiConfig: {
        list: () => Promise.resolve([{ id: 'cfg-1', name: 'OpenAI', model: 'gpt-4o-mini' }]),
        getDefault: () => Promise.resolve({ id: 'cfg-1', name: 'OpenAI', base_url: 'https://api.openai.com/v1', api_key: '', model: 'gpt-4o-mini', provider: 'openai_compatible' }),
        create: (c) => Promise.resolve(c),
      },
      preset: { create: (p) => Promise.resolve(p), getByConfig: () => Promise.resolve(null) },
      version: { setActiveProject: noop, commit: () => Promise.resolve() },
      style: { migrateFromLocalStorage: noopAsync },
      sensitive: { list: emptyList },
      taskBinding: { getByTask: () => Promise.resolve(null) },
      file: { open: () => Promise.resolve({ success: false }) },
      dialog: { confirm: () => Promise.resolve(true) },
      api: { streamChat: () => Promise.resolve({ streamId: null }), abortStream: noop },
      minimize: noop, maximize: noop, close: noop,
      world: { list: emptyList },
      character: { list: emptyList },
    }
  })()
`

const main = async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  })
  // Inject mock electronAPI before any page script
  await context.addInitScript(MOCK_ELECTRON)
  const page = await context.newPage()

  page.on('pageerror', (err) => console.error('[page error]', err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console error]', msg.text())
  })

  console.log('1. Navigate to', URL)
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  // Mark onboarding as done so welcome dialog doesn't open
  await page.evaluate(() => localStorage.setItem('inkark-onboarding-done', '1'))
  await sleep(1500)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(2500)

  // Dismiss any leftover dialogs (e.g. ApiSettings)
  const dismissDialogs = async () => {
    const closeButtons = [
      'button:has-text("关闭")',
      'button:has-text("取消")',
      'button:has-text("稍后")',
      'button:has-text("知道了")',
      'button[aria-label="Close"]',
      '[data-radix-dialog-close]',
    ]
    for (const sel of closeButtons) {
      const btn = page.locator(sel).first()
      if (await btn.isVisible({ timeout: 200 }).catch(() => false)) {
        await btn.click({ timeout: 500 }).catch(() => null)
        await sleep(200)
      }
    }
  }
  await dismissDialogs()
  await sleep(300)

  // Take screenshot of main page
  await page.screenshot({
    path: resolve(OUT_DIR, '01-主页.png'),
    fullPage: false,
  })
  console.log('  saved 01-主页.png')

  // Open command palette via Ctrl+K
  console.log('2. Trigger Ctrl+K command palette')
  await page.keyboard.press('Control+k')
  await sleep(700)
  await page.screenshot({
    path: resolve(OUT_DIR, '03-命令面板.png'),
    fullPage: false,
  })
  console.log('  saved 03-命令面板.png')

  // Type a query to demo filtering
  await page.keyboard.type('写作', { delay: 30 })
  await sleep(400)
  await page.screenshot({
    path: resolve(OUT_DIR, '03b-命令面板-筛选.png'),
    fullPage: false,
  })
  console.log('  saved 03b-命令面板-筛选.png')

  // Press Escape to close
  await page.keyboard.press('Escape')
  await sleep(400)
  // Force-close any overlay by clicking on the canvas (safe area)
  await page.mouse.click(960, 540)
  await sleep(400)

  // Open settings via command palette
  console.log('3. Open settings via command palette (> 设置)')
  await page.keyboard.press('Control+k')
  await sleep(500)
  await page.keyboard.type('设置', { delay: 30 })
  await sleep(400)
  await page.keyboard.press('Enter')
  await sleep(900)
  await page.screenshot({
    path: resolve(OUT_DIR, '04-设置.png'),
    fullPage: false,
  })
  console.log('  saved 04-设置.png')
  await page.keyboard.press('Escape')
  await sleep(300)

  // Type in editor
  console.log('4. Type in editor')
  const editor = page.locator('.ProseMirror').first()
  if (await editor.isVisible().catch(() => false)) {
    await editor.click()
    await page.keyboard.type('——Version A floating UI smoke test, ')
    await sleep(500)
    await page.screenshot({
      path: resolve(OUT_DIR, '05-编辑器输入.png'),
      fullPage: false,
    })
    console.log('  saved 05-编辑器输入.png')
  } else {
    console.log('  editor not visible, skipping')
  }

  // AI panel close-up
  console.log('5. AI panel close-up')
  await page.screenshot({
    path: resolve(OUT_DIR, '02-AI面板.png'),
    fullPage: false,
  })
  console.log('  saved 02-AI面板.png')

  await browser.close()
  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
