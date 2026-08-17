import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  pushChange,
  consumeChanges,
  clearChanges,
  getStyleGuidance,
  setStyleGuidance,
  getStyleCustomId,
  setStyleCustom,
  initStyleCustomId,
  getSummaryOutline,
  setSummaryOutline,
  getPendingAction,
  setPendingAction,
  getEditor,
  setEditor,
  setPendingDiffResolve,
  resolvePendingDiff,
  setPendingOutlineResolve,
  resolvePendingOutline,
  formatEditRejectResult,
  formatDeleteRejectResult,
  scheduleChapterSave,
  flushChapterSave,
  registerVolumeSaveFlush,
  unregisterVolumeSaveFlush,
  flushVolumeSave,
  getStyleRestrictions,
  setStyleRestrictions,
  initWritingRestrictions,
} from './editorRef'
import { useEditorStore } from '@/stores/editorStore'

const mockChapterSave = vi.fn()
const mockSetStyleGuidance = vi.fn()
const mockGetStyle = vi.fn()
const mockSetStyle = vi.fn()
const mockSetWritingRestrictions = vi.fn()

beforeEach(() => {
  const store: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => Object.keys(store).forEach(k => delete store[k]),
    get length() { return Object.keys(store).length },
    key: (i: number) => Object.keys(store)[i] ?? null,
  })
  mockGetStyle.mockReset()
  mockSetStyle.mockReset()
  vi.stubGlobal('window', {
    electronAPI: {
      chapter: { save: mockChapterSave },
      project: {
        setStyleGuidance: mockSetStyleGuidance,
        getStyle: mockGetStyle,
        setStyle: mockSetStyle,
        setWritingRestrictions: mockSetWritingRestrictions,
      },
    },
  })
  clearChanges()
  setStyleGuidance('')
  initStyleCustomId(null)
  setSummaryOutline('')
  setPendingAction(null)
  setEditor(null)
  initWritingRestrictions('')
  useEditorStore.setState({
    activeProjectId: null,
    chapters: [],
    isDirty: false,
  })
  mockChapterSave.mockReset()
  mockSetStyleGuidance.mockReset()
  mockSetWritingRestrictions.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('change notification queue', () => {
  it('pushChange + consumeChanges 基本流程', () => {
    pushChange('proj1', 'chapter_title', '第一章', '标题已更新')
    const changes = consumeChanges('proj1')
    expect(changes).toHaveLength(1)
    expect(changes[0]).toContain('标题已更新')
  })

  it('不同项目的变更互不干扰', () => {
    pushChange('proj1', 'chapter_title', '第一章', '项目1变更')
    pushChange('proj2', 'chapter_title', '第一章', '项目2变更')
    expect(consumeChanges('proj1')).toHaveLength(1)
    expect(consumeChanges('proj2')).toHaveLength(1)
    expect(consumeChanges('proj1')[0]).toContain('项目1变更')
    expect(consumeChanges('proj2')[0]).toContain('项目2变更')
  })

  it('consumeChanges 不会清空队列', () => {
    pushChange('proj1', 'chapter_title', undefined, '变更1')
    consumeChanges('proj1')
    const changes = consumeChanges('proj1')
    expect(changes).toHaveLength(1)
  })

  it('clearChanges 清除指定项目', () => {
    pushChange('proj1', 'chapter_title', undefined, '变更1')
    pushChange('proj2', 'chapter_title', undefined, '变更2')
    clearChanges('proj1')
    expect(consumeChanges('proj1')).toHaveLength(0)
    expect(consumeChanges('proj2')).toHaveLength(1)
  })

  it('clearChanges 无参数清除全部', () => {
    pushChange('proj1', 'chapter_title', undefined, '变更1')
    pushChange('proj2', 'chapter_title', undefined, '变更2')
    clearChanges()
    expect(consumeChanges('proj1')).toHaveLength(0)
    expect(consumeChanges('proj2')).toHaveLength(0)
  })

  it('相同 key 的变更被覆盖', () => {
    pushChange('proj1', 'chapter_title', '第一章', '旧标题')
    pushChange('proj1', 'chapter_title', '第一章', '新标题')
    const changes = consumeChanges('proj1')
    expect(changes).toHaveLength(1)
    expect(changes[0]).toContain('新标题')
  })

  it('不同 dimension 的变更分别保留', () => {
    pushChange('proj1', 'chapter_title', '第一章', '标题变更')
    pushChange('proj1', 'chapter_outline', '第一章', '大纲变更')
    const changes = consumeChanges('proj1')
    expect(changes).toHaveLength(2)
  })

  it('变更附带工具提示', () => {
    pushChange('proj1', 'character', '叶凡', '角色已更新')
    const changes = consumeChanges('proj1')
    expect(changes[0]).toContain('read(type=character)')
  })

  it('chapter_create 变更附带 list 提示', () => {
    pushChange('proj1', 'chapter_create', undefined, '新章节已创建')
    const changes = consumeChanges('proj1')
    expect(changes[0]).toContain('list(type=chapter)')
  })

  it('style 变更无工具提示', () => {
    pushChange('proj1', 'style', undefined, '风格已更新')
    const changes = consumeChanges('proj1')
    expect(changes[0]).toBe('风格已更新')
  })

  it('队列超过 50 条时淘汰最早的', () => {
    for (let i = 0; i < 55; i++) {
      pushChange('proj1', `dim${i}`, undefined, `变更${i}`)
    }
    const changes = consumeChanges('proj1')
    expect(changes.length).toBeLessThanOrEqual(50)
  })
})

