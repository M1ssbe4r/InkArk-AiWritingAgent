import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { generateId } from '@/lib/utils'
import { pushChange } from '@/lib/editorRef'
import type { CharacterCard } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  card?: CharacterCard | null
  onSaved: () => void
}

export function CharacterCardEditor({ open, onOpenChange, projectId, card, onSaved }: Props) {
  const [form, setForm] = useState({
    name: '', alias: '', description: '', role: '配角',
    traits: '', appearance: '', background: '', relationships: '', notes: '',
    tags: '', card_group: '', gender: '', age: '',
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
        name: card.name, alias: card.alias || '', description: card.description || '',
        role: card.role || '配角',
        traits: (card.traits || []).join(', '), appearance: card.appearance || '',
        background: card.background || '', relationships: card.relationships || '',
        notes: card.notes || '',
        tags: (card.tags || []).join(', '), card_group: card.card_group || '',
        gender: card.gender || '', age: card.age || '',
      })
    } else {
      setForm({ name: '', alias: '', description: '', role: '配角', traits: '', appearance: '', background: '', relationships: '', notes: '', tags: '', card_group: '', gender: '', age: '' })
    }
  }, [card, open])

  const handleSave = async () => {
    if (!form.name.trim()) return
    const data = {
      id: card?.id || generateId(),
      project_id: projectId,
      name: form.name.trim(),
      alias: form.alias.trim(),
      description: form.description.trim(),
      role: form.role,
      traits: form.traits.split(',').map((s) => s.trim()).filter(Boolean),
      appearance: form.appearance.trim(),
      background: form.background.trim(),
      relationships: form.relationships.trim(),
      notes: form.notes.trim(),
      tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
      card_group: form.card_group.trim(),
      sort_order: card?.sort_order || 0,
      gender: form.gender.trim(),
      age: form.age.trim(),
    }
    if (card) {
      await window.electronAPI.character.update(data)
      if (projectId) pushChange(projectId, 'character', card.id, `角色更新：${data.name}`)
    } else {
      await window.electronAPI.character.create(data)
      if (projectId) pushChange(projectId, 'character', data.id, `角色新增：${data.name}`)
    }
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={contentRef} className="max-w-[50vw] w-[50vw] h-[50vh] grid-rows-[auto_1fr_auto]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>{card ? '编辑角色' : '新建角色'}</DialogTitle></DialogHeader>
        <div className="overflow-y-auto min-h-0 space-y-3 px-1">
          <div className="grid grid-cols-3 gap-3">
            <div><Label>名称 *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="角色名" /></div>
            <div><Label>别名/称号</Label><Input value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} placeholder="别名" /></div>
            <div><Label>定位</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['主角', '配角', '反派', '路人', '其他'].map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>性别</Label>
              <Select value={form.gender || '未知'} onValueChange={(v) => setForm({ ...form, gender: v === '未知' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="未设定" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="未知">未知</SelectItem>
                  <SelectItem value="男">男</SelectItem>
                  <SelectItem value="女">女</SelectItem>
                  <SelectItem value="其他">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>年龄</Label><Input value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} placeholder="17岁 / 中年 / 未知" /></div>
            <div><Label>分组</Label><Input value={form.card_group} onChange={(e) => setForm({ ...form, card_group: e.target.value })} placeholder="宗门/势力的分组名称" /></div>
          </div>
          <div><Label>标签</Label><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="人族, 修士, 主角团（逗号分隔）" /></div>
          <div><Label>性格标签</Label><Input value={form.traits} onChange={(e) => setForm({ ...form, traits: e.target.value })} placeholder="勇敢, 聪明, 多疑（逗号分隔）" /></div>
          <div><Label>外貌描述</Label><Textarea value={form.appearance} onChange={(e) => setForm({ ...form, appearance: e.target.value })} onInput={(e) => autoResize(e.currentTarget)} className="text-sm overflow-hidden" rows={1} /></div>
          <div><Label>详细描述</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} onInput={(e) => autoResize(e.currentTarget)} className="text-sm overflow-hidden" rows={1} /></div>
          <div><Label>背景故事</Label><Textarea value={form.background} onChange={(e) => setForm({ ...form, background: e.target.value })} onInput={(e) => autoResize(e.currentTarget)} className="text-sm overflow-hidden" rows={1} /></div>
          <div><Label>人际关系</Label><Textarea value={form.relationships} onChange={(e) => setForm({ ...form, relationships: e.target.value })} onInput={(e) => autoResize(e.currentTarget)} className="text-sm overflow-hidden" rows={1} /></div>
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
