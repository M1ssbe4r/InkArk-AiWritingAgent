import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type { OutlineVolume } from '@/types'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { computeDiff } from '@/lib/diffUtils'
import { registerVolumeSaveFlush, unregisterVolumeSaveFlush } from '@/lib/editorRef'
import { Button } from '@/components/ui/button'

const STATUS_LABEL: Record<string, string> = {
  planned: '规划中',
  writing: '写作中',
  done: '已完成',
  paused: '暂停',
}

function formatChapterDraft(value: number | null | undefined): string {
  return value != null ? String(value) : ''
}

function parseChapterDraft(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 1) return null
  return Math.trunc(n)
}

function validateChapterRange(start: number | null, end: number | null): string | null {
  if (start != null && end != null && start > end) {
    return '起始章节不能大于结束章节'
  }
  return null
}

interface PendingSummaryEdit {
  original: string
  modified: string
  summary: string
  // AI 提议的其他字段变更(title / chapter_start / chapter_end / status / progress_notes)
  pendingMeta?: Partial<OutlineVolume>
}

interface VolumeAccordionItemProps {
  volume: OutlineVolume
  index: number
  expanded: boolean
  onToggle: () => void
  onSave: (patch: Partial<OutlineVolume>) => void
  onDelete: () => void
  pendingSummaryEdit?: PendingSummaryEdit | null
}

