import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Copy, Check, Sparkles } from 'lucide-react'
import { stripHtml } from '@/lib/html'
import { setPendingAction } from '@/lib/editorRef'
import { useAppStore } from '@/stores/appStore'
import { buildMigrationPrompt } from './OutlineMigrationDialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  outlineHtml: string
}

export function LegacyOutlineViewer({ open, onOpenChange, outlineHtml }: Props) {
  const [copied, setCopied] = useState(false)
  const setPendingLegacyOutline = useAppStore((s) => s.setPendingLegacyOutline)
  const setAIPanelOpen = useAppStore((s) => s.setAIPanelOpen)

  const plainText = stripHtml(outlineHtml).trim()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plainText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const handleClose = () => {
    setPendingLegacyOutline(null)
    onOpenChange(false)
  }

  const handleAiMigrate = () => {
    setAIPanelOpen(true)
    setPendingAction({ action: 'autoOutlinePrompt', text: buildMigrationPrompt(outlineHtml), freshSession: true })
    handleClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>旧版大纲原文</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground">
          原文存档。可让 AI 按语义整理为分卷结构，或复制后手动整理。
        </div>
        <div className="flex-1 overflow-auto rounded border bg-muted/30 p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed">
          {plainText || '（无内容）'}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={handleClose}>
            关闭
          </Button>
          <Button onClick={handleAiMigrate} disabled={!plainText}>
            <Sparkles className="w-4 h-4 mr-1.5" />
            一键迁移
          </Button>
          <Button onClick={handleCopy} variant={copied ? 'ghost' : 'default'}>
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-1.5" />
                已复制
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-1.5" />
                复制全文
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
