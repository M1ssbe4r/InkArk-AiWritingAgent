import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useEditorStore } from '@/stores/editorStore'
import { setPendingAction, pushChange } from '@/lib/editorRef'
import { Sparkles, PenTool, Users, Palette, History, ArrowRight, ArrowLeft } from 'lucide-react'
import { markReleaseNotesSeen } from '@/lib/appVersion'
import logoImg from '@/assets/logo.webp'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const features = [
  { icon: PenTool, title: 'AI 写作', desc: 'Write/Chat 双模式，AI 可直接编辑章节内容、创建角色和世界观' },
  { icon: Users, title: '角色与世界观', desc: '管理角色卡和世界观设定，AI 支持批量创建和更新' },
  { icon: Palette, title: '写作风格', desc: '内置 6 种风格 + 自定义风格，规则与敏感词管理' },
  { icon: History, title: '版本控制', desc: '自动保存历史版本，支持查看变更详情和一键回退' },
]

export function WelcomeDialog({ open, onOpenChange }: Props) {
  const [step, setStep] = useState(0)
  const [bookTitle, setBookTitle] = useState('')
  const [chapterCount, setChapterCount] = useState(30)
  const [bookIdea, setBookIdea] = useState('')

  const projects = useEditorStore((s) => s.projects)
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const setProjects = useEditorStore((s) => s.setProjects)
  const activeProject = projects.find((p) => p.id === activeProjectId)

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
    const count = chapterCount || 30
    const prefix = `我准备写一本${count}章左右的新书《${bookTitle.trim()}》。\n1.帮我合理规划设计剧情分卷，每卷用300字左右来简要交代人物、情节、地点，不带描写。\n2.给出角色卡，包含主/配角、性格、外貌、组织关系、背景、人际关系、备注。\n3.根据实际给出世界观设定，包含地点、组织、物品、规则、其他。\n以下是我的idea：\n\n`
    setPendingAction({ action: 'autoOutlinePrompt', text: prefix + bookIdea })
    finish()
  }

  const handleSkip = async () => {
    if (activeProject && bookTitle.trim() && bookTitle.trim() !== activeProject.title) {
      await window.electronAPI.project.update({ id: activeProject.id, title: bookTitle.trim() })
      setProjects(projects.map((p: any) => (
        p.id === activeProject.id ? { ...p, title: bookTitle.trim() } : p
      )))
    }
    finish()
  }

  const finish = () => {
    localStorage.setItem('inkark-onboarding-done', '1')
    markReleaseNotesSeen()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-lg [&>button:last-child]:hidden">
        {step === 0 && (
          <div className="flex flex-col items-center text-center py-4 space-y-4">
            <img src={logoImg} alt="InkArk" className="w-20 h-20" />
            <DialogHeader>
              <DialogTitle className="text-xl">欢迎使用 InkArk</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">AI 驱动的长篇小说写作助手</p>
            <Button className="mt-2" onClick={() => setStep(1)}>
              开始使用 <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="py-2 space-y-4">
            <DialogHeader>
              <DialogTitle>核心功能</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-lg border p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <f.icon className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-medium">{f.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" size="sm" onClick={finish}>
                跳过
              </Button>
              <Button size="sm" onClick={() => setStep(2)}>
                下一步 <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="py-2 space-y-4">
            <DialogHeader>
              <DialogTitle>开始写作</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              为你的新作品起个名字，并简单描述你的想法，AI 会帮你规划剧情。
            </p>
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
                className="min-h-[100px] text-xs"
              />
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" /> 上一步
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleSkip}>
                  跳过，直接进入
                </Button>
                <Button
                  size="sm"
                  onClick={handleStartOutline}
                  disabled={!bookTitle.trim() || !bookIdea.trim() || !chapterCount}
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1" /> 开始规划
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 步骤指示器 */}
        <div className="flex justify-center gap-1.5 pt-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30'}`}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
