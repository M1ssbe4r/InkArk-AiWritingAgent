import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useKnowledgeStore, type KnowledgeItem } from '@/stores/knowledgeStore'
import { useEditorStore } from '@/stores/editorStore'
import { ImportDialog } from './ImportDialog'
import { Plus, FileText, Loader2, Edit3, XCircle, Cpu, Check, Ban, RotateCw, Crown } from 'lucide-react'

function ItemList({
  items,
  activeProjectId,
  onDelete,
  onRename,
  onToggle,
  onIndex,
  indexingId,
  indexProgress,
}: {
  items: KnowledgeItem[]
  activeProjectId: string | null
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onToggle: (itemId: string, currentEnabled: boolean) => void
  onIndex: (itemId: string) => void
  indexingId: string | null
  indexProgress: { current: number; total: number } | null
}) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; item: KnowledgeItem } | null>(null)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renamingItem, setRenamingItem] = useState<KnowledgeItem | null>(null)
  const [newName, setNewName] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)

  // 渲染后测量实际尺寸，如果溢出右/下边界则反向定位，避免被裁切
  useLayoutEffect(() => {
    if (!ctxMenu || !menuRef.current) {
      setMenuPos(null)
      return
    }
    const el = menuRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const padding = 8  // 距离屏幕边缘保留 8px
    let left = ctxMenu.x
    let top = ctxMenu.y
    if (left + rect.width + padding > vw) {
      left = Math.max(padding, vw - rect.width - padding)
    }
    if (top + rect.height + padding > vh) {
      top = Math.max(padding, vh - rect.height - padding)
    }
    setMenuPos({ left, top })
  }, [ctxMenu])

  useEffect(() => {
    if (!ctxMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setCtxMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ctxMenu])

  if (items.length === 0) {
    return (
      <div className="text-center text-xs text-muted-foreground py-4">
        暂无条目
      </div>
    )
  }

  const openRenameDialog = (item: KnowledgeItem) => {
    setRenamingItem(item)
    setNewName(item.name)
    setRenameDialogOpen(true)
  }

  const handleRenameConfirm = () => {
    if (renamingItem && newName.trim()) {
      onRename(renamingItem.id, newName.trim())
      setRenameDialogOpen(false)
      setRenamingItem(null)
      setNewName('')
    }
  }

  return (
    <div className="space-y-0.5">
      {items.map((item) => {
        const isIndexed = item.chunk_count > 0
        const isIndexing = indexingId === item.id
        const progress = isIndexing && indexProgress && indexProgress.total > 0
          ? Math.round((indexProgress.current / indexProgress.total) * 100)
          : null

        return (
          <div
            key={item.id}
            className={`rounded border px-1.5 py-1 hover:bg-accent/50 cursor-default ${
              isIndexed ? 'border-green-500' : ''
            }`}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, item }) }}
          >
            <div className="flex items-center gap-1">
              <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="text-xs font-medium truncate flex-1">{item.name}</span>
              {isIndexing && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
              )}
            </div>
            {progress !== null && (
              <div className="mt-1 flex items-center gap-1.5">
                <div className="flex-1 bg-muted rounded-full h-1 overflow-hidden">
                  <div
                    className="bg-primary h-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">
                  {indexProgress!.current}/{indexProgress!.total}
                </span>
              </div>
            )}
            {isIndexed && (
              <span className="inline-block text-[9px] text-green-600 bg-green-50 px-0.5 rounded mt-0.5">已向量化</span>
            )}
            {item.file_name && (
              <div className="text-[10px] text-muted-foreground mt-0.5 break-all">{item.file_name}</div>
            )}
          </div>
        )
      })}

      {ctxMenu && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 w-36 rounded-md border bg-popover p-1 shadow-md"
          style={{
            // 第一次渲染时先用 ctxMenu 坐标（不可见），useLayoutEffect 测量后用修正后的坐标
            left: menuPos?.left ?? ctxMenu.x,
            top: menuPos?.top ?? ctxMenu.y,
            visibility: menuPos ? 'visible' : 'hidden',
          }}
        >
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent" onClick={() => { openRenameDialog(ctxMenu.item); setCtxMenu(null) }}>
            <Edit3 className="h-3.5 w-3.5" /> 重命名
          </button>
          {activeProjectId && (
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent" onClick={() => { onToggle(ctxMenu.item.id, ctxMenu.item.enabled === 1); setCtxMenu(null) }}>
              {ctxMenu.item.enabled === 1 ? <Ban className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
              {ctxMenu.item.enabled === 1 ? '禁用' : '启用'}
            </button>
          )}
          {!ctxMenu.item.chunk_count && (
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50" onClick={() => { onIndex(ctxMenu.item.id); setCtxMenu(null) }} disabled={indexingId === ctxMenu.item.id}>
              <Cpu className="h-3.5 w-3.5" /> 向量化
            </button>
          )}
          {ctxMenu.item.chunk_count > 0 && (
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50" onClick={() => { onIndex(ctxMenu.item.id); setCtxMenu(null) }} disabled={indexingId === ctxMenu.item.id}>
              <RotateCw className="h-3.5 w-3.5" /> 重新向量化
            </button>
          )}
          <div className="my-1 border-t" />
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent text-destructive" onClick={() => { onDelete(ctxMenu.item.id); setCtxMenu(null) }}>
            <XCircle className="h-3.5 w-3.5" /> 删除
          </button>
        </div>,
        document.body
      )}

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[300px]">
          <DialogHeader>
            <DialogTitle className="text-sm">重命名条目</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="输入新名称"
              className="h-8 text-xs"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameConfirm() }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setRenameDialogOpen(false)}>
              取消
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleRenameConfirm} disabled={!newName.trim()}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function KnowledgePanel() {
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const {
    items,
    projectItems,
    isLoading,
    loadItems,
    loadProjectItems,
    deleteItem,
    updateItem,
    toggleProjectItem,
    loadVectorStatus,
    vectorStatus,
    indexItem
  } = useKnowledgeStore()

  const [importOpen, setImportOpen] = useState(false)
  const [indexingId, setIndexingId] = useState<string | null>(null)
  // KnowledgePanel 层持有 indexProgress,通过 prop 传给 ItemList 显示
  // 用 ref 跟踪 indexingId,订阅只在挂载时跑一次,避免卸载/重装丢事件
  const [indexProgress, setIndexProgress] = useState<{ current: number; total: number } | null>(null)
  const indexingIdRef = useRef<string | null>(null)

  useEffect(() => {
    const unsub = window.electronAPI.vector.onIndexProgress((data) => {
      if (data.itemId === indexingIdRef.current) {
        setIndexProgress({ current: data.current, total: data.total })
        if (data.current >= data.total) {
          setTimeout(() => setIndexProgress(null), 1500)
        }
      }
    })
    return () => { unsub() }
  }, [])

  useEffect(() => {
    loadItems()
    loadVectorStatus()
  }, [])

  useEffect(() => {
    if (activeProjectId) {
      loadProjectItems(activeProjectId)
    }
  }, [activeProjectId])

  const allItems = activeProjectId ? projectItems : items
  const enabledItems = allItems.filter(item => item.enabled === 1)
  const disabledItems = allItems.filter(item => item.enabled !== 1)

  const handleDelete = async (id: string) => {
    const confirmed = await window.electronAPI.dialog.confirm('确定要删除此条目吗？删除后无法恢复。')
    if (confirmed) {
      await deleteItem(id)
      if (activeProjectId) {
        await loadProjectItems(activeProjectId)
      }
      loadVectorStatus()
    }
  }

  const handleRename = async (id: string, name: string) => {
    await updateItem({ id, name })
    if (activeProjectId) {
      await loadProjectItems(activeProjectId)
    }
  }

  const handleToggle = async (itemId: string, currentEnabled: boolean) => {
    if (!activeProjectId) return
    await toggleProjectItem(activeProjectId, itemId, !currentEnabled)
  }

  const handleIndex = async (itemId: string) => {
    setIndexingId(itemId)
    indexingIdRef.current = itemId
    try {
      const result = await indexItem(itemId)
      if (result.success) {
        await loadItems()
        if (activeProjectId) {
          await loadProjectItems(activeProjectId)
        }
        loadVectorStatus()
      }
    } catch (err) {
      console.error('Index failed:', err)
    } finally {
      setIndexingId(null)
      indexingIdRef.current = null
    }
  }

  const handleImportComplete = () => {
    loadItems()
    if (activeProjectId) {
      loadProjectItems(activeProjectId)
    }
    loadVectorStatus()
  }

  const openImport = () => {
    setImportOpen(true)
  }

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 overflow-hidden">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 min-w-0 h-8 text-xs truncate"
          onClick={openImport}
        >
          <Plus className="h-3.5 w-3.5 mr-1 shrink-0" />
          <span className="truncate">导入资料</span>
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {allItems.length === 0 && !isLoading ? (
            <div className="text-center text-xs text-muted-foreground py-4 px-2">
              暂无参考资料
              <div className="mt-1 text-[10px]">
                导入参考资料后，AI 会按需搜索资料辅助写作。适用于同人文与小众领域。
              </div>
            </div>
          ) : (
            <>
              {activeProjectId && (
                <div className="mb-3">
                  <div className="px-2 py-1.5 text-xs font-semibold text-foreground border-b">
                    已启用
                  </div>
                  {enabledItems.length > 0 ? (
                    <ItemList
                      items={enabledItems}
                      activeProjectId={activeProjectId}
                      onDelete={handleDelete}
                      onRename={handleRename}
                      onToggle={handleToggle}
                      onIndex={handleIndex}
                      indexingId={indexingId}
                      indexProgress={indexProgress}
                    />
                  ) : (
                    <div className="text-center text-xs text-muted-foreground py-4">暂无条目</div>
                  )}
                </div>
              )}

              {activeProjectId && (
                <div className="mb-3">
                  <div className="px-2 py-1.5 text-xs font-semibold text-foreground border-b">
                    未启用
                  </div>
                  {disabledItems.length > 0 ? (
                    <ItemList
                      items={disabledItems}
                      activeProjectId={activeProjectId}
                      onDelete={handleDelete}
                      onRename={handleRename}
                      onToggle={handleToggle}
                      onIndex={handleIndex}
                      indexingId={indexingId}
                      indexProgress={indexProgress}
                    />
                  ) : (
                    <div className="text-center text-xs text-muted-foreground py-4">暂无条目</div>
                  )}
                </div>
              )}

              {!activeProjectId && (
                <ItemList
                  items={allItems}
                  activeProjectId={activeProjectId}
                  onDelete={handleDelete}
                  onRename={handleRename}
                  onToggle={handleToggle}
                  onIndex={handleIndex}
                  indexingId={indexingId}
                  indexProgress={indexProgress}
                />
              )}
            </>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </ScrollArea>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImportComplete={handleImportComplete}
        activeProjectId={activeProjectId}
      />
    </div>
    </TooltipProvider>
  )
}
