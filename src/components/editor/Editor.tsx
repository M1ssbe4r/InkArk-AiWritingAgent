import { useEffect, useMemo, useRef, useState, useLayoutEffect, useCallback, type RefObject } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import { StaticCursor } from '@/extensions/StaticCursor'
import { ParagraphNumberGutter } from '@/extensions/ParagraphNumberGutter'
import { normalizeChapterContentHtml, resolveChapterSelectionContext } from '@/lib/chapterParagraph'
import { useEditorStore } from '@/stores/editorStore'
import { useAppStore } from '@/stores/appStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { setEditor, setSummaryOutline, pushChange, scheduleChapterSave, scheduleOutlineSave, flushOutlineSave, setPendingAction } from '@/lib/editorRef'
import {
  getChapterReview,
  isChapterReviewRunning,
  runChapterReview,
  sanitizeReviewText,
} from '@/lib/chapterReview'
import { VolumeOutlineView } from '@/components/outline/VolumeOutlineView'
import type { Chapter } from '@/types'

import { streamChatCompletion } from '@/lib/api'
import { computeDiff, type DiffSegment } from '@/lib/diffUtils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StatusBar } from '@/components/layout/StatusBar'
import { ExportDialog } from './ExportDialog'
import { ContextMenu } from './ContextMenu'
import { Bold, Italic, FileText, Undo, Redo, Download, Check, X, Loader2, Pencil, RotateCcw, Eye, Send } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { BookIdeaDialog } from '@/components/outline/BookIdeaDialog'

/**
 * 构造章节标题/大纲 debounce 自动保存的任务。
 *
 * 标题和大纲是组件本地 state (titleDraft / summaryDraft),1s debounce 后 task 触发时
 * 闭包里的值已是 stale,所以从 ref 里读最新值。afterSave 用于失焦时的 pushChange,
 * 自动保存路径传 noop,避免每个字符都产生 change queue 条目。
 */
function buildOutlineSaveTask(
  chapter: Chapter | undefined,
  projectId: string | null,
  loadChapters: (id: string) => Promise<void>,
  titleRef: React.MutableRefObject<string>,
  summaryRef: React.MutableRefObject<string>,
  afterSave: () => void,
): () => Promise<void> {
  return async () => {
    if (!chapter) return
    try {
      await window.electronAPI.chapter.updateMeta({
        id: chapter.id,
        title: titleRef.current,
        chapter_outline: summaryRef.current.trim(),
        status: chapter.status,
      })
      if (projectId) await loadChapters(projectId)
    } finally {
      try { afterSave() } catch {}
    }
  }
}

