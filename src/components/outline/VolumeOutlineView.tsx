import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { VolumeAccordionItem } from './VolumeAccordionItem'
import { LegacyOutlineViewer } from './LegacyOutlineViewer'
import { Button } from '@/components/ui/button'
import { BookOpen, Plus, FileText } from 'lucide-react'
import { generateId } from '@/lib/utils'
import { pushChange, resolvePendingOutline } from '@/lib/editorRef'
import type { OutlineVolume } from '@/types'
import { ScrollArea } from '@/components/ui/scroll-area'

export function VolumeOutlineView() {
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const projects = useEditorStore((s) => s.projects)
  const volumes = useEditorStore((s) => s.volumes)
  const activeVolumeId = useEditorStore((s) => s.activeVolumeId)
  const setVolumes = useEditorStore((s) => s.setVolumes)
  const setActiveVolumeId = useEditorStore((s) => s.setActiveVolumeId)
  const pendingVolumeEdit = useEditorStore((s) => s.pendingVolumeEdit)

  const currentProject = projects.find((p) => p.id === activeProjectId)
  const pendingVolumeRef = useRef<HTMLDivElement>(null)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const legacyOutline = (currentProject?.outline || '').trim()

  // 审阅中自动滚动到对应卷
  useEffect(() => {
    if (!pendingVolumeEdit || !pendingVolumeRef.current) return
    pendingVolumeRef.current.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [pendingVolumeEdit?.volumeId, pendingVolumeEdit?.modified])

  const persistVolume = useCallback(async (volume: OutlineVolume, patch: Partial<OutlineVolume>) => {
    const merged = { ...volume, ...patch }
    try {
      const saved = await window.electronAPI.volume.save(merged)
      setVolumes(volumes.map((v) => (v.id === saved.id ? saved : v)))
    } catch (e: any) {
      console.error('[volume save]', e?.message || e)
    }
  }, [volumes, setVolumes])

  const handleDeleteVolume = async (volume: OutlineVolume, index: number) => {
    const label = volume.title || `第 ${index + 1} 卷`
    const ok = await window.electronAPI.dialog.confirm(`确定删除「${label}」？\n卷内概要将无法恢复。`)
    if (!ok) return
    const store = useEditorStore.getState()
    if (store.pendingVolumeEdit?.volumeId === volume.id) {
      store.setPendingVolumeEdit(null)
      resolvePendingOutline('revert', '卷已删除')
    }
    try {
      await window.electronAPI.volume.delete(volume.id)
      const next = volumes.filter((v) => v.id !== volume.id)
      setVolumes(next)
      if (activeVolumeId === volume.id) {
        setActiveVolumeId(next[0]?.id ?? null)
      }
      if (activeProjectId) {
        pushChange(activeProjectId, 'outline', volume.id, `删除卷：${label}`)
      }
    } catch (e: any) {
      console.error('[volume delete]', e?.message || e)
    }
  }

  const handleAddVolume = async () => {
    if (!activeProjectId) return
    const vol: OutlineVolume = {
      id: generateId(),
      project_id: activeProjectId,
      sort_order: volumes.length,
      title: `第 ${volumes.length + 1} 卷`,
      outline: '',
      chapter_start: null,
      chapter_end: null,
      status: 'planned',
      progress_notes: '',
    }
    try {
      const saved = await window.electronAPI.volume.save(vol)
      setVolumes([...volumes, saved])
      setActiveVolumeId(saved.id)
    } catch (e: any) {
      console.error(e)
    }
  }

  if (!currentProject || !activeProjectId) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">请选择项目</div>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BookOpen className="h-4 w-4" />
          全书大纲
        </div>
        <div className="flex items-center gap-2">
          {legacyOutline && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLegacyOpen(true)}
              title="查看旧版大纲原文"
            >
              <FileText className="mr-1 h-3.5 w-3.5" />
              查看旧版大纲
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleAddVolume}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            添加卷
          </Button>
        </div>
      </div>


      <ScrollArea className="flex-1">
        {volumes.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">暂无卷，点击「添加卷」创建。</p>
        ) : (
          volumes.map((vol, i) => {
            const isPending = pendingVolumeEdit?.volumeId === vol.id
            const expanded = activeVolumeId === vol.id || isPending
            return (
              <div key={vol.id} ref={isPending ? pendingVolumeRef : undefined}>
                <VolumeAccordionItem
                  volume={vol}
                  index={i}
                  expanded={expanded}
                  onToggle={() => setActiveVolumeId(activeVolumeId === vol.id ? null : vol.id)}
                  onSave={(patch) => persistVolume(vol, patch)}
                  onDelete={() => handleDeleteVolume(vol, i)}
                  pendingSummaryEdit={isPending ? pendingVolumeEdit : null}
                />
              </div>
            )
          })
        )}
      </ScrollArea>

      {legacyOutline && (
        <LegacyOutlineViewer
          open={legacyOpen}
          onOpenChange={setLegacyOpen}
          outlineHtml={legacyOutline}
        />
      )}
    </div>
  )
}
