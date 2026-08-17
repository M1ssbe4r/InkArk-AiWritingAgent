import { useEffect, useState } from 'react'
import { X, Download, RotateCw, AlertCircle } from 'lucide-react'
import { useEditorStore } from '@/stores/editorStore'

type UpdateStatus = {
  type: string
  version?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  message?: string
}

type CardState = UpdateStatus & { dismissed: boolean }

function formatMB(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(1)
}

export function UpdateToast() {
  const [state, setState] = useState<CardState | null>(null)

  useEffect(() => {
    if (!window.electronAPI?.update) return
    const unsub = window.electronAPI.update.onStatus((status: UpdateStatus) => {
      setState({ ...status, dismissed: false })
      // 失败 5s 后自动隐藏
      if (status.type === 'error') {
        window.setTimeout(() => {
          setState((cur) => (cur && cur.type === 'error' ? null : cur))
        }, 5000)
      }
    })
    return () => { unsub() }
  }, [])

  if (!state || state.dismissed) return null
  if (state.type === 'not-available') return null

  const dismiss = () => setState((cur) => (cur ? { ...cur, dismissed: true } : cur))

  return (
    <div
      className="fixed bottom-4 left-4 z-50 floating-glass px-4 py-3 min-w-[280px] max-w-[360px] text-sm"
      role="status"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {state.type === 'available' && (
            <>
              <div className="font-medium text-foreground">
                发现新版本 v{state.version}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                点击"立即下载"开始更新
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => window.electronAPI.update?.download()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs hover:opacity-90"
                >
                  <Download className="h-3.5 w-3.5" />
                  立即下载
                </button>
                <button
                  onClick={dismiss}
                  className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  稍后
                </button>
              </div>
            </>
          )}

          {state.type === 'progress' && (
            <>
              <div className="font-medium text-foreground">
                正在下载 {state.percent ?? 0}%
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground font-mono">
                {state.transferred ? `${formatMB(state.transferred)} MB` : '0.0 MB'}
                {state.total ? ` / ${formatMB(state.total)} MB` : ''}
              </div>
            </>
          )}

          {state.type === 'downloaded' && (
            <>
              <div className="font-medium text-foreground flex items-center gap-1.5">
                <RotateCw className="h-3.5 w-3.5" />
                更新已就绪 v{state.version}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                重启应用以完成更新
              </div>
              <div className="mt-2">
                <button
                  onClick={() => {
                    if (useEditorStore.getState().isDirty) {
                      const confirmed = window.confirm('有未保存的内容，确认重启？')
                      if (!confirmed) return
                    }
                    window.electronAPI.update?.quitAndInstall()
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs hover:opacity-90"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  立即重启
                </button>
              </div>
            </>
          )}

          {state.type === 'error' && (
            <>
              <div className="font-medium text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" />
                更新失败
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {state.message || '请稍后重试'}
              </div>
            </>
          )}
        </div>

        {/* 失败 5s 后会自动消失,其他状态可手动 × 关掉 */}
        {state.type !== 'error' && (
          <button
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground shrink-0 -mt-0.5 -mr-1 p-0.5"
            aria-label="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
