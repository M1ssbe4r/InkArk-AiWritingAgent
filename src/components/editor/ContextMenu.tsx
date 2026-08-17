import { useEffect, useRef, useLayoutEffect, useState, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { setPendingAction } from '@/lib/editorRef'
import { Sparkles, Shrink, Expand, MessageSquare, Wand2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface Props {
  x: number
  y: number
  selectedText: string
  chapterIndex?: number
  paragraphIndices?: number[]
  mode: 'chapter' | 'outline'
  onClose: () => void
}

const chapterItems = [
  { action: 'polish' as const, label: '润色', icon: Sparkles },
  { action: 'condense' as const, label: '缩写', icon: Shrink },
  { action: 'expand' as const, label: '扩写', icon: Expand },
  { action: 'sendToChat' as const, label: '发送到聊天框', icon: MessageSquare },
]

const outlineItems = [
  { action: 'sendToChat' as const, label: '发送到聊天框', icon: MessageSquare },
]

export function ContextMenu({
  x,
  y,
  selectedText,
  chapterIndex,
  paragraphIndices,
  mode,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [customMode, setCustomMode] = useState<'menu' | 'input'>('menu')
  const [customPrompt, setCustomPrompt] = useState('')
  const items = mode === 'chapter' ? chapterItems : outlineItems

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x
    let top = y
    if (rect.right > vw) {
      left = Math.max(0, x - rect.width)
    }
    if (rect.bottom > vh) {
      top = Math.max(0, y - rect.height)
    }
    setPos({ left, top })
  }, [x, y])

  useEffect(() => {
    if (customMode === 'input') {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [customMode])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const buildPendingBase = () => ({
    text: selectedText,
    chapterIndex,
    paragraphIndices,
  })

  const handleClick = (action: string) => {
    if (action === 'sendToChat') {
      setPendingAction({ action: 'sendToChat', text: selectedText })
      onClose()
      return
    }
    setPendingAction({ action: action as any, ...buildPendingBase() })
    onClose()
  }

  const handleCustomSubmit = () => {
    const prompt = customPrompt.trim()
    if (!prompt) return
    setPendingAction({ action: 'customCommand', ...buildPendingBase(), customPrompt: prompt })
    onClose()
  }

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 w-72 rounded-md border bg-popover p-1.5 shadow-md"
      style={{ left: pos.left, top: pos.top }}
    >
      {customMode === 'menu' && (
        <>
          {items.map((item) => {
            if (item.action === 'sendToChat') {
              return (
                <Fragment key="__custom__wrap">
                  <button
                    onClick={() => setCustomMode('input')}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    自定义指令
                  </button>
                  <button
                    key={item.action}
                    onClick={() => handleClick(item.action)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                </Fragment>
              )
            }
            return (
              <button
                key={item.action}
                onClick={() => handleClick(item.action)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            )
          })}
        </>
      )}
      {customMode === 'input' && (
        <div className="flex flex-col gap-1.5 p-1">
          <div className="text-[10px] text-muted-foreground px-1">
            输入自定义指令，将与选中文本一起发送给 AI
          </div>
          <Input
            ref={inputRef}
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="例如：改写得更符合主角人设..."
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleCustomSubmit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
          />
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2" onClick={onClose}>
              取消
            </Button>
            <Button
              size="sm"
              className="h-6 text-[11px] px-2"
              onClick={handleCustomSubmit}
              disabled={!customPrompt.trim()}
            >
              确定
            </Button>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
