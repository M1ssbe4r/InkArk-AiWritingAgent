import { test, expect, dismissStartupDialogs } from './fixtures'
import {
  getFirstProjectId,
  seedChapterContent,
  executeToolOnRenderer,
  readViaRenderer,
} from './ai-helpers'

const SAMPLE_HTML = [
  '<p>张三走进房间，看到桌上放着一封信。</p>',
  '<p>窗外下着雨，街灯在积水中摇晃。</p>',
  '<p>他深吸一口气，拆开了信封。</p>',
].join('')

async function typeMultiParagraphSample(window: import('@playwright/test').Page) {
  await dismissStartupDialogs(window)
  const editor = window.locator('.ProseMirror.inkark-chapter-editor')
  await editor.click()
  await window.keyboard.press('ControlOrMeta+A')
  await window.keyboard.press('Backspace')
  await window.waitForTimeout(200)
  await window.keyboard.type('第一段内容用于测试')
  await window.keyboard.press('Enter')
  await window.keyboard.type('第二段内容用于测试')
  await window.keyboard.press('Enter')
  await window.keyboard.type('第三段内容用于测试')
  await window.waitForTimeout(500)
}

test.describe('章节段落编辑', () => {
  test.beforeEach(async ({ window }) => {
    await dismissStartupDialogs(window)
  })

  test('编辑器显示段落序号 gutter', async ({ window }) => {
    await typeMultiParagraphSample(window)

    const gutters = window.locator('.ProseMirror.inkark-chapter-editor .para-gutter-num')
    await expect(gutters).toHaveCount(3)
    await expect(gutters.nth(0)).toHaveText('1')
    await expect(gutters.nth(1)).toHaveText('2')
    await expect(gutters.nth(2)).toHaveText('3')
  })

  test('选中文本后右键显示段落级 AI 菜单', async ({ window }) => {
    await typeMultiParagraphSample(window)

    const firstParagraph = window.locator('.ProseMirror.inkark-chapter-editor p').first()
    await firstParagraph.click({ clickCount: 3 })
    await window.waitForTimeout(200)
    await firstParagraph.click({ button: 'right' })
    await window.waitForTimeout(300)

    await expect(window.getByText('润色')).toBeVisible()
    await expect(window.getByText('缩写')).toBeVisible()
    await expect(window.getByText('扩写')).toBeVisible()
    await expect(window.getByText('自定义指令')).toBeVisible()
  })

  test('write_chapter_content 段落 edits 改写指定段', async ({ window }) => {
    const projectId = await getFirstProjectId(window)
    await seedChapterContent(window, projectId, 1, SAMPLE_HTML)

    const result = await executeToolOnRenderer(window, 'write_chapter_content', {
      chapter_index: 1,
      edits: [{ paragraph_index: 2, text: '改写后的第二段内容。' }],
    }, projectId)
    expect(result.result).toBe('内容已写入')

    const content = await readViaRenderer(window, 'read', { type: 'chapter_content', chapter_index: 1 }, projectId)
    expect(content).toContain('改写后的第二段内容')
    expect(content).toContain('张三走进房间')
    expect(content).not.toContain('窗外下着雨')
  })

  test('write_chapter_content 段落 inserts 在段后插入', async ({ window }) => {
    const projectId = await getFirstProjectId(window)
    await seedChapterContent(window, projectId, 1, SAMPLE_HTML)

    const result = await executeToolOnRenderer(window, 'write_chapter_content', {
      chapter_index: 1,
      inserts: [{ after_paragraph_index: 1, text: '过渡段：他停下了脚步。' }],
    }, projectId)
    expect(result.result).toBe('内容已写入')

    const content = await readViaRenderer(window, 'read', { type: 'chapter_content', chapter_index: 1 }, projectId)
    expect(content).toContain('过渡段：他停下了脚步')
    expect(content).toContain('张三走进房间')
    expect(content).toContain('窗外下着雨')
  })

  test('write_chapter_content 空 text 删除段落', async ({ window }) => {
    const projectId = await getFirstProjectId(window)
    await seedChapterContent(window, projectId, 1, SAMPLE_HTML)

    const result = await executeToolOnRenderer(window, 'write_chapter_content', {
      chapter_index: 1,
      edits: [{ paragraph_index: 2, text: '' }],
    }, projectId)
    expect(result.result).toBe('内容已写入')

    const content = await readViaRenderer(window, 'read', { type: 'chapter_content', chapter_index: 1 }, projectId)
    expect(content).not.toContain('窗外下着雨')
    expect(content).toContain('张三走进房间')
    expect(content).toContain('他深吸一口气')
  })

  test('write_chapter_content 非空章节禁止 content 整章覆盖', async ({ window }) => {
    const projectId = await getFirstProjectId(window)
    await seedChapterContent(window, projectId, 1, SAMPLE_HTML)

    const result = await executeToolOnRenderer(window, 'write_chapter_content', {
      chapter_index: 1,
      content: '整章替换后的唯一段落。',
    }, projectId)
    expect(result.result).toContain('edits/inserts')
  })

  test('write_chapter_content 空章节首次写作使用 content', async ({ window }) => {
    const projectId = await getFirstProjectId(window)
    const chapters = await window.evaluate((pid) => window.electronAPI.chapter.list(pid), projectId)
    const ch = chapters[0]
    await window.evaluate(async ({ chapter }) => {
      await window.electronAPI.chapter.save({
        ...chapter,
        content: '',
        word_count: 0,
      })
    }, { chapter: ch })

    const result = await executeToolOnRenderer(window, 'write_chapter_content', {
      chapter_index: 1,
      content: '第一段\n\n第二段',
    }, projectId)
    expect(result.result).toBe('内容已写入')

    const content = await readViaRenderer(window, 'read', { type: 'chapter_content', chapter_index: 1 }, projectId)
    expect(content).toContain('第一段')
    expect(content).toContain('第二段')
  })
})
