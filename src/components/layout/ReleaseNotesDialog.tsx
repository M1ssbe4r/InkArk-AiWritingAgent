import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { APP_VERSION, getReleaseNotes, markReleaseNotesSeen } from '@/lib/appVersion'
import { Sparkles } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  markSeenOnClose?: boolean
}

export function ReleaseNotesDialog({ open, onOpenChange, markSeenOnClose = true }: Props) {
  const sections = getReleaseNotes()

  const handleClose = () => {
    if (markSeenOnClose) markReleaseNotesSeen()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose() }}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            v{APP_VERSION} 更新说明
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">感谢更新，本次主要变化如下：</p>
        <div className="space-y-4">
          {sections.map((section) => (
            <div key={section.title} className="space-y-2">
              <h3 className="text-sm font-medium">{section.title}</h3>
              <ul className="space-y-2 text-sm leading-relaxed">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Button className="w-full" onClick={handleClose}>
          知道了
        </Button>
      </DialogContent>
    </Dialog>
  )
}
