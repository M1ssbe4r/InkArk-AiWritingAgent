import { test, expect, closeApiDialog, closeBookIdeaDialog, reactClick } from './fixtures'

test.describe('章节管理', () => {
  test.beforeEach(async ({ window }) => {
    await closeApiDialog(window)
    await closeBookIdeaDialog(window)
  })

  test('新建章节', async ({ window }) => {
    const addBtn = window.locator('.border-r button:has(svg.lucide-plus)')
    await expect(addBtn).toBeVisible()
    await reactClick(window, '.border-r button:has(svg.lucide-plus)')
    await window.waitForTimeout(500)
    const chapters = window.locator('.border-r .p-2 > div')
    const count = await chapters.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('切换章节', async ({ window }) => {
    await reactClick(window, '.border-r button:has(svg.lucide-plus)')
    await window.waitForTimeout(500)
    const secondChapter = window.locator('.border-r .p-2 > div').nth(1)
    await secondChapter.click()
    await window.waitForTimeout(300)
    const activeItem = window.locator('.border-r .p-2 .bg-sidebar-accent')
    await expect(activeItem).toBeVisible()
  })

  test('删除章节', async ({ window }) => {
    await reactClick(window, '.border-r button:has(svg.lucide-plus)')
    await window.waitForTimeout(500)
    const chaptersBefore = await window.locator('.border-r .p-2 > div').count()
    const secondChapter = window.locator('.border-r .p-2 > div').nth(1)
    await secondChapter.click({ button: 'right' })
    await window.waitForTimeout(300)
    const deleteBtn = window.locator('.fixed.z-50 button:has-text("删除")')
    await expect(deleteBtn).toBeVisible()
    await deleteBtn.click()
    await window.waitForTimeout(500)
    const chaptersAfter = await window.locator('.border-r .p-2 > div').count()
    expect(chaptersAfter).toBeLessThan(chaptersBefore)
  })

  test('修改章节标题', async ({ window }) => {
    const titleInput = window.locator('input[placeholder="章节标题..."]')
    await expect(titleInput).toBeVisible()
    await titleInput.clear()
    await titleInput.fill('序章')
    await titleInput.blur()
    await window.waitForTimeout(500)
    const renamedChapter = window.locator('.border-r').getByText('序章')
    await expect(renamedChapter).toBeVisible()
  })

  test('状态栏显示字数统计', async ({ window }) => {
    const wordCount = window.getByText(/\d+ 字/)
    await expect(wordCount).toBeVisible()
  })
})
