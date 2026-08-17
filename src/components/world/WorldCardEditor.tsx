import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { generateId } from '@/lib/utils'
import { pushChange } from '@/lib/editorRef'
import type { WorldCard } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  card?: WorldCard | null
  onSaved: () => void
}

const types = [
  { value: 'location', label: '地点' },
  { value: 'organization', label: '组织' },
  { value: 'rule', label: '规则' },
  { value: 'item', label: '物品' },
  { value: 'other', label: '其他' },
]

export function WorldCardEditor({ open, onOpenChange, projectId, card, onSaved }: Props) {
  const [form, setForm] = useState({
    name: '', card_type: 'location', description: '', tags: '', card_group: '', parent_id: '', notes: '',
  })
  const contentRef = useRef<HTMLDivElement>(null)

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      if (!contentRef.current) return
      contentRef.current.querySelectorAll('textarea').forEach((ta) => {
        ta.style.height = 'auto'
        ta.style.height = ta.scrollHeight + 'px'
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (card) {
      setForm({
        name: card.name, card_type: card.card_type || 'location', description: card.description || '',
        tags: (card.tags || []).join(', '), card_group: card.card_group || '',
        parent_id: card.parent_id || '', notes: card.notes || '',
      })
    } else {
      setForm({ name: '', card_type: 'location', description: '', tags: '', card_group: '', parent_id: '', notes: '' })
    }
  }, [card, open])

  const handleSave = async () => {
    if (!form.name.trim()) return
    const data = {
      id: card?.id || generateId(),
      project_id: projectId,
      name: form.name.trim(),
      card_type: form.card_type,
      description: form.description.trim(),
      tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
      card_group: form.card_group.trim(),
      parent_id: form.parent_id.trim() || null,
      sort_order: card?.sort_order || 0,
      notes: form.notes.trim(),
    }
    if (card) {
      await window.electronAPI.world.update(data)
      if (projectId) pushChange(projectId, 'world', card.id, `世界观更新：${data.name}`)
    } else {
      await window.electronAPI.world.create(data)
      if (projectId) pushChange(projectId, 'world', data.id, `世界观新增：${data.name}`)
    }
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={contentRef} className="max-w-[50vw] w-[50vw] h-[50vh] grid-rows-[auto_1fr_auto]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>{card ? '编辑设定' : '新建设定'}</DialogTitle></DialogHeader>
        <div className="overflow-y-auto min-h-0 space-y-3 px-1">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>名称 *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="设定名称" /></div>
            <div><Label>类型</Label>
              <Select value={form.card_type} onValueChange={(v) => setForm({ ...form, card_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>标签</Label><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="逗号分隔" /></div>
          <div><Label>分组</Label><Input value={form.card_group} onChange={(e) => setForm({ ...form, card_group: e.target.value })} placeholder="分组名称" /></div>
          <div><Label>上级设定（可选）</Label><Input value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })} placeholder="上级设定的 ID" /></div>
          <div><Label>详细描述</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} onInput={(e) => autoResize(e.currentTarget)} className="text-sm overflow-hidden" rows={1} /></div>
          <div><Label>备注</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} onInput={(e) => autoResize(e.currentTarget)} className="text-sm overflow-hidden" rows={1} /></div>
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
          <Button size="sm" onClick={handleSave} disabled={!form.name.trim()}>保存</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
