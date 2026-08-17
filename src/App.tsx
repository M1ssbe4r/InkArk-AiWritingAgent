import { useEffect, useRef, useState, useCallback } from 'react'
import { TitleBar } from '@/components/layout/TitleBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { Editor } from '@/components/editor/Editor'
import { AIPanel } from '@/components/ai-panel/AIPanel'
import { ApiSettings } from '@/components/settings/ApiSettings'
import { BookIdeaDialog } from '@/components/outline/BookIdeaDialog'
import { OutlineMigrationDialog } from '@/components/outline/OutlineMigrationDialog'
import { LegacyOutlineViewer } from '@/components/outline/LegacyOutlineViewer'
import { WelcomeDialog } from '@/components/layout/WelcomeDialog'
import { ReleaseNotesDialog } from '@/components/layout/ReleaseNotesDialog'
import { HelpDialog } from '@/components/layout/HelpDialog'
import { ProjectCommits } from '@/components/layout/ProjectCommits'
import { CommandPalette } from '@/components/ui/CommandPalette'
import { UpdateToast } from '@/components/UpdateToast'
import { Toaster } from 'sonner'
import { useEditorStore } from '@/stores/editorStore'
import { useAppStore } from '@/stores/appStore'
import { initStyleGuidance, initStyleCustomId, initWritingRestrictions, flushChapterSave, flushVolumeSave } from '@/lib/editorRef'
import { generateId } from '@/lib/utils'
import { shouldShowReleaseNotes } from '@/lib/appVersion'

const SIDEBAR_MIN = 240
const SIDEBAR_MAX = 360
const AIPANEL_MIN = 320
const AIPANEL_MAX = 720
const SIDEBAR_DEFAULT = () => window.innerWidth <= 1920 ? 280 : 300
const AIPANEL_DEFAULT = () => window.innerWidth <= 1920 ? 480 : 560

function load(key: string, def: number) {
  const v = Number(localStorage.getItem(key))
  return v > 0 ? v : def
}

function DragHandle({
  onDragStart,
  resizing,
}: {
  onDragStart: (e: React.MouseEvent) => void
  resizing?: boolean
}) {
  return (
    <div
      className="resize-handle h-full"
      onMouseDown={onDragStart}
      data-resizing={resizing ? 'true' : 'false'}
    />
  )
}

