import { test, expect, closeApiDialog, closeBookIdeaDialog, reactClick } from './fixtures'

test.describe('侧边栏导航', () => {
  test.beforeEach(async ({ window }) => {
    await closeApiDialog(window)
    await closeBookIdeaDialog(window)
  })

  test('默认显示大纲视图', async ({ window }) => {
    const chapterItem = window.locator('.border-r').getByText('第一章')
    await expect(chapterItem).toBeVisible()
  })

  test('切换到角色面板', async ({ window }) => {
    await reactClick(window, '.border-r button[title="角色"]')
    await window.waitForTimeout(300)
    const searchInput = window.locator('input[placeholder="搜索角色..."]')
    await expect(searchInput).toBeVisible()
  })

  test('切换到世界观面板', async ({ window }) => {
    await reactClick(window, '.border-r button[title="世界观"]')
    await window.waitForTimeout(300)
    const searchInput = window.locator('input[placeholder="搜索设定..."]')
    await expect(searchInput).toBeVisible()
  })

  test('切换回大纲视图', async ({ window }) => {
    await reactClick(window, '.border-r button[title="角色"]')
    await window.waitForTimeout(300)
    await reactClick(window, '.border-r button[title="目录"]')
    await window.waitForTimeout(300)
    const chapterItem = window.locator('.border-r').getByText('第一章')
    await expect(chapterItem).toBeVisible()
  })

  test('全书大纲按钮存在', async ({ window }) => {
    const outlineBtn = window.locator('.border-r button[title="全书大纲"]')
    await expect(outlineBtn).toBeVisible()
  })

  test('写作风格按钮存在', async ({ window }) => {
    const styleBtn = window.locator('.border-r button[title="写作风格"]')
    await expect(styleBtn).toBeVisible()
  })
})
