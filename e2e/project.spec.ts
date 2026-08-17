import { test, expect, closeApiDialog, closeBookIdeaDialog, reactClick } from './fixtures'

test.describe('项目管理', () => {
  test.beforeEach(async ({ window }) => {
    await closeApiDialog(window)
    await closeBookIdeaDialog(window)
  })

  test('标题栏显示当前项目名称', async ({ window }) => {
    const projectBtn = window.locator('button:has-text("未命名作品")')
    await expect(projectBtn).toBeVisible()
  })

  test('通过标题栏菜单新建作品', async ({ window }) => {
    await window.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('未命名作品'))
      if (btn) (btn as HTMLElement).click()
    })
    await window.waitForTimeout(300)
    const createBtn = window.locator('button:has-text("新建作品")')
    await expect(createBtn).toBeVisible()
    await window.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('新建作品'))
      if (btn) (btn as HTMLElement).click()
    })
    await window.waitForTimeout(500)
    const bookIdeaDialog = window.locator('[role="dialog"][data-state="open"]')
    if ((await bookIdeaDialog.count()) > 0) {
      await closeBookIdeaDialog(window)
    }
    const newProjectBtn = window.locator('button:has-text("新作品")')
    await expect(newProjectBtn).toBeVisible()
  })

  test('通过标题栏菜单重命名项目', async ({ window }) => {
    await window.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('未命名作品'))
      if (btn) (btn as HTMLElement).click()
    })
    await window.waitForTimeout(300)
    const renameBtn = window.locator('button:has-text("重命名")')
    await expect(renameBtn).toBeVisible()
    await window.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('重命名'))
      if (btn) (btn as HTMLElement).click()
    })
    await window.waitForTimeout(300)
    const renameInput = window.locator('.flex.h-10 input')
    await expect(renameInput).toBeVisible()
    await renameInput.fill('我的小说')
    await window.keyboard.press('Enter')
    await window.waitForTimeout(500)
    const renamedBtn = window.locator('button:has-text("我的小说")')
    await expect(renamedBtn).toBeVisible()
  })

  test('在下拉列表中切换项目', async ({ window }) => {
    await window.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('未命名作品'))
      if (btn) (btn as HTMLElement).click()
    })
    await window.waitForTimeout(300)
    await window.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('新建作品'))
      if (btn) (btn as HTMLElement).click()
    })
    await window.waitForTimeout(500)
    const bookIdeaDialog = window.locator('[role="dialog"][data-state="open"]')
    if ((await bookIdeaDialog.count()) > 0) {
      await closeBookIdeaDialog(window)
    }
    await window.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('新作品'))
      if (btn) (btn as HTMLElement).click()
    })
    await window.waitForTimeout(300)
    await window.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.absolute button'))
      const oldProject = btns.find(b => b.textContent?.includes('未命名作品'))
      if (oldProject) (oldProject as HTMLElement).click()
    })
    await window.waitForTimeout(500)
    const switchedBtn = window.locator('button:has-text("未命名作品")')
    await expect(switchedBtn).toBeVisible()
  })

  test('状态栏显示版本号', async ({ window }) => {
    const versionText = window.getByText(/InkArk v\d+\.\d+/)
    await expect(versionText).toBeVisible()
  })
})
