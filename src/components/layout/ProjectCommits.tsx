import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { useEditorStore } from '@/stores/editorStore'
import { flushChapterSave, flushVolumeSave } from '@/lib/editorRef'
import { Clock, RotateCcw, Plus, Trash2, Database } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface CommitEntry {
  id: string
  parent_id: string | null
  message: string
  manifest: string
  created_at: string
}

function entityName(key: string, val: string): string {
  if (key.startsWith('chapter:')) {
    try { const p = JSON.parse(val); return p.s !== undefined ? `第${p.s + 1}章 ${p.n || ''}` : (p.n || '') } catch {}
    return ''
  }
  if (key.startsWith('character:')) {
    try { const n = JSON.parse(val).n; return n ? `角色卡：${n}` : '' } catch {}
    return ''
  }
  if (key.startsWith('world:')) {
    try { const n = JSON.parse(val).n; return n ? `世界观：${n}` : '' } catch {}
    return ''
  }
  if (key.startsWith('volume:')) {
    try {
      const p = JSON.parse(val)
      const title = p.n ? `：${p.n}` : ''
      const order = p.s !== undefined ? `第${p.s + 1}卷` : '卷'
      return `卷级大纲（${order}${title}）`
    } catch {}
    return '卷级大纲'
  }
  if (key === 'volumes_empty') return '卷级大纲（已清空）'
  if (key === 'outline') return '全书大纲（旧版备份）'
  if (key === 'project_title') return '项目标题'
  return ''
}

function entityHash(val: string): string {
  try {
    const p = JSON.parse(val)
    if (p && typeof p === 'object' && p.h) return p.h
  } catch {}
  return val
}

