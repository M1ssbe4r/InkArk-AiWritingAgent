import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, ArrowUp, ArrowDown, CornerDownLeft, Sparkles, Settings, BookOpen, History, HelpCircle, FilePlus2, Save, FileText, Library, User, Globe, Palette, Ban, Database } from 'lucide-react'
import { useCommandPalette } from '@/stores/commandPaletteStore'
import { setPendingAction, getEditor } from '@/lib/editorRef'
import { useEditorStore } from '@/stores/editorStore'
import { useAppStore } from '@/stores/appStore'
import { generateId, cn } from '@/lib/utils'
import { resolveChapterSelectionContext } from '@/lib/chapterParagraph'

export type PaletteCommand = {
  id: string
  label: string
  description?: string
  keywords?: string[]
  icon: React.ReactNode
  group: 'navigation' | 'chat' | 'sidebar' | 'project' | 'help'
  run: (query: string) => 'close' | 'stay' | { action: 'sendToChat'; text: string }
}

type DisplayItem = PaletteCommand

interface CommandPaletteProps {
  onOpenSettings: () => void
  onOpenBookIdea: () => void
  onOpenVersion: () => void
  onOpenHelp: () => void
  onNewChapter: () => Promise<void> | void
  onSave: () => Promise<void> | void
}

const HISTORY_KEY = 'inkark-cmd-palette-history'

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, 50) : []
  } catch {
    return []
  }
}

function saveHistory(history: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)))
  } catch {}
}

