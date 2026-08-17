import { test, expect, closeApiDialog, closeBookIdeaDialog, reactClick } from './fixtures'

test.describe('设置对话框', () => {
  test.beforeEach(async ({ window }) => {
    await closeApiDialog(window)
    await closeBookIdeaDialog(window)
  })

  test('打开设置对话框', async ({ window }) => {
    await reactClick(window, 'button[title="设置"]')
    await window.waitForTimeout(500)
    const dialog = window.locator('[role="dialog"][data-state="open"]')
    await expect(dialog).toBeVisible()
  })

  test('设置对话框标题', async ({ window }) => {
    await reactClick(window, 'button[title="设置"]')
    await window.waitForTimeout(500)
    const dialog = window.locator('[role="dialog"][data-state="open"]')
    const dialogTitle = dialog.getByRole('heading', { name: '设置' })
    await expect(dialogTitle).toBeVisible()
  })

  test('API 配置标签页默认', async ({ window }) => {
    await reactClick(window, 'button[title="设置"]')
    await window.waitForTimeout(500)
    const apiTab = window.locator('[role="tab"][data-state="active"]:has-text("API 配置")')
    await expect(apiTab).toBeVisible()
  })

  test('切换到字体设置标签页', async ({ window }) => {
    await reactClick(window, 'button[title="设置"]')
    await window.waitForTimeout(500)
    const fontTab = window.locator('[role="tab"]:has-text("字体设置")')
    await fontTab.click()
    await window.waitForTimeout(300)
    const activeFontTab = window.locator('[role="tab"][data-state="active"]:has-text("字体设置")')
    await expect(activeFontTab).toBeVisible()
  })

  test('关闭设置对话框', async ({ window }) => {
    await reactClick(window, 'button[title="设置"]')
    await window.waitForTimeout(500)
    const dialog = window.locator('[role="dialog"][data-state="open"]')
    await expect(dialog).toBeVisible()
    await window.keyboard.press('Escape')
    await window.waitForTimeout(500)
    const closedDialog = window.locator('[role="dialog"][data-state="open"]')
    await expect(closedDialog).not.toBeVisible()
  })

  test('添加 API 按钮存在', async ({ window }) => {
    await reactClick(window, 'button[title="设置"]')
    await window.waitForTimeout(500)
    const addApiBtn = window.locator('button:has-text("添加 API")')
    await expect(addApiBtn).toBeVisible()
  })
})