export function VolumeAccordionItem({
  volume,
  index,
  expanded,
  onToggle,
  onSave,
  onDelete,
  pendingSummaryEdit,
}: VolumeAccordionItemProps) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const diffContainerRef = useRef<HTMLDivElement>(null)

  // 卷名本地 draft: 跟着章节标题的模式, 输入先到本地 state, 渲染时 value 跟本地一致,
  // 不会被外层 store prop 覆盖,IME 合成过程不会被父组件 re-render 打断。
  // 切卷(volume.id 变)或失焦时同步外部最新值。
  const [titleDraft, setTitleDraft] = useState(volume.title)
  const titleDraftRef = useRef(volume.title)
  useEffect(() => {
    setTitleDraft(volume.title)
  }, [volume.id])
  useEffect(() => {
    titleDraftRef.current = titleDraft
  }, [titleDraft])

  const [progressDraft, setProgressDraft] = useState(volume.progress_notes)
  const progressDraftRef = useRef(volume.progress_notes)
  useEffect(() => {
    setProgressDraft(volume.progress_notes)
  }, [volume.id])
  useEffect(() => {
    progressDraftRef.current = progressDraft
  }, [progressDraft])

  const [chapterStartDraft, setChapterStartDraft] = useState(() => formatChapterDraft(volume.chapter_start))
  const [chapterEndDraft, setChapterEndDraft] = useState(() => formatChapterDraft(volume.chapter_end))
  useEffect(() => {
    setChapterStartDraft(formatChapterDraft(volume.chapter_start))
    setChapterEndDraft(formatChapterDraft(volume.chapter_end))
  }, [volume.id])

  const persistChapterRange = (field: 'start' | 'end') => {
    const start = parseChapterDraft(chapterStartDraft)
    const end = parseChapterDraft(chapterEndDraft)
    const err = validateChapterRange(start, end)
    if (err) {
      if (field === 'start') {
        setChapterStartDraft(formatChapterDraft(volume.chapter_start))
      } else {
        setChapterEndDraft(formatChapterDraft(volume.chapter_end))
      }
      return
    }
    const patch: Partial<OutlineVolume> = {}
    if (start !== volume.chapter_start) patch.chapter_start = start
    if (end !== volume.chapter_end) patch.chapter_end = end
    if (Object.keys(patch).length > 0) onSave(patch)
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Placeholder.configure({ placeholder: '卷级大纲…' }),
    ],
    content: volume.outline || '',
    editable: !pendingSummaryEdit,
    onUpdate: ({ editor: ed }) => {
      if (pendingSummaryEdit) return
      const html = ed.getHTML()
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => onSave({ outline: html }), 1000)
    },
  }, [volume.id, pendingSummaryEdit])

  useEffect(() => {
    if (editor && expanded && !pendingSummaryEdit) {
      const cur = editor.getHTML()
      const target = volume.outline || ''
      if (cur !== target) {
        editor.commands.setContent(target, false)
      }
    }
  }, [volume.id, volume.outline, expanded, editor, pendingSummaryEdit])

  useEffect(() => {
    if (pendingSummaryEdit && diffContainerRef.current) {
      const firstChange = diffContainerRef.current.querySelector('[data-diff-type="del"], [data-diff-type="ins"]') as HTMLElement | null
      firstChange?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    }
  }, [pendingSummaryEdit])

  const editorRef = useRef(editor)
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!expanded) {
      unregisterVolumeSaveFlush(volume.id)
      return
    }
    registerVolumeSaveFlush(volume.id, async () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current)
      const patch: Partial<OutlineVolume> = {}
      if (titleDraftRef.current !== volume.title) patch.title = titleDraftRef.current
      const ed = editorRef.current
      if (ed && !ed.isDestroyed) {
        const html = ed.getHTML()
        if (html !== volume.outline) patch.outline = html
      }
      const progressValue = textareaRef.current?.value ?? progressDraftRef.current
      if (progressValue !== volume.progress_notes) patch.progress_notes = progressValue
      const start = parseChapterDraft(chapterStartDraft)
      const end = parseChapterDraft(chapterEndDraft)
      if (validateChapterRange(start, end) === null) {
        if (start !== volume.chapter_start) patch.chapter_start = start
        if (end !== volume.chapter_end) patch.chapter_end = end
      }
      if (Object.keys(patch).length > 0) {
        await onSave(patch)
      }
    })
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current)
      unregisterVolumeSaveFlush(volume.id)
    }
  }, [expanded, volume.id, volume.title, volume.outline, volume.progress_notes, volume.chapter_start, volume.chapter_end, chapterStartDraft, chapterEndDraft, onSave])

  const diffSegments = useMemo(() => {
    if (!pendingSummaryEdit) return []
    return computeDiff(pendingSummaryEdit.original, pendingSummaryEdit.modified)
  }, [pendingSummaryEdit])

  const rangeLabel = useMemo(() => {
    if (volume.chapter_start != null && volume.chapter_end != null) {
      return `第 ${volume.chapter_start}–${volume.chapter_end} 章`
    }
    return '未绑定章节'
  }, [volume.chapter_start, volume.chapter_end])

  return (
    <div className="border-b border-border/40">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/40"
        onClick={onToggle}
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="flex-1 font-medium text-sm truncate">第 {index + 1} 卷：{volume.title}</span>
        {pendingSummaryEdit && (
          <span className="flex items-center gap-1 text-xs font-medium text-amber-600 shrink-0">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            变更待审阅
          </span>
        )}
        <span className="text-xs text-muted-foreground">{rangeLabel}</span>
        <span className={cn('rounded px-1.5 py-0.5 text-xs', {
          'bg-muted text-muted-foreground': volume.status === 'planned',
          'bg-blue-500/15 text-blue-600 dark:text-blue-400': volume.status === 'writing',
          'bg-green-500/15 text-green-600 dark:text-green-400': volume.status === 'done',
          'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400': volume.status === 'paused',
        })}>
          {STATUS_LABEL[volume.status] || volume.status}
        </span>
      </button>
      {expanded && (
        <div className="space-y-3 px-4 pb-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
            <div className="flex items-center gap-1.5 sm:col-span-6">
              <span className="text-xs text-muted-foreground shrink-0">卷名</span>
              <input
                className="flex-1 min-w-0 rounded border border-input bg-background px-2 py-1 text-sm"
                value={titleDraft}
                placeholder="天降神兵"
                disabled={!!pendingSummaryEdit}
                onChange={(e) => {
                  const v = e.target.value
                  setTitleDraft(v)
                  // debounce 写回 store,800ms 静默后再持久化;这样 IME 合成期间父组件
                  // 不会 re-render,合成结果不会被外部 value 覆盖。
                  if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
                  titleTimerRef.current = setTimeout(() => onSave({ title: v }), 800)
                }}
                onBlur={() => {
                  // 失焦立即 flush,不等 debounce
                  if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
                  onSave({ title: titleDraft })
                }}
              />
            </div>
            <div className="flex items-center gap-1.5 sm:col-span-2">
              <span className="text-xs text-muted-foreground shrink-0">起始</span>
              <input
                type="text"
                inputMode="numeric"
                className="w-16 rounded border border-input bg-background px-2 py-1 text-sm"
                placeholder="章"
                value={chapterStartDraft}
                disabled={!!pendingSummaryEdit}
                onChange={(e) => setChapterStartDraft(e.target.value)}
                onBlur={() => persistChapterRange('start')}
              />
            </div>
            <div className="flex items-center gap-1.5 sm:col-span-2">
              <span className="text-xs text-muted-foreground shrink-0">结束</span>
              <input
                type="text"
                inputMode="numeric"
                className="w-16 rounded border border-input bg-background px-2 py-1 text-sm"
                placeholder="章"
                value={chapterEndDraft}
                disabled={!!pendingSummaryEdit}
                onChange={(e) => setChapterEndDraft(e.target.value)}
                onBlur={() => persistChapterRange('end')}
              />
            </div>
            <select
              className="sm:col-span-2 rounded border border-input bg-background px-2 py-1 text-sm"
              value={volume.status}
              disabled={!!pendingSummaryEdit}
              onChange={(e) => onSave({ status: e.target.value as OutlineVolume['status'] })}
            >
              <option value="planned">规划中</option>
              <option value="writing">写作中</option>
              <option value="done">已完成</option>
              <option value="paused">暂停</option>
            </select>
          </div>
          {pendingSummaryEdit ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5">
              <p className="border-b border-amber-500/30 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-200">
                {pendingSummaryEdit.summary}
              </p>
              {pendingSummaryEdit.pendingMeta && (
                <div className="border-b border-amber-500/30 px-3 py-2 text-xs space-y-1 text-muted-foreground">
                  {pendingSummaryEdit.pendingMeta.title !== undefined && (
                    <div>卷名：<span className="line-through opacity-70">{volume.title || '(空)'}</span> → <span className="text-foreground">{pendingSummaryEdit.pendingMeta.title || '(空)'}</span></div>
                  )}
                  {pendingSummaryEdit.pendingMeta.chapter_start !== undefined && (
                    <div>起始：<span className="line-through opacity-70">{volume.chapter_start ?? '(未设)'}</span> → <span className="text-foreground">{pendingSummaryEdit.pendingMeta.chapter_start ?? '(未设)'}</span></div>
                  )}
                  {pendingSummaryEdit.pendingMeta.chapter_end !== undefined && (
                    <div>结束：<span className="line-through opacity-70">{volume.chapter_end ?? '(未设)'}</span> → <span className="text-foreground">{pendingSummaryEdit.pendingMeta.chapter_end ?? '(未设)'}</span></div>
                  )}
                  {pendingSummaryEdit.pendingMeta.status !== undefined && (
                    <div>状态：<span className="line-through opacity-70">{STATUS_LABEL[volume.status] || volume.status}</span> → <span className="text-foreground">{STATUS_LABEL[pendingSummaryEdit.pendingMeta.status] || pendingSummaryEdit.pendingMeta.status}</span></div>
                  )}
                  {pendingSummaryEdit.pendingMeta.progress_notes !== undefined && (
                    <div>进度：<span className="line-through opacity-70">{volume.progress_notes || '(空)'}</span> → <span className="text-foreground">{pendingSummaryEdit.pendingMeta.progress_notes || '(空)'}</span></div>
                  )}
                </div>
              )}
              <div
                ref={diffContainerRef}
                className="max-h-[min(50vh,480px)] overflow-y-auto px-3 py-2 text-sm leading-relaxed"
              >
                {diffSegments.map((d, i) =>
                  d.type === 'para_break' ? (
                    <div key={i} data-diff-type={d.type} className="flex items-center gap-2 my-1">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[10px] text-muted-foreground shrink-0">&#182;</span>
                    </div>
                  ) : (
                    <div
                      key={i}
                      data-diff-type={d.type}
                      className={cn('py-1 px-2 -mx-2 rounded', {
                        'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300': d.type === 'del',
                        'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300': d.type === 'ins',
                      })}
                      style={d.type === 'del' || d.type === 'ins' ? { scrollMarginTop: '8rem' } : undefined}
                    >
                      {d.text || '\u00A0'}
                    </div>
                  ),
                )}
              </div>
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none min-h-[120px] rounded-md border border-input p-2">
              <EditorContent editor={editor} />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">进度备注</label>
            <textarea
              ref={textareaRef}
              className="w-full resize-none rounded border border-input bg-background px-2 py-1 text-sm min-h-[60px]"
              value={progressDraft}
              disabled={!!pendingSummaryEdit}
              onChange={(e) => {
                const v = e.target.value
                setProgressDraft(v)
                if (progressTimerRef.current) clearTimeout(progressTimerRef.current)
                progressTimerRef.current = setTimeout(() => onSave({ progress_notes: v }), 800)
              }}
              onBlur={() => {
                if (progressTimerRef.current) clearTimeout(progressTimerRef.current)
                onSave({ progress_notes: progressDraftRef.current })
              }}
            />
          </div>
          {!pendingSummaryEdit && (
            <div className="flex justify-end border-t border-border/40 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                删除卷
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
