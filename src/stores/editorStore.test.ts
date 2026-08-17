import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEditorStore } from './editorStore'

const mockChapterList = vi.fn()
const mockVolumeList = vi.fn()

beforeEach(() => {
  vi.stubGlobal('window', {
    electronAPI: {
      chapter: { list: mockChapterList },
      volume: { list: mockVolumeList },
    },
  })
  useEditorStore.setState({
    projects: [],
    activeProjectId: null,
    chapters: [],
    activeChapterId: null,
    volumes: [],
    activeVolumeId: null,
    isDirty: false,
    dataVersion: 0,
    pendingChapterEdit: null,
    pendingVolumeEdit: null,
  })
  mockChapterList.mockReset()
  mockVolumeList.mockReset()
  mockVolumeList.mockResolvedValue([])
})

describe('useEditorStore', () => {
  it('初始状态正确', () => {
    const state = useEditorStore.getState()
    expect(state.projects).toEqual([])
    expect(state.activeProjectId).toBeNull()
    expect(state.chapters).toEqual([])
    expect(state.activeChapterId).toBeNull()
    expect(state.isDirty).toBe(false)
    expect(state.dataVersion).toBe(0)
    expect(state.pendingChapterEdit).toBeNull()
  })

  it('setProjects 设置项目列表', () => {
    const projects = [{ id: 'p1', title: '小说1' }]
    useEditorStore.getState().setProjects(projects as any)
    expect(useEditorStore.getState().projects).toEqual(projects)
  })

  it('setChapters 设置章节列表', () => {
    const chapters = [{ id: 'c1', title: '第一章', project_id: 'p1' }]
    useEditorStore.getState().setChapters(chapters as any)
    expect(useEditorStore.getState().chapters).toEqual(chapters)
  })

  it('setActiveChapter 设置活跃章节', () => {
    useEditorStore.getState().setActiveChapter('c1')
    expect(useEditorStore.getState().activeChapterId).toBe('c1')
  })

  it('setActiveChapter 设为 null', () => {
    useEditorStore.getState().setActiveChapter('c1')
    useEditorStore.getState().setActiveChapter(null)
    expect(useEditorStore.getState().activeChapterId).toBeNull()
  })

  it('setDirty 设置脏标记', () => {
    useEditorStore.getState().setDirty(true)
    expect(useEditorStore.getState().isDirty).toBe(true)
    useEditorStore.getState().setDirty(false)
    expect(useEditorStore.getState().isDirty).toBe(false)
  })

  it('incrementDataVersion 递增版本号', () => {
    expect(useEditorStore.getState().dataVersion).toBe(0)
    useEditorStore.getState().incrementDataVersion()
    expect(useEditorStore.getState().dataVersion).toBe(1)
    useEditorStore.getState().incrementDataVersion()
    expect(useEditorStore.getState().dataVersion).toBe(2)
  })

  it('updateChapterContent 更新章节内容和字数', () => {
    useEditorStore.getState().setChapters([
      { id: 'c1', title: '第一章', content: '', word_count: 0 } as any,
    ])
    useEditorStore.getState().updateChapterContent('c1', '<p>你好世界</p>')
    const chapter = useEditorStore.getState().chapters.find((c) => c.id === 'c1')
    expect(chapter!.content).toBe('<p>你好世界</p>')
    expect(chapter!.word_count).toBe(4)
  })

  it('updateChapterContent 不影响其他章节', () => {
    useEditorStore.getState().setChapters([
      { id: 'c1', title: '第一章', content: '旧内容', word_count: 3 } as any,
      { id: 'c2', title: '第二章', content: '不变', word_count: 2 } as any,
    ])
    useEditorStore.getState().updateChapterContent('c1', '新内容')
    const c2 = useEditorStore.getState().chapters.find((c) => c.id === 'c2')
    expect(c2!.content).toBe('不变')
  })

  it('setPendingChapterEdit 设置编辑差异', () => {
    const edit = { chapterId: 'c1', original: '旧文本', modified: '新文本', summary: '润色' }
    useEditorStore.getState().setPendingChapterEdit(edit)
    expect(useEditorStore.getState().pendingChapterEdit).toEqual(edit)
  })

  it('setPendingChapterEdit 清空编辑差异', () => {
    const edit = { chapterId: 'c1', original: '旧文本', modified: '新文本', summary: '润色' }
    useEditorStore.getState().setPendingChapterEdit(edit)
    useEditorStore.getState().setPendingChapterEdit(null)
    expect(useEditorStore.getState().pendingChapterEdit).toBeNull()
  })

  it('setActiveProject 切换项目', async () => {
    mockChapterList.mockResolvedValue([
      { id: 'c1', title: '第一章' },
      { id: 'c2', title: '第二章' },
    ])
    await useEditorStore.getState().setActiveProject('p1')
    expect(useEditorStore.getState().activeProjectId).toBe('p1')
    expect(useEditorStore.getState().activeChapterId).toBe('c2')
    expect(mockChapterList).toHaveBeenCalledWith('p1')
  })

  it('setActiveProject 从有项目切换到 null 清空章节', async () => {
    useEditorStore.setState({ activeProjectId: 'p1', chapters: [{ id: 'c1' } as any] })
    await useEditorStore.getState().setActiveProject(null)
    expect(useEditorStore.getState().activeProjectId).toBeNull()
    expect(useEditorStore.getState().chapters).toEqual([])
    expect(useEditorStore.getState().activeChapterId).toBeNull()
  })

  it('setActiveProject 相同项目不重复加载', async () => {
    useEditorStore.setState({ activeProjectId: 'p1' })
    await useEditorStore.getState().setActiveProject('p1')
    expect(mockChapterList).not.toHaveBeenCalled()
  })

  it('setActiveProject 空章节列表时 activeChapterId 为 null', async () => {
    mockChapterList.mockResolvedValue([])
    await useEditorStore.getState().setActiveProject('p1')
    expect(useEditorStore.getState().activeChapterId).toBeNull()
  })

  it('loadChapters 加载章节，不改变 activeChapterId', async () => {
    useEditorStore.getState().setActiveChapter('c1')
    mockChapterList.mockResolvedValue([
      { id: 'c1', title: '第一章' },
      { id: 'c2', title: '第二章' },
    ])
    await useEditorStore.getState().loadChapters('p1')
    expect(useEditorStore.getState().chapters).toHaveLength(2)
    expect(useEditorStore.getState().activeChapterId).toBe('c1')
  })

  it('loadChaptersJump 加载章节，跳转到最后一章', async () => {
    mockChapterList.mockResolvedValue([
      { id: 'c1', title: '第一章' },
      { id: 'c2', title: '第二章' },
    ])
    await useEditorStore.getState().loadChaptersJump('p1')
    expect(useEditorStore.getState().chapters).toHaveLength(2)
    expect(useEditorStore.getState().activeChapterId).toBe('c2')
  })
})
