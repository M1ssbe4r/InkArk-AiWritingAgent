import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, FileText, CheckCircle, AlertCircle, ChevronDown, ChevronUp, RefreshCw, Package, FileType2 } from 'lucide-react'
import { validateBackup } from '@/lib/backupValidator'

interface BuiltChapter {
  id: string
  title: string
  content: string
  chapter_outline: string
  sort_order: number
  status: string
  word_count: number
  created_at: string
  updated_at: string
}

type SplitMode = 'auto' | 'pattern' | 'blankline' | 'whole'
type Stage = 'idle' | 'opening' | 'splitting' | 'committing' | 'done' | 'error'

interface ImportProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (projectId: string) => void
}

interface SelectedFile {
  path: string
  fileName: string
  text: string
  totalChars: number
}

export function ImportProjectDialog({ open, onOpenChange, onImported }: ImportProjectDialogProps) {
  const [stage, setStage] = useState<Stage>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const [mode, setMode] = useState<SplitMode>('auto')
  const [customPattern, setCustomPattern] = useState('')
  const [projectTitle, setProjectTitle] = useState('')
  const [chapters, setChapters] = useState<BuiltChapter[]>([])
  const [matchedRule, setMatchedRule] = useState('')
  const [previewOpen, setPreviewOpen] = useState(true)
  const [committing, setCommitting] = useState(false)
  const [progress, setProgress] = useState<{ phase: string; current: number; total: number; message: string } | null>(null)
  const [inkarkImporting, setInkarkImporting] = useState(false)

  useEffect(() => {
    if (!open) return
    const off = window.electronAPI.importProject.onProgress((p) => {
      setProgress(p)
      if (p.phase === 'parse') setStage('opening')
      else if (p.phase === 'split') setStage('splitting')
      else if (p.phase === 'commit') setStage('committing')
      // phase='committed' / 'fts-background*' / 'done' 在 commit 成功后已被忽略:
      // dialog 立刻关闭, 后台 FTS 在主进程继续跑 (有 8ms 时间预算限速)
      else if (p.phase === 'error' || p.phase === 'fts-background-error') setStage('error')
    })
    return off
  }, [open])

  useEffect(() => {
    if (!open) {
      setStage('idle')
      setErrorMsg('')
      setSelected(null)
      setMode('auto')
      setCustomPattern('')
      setProjectTitle('')
      setChapters([])
      setMatchedRule('')
      setPreviewOpen(true)
      setCommitting(false)
      setProgress(null)
      setInkarkImporting(false)
    }
  }, [open])

  const handleOpen = async () => {
    setProgress({ phase: 'parse', current: 0, total: 1, message: '打开文件选择框...' })
    setErrorMsg('')
    try {
      const result = await window.electronAPI.importProject.openFile({ filterName: '文本文档 / Word' })
      if (!result.success) {
        if (result.error) setErrorMsg(result.error)
        setStage('idle')
        setProgress(null)
        return
      }
      if (!result.text || !result.fileName) {
        setErrorMsg('文件内容为空')
        setStage('idle')
        setProgress(null)
        return
      }
      setSelected({
        path: result.path || '',
        fileName: result.fileName,
        text: result.text,
        totalChars: result.totalChars ?? result.text.length,
      })
      setProjectTitle(result.fileName.replace(/\.[^.]+$/, ''))
      setStage('idle')
      setProgress(null)
    } catch (e: any) {
      setErrorMsg(e?.message || '打开文件失败')
      setStage('error')
      setProgress(null)
    }
  }

  const handleInkarkImport = async () => {
    setInkarkImporting(true)
    setErrorMsg('')
    try {
      const result = await window.electronAPI.file.open({
        filterName: 'InkArk 项目备份',
        extension: 'inkark',
      })
      if (!result.success) {
        setInkarkImporting(false)
        return
      }
      if (!result.content) {
        setErrorMsg('文件内容为空')
        setInkarkImporting(false)
        return
      }
      let backup: any
      try {
        backup = JSON.parse(result.content)
      } catch {
        setErrorMsg('文件不是有效的 InkArk 备份(JSON 解析失败)')
        setInkarkImporting(false)
        return
      }
      const validation = validateBackup(backup)
      if (!validation.valid) {
        setErrorMsg('无效的项目备份文件格式:' + (validation.error || ''))
        setInkarkImporting(false)
        return
      }
      const importResult = await window.electronAPI.project.import(backup)
      if (!importResult.success || !importResult.projectId) {
        setErrorMsg('导入失败')
        setInkarkImporting(false)
        return
      }
      onImported(importResult.projectId)
      setTimeout(() => onOpenChange(false), 400)
    } catch (e: any) {
      setErrorMsg(e?.message || '导入失败')
      setInkarkImporting(false)
    }
  }

  const runSplit = async (overrideMode?: SplitMode, overridePattern?: string) => {
    if (!selected) return
    const useMode = overrideMode ?? mode
    const usePattern = overridePattern ?? customPattern
    setStage('splitting')
    setErrorMsg('')
    try {
      const result = await window.electronAPI.importProject.splitChapters({
        text: selected.text,
        fileName: selected.fileName,
        projectTitle: projectTitle || selected.fileName.replace(/\.[^.]+$/, ''),
        splitOptions: {
          mode: useMode,
          pattern: usePattern,
        },
      })
      if (!result.success) {
        setErrorMsg('章节识别失败')
        setStage('error')
        return
      }
      setChapters(result.chapters)
      setMatchedRule(result.matchedRule)
      setStage('idle')
    } catch (e: any) {
      setErrorMsg(e?.message || '章节识别失败')
      setStage('error')
    }
  }

  useEffect(() => {
    if (selected && stage === 'idle') {
      runSplit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const handleCommit = async () => {
    if (!selected || chapters.length === 0) return
    setStage('committing')
    setCommitting(true)
    setErrorMsg('')
    setProgress({ phase: 'commit', current: 0, total: chapters.length, message: '准备导入...' })
    try {
      const result = await window.electronAPI.importProject.commitProject({
        fileName: selected.fileName,
        projectTitle: projectTitle || selected.fileName.replace(/\.[^.]+$/, ''),
        chapters,
      })
      if (!result.success || !result.projectId) {
        setErrorMsg(result.error || '导入失败')
        setStage('error')
        setCommitting(false)
        setProgress(null)
        return
      }
      // 数据已写入, 项目立即可用. 后台 FTS 索引在主进程继续跑 (有 8ms 时间预算限速, 不会卡 UI).
      // 立刻关闭弹窗让用户进入项目, 不等后台索引完成.
      onImported(result.projectId)
      onOpenChange(false)
    } catch (e: any) {
      setErrorMsg(e?.message || '导入失败')
      setStage('error')
      setCommitting(false)
      setProgress(null)
    }
  }

  const totalWords = useMemo(
    () => chapters.reduce((s, c) => s + (c.word_count || 0), 0),
    [chapters],
  )

  const splitDisabled = !selected || stage === 'splitting' || stage === 'committing'
  const commitDisabled = !selected || chapters.length === 0 || committing

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>导入项目</DialogTitle>
          <DialogDescription>
            支持 .txt / .doc / .docx 文件,自动识别章节并生成可编辑的 InkArk 项目
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4 pr-1">
          {!selected && !inkarkImporting && (
            <div className="space-y-3 pt-1">
              <Label className="text-xs">选择导入类型</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleInkarkImport}
                  disabled={inkarkImporting}
                  className="flex flex-col items-start text-left p-4 rounded-lg border border-border hover:border-primary hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center gap-2 mb-2">
                    {inkarkImporting ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <Package className="h-4 w-4 text-primary" />
                    )}
                    <span className="font-medium text-sm">.inkark 备份文件</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    完整恢复整个项目(章节 / 角色 / 世界观 / 大纲 / 风格)。适合备份还原或跨设备迁移。
                  </p>
                </button>

                <button
                  onClick={handleOpen}
                  className="flex flex-col items-start text-left p-4 rounded-lg border border-border hover:border-primary hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <FileType2 className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">txt / doc / md 文本</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    把文本文档自动识别章节,生成可编辑的新项目。支持中文章节、英文 Chapter、双空行、自定义正则。
                  </p>
                </button>
              </div>
            </div>
          )}

          {selected && (
          <>
          <div className="flex items-center gap-2 px-2.5 py-2 rounded border bg-muted/30 text-xs">
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="font-medium text-foreground truncate flex-1">{selected.fileName}</span>
            <span className="text-muted-foreground shrink-0">{(selected.totalChars / 10000).toFixed(1)} 万字</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpen}
              disabled={stage === 'opening' || stage === 'committing'}
              className="h-6 px-2 text-[10px]"
            >
              更换
            </Button>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">第 2 步:章节分隔规则</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    { value: 'auto', label: '自动识别(推荐)', desc: '用内置正则识别常见章节标记' },
                    { value: 'blankline', label: '双空行分章', desc: '两个空行视为章节分隔' },
                    { value: 'pattern', label: '自定义分隔符', desc: '用正则匹配章节标题' },
                    { value: 'whole', label: '整篇一章', desc: '不切分,整篇作为一章' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setMode(opt.value); if (opt.value !== 'pattern') runSplit(opt.value) }}
                      disabled={splitDisabled}
                      className={`flex flex-col items-start text-left p-2 rounded border text-xs transition-colors ${
                        mode === opt.value
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border hover:bg-accent text-muted-foreground'
                      }`}
                    >
                      <span className="font-medium">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</span>
                    </button>
                  ))}
                </div>

                {mode === 'pattern' && (
                  <div className="flex items-center gap-2 mt-2">
                    <Input
                      value={customPattern}
                      onChange={(e) => setCustomPattern(e.target.value)}
                      placeholder="例如:第*章(* 通配任意字符),或正则第[0-9]+章"
                      className="h-7 text-xs font-mono"
                      disabled={splitDisabled}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runSplit('pattern', customPattern)}
                      disabled={splitDisabled || !customPattern.trim()}
                      className="text-xs"
                    >
                      <RefreshCw className="h-3 w-3 mr-1" /> 重新识别
                    </Button>
                  </div>
                )}

                {matchedRule && (
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    {stage === 'splitting' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <CheckCircle className="h-3 w-3 text-green-600" />
                    )}
                    {matchedRule} — 共 {chapters.length} 章
                  </div>
                )}
              </div>

              {chapters.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">第 3 步:预览章节标题({chapters.length})</Label>
                    <button
                      onClick={() => setPreviewOpen(!previewOpen)}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      {previewOpen ? '收起' : '展开'}
                      {previewOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  </div>
                  {previewOpen && (
                    <div className="max-h-48 overflow-auto border rounded text-xs">
                      {chapters.slice(0, 200).map((c, i) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between px-2.5 py-1.5 border-b last:border-b-0 hover:bg-accent/50"
                        >
                          <span className="truncate flex-1">{c.title || `(未命名 ${i + 1})`}</span>
                          <span className="text-muted-foreground ml-2 shrink-0">{c.word_count} 字</span>
                        </div>
                      ))}
                      {chapters.length > 200 && (
                        <div className="px-2.5 py-1.5 text-[10px] text-muted-foreground">
                          …… 还有 {chapters.length - 200} 章
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs">第 4 步:项目名</Label>
                <Input
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  placeholder="将作为新项目名"
                  className="h-8 text-xs"
                  maxLength={200}
                  disabled={committing}
                />
                <div className="text-[10px] text-muted-foreground">
                  共 {chapters.length} 章,合计 {totalWords.toLocaleString()} 字
                </div>
              </div>
          </>
          )}

          {errorMsg && (
            <div className="flex items-start gap-2 p-2.5 rounded border border-destructive/30 bg-destructive/5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {progress && stage !== 'done' && stage !== 'error' && (
            <div className="space-y-1.5 p-2.5 rounded border bg-muted/30">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                <span className="flex-1 truncate">{progress.message}</span>
                {progress.total > 0 && progress.total <= 100000 && (
                  <span className="shrink-0 tabular-nums text-[10px]">
                    {progress.current}/{progress.total}
                  </span>
                )}
              </div>
              {(progress.phase === 'commit' || progress.phase === 'pre-tokenize' || progress.phase === 'fts-background' || progress.phase === 'fts-background-prepare' || progress.phase === 'fts-background-write') && progress.total > 0 && (
                <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-primary h-1.5 rounded-full transition-all duration-200"
                    style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {stage === 'done' && (
            <div className="flex items-center gap-2 p-2.5 rounded border border-green-600/30 bg-green-600/5 text-xs text-green-700">
              <CheckCircle className="h-3.5 w-3.5" />
              导入成功!已自动切换到新项目。
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t mt-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={committing}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleCommit}
            disabled={commitDisabled}
          >
            {committing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                正在导入…
              </>
            ) : (
              '开始导入'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
