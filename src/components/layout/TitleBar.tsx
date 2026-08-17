import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Square, X, BookOpen, Settings, ChevronDown, Plus, Pencil, Trash2, History, HelpCircle, Download, Bug, Search } from 'lucide-react'
import { useAppStore } from '@/stores/appStore'
import { useEditorStore } from '@/stores/editorStore'
import { useCommandPalette } from '@/stores/commandPaletteStore'
import { generateId, countChars, cn } from '@/lib/utils'
import { getEditor, flushChapterSave, flushVolumeSave, clearChanges } from '@/lib/editorRef'
import { BookIdeaDialog } from '@/components/outline/BookIdeaDialog'
import { ProjectCommits } from '@/components/layout/ProjectCommits'
import { HelpDialog } from '@/components/layout/HelpDialog'
import { ImportProjectDialog } from '@/components/layout/ImportProjectDialog'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface TitleBarProps {
  onSettingsClick?: () => void
}

export function TitleBar({ onSettingsClick }: TitleBarProps) {
  const isMac = window.electronAPI?.platform === 'darwin'
  const { setSidebarView, sidebarView, setDebugMode, setExportOpen } = useAppStore()
  const { projects, activeProjectId, setProjects, setActiveProject } = useEditorStore()
  const openCommandPalette = useCommandPalette((s) => s.setOpen)
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')
  const [ideaOpen, setIdeaOpen] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const debugClickRef = useRef({ count: 0, lastTime: 0 })

  useEffect(() => {
    if (renaming && inputRef.current) { inputRef.current.focus(); inputRef.current.select() }
  }, [renaming])

  useEffect(() => {
    if (activeProjectId) {
      window.electronAPI.version.setActiveProject(activeProjectId)
    }
  }, [activeProjectId])

  useEffect(() => {
    return () => { if (statusTimer.current) clearTimeout(statusTimer.current) }
  }, [])

  const showStatus = (msg: string) => {
    setStatusMsg(msg)
    if (statusTimer.current) clearTimeout(statusTimer.current)
    statusTimer.current = setTimeout(() => setStatusMsg(''), 2500)
  }

  const openFeedback = () => {
    window.open('https://github.com/M1ssbe4r/InkArk-AiWritingAgent/issues', '_blank', 'noopener')
  }

  const handleRename = async () => {
    if (!renameText.trim() || !activeProject) return
    const updated = { ...activeProject, title: renameText.trim() }
    await window.electronAPI.project.update({ id: activeProject.id, title: renameText.trim() })
    setProjects(projects.map((p) => (p.id === updated.id ? updated : p)))
    setRenaming(false)
  }

  const handleDelete = async () => {
    if (!activeProject || projects.length <= 1) return
    const ok = await window.electronAPI.dialog.confirm(`确定删除「${activeProject.title}」？\n所有章节及角色设定将被永久删除。`)
    if (!ok) return
    const store = useEditorStore.getState()
    store.setPendingChapterEdit(null)
    store.setPendingVolumeEdit(null)
    clearChanges(activeProject.id)
    localStorage.removeItem(`ai-chat-history-${activeProject.id}`)
    await window.electronAPI.project.delete(activeProject.id)
    const remaining = projects.filter((p) => p.id !== activeProject.id)
    setProjects(remaining)
    await setActiveProject(remaining[0].id)
    setMenuOpen(false)
  }

  const handleImport = async () => {
    setMenuOpen(false)
    setImportDialogOpen(true)
  }

  const handleImported = async (projectId: string) => {
    const projects = await window.electronAPI.project.list()
    setProjects(projects)
    await setActiveProject(projectId)
    showStatus('导入成功')
  }

  const handleCreate = async () => {
    const project = { id: generateId(), title: '新作品' }
    await window.electronAPI.project.create(project)
    const firstChapter = {
      id: generateId(), project_id: project.id,
      title: '', content: '', chapter_outline: '', sort_order: 0, status: 'draft', word_count: 0,
    }
    await window.electronAPI.chapter.save(firstChapter)
    setProjects([...projects, project])
    await setActiveProject(project.id)
    setMenuOpen(false)
    setIdeaOpen(true)
  }

  const handleSwitch = async (id: string) => {
    await setActiveProject(id)
    setMenuOpen(false)
  }

  const handleMinimize = () => window.electronAPI?.minimize()
  const handleMaximize = () => window.electronAPI?.maximize()
  const handleClose = async () => {
    if (activeProjectId) {
      await flushChapterSave()
      await flushVolumeSave()
      const store = useEditorStore.getState()
      const chapter = store.chapters.find((c) => c.id === store.activeChapterId)
      if (chapter && store.isDirty) {
        const editor = getEditor()
        const html = editor?.getHTML() || chapter.content
        await window.electronAPI.chapter.save({
          ...chapter,
          content: html,
          word_count: countChars(html),
        })
        store.setDirty(false)
      }
      await window.electronAPI.version.commit(activeProjectId, '自动保存 — 退出前')
    }
    window.electronAPI?.close()
  }

  return (
    <TooltipProvider delayDuration={300}>
    <div
      className={cn(
        'floating-glass-topbar relative z-10 flex h-11 items-center gap-1.5 select-none',
        isMac ? 'pl-[4.5rem] pr-3' : 'px-3',
      )}
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <div className="flex items-center gap-0.5 pl-1 shrink-0 min-w-0 max-w-[40%]" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/50 hover:text-foreground"
              onClick={() => {
                const now = Date.now()
                const ref = debugClickRef.current
                if (now - ref.lastTime > 2000) ref.count = 0
                ref.count++
                ref.lastTime = now
                if (ref.count >= 10) {
                  ref.count = 0
                  setDebugMode((v) => !v)
                }
              }}
            >
              <BookOpen className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">InkArk</TooltipContent>
        </Tooltip>
        <div className="relative min-w-0">
          <button
            ref={buttonRef}
            onClick={() => setMenuOpen(!menuOpen)}
            className={`flex items-center gap-1.5 rounded-full px-3 h-8 text-xs font-medium transition-colors min-w-0 max-w-[18rem] ${menuOpen ? 'bg-white/60 text-foreground' : 'text-foreground/80 hover:bg-white/40'}`}
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            {renaming ? (
              <input
                ref={inputRef}
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleRename() }
                  if (e.key === 'Escape') { setRenaming(false); setRenameText(activeProject?.title || '') }
                }}
                onBlur={handleRename}
                className="w-[20rem] h-5 rounded border px-1 text-xs bg-white/60 outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="truncate max-w-[20rem]">{activeProject?.title ? `《${activeProject.title}》` : '未命名作品'}</span>
            )}
            <ChevronDown className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen && (
              <div ref={menuRef} className="absolute top-full left-0 mt-1 w-56 rounded-xl border border-white/50 bg-white/95 backdrop-blur-xl shadow-floating z-[60] py-1 glass-pop-in">
                <button onClick={handleCreate} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/60">
                  <Plus className="h-3.5 w-3.5" /> 新建作品
                </button>
                <button
                  onClick={() => { setRenaming(true); setRenameText(activeProject?.title || ''); setMenuOpen(false) }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/60"
                >
                  <Pencil className="h-3.5 w-3.5" /> 重命名
                </button>
                <div className="mx-2 my-1 h-px bg-border/40" />
                <button onClick={() => { setExportOpen(true); setMenuOpen(false) }} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/60">
                  <Download className="h-3.5 w-3.5" /> 导出作品
                </button>
                <button onClick={handleImport} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/60">
                  <Download className="h-3.5 w-3.5" /> 导入作品
                </button>
                <div className="mx-2 my-1 h-px bg-border/40" />
                <button onClick={handleDelete} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/60 text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> 删除当前作品
                </button>
                <div className="mx-2 my-1 h-px bg-border/40" />
                <div className="max-h-48 overflow-y-auto">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleSwitch(p.id)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/60 ${p.id === activeProjectId ? 'bg-white/40 font-medium' : ''}`}
                    >
                      <span className="truncate">{p.title}</span>
                    </button>
                  ))}
                </div>
              </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex justify-center">
        <button
          onClick={() => openCommandPalette(true)}
          style={{ WebkitAppRegion: 'no-drag' } as any}
          className="flex items-center gap-2 h-7 px-2.5 rounded-full bg-white/40 hover:bg-white/60 border border-white/50 text-xs text-muted-foreground transition-colors w-[200px] lg:w-[240px] xl:w-[280px] max-w-full hover-lift"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left truncate">搜索命令、章节、设置…</span>
        </button>
      </div>

      <div className={cn('flex items-center gap-0.5 shrink-0', isMac ? 'pr-1' : 'pr-36')} style={{ WebkitAppRegion: 'no-drag' } as any}>
        {statusMsg && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">{statusMsg}</span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setHelpOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/50 hover:text-foreground"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">使用指南</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setVersionOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/50 hover:text-foreground"
            >
              <History className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">版本历史</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onSettingsClick}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/50 hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">设置</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={openFeedback}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/50 hover:text-foreground"
            >
              <Bug className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">反馈问题</TooltipContent>
        </Tooltip>
      </div>

      {!isMac && (
        <div
          className="fixed top-0 right-0 z-[60] flex items-stretch h-11"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <button
            onClick={handleMinimize}
            title="最小化"
            className="w-12 h-full flex items-center justify-center text-muted-foreground hover:bg-white/40 transition-colors"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleMaximize}
            title="最大化"
            className="w-12 h-full flex items-center justify-center text-muted-foreground hover:bg-white/40 transition-colors"
          >
            <Square className="h-3 w-3" />
          </button>
          <button
            onClick={handleClose}
            title="关闭"
            className="w-12 h-full flex items-center justify-center text-muted-foreground hover:bg-red-500 hover:text-white transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <BookIdeaDialog open={ideaOpen} onOpenChange={setIdeaOpen} />
      <ProjectCommits open={versionOpen} onOpenChange={setVersionOpen} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <ImportProjectDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} onImported={handleImported} />
    </div>
    </TooltipProvider>
  )
}
