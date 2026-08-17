import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { setPendingAction } from '@/lib/editorRef'
import { useAppStore } from '@/stores/appStore'
import { Sparkles, FileText } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectTitle: string
  outlineHtml: string
}

function buildMigrationPrompt(outlineHtml: string): string {
  return `你是一个大纲整理助手。下面是用户从旧版 InkArk 升级带过来的大纲原文（HTML 格式）：

---
${outlineHtml}
---

请用工具把它重新整理为结构化的分卷：

1. 先理解全文语义，识别：
   - 梗概（贯穿全书的核心设定 / 故事线）
   - 分卷（每卷的标题、章节范围、剧情概要）
   - 写作进度（已写到第几章之类）

2. 用 \`create_volume\` 工具逐卷建占位
3. 用 \`write_volume\` 工具逐卷填字段。字段语义严格区分：
   - title：卷名（如"天降神兵"），不要再加"第N卷："前缀或章节范围后缀
   - chapter_start / chapter_end：纯阿拉伯数字（如 1, 8），只在原文出现「第 X-Y 章」类文字时填，否则 null
   - outline：仅写卷级大纲（人物、地点、情节、关键事件等，200-500 字），**不要**包含"第N卷：xxx"标题、**不要**包含"（第N-M章）"章节范围字符串
   - progress_notes：写作进度备注
4. 写完后用 \`read\` type=outline 自检一遍，向用户报告结果

注意：
- 章节范围只在原文出现「第 X-Y 章」类文字时填，否则保持 null，不要从卷数推断章节数
- 标题、专有名词严格保留原文
- 全是平铺没有结构时，建一个空标题的卷，summary 放全文
- 不要修改 projects.outline 字段（那是原文存档）`
}

// 兜底: AI 不一定听话把"第N卷：xxx（第N-M章）"写进 summary,
// 写完后用 stripChapterRangeFromTitle 兜底, 避免重复展示
function sanitizeAiMigratedSummary(title: string, summary: string): string {
  if (!summary) return summary
  // 1. 去掉开头的"第N卷：xxx"或"第N卷 xxx"形式
  let s = summary.replace(/^第\s*\d+\s*卷[：:\s]+[^\n]{0,80}/, '').trim()
  // 2. 去掉首行里的章节范围后缀
  s = s.replace(/[（(]\s*第\s*\d+\s*[-–—~至到]\s*\d+\s*章\s*[)）]\s*$/m, '').trim()
  return s
}

export { buildMigrationPrompt }

export function OutlineMigrationDialog({ open, onOpenChange, projectId, projectTitle, outlineHtml }: Props) {
  const setAIPanelOpen = useAppStore((s) => s.setAIPanelOpen)
  const setPendingLegacyOutline = useAppStore((s) => s.setPendingLegacyOutline)

  const handleAiMigrate = () => {
    setAIPanelOpen(true)
    setPendingAction({ action: 'autoOutlinePrompt', text: buildMigrationPrompt(outlineHtml), freshSession: true })
    onOpenChange(false)
  }

  const handleManualMigrate = () => {
    setPendingLegacyOutline({ projectId, outlineHtml })
    onOpenChange(false)
  }

  const handleOpenChange = (next: boolean) => {
    // 关闭由 App.tsx 的 dismissedMigration 集合去重:本 session 内同项目不会再弹
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新版大纲改为分卷结构</DialogTitle>
        </DialogHeader>
        <div className="text-sm leading-relaxed space-y-3">
          <p className="text-foreground">
            InkArk 新版把全书大纲改成了<strong>分卷结构</strong>：每卷独立记录标题、章节范围和剧情概要。
            这样 AI 可以用工具调用精确改写某一卷、搜索可以按卷定位、新建章节时也会先核对对应卷的规划。
          </p>
          <p className="text-muted-foreground">
            你的作品《{projectTitle}》还存着旧版大纲，可以让 AI 按语义重新整理成新结构，或者先看旧版原文手动迁移。
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={handleManualMigrate}>
            <FileText className="w-4 h-4 mr-1.5" />
            手动迁移
          </Button>
          <Button onClick={handleAiMigrate}>
            <Sparkles className="w-4 h-4 mr-1.5" />
            让 AI 整理
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
