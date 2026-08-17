import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useKnowledgeStore } from '@/stores/knowledgeStore'
import { X, FileText, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { logger } from '@/lib/logger'

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete: () => void
  activeProjectId: string | null
}

export function ImportDialog({ open, onOpenChange, onImportComplete, activeProjectId }: ImportDialogProps) {
  const { importFiles, indexItem, toggleProjectItem, isLoading } = useKnowledgeStore()
  const [name, setName] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<Array<{ name: string; path: string }>>([])
  const [enableVectorize, setEnableVectorize] = useState(false)
  const [result, setResult] = useState<{
    imported: Array<{ id: string; name: string; file_type: string }>
    errors: Array<{ file: string; error: string }>
  } | null>(null)
  const [indexing, setIndexing] = useState(false)
  const [indexProgress, setIndexProgress] = useState<{ currentFile: number; totalFiles: number; currentBatch: number; totalBatches: number }>({ currentFile: 0, totalFiles: 0, currentBatch: 0, totalBatches: 0 })
  const [indexResults, setIndexResults] = useState<{ success: number; failed: number; errors: string[] }>({ success: 0, failed: 0, errors: [] })
  const [done, setDone] = useState(false)

  if (!open) return null

  const handleSelectFiles = async () => {
    try {
      const files = await window.electronAPI.knowledge.selectFiles()
      if (files && files.length > 0) {
        setSelectedFiles(files)
        if (!name) {
          const firstName = files[0].name.replace(/\.[^.]+$/, '')
          setName(firstName)
        }
      }
    } catch (err) {
      logger.errorObj('knowledge.selectFiles', 'failed', err)
    }
  }

  const handleImport = async () => {
    if (!name.trim() || selectedFiles.length === 0) {
      logger.warn('knowledge.import.aborted', 'missing name or files', { name, fileCount: selectedFiles.length })
      return
    }

    try {
      const importResult = await importFiles({
        name: name.trim(),
        category: 'other',
        files: selectedFiles,
      })
      setResult(importResult)

      if (importResult.imported.length > 0 && enableVectorize) {
        setIndexing(true)
        setIndexProgress({ currentFile: 0, totalFiles: importResult.imported.length, currentBatch: 0, totalBatches: 0 })
        let success = 0
        let failed = 0
        const errors: string[] = []
        const totalFiles = importResult.imported.length

        // 订阅批次进度
        const unsub = window.electronAPI.vector.onIndexProgress((data) => {
          setIndexProgress((prev) => ({
            ...prev,
            currentBatch: data.current,
            totalBatches: data.total,
          }))
        })

        try {
          for (let i = 0; i < importResult.imported.length; i++) {
            setIndexProgress((prev) => ({ ...prev, currentFile: i + 1, currentBatch: 0, totalBatches: 0 }))
            try {
              const indexResult = await indexItem(importResult.imported[i].id)
              if (indexResult.success) {
                success++
              } else {
                failed++
                errors.push(`${importResult.imported[i].name}: ${indexResult.error}`)
              }
            } catch (err: any) {
              failed++
              errors.push(`${importResult.imported[i].name}: ${err.message}`)
            }
          }
        } finally {
          unsub()
        }

        setIndexResults({ success, failed, errors })
        setIndexing(false)
      }

      setDone(true)
      if (activeProjectId && importResult.imported.length > 0) {
        for (const item of importResult.imported) {
          await toggleProjectItem(activeProjectId, item.id, true)
        }
      }
      onImportComplete()
    } catch (err: any) {
      logger.errorObj('knowledge.import', 'failed', err, { name, fileCount: selectedFiles.length })
      // UI 上也提示一下,避免静默失败
      setResult({ imported: [], errors: [{ file: '导入过程', error: err?.message || String(err) }] })
      setDone(true)
    }
  }

  const handleClose = () => {
    setName('')
    setSelectedFiles([])
    setResult(null)
    setIndexing(false)
    setIndexProgress({ currentFile: 0, totalFiles: 0, currentBatch: 0, totalBatches: 0 })
    setIndexResults({ success: 0, failed: 0, errors: [] })
    setDone(false)
    onOpenChange(false)
  }

  const removeFile = (index: number) => {
    setSelectedFiles(files => files.filter((_, i) => i !== index))
  }

  const canClose = !indexing

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="bg-background rounded-lg shadow-lg w-[400px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-sm font-medium">导入参考资料</h3>
          {canClose && (
            <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {!result ? (
            <>
              <div>
                <div className="text-xs mb-1.5">名称</div>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如：甄嬛传"
                  className="h-8 text-xs"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xs">选择文件</div>
                  <div className="text-[10px] text-muted-foreground">支持 .txt, .md, .docx, .pdf</div>
                </div>
                <Button variant="outline" size="sm" onClick={handleSelectFiles} className="w-full h-8 text-xs">
                  {selectedFiles.length > 0 ? `已选择 ${selectedFiles.length} 个文件` : '选择文件（可多选）'}
                </Button>
                {selectedFiles.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-[120px] overflow-auto">
                    {selectedFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs px-2 py-1 bg-muted/50 rounded">
                        <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{file.name}</span>
                        <button
                          onClick={() => removeFile(idx)}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border bg-muted/30 p-2.5 space-y-1.5">
                <label htmlFor="enableVectorize" className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    id="enableVectorize"
                    checked={enableVectorize}
                    onChange={(e) => setEnableVectorize(e.target.checked)}
                    className="rounded mt-0.5"
                  />
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">导入后自动向量化</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground leading-relaxed">
                      为导入的资料建立向量化索引，写作时 AI 能通过语义检索相关知识片段，非向量化则只能通过关键词检索。
                    </div>
                  </div>
                </label>
              </div>

              <Button
                onClick={handleImport}
                disabled={isLoading || !name.trim() || selectedFiles.length === 0}
                className="w-full"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    导入中...
                  </>
                ) : (
                  '导入'
                )}
              </Button>
            </>
          ) : (
            <>
              {result.imported.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-green-600 mb-2">
                    <CheckCircle className="h-3.5 w-3.5" />
                    成功导入「{name}」（{result.imported.length} 个文件）
                  </div>
                </div>
              )}

              {result.errors.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-destructive mb-2">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {result.errors.length} 个文件导入失败
                  </div>
                  <div className="space-y-1">
                    {result.errors.map((err, idx) => (
                      <div key={idx} className="text-xs text-destructive">
                        {err.file}: {err.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {indexing && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      正在向量化 {indexProgress.currentFile}/{indexProgress.totalFiles}
                    </div>
                    {indexProgress.totalBatches > 0 && (
                      <span className="tabular-nums text-[10px]">
                        {indexProgress.currentBatch}/{indexProgress.totalBatches} 批
                      </span>
                    )}
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all"
                      style={{ width: `${
                        indexProgress.totalBatches > 0
                          ? (indexProgress.currentBatch / indexProgress.totalBatches) * 100
                          : (indexProgress.currentFile / Math.max(1, indexProgress.totalFiles)) * 100
                      }%` }}
                    />
                  </div>
                </div>
              )}

              {done && !indexing && enableVectorize && (
                <div className="space-y-2">
                  <div className={`flex items-center gap-1.5 text-xs font-medium ${
                    indexResults.failed > 0 ? 'text-yellow-600' : 'text-green-600'
                  }`}>
                    {indexResults.failed > 0 ? (
                      <AlertCircle className="h-3.5 w-3.5" />
                    ) : (
                      <CheckCircle className="h-3.5 w-3.5" />
                    )}
                    向量化完成：{indexResults.success} 个成功
                    {indexResults.failed > 0 && `，${indexResults.failed} 个失败`}
                  </div>

                  {indexResults.errors.length > 0 && (
                    <div className="text-[10px] text-destructive space-y-0.5">
                      {indexResults.errors.map((err, idx) => (
                        <div key={idx}>{err}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Button onClick={handleClose} className="w-full" disabled={!canClose}>
                完成
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
