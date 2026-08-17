import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEditorStore } from '@/stores/editorStore'
import { sanitizeFileName } from '@/lib/utils'
import { chapterContentToPlainText, splitParagraphs } from '@/lib/chapterParagraph'
import { flushChapterSave, getEditor } from '@/lib/editorRef'
import { Loader2 } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const formats = [
  { value: 'inkark', label: 'InkArk 项目备份', ext: 'inkark', filter: 'InkArk 项目备份' },
  { value: 'txt', label: 'TXT 纯文本', ext: 'txt', filter: '文本文件' },
  { value: 'md', label: 'Markdown', ext: 'md', filter: 'Markdown 文件' },
  { value: 'docx', label: 'Word (DOCX)', ext: 'docx', filter: 'Word 文档' },
]

function base64FromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function docxParagraphChildren(para: string, TextRun: typeof import('docx').TextRun) {
  const lines = para.split('\n')
  if (lines.length === 1) return [new TextRun(para)]
  const runs: InstanceType<typeof TextRun>[] = []
  lines.forEach((line, i) => {
    if (i > 0) runs.push(new TextRun({ break: 1 }))
    runs.push(new TextRun(line))
  })
  return runs
}

export function ExportDialog({ open, onOpenChange }: Props) {
  const projects = useEditorStore((s) => s.projects)
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const chapters = useEditorStore((s) => s.chapters)

  const [format, setFormat] = useState('inkark')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [exporting, setExporting] = useState(false)
  const [startChapter, setStartChapter] = useState('1')
  const [endChapter, setEndChapter] = useState('')

  const project = projects.find((p) => p.id === activeProjectId)
  const currentTitle = title || project?.title || ''
  const allChapters = [...chapters].sort((a, b) => a.sort_order - b.sort_order)
  const maxChapter = allChapters.length

  const validateChapterRange = (): { valid: boolean; start: number; end: number } => {
    const start = parseInt(startChapter, 10)
    const end = endChapter ? parseInt(endChapter, 10) : maxChapter

    if (isNaN(start) || isNaN(end)) return { valid: false, start: 0, end: 0 }
    if (start < 1 || start > maxChapter) return { valid: false, start: 0, end: 0 }
    if (end < start || end > maxChapter) return { valid: false, start: 0, end: 0 }

    return { valid: true, start, end }
  }

  const getChaptersForExport = async () => {
    await flushChapterSave()
    const store = useEditorStore.getState()
    const editor = getEditor()
    return [...store.chapters]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((ch) => (
        ch.id === store.activeChapterId && editor
          ? { ...ch, content: editor.getHTML() }
          : ch
      ))
  }

  const handleExport = async () => {
    if (format !== 'inkark') {
      const range = validateChapterRange()
      if (!range.valid) return
    }
    setExporting(true)
    try {
      if (format === 'inkark') {
        if (!activeProjectId) return
        await flushChapterSave()
        const backup = await window.electronAPI.project.export(activeProjectId)
        if (backup.error) {
          console.error('Export error:', backup.error)
          setExporting(false)
          return
        }
        const result = await window.electronAPI.file.save({
          defaultName: `${sanitizeFileName(currentTitle)}.inkark`,
          content: JSON.stringify(backup, null, 2),
          filterName: 'InkArk 项目备份',
          extension: 'inkark',
        })
        if (result.success) onOpenChange(false)
        setExporting(false)
        return
      }

      const range = validateChapterRange()
      const chaptersForExport = await getChaptersForExport()
      const exportChapters = chaptersForExport.slice(range.start - 1, range.end)
      const fmt = formats.find((f) => f.value === format)!

      if (format === 'docx') {
        const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')
        const children: InstanceType<typeof Paragraph>[] = [
          new Paragraph({ text: currentTitle, heading: HeadingLevel.TITLE }),
        ]
        if (author) children.push(new Paragraph({ text: `作者: ${author}`, spacing: { after: 400 } }))
        for (const ch of exportChapters) {
          children.push(new Paragraph({ text: ch.title, heading: HeadingLevel.HEADING_1 }))
          const paragraphs = splitParagraphs(ch.content || '')
          if (paragraphs.length === 0) {
            children.push(new Paragraph({ spacing: { after: 200 } }))
          } else {
            for (const para of paragraphs) {
              children.push(new Paragraph({
                children: docxParagraphChildren(para, TextRun),
                spacing: { after: 200 },
              }))
            }
          }
        }
        const doc = new Document({ sections: [{ children }] })
        const blob = await Packer.toBlob(doc)
        const buffer = await blob.arrayBuffer()
        const result = await window.electronAPI.file.save({
          defaultName: `${sanitizeFileName(currentTitle)}.docx`,
          base64: base64FromBuffer(buffer),
          filterName: 'Word 文档',
          extension: 'docx',
        })
        if (result.success) { setExporting(false); onOpenChange(false); return }
      } else {
        let content = ''
        if (format === 'txt') {
          content = exportChapters.map((c) => `# ${c.title}\n\n${chapterContentToPlainText(c.content || '')}`).join('\n\n---\n\n')
        } else {
          const fm = [`---`, `title: "${currentTitle}"`, author ? `author: "${author}"` : '', `---`].filter(Boolean).join('\n')
          content = fm + '\n\n' + exportChapters.map((c) => `# ${c.title}\n\n${chapterContentToPlainText(c.content || '')}`).join('\n\n---\n\n')
        }
        const result = await window.electronAPI.file.save({
          defaultName: `${sanitizeFileName(currentTitle)}.${fmt.ext}`,
          content,
          filterName: fmt.filter,
          extension: fmt.ext,
        })
        if (result.success) onOpenChange(false)
      }
    } catch (err: any) {
      console.error('Export error:', err)
    }
    setExporting(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>导出作品</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>导出格式</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {formats.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {format === 'inkark' && (
              <p className="text-xs text-muted-foreground mt-1.5">InkArk 格式包含正文、角色卡、世界观、大纲等全部项目数据，可在其他设备上导入恢复。</p>
            )}
          </div>
          {format !== 'inkark' && (
            <>
              <div><Label>书名</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={project?.title || '请输入书名'} /></div>
              <div><Label>作者</Label><Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="可选" /></div>
              <div>
                <Label>章节范围</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    type="number"
                    min={1}
                    max={maxChapter}
                    value={startChapter}
                    onChange={(e) => setStartChapter(e.target.value)}
                    className="w-20"
                  />
                  <span className="text-xs text-muted-foreground">至</span>
                  <Input
                    type="number"
                    min={1}
                    max={maxChapter}
                    value={endChapter}
                    onChange={(e) => setEndChapter(e.target.value)}
                    placeholder={String(maxChapter)}
                    className="w-20"
                  />
                  <span className="text-xs text-muted-foreground">共 {maxChapter} 章</span>
                </div>
              </div>
            </>
          )}
          <Button className="w-full" size="sm" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
            导出
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