describe('style guidance', () => {
  it('默认为空字符串', () => {
    expect(getStyleGuidance()).toBe('')
  })

  it('设置后可获取', () => {
    setStyleGuidance('古风文笔')
    expect(getStyleGuidance()).toBe('古风文笔')
    setStyleGuidance('')
  })

  it('设置时调用 electronAPI 保存', async () => {
    useEditorStore.setState({ activeProjectId: 'p1' })
    await setStyleGuidance('古风文笔')
    expect(mockSetStyleGuidance).toHaveBeenCalledWith('p1', '古风文笔')
    setStyleGuidance('')
  })

  it('无活跃项目时不调用 electronAPI', async () => {
    useEditorStore.setState({ activeProjectId: null })
    await setStyleGuidance('古风文笔')
    expect(mockSetStyleGuidance).not.toHaveBeenCalled()
    setStyleGuidance('')
  })
})

describe('style custom id', () => {
  it('默认为 null', () => {
    expect(getStyleCustomId()).toBe(null)
  })

  it('initStyleCustomId 后可获取', () => {
    initStyleCustomId('cs-1')
    expect(getStyleCustomId()).toBe('cs-1')
    initStyleCustomId(null)
  })

  it('setStyleCustom 调用 IPC 并更新 cache', async () => {
    useEditorStore.setState({ activeProjectId: 'p1' })
    mockGetStyle.mockResolvedValue({ guidance: '赛博朋克文风', customStyleId: 'cs-1' })
    await setStyleCustom('cs-1')
    expect(getStyleCustomId()).toBe('cs-1')
    expect(getStyleGuidance()).toBe('赛博朋克文风')
    expect(mockSetStyle).toHaveBeenCalledWith('p1', 'cs-1')
    initStyleCustomId(null)
  })

  it('setStyleCustom(null) 清空 cache', async () => {
    useEditorStore.setState({ activeProjectId: 'p1' })
    initStyleCustomId('cs-1')
    await setStyleCustom(null)
    expect(getStyleCustomId()).toBe(null)
    expect(getStyleGuidance()).toBe('')
    expect(mockSetStyle).toHaveBeenCalledWith('p1', null)
  })

  it('setStyleCustom 无活跃项目时不调 IPC', async () => {
    useEditorStore.setState({ activeProjectId: null })
    await setStyleCustom('cs-1')
    expect(mockSetStyle).not.toHaveBeenCalled()
  })

  it('setStyleGuidance 同时清空 customId', async () => {
    useEditorStore.setState({ activeProjectId: 'p1' })
    initStyleCustomId('cs-1')
    await setStyleGuidance('古风文笔')
    expect(getStyleCustomId()).toBe(null)
    expect(getStyleGuidance()).toBe('古风文笔')
    setStyleGuidance('')
  })
})

