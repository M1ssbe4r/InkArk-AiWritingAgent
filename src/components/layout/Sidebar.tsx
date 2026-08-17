import { useState, useEffect, useRef, useLayoutEffect, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/stores/appStore'
import { useEditorStore } from '@/stores/editorStore'
import { CharacterPanel } from '@/components/character/CharacterPanel'
import { WorldPanel } from '@/components/world/WorldPanel'
import { KnowledgePanel } from '@/components/knowledge/KnowledgePanel'
import { cn, generateId } from '@/lib/utils'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { Plus, BookOpen, User, Globe, Palette, Edit3, XCircle, FileText, Ban, Search, Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { StylePanel } from '@/components/style/StylePanel'

// Module-level 共享右键菜单状态：所有 ChapterItem 共享同一个菜单，避免多次右键时多个菜单叠加
type SharedCtxMenu = {
  x: number
  y: number
  chapter: any
  onDelete: (e: ReactMouseEvent) => void
}
let sharedCtxMenu: SharedCtxMenu | null = null
const ctxMenuListeners = new Set<(m: SharedCtxMenu | null) => void>()
function setSharedCtxMenu(m: SharedCtxMenu | null) {
  sharedCtxMenu = m
  ctxMenuListeners.forEach((l) => l(m))
}
import { RestrictionsPanel } from '@/components/restrictions/RestrictionsPanel'
import { pushChange, flushChapterSave, resolvePendingDiff } from '@/lib/editorRef'

export function Sidebar({ width }: { width?: number }) {
  const { sidebarView, setSidebarView, editorView, setEditorView } = useAppStore()
  const chapters = useEditorStore((s) => s.chapters)
  const activeChapterId = useEditorStore((s) => s.activeChapterId)
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const setActiveChapter = useEditorStore((s) => s.setActiveChapter)
  const loadChapters = useEditorStore((s) => s.loadChapters)
  const [search, setSearch] = useState('')

  const handleNewChapter = async () => {
    if (!activeProjectId) return
    const currentChapters = useEditorStore.getState().chapters
    const newChapter = {
      id: generateId(),
      project_id: activeProjectId,
      title: '',
      content: '',
      chapter_outline: '',
      sort_order: currentChapters.length,
      status: 'draft',
      word_count: 0,
    }
    await window.electronAPI.chapter.save(newChapter)
    useEditorStore.getState().setChapters([...currentChapters, newChapter])
    setActiveChapter(newChapter.id)
    pushChange(activeProjectId, 'chapter_create', newChapter.id, '新增章节')
  }

  const handleDeleteChapter = async (chapterId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const ch = chapters.find((c) => c.id === chapterId)
    const store = useEditorStore.getState()
    if (store.pendingChapterEdit) {
      resolvePendingDiff('revert', '章节已删除')
      store.setPendingChapterEdit(null)
    }
    await flushChapterSave()
    await window.electronAPI.chapter.delete(chapterId)
    if (activeProjectId) await loadChapters(activeProjectId)
    if (activeProjectId && ch) pushChange(activeProjectId, 'chapter_delete', chapterId, `删除章节：${ch.title || '未命名'}`)
  }

  if (sidebarView === 'none') return null

  return (
    <TooltipProvider delayDuration={300}>
    <div className="floating-glass flex h-full flex-col overflow-hidden" style={{ width }}>
      <div className="flex h-12 items-center justify-between px-3 border-b border-white/30">
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSidebarView('outline')}
                className={cn('flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/50 hover:text-foreground', sidebarView === 'outline' && 'bg-white/60 text-foreground')}
              >
                <BookOpen className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">目录</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSidebarView('characters')}
                className={cn('flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/50 hover:text-foreground', sidebarView === 'characters' && 'bg-white/60 text-foreground')}
              >
                <User className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">角色</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSidebarView('world')}
                className={cn('flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/50 hover:text-foreground', sidebarView === 'world' && 'bg-white/60 text-foreground')}
              >
                <Globe className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">世界观</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSidebarView('style')}
                className={cn('flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/50 hover:text-foreground', sidebarView === 'style' && 'bg-white/60 text-foreground')}
              >
                <Palette className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">写作风格</TooltipContent>
          </Tooltip>
           <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSidebarView('restrictions')}
                className={cn('flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/50 hover:text-foreground', sidebarView === 'restrictions' && 'bg-white/60 text-foreground')}
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">规则</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSidebarView('knowledge')}
                className={cn('flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/50 hover:text-foreground', sidebarView === 'knowledge' && 'bg-white/60 text-foreground')}
              >
                <Database className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">知识库</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {sidebarView === 'outline' && (
          <>
            <div className="flex items-center gap-1 pr-2 pl-3 py-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索章节..." className="h-7 pl-7 text-xs bg-white/40 border-white/40 rounded-md shadow-none focus-visible:shadow-none" />
              </div>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-md hover:bg-white/50" onClick={handleNewChapter}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div
              className={`group mx-2 flex items-center gap-1.5 rounded-lg border px-2.5 py-2 cursor-pointer transition-all shadow-md hover:shadow-lg ${
                editorView === 'outline'
                  ? 'bg-white/80 text-foreground border-primary/30 shadow-lg'
                  : 'bg-white/50 text-foreground border-white/50 hover:bg-white/70 hover:border-white/70'
              }`}
              onClick={() => setEditorView('outline')}
            >
              <span className={`shrink-0 flex h-5 w-5 items-center justify-center rounded ${
                editorView === 'outline' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
              }`}>
                <FileText className="h-3 w-3" />
              </span>
              <span className="text-[13px] font-semibold">全书大纲</span>
            </div>
            <div className="h-px bg-white/30 mx-3 my-1" />
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-0.5">
                {chapters
                  .map((chapter, originalIndex) => ({ chapter, originalIndex }))
                  .filter(({ chapter, originalIndex }) => {
                    if (!search) return true
                    const q = search.trim()
                    if (String(originalIndex + 1) === q) return true
                    return (chapter.title || '').includes(q)
                  })
                  .map(({ chapter, originalIndex }) => (
                    <ChapterItem
                      key={chapter.id}
                      chapter={chapter}
                      index={originalIndex + 1}
                      isActive={activeChapterId === chapter.id && editorView === 'chapter'}
                      onSelect={() => { setActiveChapter(chapter.id); setEditorView('chapter') }}
                      onDelete={(e) => handleDeleteChapter(chapter.id, e)}
                    />
                  ))}
              </div>
            </ScrollArea>
          </>
        )}
        {sidebarView === 'characters' && <ErrorBoundary><CharacterPanel /></ErrorBoundary>}
        {sidebarView === 'world' && <WorldPanel />}
        {sidebarView === 'style' && <StylePanel />}
        {sidebarView === 'restrictions' && <RestrictionsPanel />}
        {sidebarView === 'knowledge' && <ErrorBoundary><KnowledgePanel /></ErrorBoundary>}
      </div>
      <SharedChapterCtxMenu />
    </div>
    </TooltipProvider>
  )
}

