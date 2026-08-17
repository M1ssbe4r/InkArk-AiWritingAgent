import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ExternalLink, ScrollText } from 'lucide-react'
import { ReleaseNotesDialog } from '@/components/layout/ReleaseNotesDialog'

import { APP_VERSION } from '@/lib/appVersion'

const REPO_URL = 'https://github.com/M1ssbe4r/InkArk-AiWritingAgent'
const RELEASES_URL = `${REPO_URL}/releases`
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`

export function AboutSettings() {
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)

  return (
    <div className="flex flex-col gap-6 p-4 max-w-md">
      <div>
        <h3 className="text-lg font-semibold mb-1">InkArk</h3>
        <p className="text-sm text-muted-foreground">AI 写作助手</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-sm">
          <span className="text-muted-foreground">当前版本：</span>
          <span className="font-mono font-medium">v{APP_VERSION}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(RELEASES_URL, '_blank', 'noopener')}
        >
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
          检查更新
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setReleaseNotesOpen(true)}
        >
          <ScrollText className="h-3.5 w-3.5 mr-1.5" />
          更新日志
        </Button>
      </div>

      <ReleaseNotesDialog
        open={releaseNotesOpen}
        onOpenChange={setReleaseNotesOpen}
        markSeenOnClose={false}
      />

      <div className="border-t pt-4 space-y-2">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          GitHub 仓库
        </a>
        <a
          href={LICENSE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          许可证 (MIT)
        </a>
      </div>
    </div>
  )
}