describe('style restrictions', () => {
  it('默认为空字符串', () => {
    expect(getStyleRestrictions()).toBe('')
  })

  it('设置后可获取并保存到当前作品', async () => {
    useEditorStore.setState({ activeProjectId: 'p1' })
    await setStyleRestrictions('避用成语')
    expect(getStyleRestrictions()).toBe('避用成语')
    expect(mockSetWritingRestrictions).toHaveBeenCalledWith('p1', '避用成语')
    initWritingRestrictions('')
  })
})

describe('summary outline', () => {
  it('默认为空字符串', () => {
    expect(getSummaryOutline()).toBe('')
  })

  it('设置后可获取', () => {
    setSummaryOutline('大纲内容')
    expect(getSummaryOutline()).toBe('大纲内容')
    setSummaryOutline('')
  })
})

describe('pending action', () => {
  it('默认为 null', () => {
    expect(getPendingAction()).toBeNull()
  })

  it('设置后可获取', () => {
    const action = { action: 'polish' as const, text: '润色文本' }
    setPendingAction(action)
    expect(getPendingAction()).toEqual(action)
    setPendingAction(null)
  })

  it('支持 chapterIndex 与 paragraphIndices', () => {
    const action = {
      action: 'polish' as const,
      text: '选区',
      chapterIndex: 3,
      paragraphIndices: [2, 3],
    }
    setPendingAction(action)
    expect(getPendingAction()).toEqual(action)
    setPendingAction(null)
  })
})

describe('editor reference', () => {
  it('默认为 null', () => {
    expect(getEditor()).toBeNull()
  })

  it('设置后可获取', () => {
    const mockEditor = {} as any
    setEditor(mockEditor)
    expect(getEditor()).toBe(mockEditor)
    setEditor(null)
  })
})