function ChapterItem({
  chapter, index, isActive, onSelect, onDelete,
}: {
  chapter: any; index: number; isActive: boolean; onSelect: () => void; onDelete: (e: React.MouseEvent) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(chapter.title)
  const loadChapters = useEditorStore((s) => s.loadChapters)
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const hasPendingEdit = useEditorStore((s) => s.pendingChapterEdit?.chapterId === chapter.id)

  const saveTitle = async () => {
    const title = editTitle.trim()
    await window.electronAPI.chapter.updateMeta({ id: chapter.id, title, chapter_outline: chapter.chapter_outline, status: chapter.status })
    if (activeProjectId) loadChapters(activeProjectId)
    setEditing(false)
    if (activeProjectId) pushChange(activeProjectId, 'chapter_title', chapter.id, `章节标题变更：第${index}章 → ${title || '（空）'}`)
  }

  if (editing) {
    return (
      <div className="flex items-center rounded-md px-2 py-1.5 bg-white/60">
        <span className="w-7 text-left text-[10px] text-muted-foreground shrink-0 tabular-nums">{index}</span>
        <div className="flex-1 min-w-0">
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="h-7 text-xs px-2 py-0 border-white/40 bg-white/60 shadow-sm"
            autoFocus
            onKeyDown={async (e) => {
              if (e.key === 'Enter') { e.preventDefault(); await saveTitle() }
              if (e.key === 'Escape') { setEditing(false); setEditTitle(chapter.title) }
            }}
            onBlur={saveTitle}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`group flex items-center rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
        isActive ? 'bg-white/70 text-foreground shadow-sm' : 'hover:bg-white/40 text-foreground/80'
      }`}
      onClick={onSelect}
      onDoubleClick={() => { setEditing(true); setEditTitle(chapter.title) }}
      onContextMenu={(e) => {
        e.preventDefault()
        setSharedCtxMenu({ x: e.clientX, y: e.clientY, chapter, onDelete })
      }}
    >
      <span className="w-7 text-left text-[10px] text-muted-foreground shrink-0 tabular-nums">{index}</span>
      <div className="flex-1 min-w-0 overflow-hidden" title={chapter.title}>
        <div className={`text-xs whitespace-nowrap overflow-hidden mask-fade-right ${hasPendingEdit ? 'text-amber-600' : ''}`}>{chapter.title || '未命名'}</div>
      </div>
    </div>
  )
}

// 共享的章节右键菜单（用 module-level 单例 + portal 解决叠加和裁切）
function SharedChapterCtxMenu() {
  const [menu, setMenu] = useState<SharedCtxMenu | null>(sharedCtxMenu)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const activeProjectId = useEditorStore((s) => s.activeProjectId)

  useEffect(() => {
    const l = (m: SharedCtxMenu | null) => {
      setMenu(m)
      setEditing(false)
      setEditTitle(m?.chapter.title || '')
    }
    ctxMenuListeners.add(l)
    return () => { ctxMenuListeners.delete(l) }
  }, [])

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) {
      setPos(null)
      return
    }
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const padding = 8
    let left = menu.x
    let top = menu.y
    if (left + rect.width + padding > vw) left = Math.max(padding, vw - rect.width - padding)
    if (top + rect.height + padding > vh) top = Math.max(padding, vh - rect.height - padding)
    setPos({ left, top })
  }, [menu])

  // 全局 mousedown：点菜单内部不关，点菜单外部关
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSharedCtxMenu(null)
      }
    }
    // 用 mousedown 而不是 click：避免右键触发后又立刻被 click 关闭
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  if (!menu) return null

  if (editing) {
    return createPortal(
      <div
        ref={menuRef}
        className="fixed z-50 w-48 rounded-md border bg-popover p-1 shadow-md"
        style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          autoFocus
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter') {
              const title = editTitle.trim()
              if (title) {
                await window.electronAPI.chapter.updateMeta({ id: menu.chapter.id, title, chapter_outline: menu.chapter.chapter_outline, status: menu.chapter.status })
                if (activeProjectId) useEditorStore.getState().loadChapters(activeProjectId)
              }
              setSharedCtxMenu(null)
            } else if (e.key === 'Escape') {
              setSharedCtxMenu(null)
            }
          }}
          onBlur={async () => {
            const title = editTitle.trim()
            if (title && title !== menu.chapter.title) {
              await window.electronAPI.chapter.updateMeta({ id: menu.chapter.id, title, chapter_outline: menu.chapter.chapter_outline, status: menu.chapter.status })
              if (activeProjectId) useEditorStore.getState().loadChapters(activeProjectId)
            }
            setSharedCtxMenu(null)
          }}
          className="h-7 text-xs"
        />
      </div>,
      document.body
    )
  }

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 w-32 rounded-md border bg-popover p-1 shadow-md"
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent"
        onClick={() => { setEditTitle(menu.chapter.title); setEditing(true) }}
      >
        <Edit3 className="h-3.5 w-3.5" /> 重命名
      </button>
      <button
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent text-destructive"
        onClick={(e) => { setSharedCtxMenu(null); menu.onDelete(e) }}
      >
        <XCircle className="h-3.5 w-3.5" /> 删除
      </button>
    </div>,
    document.body
  )
}
