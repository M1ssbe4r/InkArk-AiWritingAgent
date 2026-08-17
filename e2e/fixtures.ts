import { test as base, expect, _electron as electron } from '@playwright/test'
import path from 'path'
import fs from 'fs'

type ElectronFixtures = {
  app: electron.ElectronApplication
  window: electron.Page
}

export const test = base.extend<ElectronFixtures>({
  app: async ({}, use) => {
    const userDataDir = path.join(__dirname, '.e2e-data', `test-${Date.now()}`)
    const env = { ...process.env, INKARK_E2E_USER_DATA: userDataDir }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ATOM_SHELL_INTERNAL_RUN_AS_NODE
    const app = await electron.launch({
      args: ['.'],
      env,
    })
    await use(app)
    await app.close()
    try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch {}
  },
  window: async ({ app }, use) => {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)
    await use(page)
  },
})

export { expect }

export async function closeApiDialog(window: electron.Page) {
  await window.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    document.activeElement.dispatchEvent(event)
    document.dispatchEvent(event)
  })
  await window.waitForTimeout(500)
  for (let i = 0; i < 4; i++) {
    const dialogCount = await window.locator('[role="dialog"][data-state="open"]').count()
    if (dialogCount === 0) break
    await window.keyboard.press('Escape')
    await window.waitForTimeout(400)
  }
}

export async function closeBookIdeaDialog(window: electron.Page) {
  const skipBtn = window.getByText('跳过')
  if ((await skipBtn.count()) > 0) {
    await skipBtn.click()
    await window.waitForTimeout(500)
  }
}

export async function closeWelcomeDialog(window: electron.Page) {
  const welcomeTitle = window.getByRole('heading', { name: '欢迎使用 InkArk' })
  if ((await welcomeTitle.count()) === 0) return

  const startBtn = window.getByRole('button', { name: /开始使用/ })
  if ((await startBtn.count()) > 0) {
    await startBtn.click()
    await window.waitForTimeout(400)
  }

  const skipBtn = window.getByRole('button', { name: '跳过', exact: true })
  if ((await skipBtn.count()) > 0) {
    await skipBtn.click()
    await window.waitForTimeout(400)
    return
  }

  const skipDirectBtn = window.getByRole('button', { name: '跳过，直接进入' })
  if ((await skipDirectBtn.count()) > 0) {
    await skipDirectBtn.click()
    await window.waitForTimeout(400)
  }
}

export async function reactClick(window: electron.Page, selector: string) {
  await window.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement
    if (el) el.click()
  }, selector)
  await window.waitForTimeout(300)
}

export async function dismissStartupDialogs(window: electron.Page) {
  await closeWelcomeDialog(window)
  await closeApiDialog(window)
  await closeBookIdeaDialog(window)
}
