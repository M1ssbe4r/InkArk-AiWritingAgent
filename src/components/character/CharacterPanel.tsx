import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CharacterCardEditor } from './CharacterCardEditor'
import { useEditorStore } from '@/stores/editorStore'
import type { CharacterCard } from '@/types'
import { Plus, Search, Edit3, XCircle, User } from 'lucide-react'
import { generateId } from '@/lib/utils'
import { pushChange } from '@/lib/editorRef'

export function CharacterPanel() {
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const dataVersion = useEditorStore((s) => s.dataVersion)
  const [cards, setCards] = useState<CharacterCard[]>([])
  const [search, setSearch] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<CharacterCard | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; card: CharacterCard } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!ctxMenu || !menuRef.current) {
      setMenuPos(null)
      return
    }
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const padding = 8
    let left = ctxMenu.x
    let top = ctxMenu.y
    if (left + rect.width + padding > vw) left = Math.max(padding, vw - rect.width - padding)
    if (top + rect.height + padding > vh) top = Math.max(padding, vh - rect.height - padding)
    setMenuPos({ left, top })
  }, [ctxMenu])

  const load = async () => {
    if (!activeProjectId) return
    try {
      const list = await window.electronAPI.character.list(activeProjectId)
      setCards(list.map((c: any) => {
        const parse = (v: any) => { try { const r = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(r) ? r : [] } catch { return [] } }
        return { ...c, traits: parse(c.traits), tags: parse(c.tags) }
      }))
    } catch (e) {
      console.error('load characters failed', e)
    }
  }

  useEffect(() => { load() }, [activeProjectId, dataVersion])

  useEffect(() => {
    if (!ctxMenu) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setCtxMenu(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ctxMenu])

  const allTags = [...new Set(cards.flatMap((c) => c.tags || []))]
  const filtered = cards.filter((c) => {
    if (search && !(c.name || '').includes(search) && !(c.description || '').includes(search)) return false
    if (filterTag && !(c.tags || []).includes(filterTag)) return false
    return true
  })

  const handleDelete = async (id: string) => {
    const card = cards.find((c) => c.id === id)
    await window.electronAPI.character.delete(id)
    load()
    if (activeProjectId && card) pushChange(activeProjectId, 'character', id, `角色删除：${card.name}`)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b pr-1 pl-3 py-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索角色..." className="h-7 pl-6 text-xs" />
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setEditing(null); setEditorOpen(true) }}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex gap-1 border-b px-3 py-1 overflow-x-auto">
        <button
          onClick={() => setFilterTag('')}
          className={`text-[10px] rounded px-1.5 py-0.5 shrink-0 ${!filterTag ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}
        >全部</button>
        {allTags.map((tag) => (
          <button
            key={tag}
            onClick={() => setFilterTag(tag)}
            className={`text-[10px] rounded px-1.5 py-0.5 shrink-0 ${filterTag === tag ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}
          >{tag}</button>
        ))}
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 pb-10 space-y-1">
          {filtered.map((card) => (
            <div key={card.id} className="rounded border px-3 py-2 hover:bg-sidebar-accent/50 cursor-pointer" onClick={() => { setEditing(card); setEditorOpen(true) }} onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, card }) }}>
              <div className="flex items-center gap-2 min-w-0">
                <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{card.name}</div>
                  {card.alias && <div className="text-[10px] text-muted-foreground truncate">{card.alias}</div>}
                </div>
              </div>
              {card.description && <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{card.description}</div>}
              {(card.tags || []).length > 0 && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {(card.tags || []).map((t) => (
                    <span key={t} className="text-[9px] bg-secondary text-secondary-foreground rounded px-1 py-0.5">{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              {cards.length === 0 ? '暂无角色，点击 + 添加' : '未找到匹配角色'}
            </p>
          )}
        </div>
      </ScrollArea>
      {ctxMenu && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-32 rounded-md border bg-popover p-1 shadow-md"
          style={{
            left: menuPos?.left ?? ctxMenu.x,
            top: menuPos?.top ?? ctxMenu.y,
            visibility: menuPos ? 'visible' : 'hidden',
          }}
          onClick={() => setCtxMenu(null)}
        >
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent" onClick={() => { setEditing(ctxMenu.card); setEditorOpen(true); setCtxMenu(null) }}>
            <Edit3 className="h-3.5 w-3.5" /> 编辑
          </button>
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent text-destructive" onClick={() => { handleDelete(ctxMenu.card.id); setCtxMenu(null) }}>
            <XCircle className="h-3.5 w-3.5" /> 删除
          </button>
        </div>,
        document.body
      )}
      {activeProjectId && (
        <CharacterCardEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          projectId={activeProjectId}
          card={editing}
          onSaved={load}
        />
      )}
    </div>
  )
}