export function Editor() {
  const { editorView, setEditorView, exportOpen, setExportOpen } = useAppStore()
  const [titleDraft, setTitleDraft] = useState('')
  const [summaryDraft, setSummaryDraft] = useState('')
  const [showNewSummary, setShowNewSummary] = useState(false)
  const [newSummaryDraft, setNewSummaryDraft] = useState('')
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [showReviewPanel, setShowReviewPanel] = useState(false)
  const [reviewDraft, setReviewDraft] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const reviewChapterIdRef = useRef<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    text: string
    source: 'editor' | 'outline'
    chapterIndex?: number
    paragraphIndices?: number[]
  } | null>(null)

  const [ideaOpen, setIdeaOpen] = useState(false)

  const chapters = useEditorStore((s) => s.chapters)
  const activeChapterId = useEditorStore((s) => s.activeChapterId)
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const isDirty = useEditorStore((s) => s.isDirty)
  const setDirty = useEditorStore((s) => s.setDirty)
  const updateChapterContent = useEditorStore((s) => s.updateChapterContent)
  const loadChapters = useEditorStore((s) => s.loadChapters)
  const rememberChapterScroll = useEditorStore((s) => s.rememberChapterScroll)

  const activeChapter = chapters.find((c) => c.id === activeChapterId)
  const chaptersRef = useRef(chapters)
  const activeChapterIdRef = useRef(activeChapterId)
  chaptersRef.current = chapters
  activeChapterIdRef.current = activeChapterId
  const isProgrammaticChange = useRef(false)
  const summaryRef = useRef<HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const newSummaryRef = useRef<HTMLTextAreaElement>(null)
  // 标题/大纲最新值镜像, debounce 触发时 task 闭包读到最新值 (避免 React stale closure)
  const titleDraftRef = useRef('')
  const summaryDraftRef = useRef('')
  // 编辑器外层滚动容器:章节内容区是可滚动的 div,scrollTop 即"用户最后看到的位置"
  const chapterScrollRef = useRef<HTMLDivElement>(null)
  // 节流记录当前章节的 scrollTop;用 ref 存最新值,避免每帧都 set store 触发 re-render
  const lastSavedScrollRef = useRef<number>(0)
  const onChapterScroll = useCallback(() => {
    if (!activeChapter) return
    const el = chapterScrollRef.current
    if (!el) return
    const top = el.scrollTop
    // 只有变化超过 4px 才记录,避免抖动
    if (Math.abs(top - lastSavedScrollRef.current) < 4) return
    lastSavedScrollRef.current = top
    rememberChapterScroll(activeChapter.id, top)
  }, [activeChapter, rememberChapterScroll])

  const projects = useEditorStore((s) => s.projects)
  const setProjects = useEditorStore((s) => s.setProjects)
  const currentProject = projects.find((p) => p.id === activeProjectId)

  const handleRegenerateOutline = () => {
    setIdeaOpen(true)
  }

  // Sync titleDraft when active chapter changes
  useLayoutEffect(() => {
    setTitleDraft(activeChapter?.title || '')
  }, [activeChapter?.title])

  useEffect(() => {
    if (activeChapter && !activeChapter.title) {
      titleRef.current?.focus()
    }
  }, [activeChapter?.id])

  // Sync summaryDraft when active chapter changes
  useEffect(() => {
    const s = activeChapter?.chapter_outline || ''
    setSummaryDraft(s)
    setSummaryOutline(s)
  }, [activeChapter?.chapter_outline])

  // Adjust summary textarea height when content changes
  useLayoutEffect(() => {
    const el = summaryRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    })
  }, [summaryDraft, editorView])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1] },
        orderedList: false,
        bulletList: false,
        listItem: false,
      }),
      Underline,
      StaticCursor,
      ParagraphNumberGutter,
      Placeholder.configure({
        placeholder: '开始写作...',
      }),
    ],
    content: normalizeChapterContentHtml(activeChapter?.content || ''),
    parseOptions: { preserveWhitespace: 'full' },
    onUpdate: ({ editor: ed }) => {
      if (isProgrammaticChange.current) return
      const html = ed.getHTML()
      if (activeChapter && html !== activeChapter.content) {
        updateChapterContent(activeChapter.id, html)
        if (!isDirty) setDirty(true)
        scheduleChapterSave(activeChapter.id)
      }
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[500px] py-4 relative inkark-chapter-editor',
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Tab') {
          event.preventDefault()
          view.dispatch(view.state.tr.insertText('    '))
          return true
        }
        return false
      },
      handleDOMEvents: {
        contextmenu: (view, event) => {
          const { from, to } = view.state.selection
          const selection = resolveChapterSelectionContext(view.state.doc, from, to)
          if (selection) {
            const chapterList = chaptersRef.current
            const chapterId = activeChapterIdRef.current
            const chapterIndex = chapterList.findIndex((c) => c.id === chapterId) + 1
            setCtxMenu({
              x: event.clientX,
              y: event.clientY,
              text: selection.text,
              source: 'editor',
              chapterIndex: chapterIndex > 0 ? chapterIndex : undefined,
              paragraphIndices: selection.paragraphIndices.length > 0 ? selection.paragraphIndices : undefined,
            })
            event.preventDefault()
            return true
          }
          return false
        },
      },
    },
  })

  useEffect(() => {
    if (editor) {
      setEditor(editor)
      return () => setEditor(null)
    }
  }, [editor])

  const font = useSettingsStore((s) => s.font)
  useEffect(() => {
    if (!editor) return
    const el = editor.view.dom
    el.style.fontFamily = `"${font.editorFont}"`
    el.style.fontSize = font.editorFontSize + 'px'
    el.style.lineHeight = String(font.editorLineHeight)
  }, [editor, font])

  const handleGenerateSummary = async () => {
    if (!activeChapter || !activeChapter.content) return
    const config = await window.electronAPI.apiConfig.getDefault()
    if (!config) { setGeneratingSummary(false); return }
    const fullText = activeChapter.content.replace(/<[^>]*>/g, '').trim()
    if (!fullText) { setGeneratingSummary(false); return }
    let firstToken = true
    streamChatCompletion({
      baseUrl: config.base_url,
      apiKey: config.api_key,
      model: config.model,
      messages: [
        { role: 'system', content: '将以下章节剧情浓缩为100字内的中文大纲，只关注人物、情节走向。只输出大纲内容，不要有多余内容。' },
        { role: 'user', content: fullText.slice(0, 8000) },
      ],
      temperature: 0.3,
      onToken: (token) => {
        if (firstToken) { setNewSummaryDraft(token); firstToken = false }
        else { setNewSummaryDraft((prev) => prev + token) }
      },
      onDone: () => setGeneratingSummary(false),
      onError: () => setGeneratingSummary(false),
    })
  }

  const handleUpdateSummary = async () => {
    if (!activeChapter || !newSummaryDraft.trim()) return
    await window.electronAPI.chapter.updateMeta({
      id: activeChapter.id,
      title: activeChapter.title,
      chapter_outline: newSummaryDraft.trim(),
      status: 'completed',
    })
    setSummaryDraft(newSummaryDraft.trim())
    setSummaryOutline(newSummaryDraft.trim())
    if (activeProjectId) loadChapters(activeProjectId)
    setShowNewSummary(false)
    setNewSummaryDraft('')
    if (activeProjectId) pushChange(activeProjectId, 'chapter_outline', activeChapter.id, `章节大纲更新：第${activeChapter.sort_order + 1}章`)
  }

  const handleCancelNewSummary = () => {
    setShowNewSummary(false)
    setNewSummaryDraft('')
    setGeneratingSummary(false)
  }

  const startChapterReview = useCallback(async (force = false) => {
    if (!activeChapter || !activeProjectId) return
    const chapterIndex = chapters.findIndex((c) => c.id === activeChapter.id) + 1
    if (chapterIndex <= 0) return
    const content = activeChapter.content || ''
    if (!content.replace(/<[^>]*>/g, '').trim()) {
      setReviewError('本章暂无正文，无法审稿')
      setReviewing(false)
      return
    }

    const targetChapterId = activeChapter.id
    reviewChapterIdRef.current = targetChapterId
    setReviewing(true)
    setReviewError('')
    if (force) setReviewDraft('')

    await runChapterReview({
      projectId: activeProjectId,
      chapterId: targetChapterId,
      chapterIndex,
      chapterTitle: activeChapter.title,
      content,
      force,
      onToken: () => {
        if (reviewChapterIdRef.current !== targetChapterId) return
        const cached = getChapterReview(targetChapterId)
        if (cached) setReviewDraft(cached.text)
      },
      onStatusChange: (status) => {
        if (reviewChapterIdRef.current !== targetChapterId) return
        if (status === 'running') setReviewing(true)
        if (status === 'done' || status === 'error' || status === 'idle') setReviewing(false)
      },
    }).then((result) => {
      if (reviewChapterIdRef.current !== targetChapterId) return
      if (result.status === 'done') {
        setReviewDraft(result.text)
        setReviewError('')
      } else if (result.status === 'error') {
        setReviewError(result.error || '审稿失败')
      }
      setReviewing(false)
    })
  }, [activeChapter, activeProjectId, chapters])

  const handleReviewClick = () => {
    if (!activeChapter) return
    if (showReviewPanel) {
      setShowReviewPanel(false)
      return
    }
    setShowReviewPanel(true)
    const cached = getChapterReview(activeChapter.id)
    if (cached?.status === 'done') {
      setReviewDraft(cached.text)
      setReviewError('')
      setReviewing(isChapterReviewRunning(activeChapter.id))
      return
    }
    if (isChapterReviewRunning(activeChapter.id)) {
      setReviewing(true)
      const running = getChapterReview(activeChapter.id)
      if (running?.text) setReviewDraft(running.text)
      return
    }
    void startChapterReview(false)
  }

  const handleReReview = () => {
    void startChapterReview(true)
  }

  const handleSendReviewToAI = () => {
    if (!activeChapter || !reviewDraft.trim()) return
    const chapterIndex = chapters.findIndex((c) => c.id === activeChapter.id) + 1
    setPendingAction({
      action: 'chapterReviewFix',
      text: '',
      chapterIndex: chapterIndex > 0 ? chapterIndex : undefined,
      reviewText: sanitizeReviewText(reviewDraft.trim()),
    })
  }

  const handleCloseReviewPanel = () => {
    setShowReviewPanel(false)
  }

  useEffect(() => {
    if (showNewSummary && activeChapter?.content) {
      setNewSummaryDraft('')
      setGeneratingSummary(true)
      handleGenerateSummary()
      setTimeout(() => newSummaryRef.current?.focus(), 100)
    }
  }, [showNewSummary])

  useEffect(() => {
    if (showNewSummary) {
      setShowNewSummary(false)
      setNewSummaryDraft('')
      setGeneratingSummary(false)
    }
    setShowReviewPanel(false)
    reviewChapterIdRef.current = activeChapterId
    const cached = activeChapterId ? getChapterReview(activeChapterId) : undefined
    setReviewDraft(cached?.status === 'done' ? cached.text : '')
    setReviewing(activeChapterId ? isChapterReviewRunning(activeChapterId) : false)
    setReviewError(cached?.status === 'error' ? (cached.error || '审稿失败') : '')
  }, [activeChapter?.id])

  useEffect(() => {
    if (!showReviewPanel || !activeChapterId) return
    if (!isChapterReviewRunning(activeChapterId)) return
    const timer = setInterval(() => {
      const cached = getChapterReview(activeChapterId)
      if (cached?.text) setReviewDraft(cached.text)
      if (cached?.status === 'done') {
        setReviewing(false)
        setReviewError('')
      } else if (cached?.status === 'error') {
        setReviewing(false)
        setReviewError(cached.error || '审稿失败')
      }
    }, 500)
    return () => clearInterval(timer)
  }, [showReviewPanel, activeChapterId, reviewing])

  const pendingChapterEdit = useEditorStore((s) => s.pendingChapterEdit)
  const chapterScrollMap = useEditorStore((s) => s.chapterScroll)
  const chapterScrollMapRef = useRef(chapterScrollMap)
  chapterScrollMapRef.current = chapterScrollMap
  const pendingEdit = pendingChapterEdit && pendingChapterEdit.chapterId === activeChapterId ? pendingChapterEdit : null

  const lastChapterIdRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!editor || !activeChapter) return
    isProgrammaticChange.current = true
    try {
      const normalized = normalizeChapterContentHtml(activeChapter.content || '')
      const current = editor.getHTML()
      if (current !== normalized) {
        editor.commands.setContent(normalized, false, { preserveWhitespace: 'full' })
      }
      const isChapterSwitch = lastChapterIdRef.current !== activeChapter.id
      lastChapterIdRef.current = activeChapter.id
      if (isChapterSwitch && (activeChapter.content || '') !== normalized) {
        updateChapterContent(activeChapter.id, normalized)
        const updated = useEditorStore.getState().chapters.find((c) => c.id === activeChapter.id)
        if (updated) {
          void window.electronAPI.chapter.save(updated)
        }
      }
      if (isChapterSwitch) {
        const savedScroll = chapterScrollMapRef.current[activeChapter.id]
        const scrollEl = chapterScrollRef.current
        if (scrollEl && typeof savedScroll === 'number') {
          const max = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
          scrollEl.scrollTop = Math.min(savedScroll, max)
        } else if (activeChapter.title) {
          editor.commands.focus('end')
        }
      }
    } finally {
      queueMicrotask(() => { isProgrammaticChange.current = false })
    }
  }, [activeChapter?.id, editor])

  const diffSegments = useMemo(() => {
    if (!pendingEdit) return []
    return computeDiff(pendingEdit.original, pendingEdit.modified)
  }, [pendingEdit])

  const diffContainerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (pendingEdit && diffContainerRef.current) {
      const container = diffContainerRef.current
      const firstChange = container.querySelector('[data-diff-type="del"], [data-diff-type="ins"]') as HTMLElement | null
      if (!firstChange) return
      firstChange.scrollIntoView({ block: 'start', behavior: 'instant' })
    }
  }, [pendingEdit])

  if (editorView === 'outline') {
    return (
      <TooltipProvider delayDuration={300}>
        <div className="floating-glass flex flex-1 flex-col overflow-hidden h-full min-h-0">
          <VolumeOutlineView />
          <div className="border-t border-border/40 px-4 py-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleRegenerateOutline}>
              生成大纲
            </Button>
          </div>
          <StatusBar />
          <BookIdeaDialog open={ideaOpen} onOpenChange={setIdeaOpen} />
        </div>
      </TooltipProvider>
    )
  }

  if (!editor) return null

  return (
    <TooltipProvider delayDuration={300}>
    <div className="floating-glass flex flex-1 flex-col overflow-hidden h-full min-h-0">
      <div className="flex h-11 shrink-0 items-center gap-0.5 px-3 border-b border-border/40">
        {pendingEdit && (
          <span className="text-xs font-medium text-amber-600 flex items-center gap-2 mr-2 shrink-0">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            变更待审阅
          </span>
        )}
        {!pendingEdit && (<>
          <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="加粗">
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="斜体">
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="下划线">
            <span className="text-xs font-bold leading-none" style={{ textDecoration: 'underline' }}>U</span>
          </ToolbarButton>
        </>)}
        <div className="ml-auto flex items-center gap-0.5">
          <ToolbarButton onClick={handleReviewClick} active={showReviewPanel} title="AI 审稿">
            <Eye className={`h-3.5 w-3.5 ${reviewing ? 'animate-pulse' : ''}`} />
          </ToolbarButton>
          <ToolbarButton onClick={() => setShowNewSummary(true)} title="总结本章">
            <FileText className="h-3.5 w-3.5" />
          </ToolbarButton>
          <div className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="撤销">
            <Undo className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="重做">
            <Redo className="h-3.5 w-3.5" />
          </ToolbarButton>
        </div>
      </div>
      <div className="sticky top-0 z-[5] border-b border-white/30 shrink-0" style={{ isolation: 'isolate' }}>
        <div className="mx-auto max-w-5xl 2xl:max-w-8xl px-6 py-4 flex items-baseline gap-2">
          <span className="text-xl font-bold shrink-0 tabular-nums">
            第{chapters.findIndex((c) => c.id === activeChapterId) + 1}章
          </span>
          <input
            ref={titleRef}
            value={titleDraft}
            onChange={(e) => {
              const v = e.target.value
              setTitleDraft(v)
              titleDraftRef.current = v
              // debounce 自动保存, 1s 没新输入就 flush 进 db
              scheduleOutlineSave(buildOutlineSaveTask(activeChapter, activeProjectId, loadChapters, titleDraftRef, summaryDraftRef, () => {}))
            }}
            onBlur={async () => {
              // 失焦立即 flush, 不等 debounce; 同时记 pushChange 用于 AI 上下文
              await flushOutlineSave(buildOutlineSaveTask(activeChapter, activeProjectId, loadChapters, titleDraftRef, summaryDraftRef, () => {
                if (activeProjectId) pushChange(activeProjectId, 'chapter_title', activeChapter!.id, `章节标题变更：第${activeChapter!.sort_order + 1}章 → ${titleDraftRef.current || '（空）'}`)
              }))
            }}
            placeholder="章节标题..."
            className="flex-1 bg-transparent border-0 outline-none text-xl font-bold placeholder:text-muted-foreground/30 tracking-tight min-w-0"
          />
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {activeChapter?.word_count || 0} 字
          </span>
        </div>
      </div>
      <div ref={chapterScrollRef} onScroll={onChapterScroll} className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-5xl 2xl:max-w-8xl">
          <div className="px-6 py-3">
            <textarea
              ref={summaryRef}
              value={summaryDraft}
              onChange={(e) => {
                const v = e.target.value
                setSummaryDraft(v)
                summaryDraftRef.current = v
                setSummaryOutline(v)
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = el.scrollHeight + 'px'
                // debounce 自动保存, 1s 没新输入就 flush 进 db
                scheduleOutlineSave(buildOutlineSaveTask(activeChapter, activeProjectId, loadChapters, titleDraftRef, summaryDraftRef, () => {}))
              }}
              onBlur={async () => {
                // 失焦立即 flush, 不等 debounce; 同时记 pushChange 用于 AI 上下文
                await flushOutlineSave(buildOutlineSaveTask(activeChapter, activeProjectId, loadChapters, titleDraftRef, summaryDraftRef, () => {
                  if (activeProjectId) pushChange(activeProjectId, 'chapter_outline', activeChapter!.id, `章节大纲更新：第${activeChapter!.sort_order + 1}章`)
                }))
              }}
              placeholder="章节大纲（可选，AI 生成或自行编写）"
              style={{ fontFamily: `"${font.editorFont}"`, fontSize: font.editorFontSize + 'px' }}
              className="w-full bg-slate-50/60 border border-border/40 rounded-md px-3 py-2 resize-none overflow-hidden focus:outline-none focus:border-primary/40"
            />
            {showReviewPanel && (
              <div className="mt-2 border border-border/40 rounded-md p-3 bg-slate-50/40">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">AI 审稿意见</span>
                  {reviewing && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> 审稿中...
                    </span>
                  )}
                </div>
                {reviewError && (
                  <div className="mb-2 text-xs text-destructive">{reviewError}</div>
                )}
                <div
                  className="w-full bg-white/60 border border-border/40 rounded-md px-3 py-2 text-sm min-h-[200px] max-h-[480px] overflow-y-auto prose prose-sm max-w-none prose-headings:text-foreground prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-hr:my-2 prose-strong:text-foreground"
                  style={{ fontFamily: `"${font.editorFont}"`, fontSize: font.editorFontSize + 'px' }}
                >
                  {reviewDraft ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{reviewDraft}</ReactMarkdown>
                  ) : (
                    reviewing ? '正在审查，预计半分钟...' : '暂无审稿意见'
                  )}
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <Button variant="outline" size="sm" className="h-7 text-xs rounded-md" onClick={handleCloseReviewPanel}>
                    <X className="h-3 w-3 mr-1" /> 关闭
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs rounded-md" onClick={handleReReview} disabled={reviewing}>
                    <RotateCcw className="h-3 w-3 mr-1" /> 重新审稿
                  </Button>
                  <Button size="sm" className="h-7 text-xs rounded-md" onClick={handleSendReviewToAI} disabled={!reviewDraft.trim() || reviewing}>
                    <Send className="h-3 w-3 mr-1" /> 发送 AI 修改
                  </Button>
                </div>
              </div>
            )}
            {showNewSummary && (
              <div className="mt-2 border border-border/40 rounded-md p-3 bg-slate-50/40">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">生成新大纲</span>
                  {generatingSummary && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> 生成中...
                    </span>
                  )}
                </div>
                <textarea
                  ref={newSummaryRef}
                  value={newSummaryDraft}
                  onChange={(e) => {
                    setNewSummaryDraft(e.target.value)
                    const el = e.currentTarget
                    el.style.height = 'auto'
                    el.style.height = el.scrollHeight + 'px'
                  }}
                   placeholder={generatingSummary ? "正在总结大纲..." : "新大纲将显示在此处，可手动编辑..."}
                  style={{ fontFamily: `"${font.editorFont}"`, fontSize: font.editorFontSize + 'px' }}
                  className="w-full bg-white/60 border border-border/40 rounded-md px-3 py-2 resize-none overflow-hidden focus:outline-none focus:border-primary/40"
                />
                <div className="flex justify-end gap-2 mt-2">
                  <Button variant="outline" size="sm" className="h-7 text-xs rounded-md" onClick={handleCancelNewSummary}>
                    <X className="h-3 w-3 mr-1" /> 取消
                  </Button>
                  <Button size="sm" className="h-7 text-xs rounded-md" onClick={handleUpdateSummary} disabled={!newSummaryDraft.trim() || generatingSummary}>
                    <Check className="h-3 w-3 mr-1" /> 更新大纲
                  </Button>
                </div>
              </div>
            )}
          </div>
          {pendingEdit ? (
            <ChapterDiffView segments={diffSegments} containerRef={diffContainerRef} />
          ) : (
            <div className="px-6 py-3">
              <EditorContent editor={editor} />
            </div>
          )}
        </div>
      </div>
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <StatusBar />
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          selectedText={ctxMenu.text}
          chapterIndex={ctxMenu.chapterIndex}
          paragraphIndices={ctxMenu.paragraphIndices}
          mode="chapter"
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
    </TooltipProvider>
  )
}

