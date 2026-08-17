// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from './settingsStore'

describe('useSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({
      font: {
        editorFont: 'XingHan DengKuan',
        editorFontSize: 18,
        editorFontWeight: 400,
        editorLineHeight: 1.6,
        uiFont: 'MiSans',
        uiFontSize: 18,
        chatFontSize: 18,
      },
    })
  })

  it('初始状态包含字体设置', () => {
    const { font } = useSettingsStore.getState()
    expect(font.editorFont).toBe('XingHan DengKuan')
    expect(font.editorFontSize).toBe(18)
    expect(font.editorFontWeight).toBe(400)
    expect(font.uiFont).toBe('MiSans')
    expect(font.uiFontSize).toBe(18)
  })

  it('setEditorFont 更新编辑器字体', () => {
    useSettingsStore.getState().setEditorFont('宋体')
    expect(useSettingsStore.getState().font.editorFont).toBe('宋体')
    const saved = JSON.parse(localStorage.getItem('inkark-font')!)
    expect(saved.editorFont).toBe('宋体')
  })

  it('setEditorFontSize 更新编辑器字号', () => {
    useSettingsStore.getState().setEditorFontSize(24)
    expect(useSettingsStore.getState().font.editorFontSize).toBe(24)
  })

  it('setEditorFontWeight 更新编辑器字重', () => {
    useSettingsStore.getState().setEditorFontWeight(700)
    expect(useSettingsStore.getState().font.editorFontWeight).toBe(700)
  })

  it('setEditorLineHeight 更新行高', () => {
    useSettingsStore.getState().setEditorLineHeight(2.0)
    expect(useSettingsStore.getState().font.editorLineHeight).toBe(2.0)
  })

  it('setUiFont 更新 UI 字体', () => {
    useSettingsStore.getState().setUiFont('微软雅黑')
    expect(useSettingsStore.getState().font.uiFont).toBe('微软雅黑')
  })

  it('setUiFontSize 更新 UI 字号', () => {
    useSettingsStore.getState().setUiFontSize(20)
    expect(useSettingsStore.getState().font.uiFontSize).toBe(20)
  })

  it('setChatFontSize 更新聊天字号', () => {
    useSettingsStore.getState().setChatFontSize(16)
    expect(useSettingsStore.getState().font.chatFontSize).toBe(16)
  })

  it('修改字体后持久化到 localStorage', () => {
    useSettingsStore.getState().setEditorFont('黑体')
    const saved = JSON.parse(localStorage.getItem('inkark-font')!)
    expect(saved.editorFont).toBe('黑体')
  })

  it('修改字体后应用 CSS 变量', () => {
    useSettingsStore.getState().setEditorFontSize(22)
    const root = document.documentElement
    expect(root.style.getPropertyValue('--font-editor-size')).toBe('22px')
  })

  it('setEditorLineHeight 应用 CSS 变量', () => {
    useSettingsStore.getState().setEditorLineHeight(1.8)
    const root = document.documentElement
    expect(root.style.getPropertyValue('--font-editor-line-height')).toBe('1.8')
  })

  it('setChatFontSize 应用 CSS 变量', () => {
    useSettingsStore.getState().setChatFontSize(14)
    const root = document.documentElement
    expect(root.style.getPropertyValue('--font-chat-size')).toBe('14px')
  })

  it('多个设置修改互不影响', () => {
    useSettingsStore.getState().setEditorFont('黑体')
    useSettingsStore.getState().setUiFontSize(20)
    const { font } = useSettingsStore.getState()
    expect(font.editorFont).toBe('黑体')
    expect(font.uiFontSize).toBe(20)
    expect(font.editorFontSize).toBe(18)
    expect(font.uiFont).toBe('MiSans')
  })

  it('localStorage 存储损坏 JSON 时回退到默认值', async () => {
    localStorage.setItem('inkark-font', '{invalid json')
    vi.resetModules()
    const { useSettingsStore: freshStore } = await import('./settingsStore')
    const { font } = freshStore.getState()
    expect(font.editorFont).toBeTruthy()
    expect(typeof font.editorFontSize).toBe('number')
  })

  it('localStorage 存储部分字段时合并默认值', async () => {
    localStorage.setItem('inkark-font', JSON.stringify({ editorFont: '宋体' }))
    vi.resetModules()
    const { useSettingsStore: freshStore } = await import('./settingsStore')
    const { font } = freshStore.getState()
    expect(font.editorFont).toBe('宋体')
    expect(typeof font.editorFontSize).toBe('number')
    expect(typeof font.uiFont).toBe('string')
  })
})
