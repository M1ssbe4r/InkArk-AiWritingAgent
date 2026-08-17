import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './appStore'

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      sidebarView: 'outline',
      isAIPanelOpen: true,
      debugMode: false,
      editorView: 'chapter',
      exportOpen: false,
    })
  })

  it('setSidebarView 切换到各视图', () => {
    for (const view of ['characters', 'world', 'none', 'bookoutline'] as const) {
      useAppStore.getState().setSidebarView(view)
      expect(useAppStore.getState().sidebarView).toBe(view)
    }
  })

  it('setAIPanelOpen 切换面板状态', () => {
    useAppStore.getState().setAIPanelOpen(false)
    expect(useAppStore.getState().isAIPanelOpen).toBe(false)
    useAppStore.getState().setAIPanelOpen(true)
    expect(useAppStore.getState().isAIPanelOpen).toBe(true)
  })

  it('setDebugMode 支持函数参数', () => {
    useAppStore.setState({ debugMode: true })
    useAppStore.getState().setDebugMode((prev) => !prev)
    expect(useAppStore.getState().debugMode).toBe(false)
    useAppStore.getState().setDebugMode((prev) => !prev)
    expect(useAppStore.getState().debugMode).toBe(true)
  })

  it('setDebugMode 支持直接值', () => {
    useAppStore.getState().setDebugMode(false)
    expect(useAppStore.getState().debugMode).toBe(false)
  })

  it('setEditorView 切换编辑器视图', () => {
    useAppStore.getState().setEditorView('outline')
    expect(useAppStore.getState().editorView).toBe('outline')
    useAppStore.getState().setEditorView('chapter')
    expect(useAppStore.getState().editorView).toBe('chapter')
  })

  it('setExportOpen 切换导出对话框', () => {
    useAppStore.getState().setExportOpen(true)
    expect(useAppStore.getState().exportOpen).toBe(true)
    useAppStore.getState().setExportOpen(false)
    expect(useAppStore.getState().exportOpen).toBe(false)
  })

  it('多个状态独立变化互不影响', () => {
    useAppStore.getState().setSidebarView('bookoutline')
    useAppStore.getState().setAIPanelOpen(false)
    useAppStore.getState().setEditorView('outline')
    expect(useAppStore.getState().sidebarView).toBe('bookoutline')
    expect(useAppStore.getState().isAIPanelOpen).toBe(false)
    expect(useAppStore.getState().editorView).toBe('outline')
  })
})
