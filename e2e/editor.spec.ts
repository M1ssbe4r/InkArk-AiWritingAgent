import { test, expect, closeApiDialog, closeBookIdeaDialog } from './fixtures'

test.describe('编辑器', () => {
  test.beforeEach(async ({ window }) => {
    await closeApiDialog(window)
    await closeBookIdeaDialog(window)
  })

  test('编辑器区域可见', async ({ window }) => {
    const proseMirror = window.locator('.ProseMirror')
    await expect(proseMirror).toBeVisible()
  })

  test('在编辑器中输入文本', async ({ window }) => {
    await window.evaluate(() => {
      const editor = document.querySelector('.ProseMirror') as HTMLElement
      if (editor) {
        editor.focus()
        document.execCommand('insertText', false, '你好世界')
      }
    })
    await window.waitForTimeout(500)
    const editorContent = await window.locator('.ProseMirror').textContent()
    expect(editorContent).toContain('你好世界')
  })

  test('章节标题输入框', async ({ window }) => {
    const titleInput = window.locator('input[placeholder="章节标题..."]')
    await expect(titleInput).toBeVisible()
    await titleInput.fill('序章：初入江湖')
    await window.waitForTimeout(300)
    const value = await titleInput.inputValue()
    expect(value).toBe('序章：初入江湖')
  })

  test('章节大纲文本域', async ({ window }) => {
    const summaryTextarea = window.locator('textarea[placeholder="章节大纲（可选，AI 生成或自行编写）"]')
    await expect(summaryTextarea).toBeVisible()
    await summaryTextarea.fill('主角出场，初露锋芒')
    await window.waitForTimeout(300)
    const value = await summaryTextarea.inputValue()
    expect(value).toBe('主角出场，初露锋芒')
  })

  test('工具栏按钮存在', async ({ window }) => {
    const boldBtn = window.locator('button[title="加粗"]')
    await expect(boldBtn).toBeVisible()
    const italicBtn = window.locator('button[title="斜体"]')
    await expect(italicBtn).toBeVisible()
    const undoBtn = window.locator('button[title="撤销"]')
    await expect(undoBtn).toBeVisible()
    const redoBtn = window.locator('button[title="重做"]')
    await expect(redoBtn).toBeVisible()
    const exportBtn = window.locator('button[title="导出"]')
    await expect(exportBtn).toBeVisible()
  })
})