function computeSummary(manifestStr: string, parentManifestStr: string | null): string[] {
  const lines: string[] = []
  if (!parentManifestStr) {
    lines.push('初始状态')
    return lines
  }

  const current: Record<string, string> = JSON.parse(manifestStr)
  const parent: Record<string, string> = JSON.parse(parentManifestStr)

  const changed: string[] = []
  const added: string[] = []
  const removed: string[] = []

  for (const [key, val] of Object.entries(current)) {
    if (!(key in parent)) {
      added.push(key)
    } else if (entityHash(parent[key]) !== entityHash(val)) {
      changed.push(key)
    }
  }
  for (const key of Object.keys(parent)) {
    if (!(key in current)) {
      removed.push(key)
    }
  }

  const formatList = (keys: string[]): string => {
    const items = keys
      .map((k) => entityName(k, current[k] || parent[k]))
      .filter(Boolean)
    return items.join('、')
  }

  if (changed.length > 0) {
    const s = formatList(changed)
    if (s) lines.push(`修改 ${s}`)
  }
  if (added.length > 0) {
    const s = formatList(added)
    if (s) lines.push(`新增 ${s}`)
  }
  if (removed.length > 0) {
    const s = formatList(removed)
    if (s) lines.push(`删除 ${s}`)
  }

  if (lines.length === 0) lines.push('无变动')
  return lines
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function ProjectCommits({ open, onOpenChange }: Props) {
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const [commits, setCommits] = useState<CommitEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [totalSize, setTotalSize] = useState(0)
  const [commitCount, setCommitCount] = useState(0)

  const loadData = useCallback(async () => {
    if (!activeProjectId) return
    const [list, stats] = await Promise.all([
      window.electronAPI.version.list(activeProjectId),
      window.electronAPI.version.stats(activeProjectId),
    ])
    setCommits(list)
    setTotalSize(stats.totalSize)
    setCommitCount(stats.count)
  }, [activeProjectId])

  useEffect(() => {
    if (open && activeProjectId) {
      setSelectedId(null)
      setCommitMessage('')
      loadData()
    }
  }, [open, activeProjectId, loadData])

  const handleCommit = async () => {
    if (!activeProjectId) return
    await flushChapterSave()
    await flushVolumeSave()
    const msg = commitMessage.trim() || `手动提交 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    await window.electronAPI.version.commit(activeProjectId, msg)
    setCommitMessage('')
    loadData()
  }

  const handleRestore = async (commitId: string) => {
    if (!activeProjectId) return
    const ok = await window.electronAPI.dialog.confirm('确定恢复到此版本？\n当前状态将自动保存，不会丢失。')
    if (!ok) return
    await flushChapterSave()
    await flushVolumeSave()
    const store = useEditorStore.getState()
    store.setDirty(false)
    store.setPendingVolumeEdit(null)
    await window.electronAPI.version.restore(activeProjectId, commitId)
    const projects = await window.electronAPI.project.list()
    store.setProjects(projects)
    await Promise.all([
      store.loadChapters(activeProjectId),
      store.loadVolumes(activeProjectId),
    ])
    store.incrementDataVersion()
    onOpenChange(false)
  }

  const handleDeleteCommit = async (commitId: string) => {
    if (!activeProjectId) return
    const ok = await window.electronAPI.dialog.confirm('确定删除此版本？此操作不可撤销。')
    if (!ok) return
    await window.electronAPI.version.deleteCommit(activeProjectId, commitId)
    setSelectedId(null)
    loadData()
  }

  const handleClearAll = async () => {
    if (!activeProjectId) return
    const ok = await window.electronAPI.dialog.confirm(`确定清除全部版本历史？\n当前共 ${commitCount} 条记录，占用 ${formatSize(totalSize)}。\n此操作不可撤销。`)
    if (!ok) return
    await window.electronAPI.version.deleteProjectCommits(activeProjectId)
    loadData()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[75vh] flex flex-col">
        <DialogHeader className="flex-row items-center justify-between shrink-0">
          <DialogTitle>
            <div className="flex items-center gap-2">
              <span>项目版本历史</span>
              {commitCount > 0 && (
                <span className="text-xs text-muted-foreground font-normal flex items-center gap-1">
                  <Database className="h-3 w-3" />
                  {commitCount} 条 / {formatSize(totalSize)}
                </span>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 items-center shrink-0 pb-3">
          <Input
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="提交说明（可选）..."
            className="h-8 text-xs flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleCommit() }}
          />
          <Button size="sm" className="h-8 text-xs" onClick={handleCommit} disabled={!activeProjectId}>
            <Plus className="h-3 w-3 mr-1" /> 提交版本
          </Button>
          {commitCount > 0 && (
            <Button variant="outline" size="sm" className="h-8 text-xs text-destructive" onClick={handleClearAll}>
              <Trash2 className="h-3 w-3 mr-1" /> 清除全部
            </Button>
          )}
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-2">
            {commits.length === 0 && (
              <p className="text-xs text-muted-foreground p-4 text-center">暂无版本记录</p>
            )}
            {commits.map((c) => {
              const parent = c.parent_id ? commits.find((p) => p.id === c.parent_id)?.manifest || null : null
              const summaryLines = computeSummary(c.manifest, parent)
              const isSelected = selectedId === c.id
              return (
                <div
                  key={c.id}
                  className={`rounded-lg border px-4 py-3 cursor-pointer transition-colors ${isSelected ? 'bg-accent border-primary/30' : 'hover:bg-accent/50'}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3 shrink-0" />
                      {new Date(c.created_at).toLocaleString('zh-CN')}
                    </div>
                    {isSelected && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={(e) => { e.stopPropagation(); handleRestore(c.id) }}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" /> 恢复
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs text-destructive"
                          onClick={(e) => { e.stopPropagation(); handleDeleteCommit(c.id) }}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> 删除
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="text-sm font-medium mt-1">{c.message || '无说明'}</div>
                  <div className="text-xs text-muted-foreground mt-1 space-y-0.5 leading-relaxed">
                    {summaryLines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>

      </DialogContent>
    </Dialog>
  )
}