export function CommandPalette(props: CommandPaletteProps) {
  const { open, setOpen, toggle } = useCommandPalette()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [history, setHistory] = useState<string[]>(() => loadHistory())
  const [historyCursor, setHistoryCursor] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const chapters = useEditorStore((s) => s.chapters)
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const projects = useEditorStore((s) => s.projects)
  const setSidebarView = useAppStore((s) => s.setSidebarView)
  const setEditorView = useAppStore((s) => s.setEditorView)

  const isFreeText = query.trim().startsWith('>') || (!query.trim() && false)
  const freeText = query.replace(/^>\s*/, '').trim()

  const commands = useMemo<PaletteCommand[]>(() => {
    const base: PaletteCommand[] = [
      // chat
      {
        id: 'chat-write', label: '写作 — 让 AI 续写', keywords: ['write', 'xu xie', '续写', '写作'],
        description: '> 写作 你的指令', icon: <Sparkles className="h-3.5 w-3.5" />, group: 'chat',
        run: (q) => ({ action: 'sendToChat', text: q || '请基于上文继续写一段' }),
      },
      {
        id: 'chat-outline', label: '大纲 — 生成全书大纲', keywords: ['outline', '大纲', 'da gang'],
        description: '> 大纲 你的想法', icon: <FileText className="h-3.5 w-3.5" />, group: 'chat',
        run: (q) => ({ action: 'sendToChat', text: q ? `请基于以下内容生成大纲：\n${q}` : '请帮我梳理这本书的大纲' }),
      },
      {
        id: 'chat-polish', label: '润色 — 改写选中文本', keywords: ['polish', 'run se', '润色'],
        description: '> 润色 ...', icon: <Sparkles className="h-3.5 w-3.5" />, group: 'chat',
        run: (q) => {
          const editor = getEditor()
          if (editor && !editor.state.selection.empty) {
            const { from, to } = editor.state.selection
            const selection = resolveChapterSelectionContext(editor.state.doc, from, to)
            if (!selection) return { action: 'sendToChat', text: q ? `请润色：\n${q}` : '请润色当前章节选中的文本' }
            const { chapters, activeChapterId } = useEditorStore.getState()
            const chapterIndex = chapters.findIndex((c) => c.id === activeChapterId) + 1
            setPendingAction({
              action: 'polish',
              text: selection.text,
              chapterIndex: chapterIndex > 0 ? chapterIndex : undefined,
              paragraphIndices: selection.paragraphIndices.length > 0 ? selection.paragraphIndices : undefined,
            })
            return 'close'
          }
          return { action: 'sendToChat', text: q ? `请润色：\n${q}` : '请润色当前章节选中的文本' }
        },
      },
      // sidebar
      {
        id: 'side-outline', label: '目录', keywords: ['outline', 'catalog', 'mulu', '目录'],
        icon: <BookOpen className="h-3.5 w-3.5" />, group: 'sidebar',
        run: () => { setSidebarView('outline'); return 'close' },
      },
      {
        id: 'side-characters', label: '角色', keywords: ['character', 'juese', '角色'],
        icon: <User className="h-3.5 w-3.5" />, group: 'sidebar',
        run: () => { setSidebarView('characters'); return 'close' },
      },
      {
        id: 'side-world', label: '世界观', keywords: ['world', 'shijie', '世界观'],
        icon: <Globe className="h-3.5 w-3.5" />, group: 'sidebar',
        run: () => { setSidebarView('world'); return 'close' },
      },
      {
        id: 'side-style', label: '写作风格', keywords: ['style', 'fengge', '风格'],
        icon: <Palette className="h-3.5 w-3.5" />, group: 'sidebar',
        run: () => { setSidebarView('style'); return 'close' },
      },
      {
        id: 'side-restrictions', label: '规则', keywords: ['restrictions', 'guize', '规则'],
        icon: <Ban className="h-3.5 w-3.5" />, group: 'sidebar',
        run: () => { setSidebarView('restrictions'); return 'close' },
      },
      {
        id: 'side-knowledge', label: '知识库', keywords: ['knowledge', 'zhishi', '知识'],
        icon: <Database className="h-3.5 w-3.5" />, group: 'sidebar',
        run: () => { setSidebarView('knowledge'); return 'close' },
      },
      {
        id: 'view-book-outline', label: '全书大纲视图', keywords: ['book outline', 'quanshu', '全书大纲'],
        icon: <Library className="h-3.5 w-3.5" />, group: 'sidebar',
        run: () => { setEditorView('outline'); return 'close' },
      },
      {
        id: 'view-chapter', label: '回到章节编辑', keywords: ['chapter', 'zhangjie', '章节'],
        icon: <FileText className="h-3.5 w-3.5" />, group: 'sidebar',
        run: () => { setEditorView('chapter'); return 'close' },
      },
      // project
      {
        id: 'project-new-chapter', label: '新建章节', keywords: ['new chapter', 'xinzhangjie', '新建章节'],
        icon: <FilePlus2 className="h-3.5 w-3.5" />, group: 'project',
        run: () => { props.onNewChapter(); return 'close' },
      },
      {
        id: 'project-save', label: '保存当前章节', keywords: ['save', 'baocun', '保存'],
        icon: <Save className="h-3.5 w-3.5" />, group: 'project',
        run: () => { props.onSave(); return 'close' },
      },
      {
        id: 'project-book-idea', label: '书点子 / 重新生成大纲', keywords: ['book idea', 'dianzi', '书点子', 'shudianzi'],
        icon: <BookOpen className="h-3.5 w-3.5" />, group: 'project',
        run: () => { props.onOpenBookIdea(); return 'close' },
      },
      {
        id: 'project-version', label: '版本历史', keywords: ['version', 'banben', '版本'],
        icon: <History className="h-3.5 w-3.5" />, group: 'project',
        run: () => { props.onOpenVersion(); return 'close' },
      },
      // navigation
      {
        id: 'nav-settings', label: '设置', keywords: ['settings', 'shezhi', '设置'],
        icon: <Settings className="h-3.5 w-3.5" />, group: 'navigation',
        run: () => { props.onOpenSettings(); return 'close' },
      },
      {
        id: 'nav-help', label: '使用指南', keywords: ['help', 'zhinan', '指南', '帮助'],
        icon: <HelpCircle className="h-3.5 w-3.5" />, group: 'help',
        run: () => { props.onOpenHelp(); return 'close' },
      },
    ]
    return base
  }, [props, setSidebarView, setEditorView])

  const projectChapters = chapters

  // Build dynamic "go to chapter N" commands
  const dynamicCommands = useMemo<PaletteCommand[]>(() => {
    if (!projectChapters || projectChapters.length === 0) return []
    return projectChapters.slice(0, 30).map((ch, i) => ({
      id: `goto-chapter-${ch.id}`,
      label: `第 ${i + 1} 章 — ${ch.title || '未命名'}`,
      keywords: [String(i + 1), ch.title || ''].filter(Boolean),
      icon: <FileText className="h-3.5 w-3.5" />,
      group: 'project',
      run: () => {
        useEditorStore.getState().setActiveChapter(ch.id)
        setEditorView('chapter')
        return 'close'
      },
    }))
  }, [projectChapters, setEditorView])

  const allCommands = useMemo(() => [...commands, ...dynamicCommands], [commands, dynamicCommands])

  const filtered = useMemo(() => {
    const q = query.replace(/^>\s*/, '').trim().toLowerCase()
    if (!q) return allCommands
    return allCommands.filter((c) => {
      const hay = [c.label, ...(c.keywords || [])].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [query, allCommands])

  const displayList = useMemo<DisplayItem[]>(() => {
    if (isFreeText && freeText) {
      // Show "send to chat" option as the first item
      const sendItem: DisplayItem = {
        id: '__send_to_chat__',
        label: freeText,
        description: '发送到 AI 面板',
        keywords: [],
        icon: <Sparkles className="h-3.5 w-3.5" />,
        group: 'chat',
        run: () => ({ action: 'sendToChat', text: freeText }),
      }
      return [sendItem, ...filtered]
    }
    if (!query.trim()) {
      // Empty query: hide all preset commands. User must type to see anything.
      return []
    }
    return filtered
  }, [isFreeText, freeText, filtered, query])

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlight(0)
      setHistoryCursor(null)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Global Ctrl+K / Cmd+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        toggle()
      } else if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, toggle, setOpen])

  useEffect(() => {
    if (highlight >= displayList.length) setHighlight(0)
  }, [displayList.length, highlight])

  const runItem = (idx: number) => {
    const item = displayList[idx]
    if (!item) return
    const result = item.run(query.replace(/^>\s*/, '').trim())
    if (result && typeof result === 'object' && 'action' in result && result.action === 'sendToChat') {
      setPendingAction({ action: 'sendToChat', text: result.text })
      const text = result.text
      setHistory((prev) => {
        const next = [text, ...prev.filter((p) => p !== text)].slice(0, 50)
        saveHistory(next)
        return next
      })
      setOpen(false)
      return
    }
    if (result === 'close') setOpen(false)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-32 animate-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div
        className="absolute inset-0 bg-slate-900/5 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <div
        className="relative w-[720px] max-w-[calc(100vw-32px)] floating-glass shadow-floating-hover glass-pop-in overflow-hidden"
        style={{ borderRadius: 16 }}
      >
        <div className="flex items-center gap-2 px-4 h-14">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); setHistoryCursor(null) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (historyCursor !== null) {
                  if (historyCursor > 0) setHistoryCursor(historyCursor - 1)
                  else setHistoryCursor(null)
                } else {
                  setHighlight((h) => Math.min(h + 1, displayList.length - 1))
                }
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                if (historyCursor === null) {
                  setHighlight((h) => Math.max(0, h - 1))
                  if (highlight === 0) setHistoryCursor(history.length)
                } else {
                  setHistoryCursor(Math.min(history.length, historyCursor + 1))
                }
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (historyCursor !== null && historyCursor > 0) {
                  const text = history[historyCursor - 1]
                  if (text) {
                    setPendingAction({ action: 'sendToChat', text })
                    setOpen(false)
                  }
                } else {
                  runItem(highlight)
                }
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
              }
            }}
            placeholder="搜索命令、章节、风格、设置…  或输入 > 直接发给 AI"
            className="flex-1 h-10 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground/60"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded-md border border-white/40 bg-white/30 px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
            Esc
          </kbd>
          <button onClick={() => setOpen(false)} className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:bg-accent/60">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Result list */}
        <div className="max-h-[40vh] overflow-y-auto border-t border-white/30 bg-white/40">
          {displayList.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              {query.trim()
                ? '没有匹配的命令'
                : '输入命令、章节名，或输入 > 直接发给 AI'}
            </div>
          ) : (
            <ul className="py-1">
              {displayList.map((item, i) => (
                <li key={item.id}>
                  <button
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => runItem(i)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors',
                      i === highlight ? 'bg-primary/5 text-foreground' : 'text-foreground/80 hover:bg-accent/40'
                    )}
                  >
                    <span className="h-7 w-7 rounded-md bg-white/60 border border-white/40 flex items-center justify-center shrink-0 text-muted-foreground">
                      {item.icon}
                    </span>
                    <span className="flex-1 min-w-0">
                      <div className="truncate text-[13px]">{item.label}</div>
                      {item.description && (
                        <div className="truncate text-[11px] text-muted-foreground/80">{item.description}</div>
                      )}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 shrink-0">
                      {item.group}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between px-4 h-9 border-t border-white/30 bg-white/30 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><ArrowUp className="h-3 w-3" /><ArrowDown className="h-3 w-3" /> 导航</span>
            <span className="inline-flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> 执行</span>
            <span className="inline-flex items-center gap-1">{'>'} 直接发给 AI</span>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span>{projects.length} 个作品</span>
            <span>·</span>
            <span>{activeProjectId ? '已选择' : '未选'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
