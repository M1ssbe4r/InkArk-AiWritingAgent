import { test, expect, closeApiDialog, closeBookIdeaDialog, closeWelcomeDialog } from './fixtures'

test.describe('应用启动', () => {
  test('应用启动后显示标题栏', async ({ window }) => {
    await closeApiDialog(window)
    await closeBookIdeaDialog(window)
    await closeWelcomeDialog(window)
    const titleBar = window.locator('.floating-glass-topbar')
    await expect(titleBar).toBeVisible()
  })

  test('首次启动自动创建默认项目', async ({ window }) => {
    const projectBtn = window.locator('button:has-text("未命名作品")')
    await expect(projectBtn).toBeVisible()
  })

  test('首次启动弹出 API 设置对话框', async ({ window }) => {
    const dialog = window.locator('[role="dialog"][data-state="open"]')
    await expect(dialog).toBeVisible()
    const dialogTitle = dialog.getByRole('heading', { name: '设置' })
    await expect(dialogTitle).toBeVisible()
  })

  test('首次启动显示侧边栏章节列表', async ({ window }) => {
    await closeApiDialog(window)
    await closeBookIdeaDialog(window)
    const chapterItem = window.locator('.border-r').getByText('第一章')
    await expect(chapterItem).toBeVisible()
  })
})
