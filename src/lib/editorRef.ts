import type { Editor } from '@tiptap/react'
import { useEditorStore } from '@/stores/editorStore'
import { logger } from '@/lib/logger'

let editor: Editor | null = null
let outlineEditor: Editor | null = null
let summaryOutline = ''

let writingRestrictionsCache = ''

let styleGuidanceCache = ''
let styleCustomIdCache: string | null = null

export function initWritingRestrictions(v: string) {
  writingRestrictionsCache = v
}

export function initStyleGuidance(g: string) {
  styleGuidanceCache = g
}
export function initStyleCustomId(id: string | null) {
  styleCustomIdCache = id
}

export function getStyleGuidance() {
  return styleGuidanceCache
}
export function getStyleCustomId(): string | null {
  return styleCustomIdCache
}

export async function setStyleGuidance(g: string) {
  styleGuidanceCache = g
  // Writing via plain guidance clears any custom-style binding.
  styleCustomIdCache = null
  const projectId = useEditorStore.getState().activeProjectId
  if (!projectId) return
  await window.electronAPI.project.setStyleGuidance(projectId, g)
}
export async function setStyleCustom(customStyleId: string | null) {
  styleCustomIdCache = customStyleId
  if (customStyleId) {
    // Refresh guidance cache from DB to keep both in sync.
    const projectId = useEditorStore.getState().activeProjectId
    if (projectId) {
      const result = await window.electronAPI.project.getStyle(projectId)
      if (result) styleGuidanceCache = result.guidance
    }
  } else {
    styleGuidanceCache = ''
  }
  const projectId = useEditorStore.getState().activeProjectId
  if (!projectId) return
  await window.electronAPI.project.setStyle(projectId, customStyleId)
}
// 章节正文 debounce 间隔。300ms 仍能合并高频打字,同时把 kill / 断电的丢字窗口
// 从 1s 字数压到 ~300ms 字数。低于 200ms 在快速打字时可能漏触发。
const CHAPTER_AUTOSAVE_INTERVAL_MS = 300
// 章节标题/大纲 debounce 间隔。比正文稍长,大纲修改频率低,避免每键触发 IPC。
const OUTLINE_AUTOSAVE_INTERVAL_MS = 1000

let saveTimer: { timer: ReturnType<typeof setTimeout>; chapterId: string } | null = null

export function scheduleChapterSave(chapterId: string) {
    if (saveTimer) clearTimeout(saveTimer.timer)
    saveTimer = {
        chapterId,
        timer: setTimeout(async () => {
            saveTimer = null
            const state = useEditorStore.getState()
            if (!state.isDirty) return
            const chapter = state.chapters.find((c) => c.id === chapterId)
            if (!chapter) return
            await window.electronAPI.chapter.save(chapter)
            state.setDirty(false)
        }, CHAPTER_AUTOSAVE_INTERVAL_MS),
    }
}

export async function flushChapterSave() {
    const trigger = saveTimer ? 'timer' : 'manual'
    try {
        if (saveTimer) {
            clearTimeout(saveTimer.timer)
            const savedChapterId = saveTimer.chapterId
            saveTimer = null
            const state = useEditorStore.getState()
            if (!state.isDirty) return
            const chapter = state.chapters.find((c) => c.id === savedChapterId)
            if (!chapter) return
            await window.electronAPI.chapter.save(chapter)
            state.setDirty(false)
            logger.debug('editor.autosave', 'flushed (timer)', { chapterId: savedChapterId })
            return
        }
        const state = useEditorStore.getState()
        if (!state.isDirty) return
        const chapter = state.chapters.find((c) => c.id === state.activeChapterId)
        if (!chapter) return
        await window.electronAPI.chapter.save(chapter)
        state.setDirty(false)
        logger.debug('editor.autosave', 'flushed (manual)', { chapterId: chapter.id })
    } catch (err) {
        logger.errorObj('editor.autosave', 'failed', err, { trigger })
        throw err // 让调用方也知道失败(状态栏要显示)
    }
}

// 章节标题/大纲 debounce 自动保存。标题和大纲在原实现里只在 onBlur 时保存,
// 用户写完大纲没失焦直接关窗/崩了 → 整段大纲丢失。这里把 onBlur 改成
// 1s debounce 自动保存,blur 时强制 flush。
//
// 用 callback 模式是因为 title/outline 是组件本地 state,editorRef 拿不到最新值,
// 调用方在 onChange 时把"如何构造 IPC payload"传进来即可。
let outlineTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleOutlineSave(task: () => Promise<void> | void) {
    if (outlineTimer) clearTimeout(outlineTimer)
    outlineTimer = setTimeout(async () => {
        outlineTimer = null
        try {
            await task()
        } catch (err) {
            logger.errorObj('editor.outlineAutosave', 'failed', err)
        }
    }, OUTLINE_AUTOSAVE_INTERVAL_MS)
}