function App() {
  const { setProjects, setActiveProject, activeProjectId, volumes, isProjectLoading } = useEditorStore()
  const isAIPanelOpen = useAppStore((s) => s.isAIPanelOpen)
  const setAIPanelOpen = useAppStore((s) => s.setAIPanelOpen)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ideaOpen, setIdeaOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [configVersion, setConfigVersion] = useState(0)
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)

  const [sidebarWidth, setSidebarWidth] = useState(() => Math.max(SIDEBAR_MIN, load('inkark-sidebar-width', SIDEBAR_DEFAULT())))
  const [aiPanelWidth, setAiPanelWidth] = useState(() => Math.max(AIPANEL_MIN, load('inkark-ai-panel-width', AIPANEL_DEFAULT())))
  const [resizing, setResizing] = useState<null | 'sidebar' | 'aipanel'>(null)
  const [migrationDialog, setMigrationDialog] = useState<{ projectId: string; title: string; outlineHtml: string } | null>(null)
  // 本 session 内用户已"× 关掉"过迁移弹窗的项目 — 不再为它们重弹,
  // 避免"关掉→触发 effect→立刻重弹"死循环。
  // 不持久化:下次启动仍按纯数据状态判定,以便新升级用户能看到提示。
  const [dismissedMigration, setDismissedMigration] = useState<Set<string>>(new Set())
  const [legacyViewerOpen, setLegacyViewerOpen] = useState(false)
  const sidebarWidthRef = useRef(sidebarWidth)
  const aiPanelWidthRef = useRef(aiPanelWidth)
  useEffect(() => { sidebarWidthRef.current = sidebarWidth }, [sidebarWidth])
  useEffect(() => { aiPanelWidthRef.current = aiPanelWidth }, [aiPanelWidth])

  const startDrag = (panel: 'sidebar' | 'aipanel') => (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = panel === 'sidebar' ? sidebarWidthRef.current : aiPanelWidthRef.current
    const min = panel === 'sidebar' ? SIDEBAR_MIN : AIPANEL_MIN
    const max = panel === 'sidebar' ? SIDEBAR_MAX : AIPANEL_MAX
    const setter = panel === 'sidebar' ? setSidebarWidth : setAiPanelWidth
    const storageKey = panel === 'sidebar' ? 'inkark-sidebar-width' : 'inkark-ai-panel-width'

    setResizing(panel)
    document.body.classList.add('resizing-cols')

    const onMove = (e: MouseEvent) => {
      const newW = Math.max(min, Math.min(max, startW + (panel === 'sidebar' ? e.clientX - startX : startX - e.clientX)))
      setter(newW)
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.body.classList.remove('resizing-cols')
      const finalW = panel === 'sidebar' ? sidebarWidthRef.current : aiPanelWidthRef.current
      localStorage.setItem(storageKey, String(finalW))
      setResizing(null)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    // 窗口从后台切回前台时刷新章节列表
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    const init = async () => {
      if (!window.electronAPI) {
        // Browser dev mode without Electron — skip IPC init; show a friendly placeholder
        return
      }
      // One-shot migration: move localStorage 'custom-styles' into SQLite custom_styles
      const migrated = localStorage.getItem('inkark-styles-migrated')
      if (!migrated) {
        try {
          const raw = localStorage.getItem('custom-styles')
          if (raw) {
            const styles = JSON.parse(raw)
            if (Array.isArray(styles) && styles.length > 0) {
              await window.electronAPI.style.migrateFromLocalStorage(styles)
            }
          }
        } catch (e) {
          console.warn('[init] custom styles migration failed:', e)
        }
        localStorage.setItem('inkark-styles-migrated', '1')
        localStorage.removeItem('custom-styles')
      }

      const restrictionsMigrated = localStorage.getItem('inkark-restrictions-migrated')
      if (!restrictionsMigrated) {
        try {
          const legacy = localStorage.getItem('inkark-restrictions')
          if (legacy) {
            const allProjects = await window.electronAPI.project.list()
            for (const p of allProjects) {
              const current = await window.electronAPI.project.getWritingRestrictions(p.id)
              if (!current) {
                await window.electronAPI.project.setWritingRestrictions(p.id, legacy)
              }
            }
          }
        } catch (e) {
          console.warn('[init] writing restrictions migration failed:', e)
        }
        localStorage.setItem('inkark-restrictions-migrated', '1')
        localStorage.removeItem('inkark-restrictions')
      }

      const showWelcome = !localStorage.getItem('inkark-onboarding-done')
      if (showWelcome) {
        setWelcomeOpen(true)
      } else if (shouldShowReleaseNotes()) {
        setReleaseNotesOpen(true)
      }

      const projects = await window.electronAPI.project.list()
      if (projects.length === 0) {
        const defaultProject = {
          id: generateId(),
          title: '未命名作品',
        }
        await window.electronAPI.project.create(defaultProject)
        projects.push(defaultProject)
      }
      setProjects(projects)
      await setActiveProject(projects[0].id)
      const style = await window.electronAPI.project.getStyle(projects[0].id)
      initStyleGuidance(style.guidance || '')
      initStyleCustomId(style.customStyleId ?? null)
      const restrictions = await window.electronAPI.project.getWritingRestrictions(projects[0].id)
      initWritingRestrictions(restrictions || '')

      const chapters = useEditorStore.getState().chapters
      if (chapters.length === 0) {
        const firstChapter = {
          id: generateId(),
          project_id: projects[0].id,
          title: '',
          content: '',
          chapter_outline: '',
          sort_order: 0,
          status: 'draft',
          word_count: 0,
        }
        await window.electronAPI.chapter.save(firstChapter)
        await useEditorStore.getState().loadChaptersJump(projects[0].id)
      }

      const config = await window.electronAPI.apiConfig.getDefault()
      if (!config) {
        const configId = generateId()
        await window.electronAPI.apiConfig.create({
          id: configId,
          name: 'OpenAI 兼容',
          base_url: 'https://api.openai.com/v1',
          api_key: '',
          model: 'gpt-4o-mini',
          provider: 'openai_compatible',
          context_length: 128,
        })
        await window.electronAPI.preset.create({
          id: generateId(),
          name: '默认预设',
          api_config_id: configId,
          temperature: 1,
          top_p: 1,
          max_tokens: 8192,
          frequency_penalty: 0,
          presence_penalty: 0,
          thinking_enabled: 1,
          reasoning_effort: 'high',
        })
      }

    }
    init()
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // 退出前 flush 握手:主进程 before-quit 发 'app:beforeQuit',这里把
  // isDirty 章节 + 版本快照都 flush 完,再通知主进程进入 commit + 落盘阶段。
  // 见 electron/main.ts 'app:beforeQuit' 与 'app:flushed' 的配套逻辑。
  useEffect(() => {
    if (!window.electronAPI?.onBeforeQuit) return
    const unsub = window.electronAPI.onBeforeQuit(async () => {
      try {
        // 1. 把正在 debounce 的章节正文 flush 出来 (chapter.save IPC)
        await flushChapterSave()
        // 2. 把正在 debounce 的卷名/卷级大纲/进度备注 flush 出来 (volume.save IPC)
        await flushVolumeSave()
        // 3. 提交版本快照。注意:必须在 flush 之后,否则 commit
        //    读到的是 db 里上一版 stale 内容,版本历史会缺最后一段。
        const projectId = useEditorStore.getState().activeProjectId
        if (projectId) {
          await window.electronAPI.version.commit(projectId, '退出前保存')
        }
      } finally {
        // 无论成功失败都通知主进程, 主进程 once('app:flushed') 会推进 quit 流程。
        // 即使 renderer 卡死 / 异常,主进程也有 1.5s 超时兜底强制 commit。
        window.electronAPI.notifyFlushed()
      }
    })
    return () => { if (typeof unsub === 'function') unsub() }
  }, [])

  useEffect(() => {
    if (activeProjectId) {
      window.electronAPI.project.getStyle(activeProjectId).then(s => {
        initStyleGuidance(s.guidance || '')
        initStyleCustomId(s.customStyleId ?? null)
      })
      window.electronAPI.project.getWritingRestrictions(activeProjectId).then((restrictions) => {
        initWritingRestrictions(restrictions || '')
      })
    } else {
      initStyleGuidance('')
      initStyleCustomId(null)
      initWritingRestrictions('')
    }
  }, [activeProjectId])

  // 升级迁移弹窗:用户切到"旧 outline 还在 + volumes 全部为空"的项目时提示
  // 纯数据状态判定 + 本 session 内 dismiss 标记,× 关闭后不再重弹
  useEffect(() => {
    if (welcomeOpen || releaseNotesOpen) return
    if (!activeProjectId || migrationDialog) return
    // 项目切换中 — volumes 还没加载完,跳过判定(避免看到"上次的空 volumes"误判)
    if (isProjectLoading) return
    if (dismissedMigration.has(activeProjectId)) return
    const project = useEditorStore.getState().projects.find((p) => p.id === activeProjectId)
    if (!project) return
    const hasLegacyOutline = (project.outline || '').trim().length > 0
    if (!hasLegacyOutline) return
    // volumes 全部是空(没 title 也没 outline)= 占位卷 → 旧结构没迁过来
    const allVolumesEmpty = volumes.every((v) => !v.title.trim() && !(v.outline || '').trim())
    if (!allVolumesEmpty) return
    setMigrationDialog({ projectId: project.id, title: project.title, outlineHtml: project.outline || '' })
  }, [activeProjectId, volumes, isProjectLoading, welcomeOpen, releaseNotesOpen, migrationDialog, dismissedMigration])

  // volumes 从"全空"变"有内容"时,清掉已弹出的弹窗(让用户重新评估或退出)
  useEffect(() => {
    if (!migrationDialog) return
    if (isProjectLoading) return
    const allEmpty = volumes.every((v) => !v.title.trim() && !(v.outline || '').trim())
    if (!allEmpty) {
      setMigrationDialog(null)
    }
  }, [volumes, migrationDialog, isProjectLoading])

  // 旧版大纲查看器:由 OutlineMigrationDialog 走"手动迁移"按钮触发
  const pendingLegacyOutline = useAppStore((s) => s.pendingLegacyOutline)
  useEffect(() => {
    if (pendingLegacyOutline) {
      setLegacyViewerOpen(true)
      useAppStore.getState().setPendingLegacyOutline(null)
    }
  }, [pendingLegacyOutline])

  const handleSettingsChange = (open: boolean) => {
    setSettingsOpen(open)
    if (!open) {
      setConfigVersion((v) => v + 1)
    }
  }

  const handleNewChapter = useCallback(async () => {
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
    useEditorStore.getState().setActiveChapter(newChapter.id)
    useAppStore.getState().setEditorView('chapter')
  }, [activeProjectId])

  const handleSave = useCallback(async () => {
    if (!activeProjectId) return
    await flushChapterSave()
  }, [activeProjectId])

  return (
    <div className="flex h-screen flex-col canvas-bg">
      <TitleBar
        onSettingsClick={() => setSettingsOpen(true)}
      />

      <div className="relative flex-1 min-h-0 px-2 pb-2 pt-2 overflow-hidden">
        <div
          className="relative flex h-full w-full items-stretch glass-pane-slide min-h-0 gap-[3px]"
          style={{ transitionProperty: 'width, opacity' }}
        >
          <div className="glass-pane-slide relative z-[2]" style={{ width: sidebarWidth, flexShrink: 0 }}>
            <Sidebar width={sidebarWidth} />
          </div>
          <DragHandle onDragStart={startDrag('sidebar')} resizing={resizing === 'sidebar'} />

          <div className="flex-1 min-w-0 min-h-0 relative z-[1]">
            <Editor />
          </div>

          <DragHandle onDragStart={startDrag('aipanel')} resizing={resizing === 'aipanel'} />
          {isAIPanelOpen && (
            <div className="glass-pane-slide relative z-[2]" style={{ width: aiPanelWidth, flexShrink: 0 }}>
              <AIPanel width={aiPanelWidth} configVersion={configVersion} onClose={() => setAIPanelOpen(false)} />
            </div>
          )}
          {!isAIPanelOpen && (
            <button
              onClick={() => setAIPanelOpen(true)}
              title="打开 AI 面板"
              className="floating-glass hover-lift h-12 w-12 m-2 flex items-center justify-center self-center shrink-0 relative z-[2]"
              style={{ borderRadius: 12 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </button>
          )}
        </div>
      </div>

      <ApiSettings open={settingsOpen} onOpenChange={handleSettingsChange} />
      <BookIdeaDialog open={ideaOpen} onOpenChange={setIdeaOpen} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <ProjectCommits open={versionOpen} onOpenChange={setVersionOpen} />
      <WelcomeDialog open={welcomeOpen} onOpenChange={setWelcomeOpen} />
      <ReleaseNotesDialog open={releaseNotesOpen} onOpenChange={setReleaseNotesOpen} />

      {migrationDialog && (
        <OutlineMigrationDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              // 记录本 session 已 dismiss,防止触发 effect 在同项目反复重弹
              setDismissedMigration((prev) => {
                const next = new Set(prev)
                next.add(migrationDialog.projectId)
                return next
              })
              setMigrationDialog(null)
            }
          }}
          projectId={migrationDialog.projectId}
          projectTitle={migrationDialog.title}
          outlineHtml={migrationDialog.outlineHtml}
        />
      )}
      {pendingLegacyOutline && (
        <LegacyOutlineViewer
          open={legacyViewerOpen}
          onOpenChange={setLegacyViewerOpen}
          outlineHtml={pendingLegacyOutline.outlineHtml}
        />
      )}

      <CommandPalette
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenBookIdea={() => setIdeaOpen(true)}
        onOpenVersion={() => setVersionOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        onNewChapter={handleNewChapter}
        onSave={handleSave}
      />
      <UpdateToast />
      <Toaster position="bottom-right" richColors closeButton duration={5000} />
    </div>
  )
}

export default App
