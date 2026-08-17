import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useEditorStore } from '@/stores/editorStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { generateId } from '@/lib/utils'
import {
  setStyleGuidance,
  setStyleCustom,
  getStyleGuidance,
  getStyleCustomId,
  pushChange,
} from '@/lib/editorRef'
import { Plus, Trash2, Pencil, X } from 'lucide-react'

const builtInStyles = [
  { name: '默认', guidance: '' },
  { name: '古风', guidance: '使用半文半白的典雅文风，适当融入诗词意象，对话文雅含蓄。' },
  { name: '热血', guidance: '节奏紧凑激烈，战斗场面突出，情绪渲染强烈，对话干脆有力。' },
  { name: '轻松', guidance: '文风轻松幽默，多使用口语化和调侃语气，节奏明快。' },
  { name: '悬疑', guidance: '氛围压抑神秘，细节埋设伏笔，节奏张弛有度，对话留有悬念。' },
  { name: '细腻', guidance: '心理描写丰富，环境渲染细腻，情感刻画深入，节奏舒缓。' },
]

interface CustomStyle {
  id: string
  name: string
  guidance: string
}

export function StylePanel() {
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const [currentGuidance, setCurrentGuidance] = useState(getStyleGuidance())
  const [currentCustomId, setCurrentCustomId] = useState<string | null>(getStyleCustomId())
  const [customStyles, setCustomStyles] = useState<CustomStyle[]>([])
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingStyleId, setEditingStyleId] = useState<string | null>(null)
  const [newStyleName, setNewStyleName] = useState('')
  const [newStyleGuidance, setNewStyleGuidance] = useState('')

  // Reload custom styles when project changes
  useEffect(() => {
    let cancelled = false
    if (!activeProjectId) {
      setCustomStyles([])
      setCurrentGuidance('')
      setCurrentCustomId(null)
      return
    }
    window.electronAPI.customStyle.list().then(rows => {
      if (cancelled) return
      setCustomStyles(rows as CustomStyle[])
    })
    window.electronAPI.project.getStyle(activeProjectId).then(s => {
      if (cancelled) return
      setCurrentGuidance(s.guidance || '')
      setCurrentCustomId(s.customStyleId ?? null)
    })
    return () => { cancelled = true }
  }, [activeProjectId])

  const openAddDialog = () => {
    setEditingStyleId(null)
    setNewStyleName('')
    setNewStyleGuidance('')
    setShowAddDialog(true)
  }

  const openEditDialog = (style: CustomStyle) => {
    setEditingStyleId(style.id)
    setNewStyleName(style.name)
    setNewStyleGuidance(style.guidance)
    setShowAddDialog(true)
  }

  const handleSaveStyle = async () => {
    if (!newStyleName.trim() || !activeProjectId) return
    const name = newStyleName.trim()
    const guidance = newStyleGuidance.trim()
    if (editingStyleId) {
      const result = await window.electronAPI.customStyle.update({
        id: editingStyleId,
        name,
        guidance,
      })
      if (!result?.success) return
      const next = customStyles.map((s) =>
        s.id === editingStyleId ? { ...s, name, guidance } : s
      )
      setCustomStyles(next)
      // If this style is currently bound to the project, refresh guidance cache
      if (currentCustomId === editingStyleId) {
        setCurrentGuidance(guidance)
      }
    } else {
      const id = generateId()
      const result = await window.electronAPI.customStyle.create({
        id,
        name,
        guidance,
      })
      if (!result?.success) return
      setCustomStyles([...customStyles, { id, name, guidance }])
    }
    setNewStyleName('')
    setNewStyleGuidance('')
    setEditingStyleId(null)
    setShowAddDialog(false)
  }

  const handleRemoveStyle = async (id: string) => {
    const result = await window.electronAPI.customStyle.delete(id)
    if (!result?.success) return
    setCustomStyles(customStyles.filter((s) => s.id !== id))
    // If deleted style was bound to current project, clear it
    if (currentCustomId === id) {
      // 同步刷新 editorRef 模块级 cache(styleGuidanceCache / styleCustomIdCache),
      // 否则 AIPanel 下次发消息时 getStyleGuidance() 仍返回已删内容
      await setStyleCustom(null)
      setCurrentCustomId(null)
      setCurrentGuidance('')
      if (activeProjectId) pushChange(activeProjectId, 'style', '', '自定义风格已删除,已重置为默认')
    }
  }

  const handleSelectBuiltIn = async (guidance: string) => {
    if (!activeProjectId) return
    await setStyleGuidance(guidance)
    setCurrentGuidance(guidance)
    setCurrentCustomId(null)
    pushChange(activeProjectId, 'style', '', '风格要求已更新')
  }

  const handleSelectCustom = async (style: CustomStyle) => {
    if (!activeProjectId) return
    await setStyleCustom(style.id)
    setCurrentGuidance(style.guidance)
    setCurrentCustomId(style.id)
    pushChange(activeProjectId, 'style', '', '风格要求已更新')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b p-2">
        <Button variant="outline" size="sm" className="w-full" onClick={openAddDialog}>
          <Plus className="h-3.5 w-3.5 mr-1" /> 添加自定义风格
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <div className="p-2 space-y-1">
            {customStyles.length > 0 && (
              <div className="mb-1">
                <div className="px-3 py-1 text-xs text-muted-foreground">自定义风格</div>
                {customStyles.map((s) => (
                  <div
                    key={s.id}
                    className={`flex items-start justify-between rounded border px-3 py-2 cursor-pointer hover:bg-sidebar-accent/50 group ${currentCustomId === s.id ? 'bg-sidebar-accent border-primary' : ''}`}
                    onClick={() => handleSelectCustom(s)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{s.name}</div>
                      {s.guidance && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.guidance}</div>}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0 ml-2 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditDialog(s) }}
                        className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemoveStyle(s.id) }}
                        className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="border-t pt-1 mt-1" />
              </div>
            )}
            <div className="px-3 py-1 text-xs text-muted-foreground">内置风格</div>
            {builtInStyles.map((s) => (
              <div
                key={s.name}
                className={`rounded border px-3 py-2 text-sm cursor-pointer hover:bg-sidebar-accent/50 ${currentGuidance === s.guidance && !currentCustomId ? 'bg-sidebar-accent border-primary' : ''}`}
                onClick={() => handleSelectBuiltIn(s.guidance)}
              >
                <div className="font-medium">{s.name}</div>
                {s.guidance && <div className="text-xs text-muted-foreground mt-0.5">{s.guidance}</div>}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {showAddDialog && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowAddDialog(false); setEditingStyleId(null) } }}>
          <div className="bg-background rounded-lg shadow-lg w-[720px] max-w-[90vw] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">{editingStyleId ? '编辑自定义风格' : '添加自定义风格'}</h3>
              <button onClick={() => { setShowAddDialog(false); setEditingStyleId(null) }} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-xs mb-1.5">风格名称</div>
                <Input value={newStyleName} onChange={(e) => setNewStyleName(e.target.value)} placeholder="如：赛博朋克" />
              </div>
              <div>
                <div className="text-xs mb-1.5">风格描述</div>
                <Textarea
                  value={newStyleGuidance}
                  onChange={(e) => setNewStyleGuidance(e.target.value)}
                  placeholder="描述这种写作风格的特点,AI 将按照此描述进行写作..."
                  className="min-h-[360px] text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setShowAddDialog(false); setEditingStyleId(null) }}>取消</Button>
                <Button size="sm" onClick={handleSaveStyle} disabled={!newStyleName.trim()}>
                  {editingStyleId ? '保存' : '添加'}
                </Button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