export async function flushOutlineSave(task: () => Promise<void> | void) {
    if (outlineTimer) {
        clearTimeout(outlineTimer)
        outlineTimer = null
    }
    await task()
}

export type PendingAction = {
  action: 'polish' | 'condense' | 'expand' | 'sendToChat' | 'autoOutlinePrompt' | 'expandOutline' | 'customCommand' | 'chapterReviewFix'
  text: string
  chapterIndex?: number
  paragraphIndices?: number[]
  customPrompt?: string
  freshSession?: boolean
  reviewText?: string
} | null

let pendingAction: PendingAction = null

export function getEditor() {
  return editor
}

export function setEditor(e: Editor | null) {
  editor = e
}

export function getOutlineEditor() {
  return outlineEditor
}

export function setOutlineEditor(e: Editor | null) {
  outlineEditor = e
}

export function getStyleRestrictions(): string {
  return writingRestrictionsCache
}

export async function setStyleRestrictions(v: string) {
  writingRestrictionsCache = v
  const projectId = useEditorStore.getState().activeProjectId
  if (!projectId) return
  await window.electronAPI.project.setWritingRestrictions(projectId, v)
}

export function getSummaryOutline() {
  return summaryOutline
}

export function setSummaryOutline(s: string) {
  summaryOutline = s
}

export function getPendingAction() {
  return pendingAction
}

export function setPendingAction(a: PendingAction) {
  pendingAction = a
}

let pendingDiffResolve: ((action: 'accept' | 'revert', message?: string) => void) | null = null

export function setPendingDiffResolve(fn: typeof pendingDiffResolve) {
  pendingDiffResolve = fn
}

export function resolvePendingDiff(action: 'accept' | 'revert', message?: string) {
  pendingDiffResolve?.(action, message)
  pendingDiffResolve = null
}

let pendingOutlineResolve: ((action: 'accept' | 'revert', message?: string) => void) | null = null

export function setPendingOutlineResolve(fn: typeof pendingOutlineResolve) {
  pendingOutlineResolve = fn
}

export function resolvePendingOutline(action: 'accept' | 'revert', message?: string) {
  pendingOutlineResolve?.(action, message)
  pendingOutlineResolve = null
}

export function formatEditRejectResult(reason?: string) {
  return `用户已拒绝，修改未生效，原因：${reason?.trim() || '未填写'}`
}

export function formatDeleteRejectResult(reason?: string) {
  return `用户已拒绝，删除未执行，原因：${reason?.trim() || '未填写'}`
}

// --- Volume editor debounce flush ---
// VolumeAccordionItem 使用本地 debounce 自动保存卷名/大纲/进度备注。
// 退出前需要把这些未 flush 的写入强制落库,否则用户立刻退出会丢失最后编辑。
const volumeSaveFlushes = new Map<string, () => Promise<void> | void>()

export function registerVolumeSaveFlush(volumeId: string, fn: () => Promise<void> | void) {
  volumeSaveFlushes.set(volumeId, fn)
}

export function unregisterVolumeSaveFlush(volumeId: string) {
  volumeSaveFlushes.delete(volumeId)
}

export async function flushVolumeSave() {
  if (volumeSaveFlushes.size === 0) return
  const errors: unknown[] = []
  for (const fn of volumeSaveFlushes.values()) {
    try {
      await fn()
    } catch (err) {
      errors.push(err)
    }
  }
  if (errors.length > 0) {
    logger.errorObj('editor.volumeAutosave', 'flush failed', errors[0])
    throw errors[0]
  }
}

// --- Change notification queue ---

interface ChangeEntry {
  dimension: string
  target?: string
  text: string
}

const changeQueue = new Map<string, ChangeEntry>()

export function pushChange(projectId: string, dimension: string, target: string | undefined, text: string) {
  const key = `${projectId}:${dimension}:${target || ''}`
  changeQueue.set(key, { dimension, target, text })
  if (changeQueue.size > 50) {
    const first = changeQueue.keys().next().value
    if (first) changeQueue.delete(first)
  }
}

const toolHint: Record<string, string> = {
  chapter_title: '',
  chapter_outline: '',
  chapter_content: '',
  chapter_create: '，请使用 list(type=chapter) 查看',
  chapter_delete: '，请使用 list(type=chapter) 查看',
  character: '，请使用 read(type=character) 查看',
  world: '，请使用 read(type=world) 查看',
  outline: '，请使用 read(type=outline) 查看',
  style: '',
}

export function consumeChanges(projectId: string): string[] {
  const result: string[] = []
  for (const [key, entry] of changeQueue) {
    if (key.startsWith(projectId + ':')) {
      const hint = toolHint[entry.dimension] || ''
      result.push(entry.text + hint)
    }
  }
  return result
}

export function clearChanges(projectId?: string) {
  if (projectId) {
    for (const key of changeQueue.keys()) {
      if (key.startsWith(projectId + ':')) {
        changeQueue.delete(key)
      }
    }
  } else {
    changeQueue.clear()
  }
}