describe('pending diff resolve', () => {
  it('resolve 时调用回调', () => {
    const fn = vi.fn()
    setPendingDiffResolve(fn)
    resolvePendingDiff('accept', 'ok')
    expect(fn).toHaveBeenCalledWith('accept', 'ok')
  })

  it('resolve 后清空回调', () => {
    const fn = vi.fn()
    setPendingDiffResolve(fn)
    resolvePendingDiff('revert')
    resolvePendingDiff('accept')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('无回调时不报错', () => {
    expect(() => resolvePendingDiff('accept')).not.toThrow()
  })
})

describe('review reject result formatting', () => {
  it('formatEditRejectResult 未填原因', () => {
    expect(formatEditRejectResult()).toBe('用户已拒绝，修改未生效，原因：未填写')
    expect(formatEditRejectResult('  ')).toBe('用户已拒绝，修改未生效，原因：未填写')
  })

  it('formatEditRejectResult 有原因', () => {
    expect(formatEditRejectResult('语气不对')).toBe('用户已拒绝，修改未生效，原因：语气不对')
  })

  it('formatDeleteRejectResult', () => {
    expect(formatDeleteRejectResult()).toBe('用户已拒绝，删除未执行，原因：未填写')
    expect(formatDeleteRejectResult('误删')).toBe('用户已拒绝，删除未执行，原因：误删')
  })
})

describe('pending outline resolve', () => {
  it('resolve 时调用回调', () => {
    const fn = vi.fn()
    setPendingOutlineResolve(fn)
    resolvePendingOutline('accept', 'ok')
    expect(fn).toHaveBeenCalledWith('accept', 'ok')
  })

  it('resolve 后清空回调', () => {
    const fn = vi.fn()
    setPendingOutlineResolve(fn)
    resolvePendingOutline('revert')
    resolvePendingOutline('accept')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('无回调时不报错', () => {
    expect(() => resolvePendingOutline('accept')).not.toThrow()
  })
})

describe('scheduleChapterSave', () => {
  it('300ms 后自动保存脏章节', async () => {
    useEditorStore.setState({
      activeProjectId: 'p1',
      isDirty: true,
      chapters: [{ id: 'c1', title: '第一章', content: '内容', word_count: 2 } as any],
    })
    mockChapterSave.mockResolvedValue(undefined)

    scheduleChapterSave('c1')
    await vi.advanceTimersByTimeAsync(299)
    expect(mockChapterSave).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2)
    expect(mockChapterSave).toHaveBeenCalledTimes(1)
    expect(mockChapterSave.mock.calls[0][0].id).toBe('c1')
    expect(useEditorStore.getState().isDirty).toBe(false)
  })

  it('非脏状态不保存', async () => {
    useEditorStore.setState({
      activeProjectId: 'p1',
      isDirty: false,
      chapters: [{ id: 'c1', title: '第一章', content: '内容', word_count: 2 } as any],
    })

    scheduleChapterSave('c1')
    await vi.advanceTimersByTimeAsync(2000)
    expect(mockChapterSave).not.toHaveBeenCalled()
  })

  it('章节不存在时不保存', async () => {
    useEditorStore.setState({
      activeProjectId: 'p1',
      isDirty: true,
      chapters: [],
    })

    scheduleChapterSave('c1')
    await vi.advanceTimersByTimeAsync(2000)
    expect(mockChapterSave).not.toHaveBeenCalled()
  })

  it('连续调用防抖，只保存最后一次', async () => {
    useEditorStore.setState({
      activeProjectId: 'p1',
      isDirty: true,
      chapters: [{ id: 'c1', title: '第一章', content: '内容', word_count: 2 } as any],
    })
    mockChapterSave.mockResolvedValue(undefined)

    // 每次 advance 都 < 300ms (CHAPTER_AUTOSAVE_INTERVAL_MS), 让定时器不断被 reset,
    // 最终只在最后一次 advanceTimersByTimeAsync(301) 后才触发一次保存
    scheduleChapterSave('c1')
    await vi.advanceTimersByTimeAsync(150)
    scheduleChapterSave('c1')
    await vi.advanceTimersByTimeAsync(150)
    scheduleChapterSave('c1')
    await vi.advanceTimersByTimeAsync(301)

    expect(mockChapterSave).toHaveBeenCalledTimes(1)
  })
})

describe('flushChapterSave', () => {
  it('有定时器时立即保存', async () => {
    useEditorStore.setState({
      activeProjectId: 'p1',
      isDirty: true,
      chapters: [{ id: 'c1', title: '第一章', content: '内容', word_count: 2 } as any],
    })
    mockChapterSave.mockResolvedValue(undefined)

    scheduleChapterSave('c1')
    await flushChapterSave()

    expect(mockChapterSave).toHaveBeenCalledTimes(1)
    expect(useEditorStore.getState().isDirty).toBe(false)
  })

  it('无定时器但脏状态时保存当前活跃章节', async () => {
    useEditorStore.setState({
      activeProjectId: 'p1',
      activeChapterId: 'c1',
      isDirty: true,
      chapters: [{ id: 'c1', title: '第一章', content: '内容', word_count: 2 } as any],
    })
    mockChapterSave.mockResolvedValue(undefined)

    await flushChapterSave()

    expect(mockChapterSave).toHaveBeenCalledTimes(1)
    expect(useEditorStore.getState().isDirty).toBe(false)
  })

  it('非脏状态时不保存', async () => {
    useEditorStore.setState({
      activeProjectId: 'p1',
      isDirty: false,
      chapters: [{ id: 'c1', title: '第一章', content: '内容', word_count: 2 } as any],
    })

    await flushChapterSave()

    expect(mockChapterSave).not.toHaveBeenCalled()
  })
})

describe('flushVolumeSave', () => {
  it('执行所有已注册的卷 flush', async () => {
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    registerVolumeSaveFlush('v1', fn1)
    registerVolumeSaveFlush('v2', fn2)
    await flushVolumeSave()
    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledTimes(1)
    unregisterVolumeSaveFlush('v1')
    unregisterVolumeSaveFlush('v2')
  })

  it('无注册时不报错', async () => {
    await expect(flushVolumeSave()).resolves.toBeUndefined()
  })
})
