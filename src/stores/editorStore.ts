import { create } from 'zustand'
import type { Chapter, Project, OutlineVolume } from '@/types'
import { countChars } from '@/lib/utils'

interface ChapterEdit {
  chapterId: string
  original: string
  modified: string
  summary: string
}

interface VolumeEdit {
  volumeId: string
  original: string
  modified: string
  summary: string
  pendingMeta?: Partial<OutlineVolume>
}

interface EditorState {
  projects: Project[]
  activeProjectId: string | null
  chapters: Chapter[]
  activeChapterId: string | null
  volumes: OutlineVolume[]
  activeVolumeId: string | null
  isDirty: boolean
  // 切换项目后,volumes 异步加载,这个标志位为 false 时不要用 volumes 做依赖判断
  // (如升级迁移弹窗) — 避免看到"旧项目的空 volumes"误判
  isProjectLoading: boolean
  dataVersion: number
  pendingChapterEdit: ChapterEdit | null
  pendingVolumeEdit: VolumeEdit | null
  chapterScroll: Record<string, number>
  setProjects: (projects: Project[]) => void
  setActiveProject: (id: string | null) => void
  setChapters: (chapters: Chapter[]) => void
  setActiveChapter: (id: string | null) => void
  setVolumes: (volumes: OutlineVolume[]) => void
  setActiveVolumeId: (id: string | null) => void
  setDirty: (dirty: boolean) => void
  updateChapterContent: (chapterId: string, content: string) => void
  loadChapters: (projectId: string) => Promise<void>
  loadChaptersJump: (projectId: string) => Promise<void>
  loadVolumes: (projectId: string) => Promise<void>
  incrementDataVersion: () => void
  setPendingChapterEdit: (edit: ChapterEdit | null) => void
  setPendingVolumeEdit: (edit: VolumeEdit | null) => void
  rememberChapterScroll: (chapterId: string, scrollTop: number) => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  chapters: [],
  activeChapterId: null,
  volumes: [],
  activeVolumeId: null,
  isDirty: false,
  isProjectLoading: false,
  dataVersion: 0,
  pendingChapterEdit: null,
  pendingVolumeEdit: null,
  chapterScroll: {},
  setProjects: (projects) => set({ projects }),
  setActiveProject: async (id) => {
    if (id === get().activeProjectId) return
    const state = get()
    if (state.isDirty) {
      const dirtyChapter = state.chapters.find((c) => c.id === state.activeChapterId)
      if (dirtyChapter) {
        await window.electronAPI.chapter.save(dirtyChapter)
        set({ isDirty: false })
      }
    }
    // 标记"正在切换项目,volumes 不可信" — 防弹窗等依赖 volumes 的 effect 误判
    set({ activeProjectId: id, activeChapterId: null, chapters: [], volumes: [], activeVolumeId: null, chapterScroll: {}, isProjectLoading: true })
    if (id) {
      const [chapters, volumes] = await Promise.all([
        window.electronAPI.chapter.list(id),
        window.electronAPI.volume.list(id),
      ])
      const lastId = chapters.length > 0 ? chapters[chapters.length - 1].id : null
      const activeVol = volumes[0]?.id ?? null
      set({ chapters, activeChapterId: lastId, volumes, activeVolumeId: activeVol, isProjectLoading: false })
    } else {
      set({ isProjectLoading: false })
    }
  },
  setChapters: (chapters) => set({ chapters }),
  setActiveChapter: (id) => set({ activeChapterId: id }),
  setVolumes: (volumes) => set({ volumes }),
  setActiveVolumeId: (id) => set({ activeVolumeId: id }),
  setDirty: (dirty) => set({ isDirty: dirty }),
  updateChapterContent: (chapterId, content) => set((state) => ({
    chapters: state.chapters.map((c) =>
      c.id === chapterId ? { ...c, content, word_count: countChars(content) } : c
    ),
  })),
  loadChapters: async (projectId) => {
    const chapters = await window.electronAPI.chapter.list(projectId)
    set({ chapters })
  },
  loadChaptersJump: async (projectId) => {
    const chapters = await window.electronAPI.chapter.list(projectId)
    const lastId = chapters.length > 0 ? chapters[chapters.length - 1].id : null
    set({ chapters, activeChapterId: lastId })
  },
  loadVolumes: async (projectId) => {
    const volumes = await window.electronAPI.volume.list(projectId)
    set({ volumes, activeVolumeId: volumes[0]?.id ?? null })
  },
  incrementDataVersion: () => set((state) => ({ dataVersion: state.dataVersion + 1 })),
  setPendingChapterEdit: (edit) => set({ pendingChapterEdit: edit }),
  setPendingVolumeEdit: (edit) => set({ pendingVolumeEdit: edit }),
  rememberChapterScroll: (chapterId, scrollTop) => set((state) => ({
    chapterScroll: { ...state.chapterScroll, [chapterId]: scrollTop },
  })),
}))