function ChapterDiffView({
  segments,
  containerRef,
}: {
  segments: DiffSegment[]
  containerRef: RefObject<HTMLDivElement | null>
}) {
  let paragraphIndex = 1
  let showParaNum = true

  return (
    <div
      ref={containerRef}
      className="inkark-diff-view px-6 py-3 text-sm leading-relaxed overflow-y-auto flex-1"
      style={{ fontFamily: 'var(--font-editor, monospace)' }}
    >
      {segments.map((d, i) => {
        if (d.type === 'para_break') {
          paragraphIndex++
          showParaNum = true
          return (
            <div key={i} data-diff-type={d.type} className="flex items-center gap-2 my-1 -mx-2 px-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] text-muted-foreground shrink-0">&#182;</span>
            </div>
          )
        }
        const paraNum = showParaNum ? paragraphIndex : null
        showParaNum = false
        return (
          <div
            key={i}
            data-diff-type={d.type}
            className={`para-gutter-host py-1 px-2 -mx-2 rounded ${
              d.type === 'del' ? 'bg-red-50 text-red-700' :
              d.type === 'ins' ? 'bg-green-50 text-green-700' : ''
            }`}
            style={d.type === 'del' || d.type === 'ins' ? { scrollMarginTop: '25vh' } : undefined}
          >
            {paraNum != null && (
              <span className="para-gutter-num" aria-hidden="true">{paraNum}</span>
            )}
            {d.text || '\u00A0'}
          </div>
        )
      })}
    </div>
  )
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground transition-colors ${
            active ? 'bg-accent/80 text-accent-foreground' : ''
          }`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{title}</TooltipContent>
    </Tooltip>
  )
}
