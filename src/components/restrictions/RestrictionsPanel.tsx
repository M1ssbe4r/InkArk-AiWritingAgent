import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useEditorStore } from '@/stores/editorStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { generateId } from '@/lib/utils'
import { setStyleRestrictions, initWritingRestrictions, pushChange } from '@/lib/editorRef'
import { Plus, Shield, Trash2 } from 'lucide-react'

interface ContextMenuState {
  x: number
  y: number
  wordId: string
  wordText: string
}

export function RestrictionsPanel() {
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const [restrictionsText, setRestrictionsText] = useState('')
  const [originalText, setOriginalText] = useState('')
  const [words, setWords] = useState<any[]>([])
  const [newWord, setNewWord] = useState('')
  const [saved, setSaved] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeProjectId) {
      setRestrictionsText('')
      setOriginalText('')
      return
    }
    window.electronAPI.project.getWritingRestrictions(activeProjectId).then((text) => {
      initWritingRestrictions(text)
      setRestrictionsText(text)
      setOriginalText(text)
    })
    loadWords()
  }, [activeProjectId])

  // 右键菜单:点击外部 / 滚动 / Esc 关闭
  useEffect(() => {
    if (!ctxMenu) return
    const onClick = () => setCtxMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null) }
    window.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  // 视口边界检测:menu 渲染后测量,越界则翻转锚点,避免被截断。
  // 关键:不能拿 menuPos 门控 portal 渲染——useLayoutEffect 第一次跑时 portal
  // 还没 mount,ctxMenuRef.current === null,如果这时 setMenuPos(null) 就死循环。
  // 改为:menuPos 是修正后的位置,初始为 null,渲染时 fallback 到 ctxMenu.x/y。
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!ctxMenu) {
      setMenuPos(null)
      return
    }
    // 第一帧 ref.current 可能还是 null(commit 后立刻跑 layout effect,portal DOM 异步)——
    // 用 requestAnimationFrame 等下一帧 ref attach 后再测量
    const raf = requestAnimationFrame(() => {
      if (!ctxMenuRef.current) return
      const rect = ctxMenuRef.current.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      let left = ctxMenu.x
      let top = ctxMenu.y
      if (left + rect.width > vw) left = Math.max(0, vw - rect.width)
      if (top + rect.height > vh) top = Math.max(0, vh - rect.height)
      setMenuPos((prev) => {
        // 没变就不 setState(避免重渲)
        if (prev && prev.left === left && prev.top === top) return prev
        return { left, top }
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [ctxMenu])

  const loadWords = async () => {
    const list = await window.electronAPI.sensitive.list()
    setWords(list)
  }

  const handleAddWord = async () => {
    const word = newWord.trim()
    if (!word) return
    await window.electronAPI.sensitive.add({ id: generateId(), word })
    setNewWord('')
    loadWords()
  }

  const handleRemoveWord = async (id: string) => {
    await window.electronAPI.sensitive.remove(id)
    loadWords()
  }

  const handleSaveRestrictions = async () => {
    if (!activeProjectId) return
    await setStyleRestrictions(restrictionsText)
    pushChange(activeProjectId, 'style', '', '规则与限制已更新')
    setOriginalText(restrictionsText)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const isDirty = restrictionsText !== originalText

  const openCtxMenu = (e: React.MouseEvent, w: any) => {
    e.preventDefault()
    if (w.is_builtin) return
    setCtxMenu({ x: e.clientX, y: e.clientY, wordId: w.id, wordText: w.word })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col min-h-0 border-b">
          <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground flex items-center justify-between shrink-0">
            <span>敏感词管理</span>
            <span className="text-[10px] font-normal opacity-60">共 {words.length} 个</span>
          </div>
          <div className="flex items-center gap-2 px-2 pb-2 shrink-0">
            <div className="relative flex-1">
              <Shield className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                placeholder="添加屏蔽词..."
                className="h-8 text-xs pl-8"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddWord() }}
              />
            </div>
            <Button size="sm" className="h-8 text-xs shrink-0" onClick={handleAddWord} disabled={!newWord.trim()}>
              <Plus className="h-3.5 w-3.5 mr-1" /> 添加
            </Button>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-2 pb-2">
              {words.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-2">还没有任何敏感词</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {words.map((w) => (
                    <div
                      key={w.id}
                      onContextMenu={(e) => openCtxMenu(e, w)}
                      className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs border transition-all min-w-[2.5rem] ${
                        w.is_builtin
                          ? 'border-dashed border-muted-foreground/30 bg-muted/40 text-muted-foreground/80 cursor-default'
                          : 'border-border/60 bg-background hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm cursor-context-menu'
                      }`}
                    >
                      {w.word}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-2 pt-2 pb-1 flex items-center justify-between shrink-0">
            <div>
              <div className="text-xs font-medium text-muted-foreground">规则与限制</div>
              <p className="text-[11px] text-muted-foreground">
                当前作品的写作规则与限制。AI 将在写作时遵守这些规则与限制。
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {saved && <span className="text-xs text-green-600">已保存</span>}
              <Button size="sm" onClick={handleSaveRestrictions} disabled={!activeProjectId || !isDirty}>保存规则</Button>
            </div>
          </div>
          <div className="flex-1 min-h-0 p-2">
            <Textarea
              value={restrictionsText}
              onChange={(e) => setRestrictionsText(e.target.value)}
              placeholder={`建议简短描述，每行一条，例如：\n在每个章节末尾留下钩子\n禁止使用「不是......而是......」句式\n禁止讨论两性话题\n避免使用成语`}
              className="h-full text-sm resize-none"
            />
          </div>
        </div>

      {ctxMenu && createPortal(
        <div
          ref={ctxMenuRef}
          style={{
            left: menuPos?.left ?? ctxMenu.x,
            top: menuPos?.top ?? ctxMenu.y,
          }}
          className="fixed z-50 min-w-[120px] bg-popover border border-border rounded-md shadow-md py-1 text-xs"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              handleRemoveWord(ctxMenu.wordId)
              setCtxMenu(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-destructive/10 hover:text-destructive text-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>删除 "{ctxMenu.wordText}"</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
