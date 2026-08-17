import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useEditorStore } from '@/stores/editorStore'
import { setPendingAction, pushChange } from '@/lib/editorRef'
import { Sparkles } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function buildPrompt(bookTitle: string, chapterCount: number, bookIdea: string): string {
  const count = chapterCount || 30
  return `我准备写一本${count}章左右的新书《${bookTitle.trim()}》。
1.帮我合理规划设计剧情分卷，每卷用300字左右来简要交代人物、情节、地点，不带描写。
2.给出角色卡，包含主/配角、性格、外貌、组织关系、背景、人际关系、备注。
3.根据实际给出世界观设定，包含地点、组织、物品、规则、其他。
以下是我的idea：

${bookIdea}`
}

export function BookIdeaDialog({ open, onOpenChange }: Props) {
  const projects = useEditorStore((s) => s.projects)
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const setProjects = useEditorStore((s) => s.setProjects)
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const [step, setStep] = useState<1 | 2>(1)
  const [bookTitle, setBookTitle] = useState('')
  const [chapterCount, setChapterCount] = useState(30)
  const [bookIdea, setBookIdea] = useState('')
  const [previewPrompt, setPreviewPrompt] = useState('')

  useEffect(() => {
    if (open) {
      setStep(1)
      setBookTitle('')
      setChapterCount(30)
      setBookIdea('')
      setPreviewPrompt('')
    }
  }, [open])

  const autoPrompt = useMemo(
    () => buildPrompt(bookTitle, chapterCount, bookIdea),
    [bookTitle, chapterCount, bookIdea],
  )

  const handleNext = () => {
    setPreviewPrompt(autoPrompt)
    setStep(2)
  }

  const handleStartOutline = async () => {
    if (activeProject && bookTitle.trim() && activeProjectId) {
      await window.electronAPI.project.update({ id: activeProject.id, title: bookTitle.trim() })
      const volumes = await window.electronAPI.volume.resetOutlinePlan(activeProjectId)
      useEditorStore.getState().setVolumes(volumes)
      setProjects(projects.map((p: any) => (
        p.id === activeProject.id ? { ...p, title: bookTitle.trim() } : p
      )))
      pushChange(activeProjectId, 'outline', '', '全书大纲已重置')
    }
    setPendingAction({ action: 'autoOutlinePrompt', text: previewPrompt })
    onOpenChange(false)
  }

  const handleSkip = async () => {
    if (activeProject && bookTitle.trim() && bookTitle.trim() !== activeProject.title) {
      await window.electronAPI.project.update({ id: activeProject.id, title: bookTitle.trim() })
      setProjects(projects.map((p: any) => (
        p.id === activeProject.id ? { ...p, title: bookTitle.trim() } : p
      )))
    }
    onOpenChange(false)
  }

  const canGoNext = !!bookTitle.trim() && !!bookIdea.trim() && !!chapterCount

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>规划全书大纲</DialogTitle></DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">为你的新作品起个名字，并简单描述你的想法，AI 会帮你规划剧情段。</p>
            <p className="text-[11px] text-muted-foreground">随时可以在「目录 - 全书大纲」中重新生成。</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground mb-1 block">作品名称</label>
                <input
                  value={bookTitle}
                  onChange={(e) => setBookTitle(e.target.value)}
                  placeholder="作品名称"
                  className="w-full h-8 rounded border px-2 text-xs bg-background outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="w-20">
                <label className="text-[10px] text-muted-foreground mb-1 block">章节数</label>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={chapterCount || ''}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === '') { setChapterCount(0); return }
                    const num = Number(val)
                    if (!isNaN(num)) setChapterCount(Math.max(0, num))
                  }}
                  className="w-full h-8 rounded border px-2 text-xs bg-background outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">故事想法</label>
              <Textarea
                value={bookIdea}
                onChange={(e) => setBookIdea(e.target.value)}
                placeholder="例如：一个现代都市异能故事，主角在车祸后觉醒能力..."
                className="min-h-[120px] text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleSkip}>
                跳过
              </Button>
              <Button size="sm" className="h-8 text-xs" onClick={handleNext} disabled={!canGoNext}>
                <Sparkles className="h-3.5 w-3.5 mr-1" /> 下一步
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">这是将发送给 AI 的完整提示词，可手动增删内容约束。</p>
            <Textarea
              value={previewPrompt}
              onChange={(e) => setPreviewPrompt(e.target.value)}
              className="min-h-[260px] text-xs font-mono leading-relaxed"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setStep(1)}>
                上一步
              </Button>
              <Button size="sm" className="h-8 text-xs" onClick={handleStartOutline} disabled={!previewPrompt.trim()}>
                <Sparkles className="h-3.5 w-3.5 mr-1" /> 开始规划
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
