import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react'
import { flushSync, createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useEditorStore } from '@/stores/editorStore'
import { useAppStore } from '@/stores/appStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getEditor, getStyleGuidance, getStyleRestrictions, getSummaryOutline, getPendingAction, setPendingAction, setPendingDiffResolve, resolvePendingDiff, setPendingOutlineResolve, resolvePendingOutline, formatEditRejectResult, formatDeleteRejectResult, consumeChanges, clearChanges, flushChapterSave } from '@/lib/editorRef'
import { streamChatCompletion, buildUserPrompt, streamChatWithTools, type ChatMessage } from '@/lib/api'
import { assembleContext, buildContextPrefix, type ContextSections } from '@/lib/context'
import { buildSystemPrompt, buildStylePrompt } from '@/lib/api'
import { toolDefinitions, executeToolCall, toolUsageGuide, describeDeleteAction } from '@/lib/tools'
import { buildChapterReviewFixPrompt } from '@/lib/chapterReview'
import { generateId, countChars } from '@/lib/utils'
import { stripHtml } from '@/lib/html'
import type { OutlineVolume } from '@/types'
import { buildPrefixSum, tokensInRange, estimateMessageTokens, countText, estimateConversationTokens } from '@/lib/tokens'
import { logger } from '@/lib/logger'
import { getContextWindow } from '@/lib/modelContext'
import { Send, X, RotateCcw, Settings, FileText, Plus, Square, ChevronDown, PanelRightClose, Maximize2, Minimize2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

function formatParagraphLocation(chapterIndex?: number, paragraphIndices?: number[]): string {
  if (!chapterIndex || !paragraphIndices?.length) return ''
  if (paragraphIndices.length === 1) {
    return `（选中文本位于第 ${chapterIndex} 章第 ${paragraphIndices[0]} 段，本段非选中文本不要修改）`
  }
  return `（选中文本位于第 ${chapterIndex} 章第 ${paragraphIndices.join('、')} 段，本段非选中文本不要修改）`
}

function buildParagraphActionPrompt(
  action: 'polish' | 'condense' | 'expand',
  chapterIndex?: number,
  paragraphIndices?: number[],
): string {
  const base = {
    polish: '对章节中选中的这段文字进行润色，使其更加优美流畅',
    condense: '对章节中选中的这段文字进行缩写，保留核心信息',
    expand: '对章节中选中的这段文字进行扩写，增加更多细节和描写',
  }[action]
  const loc = formatParagraphLocation(chapterIndex, paragraphIndices)
  return loc ? `${base}${loc}` : base
}

function buildParagraphCustomPrompt(
  customPrompt: string,
  chapterIndex?: number,
  paragraphIndices?: number[],
): string {
  const base = `阅读选中文本，${customPrompt}`
  const loc = formatParagraphLocation(chapterIndex, paragraphIndices)
  return loc ? `${base}${loc}` : base
}

function isOutlinePlanAdoptable(volumes: OutlineVolume[]): boolean {
  if (volumes.length === 0) return true
  return !volumes.some((v) => stripHtml(v.outline || '').trim())
}

interface QuickCommand {
  id: string
  name: string
  prompt: string
  autoSend: boolean
  multiCandidate?: boolean
}

interface ProposalData {
  type: string
  chapter_index?: number
  options: string[]
  params?: Record<string, unknown>
}

interface ConfirmUpdateData {
  type: 'character' | 'world' | 'outline' | 'delete'
  label: string
}

interface ChatMsg {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  rawContent?: string
  systemPrompt?: string
  candidates?: string[]
  activeCandidate?: number
  loading?: boolean
  userPrompt?: string
  taskType?: string
  isToolCall?: boolean
  reasoning?: string[]
  reasoningDone?: boolean
  isThinking?: boolean
  isInlineText?: boolean
  proposal?: ProposalData
  editChapterButtons?: boolean
  editVolumeButtons?: boolean
  confirmUpdate?: ConfirmUpdateData
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolTitle?: string
  toolSummary?: string
  toolResult?: string
  toolCalls?: any[]
  tool_call_id?: string
  status?: 'completed' | 'aborted' | 'error'
}

function ThinkingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="8" cy="8" rx="5.5" ry="2.5" stroke="currentColor" strokeWidth="1.2" transform="rotate(40 8 8)"/>
      <ellipse cx="8" cy="8" rx="5.5" ry="2.5" stroke="currentColor" strokeWidth="1.2" transform="rotate(-40 8 8)"/>
      <circle cx="8" cy="8" r="1.3" fill="currentColor"/>
    </svg>
  )
}

function getToolSummary(name: string, result: string, args?: Record<string, unknown>): { title: string; summary: string } {
  const firstLine = result.split('\n')[0]
  switch (name) {
    case 'list': {
      const type = args?.type as string
      if (type === 'chapter') {
        const indices = args?.chapter_indices as number[] | undefined
        if (indices && indices.length > 0) {
          return { title: `查看了第${indices.join(', ')}章的标题与大纲`, summary: '' }
        }
        const countMatch = firstLine.match(/共\s*(\d+)\s*个章节/)
        if (countMatch) return { title: '查看了章节列表', summary: '' }
        return { title: '查看了章节列表', summary: '' }
      }
      if (type === 'character') {
        return { title: '查看了角色卡列表', summary: '' }
      }
      if (type === 'world') {
        return { title: '查看了世界观设定列表', summary: '' }
      }
      if (type === 'volume') {
        return { title: '查看了分卷列表', summary: '' }
      }
      return { title: '查看了列表', summary: '' }
    }
    case 'read': {
      const type = args?.type as string
      if (type === 'chapter_content') {
        const idx = args?.chapter_index
        return idx != null 
          ? { title: `读取了第${idx}章正文`, summary: '' }
          : { title: '读取了章节正文', summary: '' }
      }
      if (type === 'outline') {
        return { title: '查看了全文大纲', summary: '查看了全文大纲' }
      }
      if (type === 'character') {
        const cardName = args?.name
        return cardName 
          ? { title: `查看了角色「${cardName}」`, summary: `查看了角色「${cardName}」的设定` }
          : { title: '查看了角色', summary: '查看了角色设定' }
      }
      if (type === 'world') {
        const worldName = args?.name
        return worldName 
          ? { title: `查看了世界观「${worldName}」`, summary: `查看了世界观「${worldName}」的设定` }
          : { title: '查看了世界观', summary: '查看了世界观设定' }
      }
      if (type === 'knowledge') {
        const knowledgeName = args?.name as string || ''
        const start = args?.start as number ?? 0
        const end = args?.end as number ?? 0
        return { title: `查看了知识库「${knowledgeName}」[${start}, ${end}]`, summary: `读取了知识库「${knowledgeName}」` }
      }
      return { title: '读取了内容', summary: '读取了内容' }
    }
    case 'search': {
      const keyword = args?.keyword as string
      const semantic = args?.semantic as string
      const scope = args?.scope as string[] | undefined
      const scopeLabels: Record<string, string> = { settings: '设定', outlines: '大纲', knowledge: '知识库', content: '正文' }
      const scopeText = scope?.map(s => scopeLabels[s] || s).join('+') || '工作区'
      const parts: string[] = []
      if (keyword) parts.push(`在${scopeText}中检索「${keyword}」`)
      if (semantic) parts.push(`语义检索「${semantic}」`)
      const resultFirstLine = result.split('\n')[0]
      return { title: parts.join('，'), summary: resultFirstLine }
    }
    case 'write_volume': {
      const reason = args?.reason as string | undefined
      const idx = args?.volume_index as number | undefined
      if (reason) return { title: `修改了第${idx ?? ''}卷`, summary: `修改了卷概要\n修改原因：${reason}` }
      if (firstLine.includes('已更新')) return { title: '更新了卷', summary: firstLine }
      return { title: '修改了卷概要', summary: firstLine || '修改了卷概要' }
    }
    case 'create_volume': {
      const title = args?.title as string | undefined
      return title
        ? { title: `创建了卷「${title}」`, summary: firstLine || `创建了卷「${title}」` }
        : { title: '创建了卷', summary: firstLine || '创建了卷' }
    }
    case 'write_character_card': {
      const cardName = args?.name as string | undefined
      if (args?.cards && Array.isArray(args.cards) && args.cards.length > 0) {
        const names = (args.cards as any[]).map((c: any) => (c.name || c.new_name || '')).filter(Boolean)
        if (names.length > 0) {
          if (names.length === 1) {
            return firstLine.includes('已创建') 
              ? { title: `创建了角色「${names[0]}」`, summary: `创建了角色「${names[0]}」` }
              : { title: `更新了角色「${names[0]}」`, summary: `更新了角色「${names[0]}」的设定` }
          }
          return { title: `批量处理了${names.length}个角色`, summary: `批量处理了 ${names.length} 个角色：${names.map(n => `「${n}」`).join('、')}` }
        }
      }
      if (cardName) {
        if (firstLine.includes('已创建')) return { title: `创建了角色「${cardName}」`, summary: `创建了角色「${cardName}」` }
        if (firstLine.includes('已重命名')) return { title: `重命名了角色「${cardName}」`, summary: `重命名了角色「${cardName}」` }
        return { title: `更新了角色「${cardName}」`, summary: `更新了角色「${cardName}」的设定` }
      }
      return { title: '操作了角色卡', summary: '操作了角色卡' }
    }
    case 'write_world_setting': {
      const worldName = args?.name as string | undefined
      if (args?.cards && Array.isArray(args.cards) && args.cards.length > 0) {
        const names = (args.cards as any[]).map((c: any) => (c.name || c.new_name || '')).filter(Boolean)
        if (names.length > 0) {
          if (names.length === 1) {
            return firstLine.includes('已创建')
              ? { title: `创建了世界观「${names[0]}」`, summary: `创建了世界观「${names[0]}」` }
              : { title: `更新了世界观「${names[0]}」`, summary: `更新了世界观「${names[0]}」` }
          }
          return { title: `批量处理了${names.length}个世界观`, summary: `批量处理了 ${names.length} 个世界观：${names.map(n => `「${n}」`).join('、')}` }
        }
      }
      if (worldName) {
        if (firstLine.includes('已创建')) return { title: `创建了世界观「${worldName}」`, summary: `创建了世界观「${worldName}」` }
        if (firstLine.includes('已重命名')) return { title: `重命名了世界观「${worldName}」`, summary: `重命名了世界观「${worldName}」` }
        return { title: `更新了世界观「${worldName}」`, summary: `更新了世界观「${worldName}」的设定` }
      }
      return { title: '操作了世界观', summary: '操作了世界观设定' }
    }
    case 'write_chapter_content': {
      const idx = args?.chapter_index
      return idx != null 
        ? { title: `修改了第${idx}章`, summary: `修改了第${idx}章正文` }
        : { title: '修改了章节', summary: '修改了章节正文' }
    }
    case 'write_chapter_outline': {
      if (firstLine.includes('已更新')) {
        const indices = Array.from(result.matchAll(/第\s*(\d+)\s*章/g), m => parseInt(m[1]))
        const unique = [...new Set(indices)].sort((a, b) => a - b)
        if (unique.length > 0) return { title: `更新了第${unique.join('、')}章大纲`, summary: `更新了第${unique.join('、')}章大纲` }
        return { title: '更新了章节大纲', summary: '更新了章节大纲' }
      }
      return { title: '操作了章节大纲', summary: '操作了章节大纲' }
    }
    case 'write_chapter_title': {
      const chapters = args?.chapters as Array<{ chapter_index: number; title: string }> | undefined
      const singleTitle = args?.title as string | undefined
      const singleIndex = args?.chapter_index as number | undefined
      if (chapters && chapters.length > 0) {
        if (chapters.length === 1) {
          return { title: `更新了第${chapters[0].chapter_index}章「${chapters[0].title}」`, summary: `更新了第${chapters[0].chapter_index}章的标题` }
        }
        const indices = chapters.map(c => c.chapter_index).sort((a, b) => a - b)
        const detail = chapters.map(c => `第${c.chapter_index}章「${c.title}」`).join('、')
        return { title: `更新了第${indices.join('、')}章标题`, summary: detail }
      }
      if (singleIndex != null && singleTitle) {
        return { title: `更新了第${singleIndex}章「${singleTitle}」`, summary: `更新了第${singleIndex}章的标题` }
      }
      if (firstLine.includes('已更新') || firstLine.includes('已清除')) {
        const indices = Array.from(result.matchAll(/第\s*(\d+)\s*章/g), m => parseInt(m[1]))
        const unique = [...new Set(indices)].sort((a, b) => a - b)
        if (unique.length > 0) return { title: `更新了第${unique.join('、')}章标题`, summary: `更新了第${unique.join('、')}章标题` }
      }
      return { title: '更新了章节标题', summary: '更新了章节标题' }
    }
    case 'create_chapter': {
      const rangeMatch = firstLine.match(/已创建第\s*(\d+)(?:-(\d+))?/)
      if (rangeMatch) {
        if (rangeMatch[2]) return { title: `创建了第${rangeMatch[1]}-${rangeMatch[2]}章`, summary: `创建了第${rangeMatch[1]}-${rangeMatch[2]}章` }
        return { title: `创建了第${rangeMatch[1]}章`, summary: `创建了第${rangeMatch[1]}章` }
      }
      return { title: '创建了章节', summary: '创建了章节' }
    }
    case 'write_volume':
      return { title: '更新了卷进度', summary: '更新了卷进度' }
    case 'create_volume':
      return { title: '创建了卷', summary: firstLine || '创建了卷' }
    case 'delete': {
      const type = args?.type as string | undefined
      const typeLabels: Record<string, string> = { chapter: '章节', character: '角色卡', world: '世界观设定', volume: '卷' }
      const deletedCount = (result.match(/已删除/g) || []).length
      if (deletedCount > 1) {
        return { title: `删除了 ${deletedCount} 个${typeLabels[type || ''] || '实体'}`, summary: result }
      }
      return { title: '删除了实体', summary: firstLine || result }
    }
    default:
      return { title: `调用 ${name}`, summary: `调用了 ${name}` }
  }
}

function formatTokenCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${n}`
}

function findLastAssistant(
  msgs: ChatMsg[],
  opts: { excludeThinking?: boolean; excludeInlineText?: boolean; extra?: (m: ChatMsg) => boolean } = {}
): ChatMsg | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role !== 'assistant' || m.isToolCall) continue
    if (opts.excludeThinking && m.isThinking) continue
    if (opts.excludeInlineText && m.isInlineText) continue
    if (opts.extra && !opts.extra(m)) continue
    return m
  }
  return undefined
}

function ContextUsageRing({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
  const color = pct >= 80 ? 'text-red-500' : pct >= 60 ? 'text-amber-500' : 'text-emerald-500'
  const radius = 6
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - pct / 100)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="relative h-4 w-4 flex items-center justify-center cursor-default"
          aria-label={`上下文使用率 ${pct.toFixed(1)}%`}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4 -rotate-90">
            <circle
              cx="8"
              cy="8"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-muted-foreground/25"
            />
            <circle
              cx="8"
              cy="8"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              className={color}
              style={{ transition: 'stroke-dashoffset 200ms ease-out' }}
            />
          </svg>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {`${formatTokenCount(used)} / ${formatTokenCount(total)} (${pct.toFixed(1)}%)`}
      </TooltipContent>
    </Tooltip>
  )
}

export function AIPanel({ width, configVersion, onClose }: { width?: number; configVersion?: number; onClose?: () => void }) {
  const [freeInput, setFreeInput] = useState('')
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [apiConfig, setApiConfig] = useState<any>(null)
  const [preset, setPreset] = useState<any>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const imeComposingRef = useRef(false)
  const pendingResolveRef = useRef<((value: string) => void) | null>(null)
  const pendingProposalRef = useRef<ProposalData | null>(null)
  const [isWriteMode, setIsWriteMode] = useState(true)
  const isWriteModeRef = useRef(isWriteMode)
  const finalMsgRef = useRef<string | null>(null)
  const pendingReasoningIdRef = useRef<string | null>(null)
  const roundReasoningRef = useRef<string | null>(null)
  const apiConversationRef = useRef<ChatMessage[]>([])
  const conversationLenBeforeRef = useRef(0)
  const setWriteMode = useCallback((v: boolean) => {
    isWriteModeRef.current = v
    setIsWriteMode(v)
  }, [])
  const [debugMode, setDebugMode] = [useAppStore((s) => s.debugMode), useAppStore((s) => s.setDebugMode)]
  const setEditorView = useAppStore((s) => s.setEditorView)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyList, setHistoryList] = useState<any[]>([])
  const [allConfigs, setAllConfigs] = useState<any[]>([])
  const [switchMenuOpen, setSwitchMenuOpen] = useState(false)
  const [commands, setCommands] = useState<QuickCommand[]>(() => {
    const saved = localStorage.getItem('quick-commands')
    if (saved) return JSON.parse(saved)
    return [{ id: 'default', name: '自定义按钮', prompt: '快试试右键编辑自定义按钮吧', autoSend: false }]
  })
  const [cmdDialogOpen, setCmdDialogOpen] = useState(false)
  const [editingCmd, setEditingCmd] = useState<QuickCommand | null>(null)
  const [cmdName, setCmdName] = useState('')
  const [cmdPrompt, setCmdPrompt] = useState('')
  const [cmdAutoSend, setCmdAutoSend] = useState(true)
  const [cmdMultiCandidate, setCmdMultiCandidate] = useState(true)
  const [cmdCtxMenu, setCmdCtxMenu] = useState<{ x: number; y: number; cmd: QuickCommand } | null>(null)
  const cmdCtxMenuRef = useRef<HTMLDivElement>(null)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [revertText, setRevertText] = useState('')
  const [volumeRejectText, setVolumeRejectText] = useState('')
  const [confirmRejectText, setConfirmRejectText] = useState('')
  const confirmResolveRef = useRef<((action: 'accept' | 'reject', reason?: string) => void) | null>(null)
  const [dotTick, setDotTick] = useState(0)
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set())
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set())
  const [tokenWarningVisible, setTokenWarningVisible] = useState(false)
  const [longInputMode, setLongInputMode] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelHeight, setPanelHeight] = useState(0)
  // 上一次发给 API 的"完整请求 token 数"：system + tools + 对话历史（含 contextPrefix）
  // 每次发 API 时更新；新对话 = 0；abort / 切对话 / 加载历史时同步
  const [actualContextTokens, setActualContextTokens] = useState(0)
  // 当前 session 的"最后一次消息变化时间"，用于历史时间戳
  // 不要在切换/加载历史时刷新，只在消息真有变化时更新
  const [lastActiveTime, setLastActiveTime] = useState(() => new Date().toLocaleString('zh-CN'))
  const scrollRef = useRef<HTMLElement | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)
  const lastSectionsRef = useRef<Record<string, string>>({})
  const abortRef = useRef<AbortController | null>(null)
  const genIdRef = useRef(0)

  const getViewport = (): HTMLElement | null => {
    return viewportRef.current || scrollRef.current || document.querySelector('.ai-panel-scroll [data-radix-scroll-area-viewport]') as HTMLElement | null
  }

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [freeInput, longInputMode, panelHeight])

  // 关闭长文本模式时清掉残留的 inline height,让 className 的 min-h-[4em] 重新生效
  // 必须在浏览器绘制前清掉,所以用 useLayoutEffect 而不是 useEffect,避免闪烁
  useLayoutEffect(() => {
    if (longInputMode) return
    const el = inputRef.current
    if (!el) return
    el.style.height = ''
  }, [longInputMode])
  const chapters = useEditorStore((s) => s.chapters)
  const activeChapterId = useEditorStore((s) => s.activeChapterId)
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const volumes = useEditorStore((s) => s.volumes)
  const activeChapter = chapters.find((c) => c.id === activeChapterId)
  const uiFont = useSettingsStore((s) => s.font)
  const bodyFontStyle = { fontFamily: `"${uiFont.uiFont}", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`, fontSize: uiFont.chatFontSize }
  const smallFontStyle = { fontSize: Math.max(10, uiFont.chatFontSize - 2) }
  const prevProjectRef = useRef<string | null>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const sessionIdRef = useRef(generateId())
  const activeProjectIdRef = useRef(activeProjectId)

  // 静态 system + tools 的 token 估算（runStream 之外用这个作 fallback）
  const staticSystemAndToolsTokens = useMemo(() => {
    const baseSystem = buildSystemPrompt()
    const toolsGuide = toolUsageGuide()
    const toolsJson = JSON.stringify(toolDefinitions)
    const systemContent = baseSystem + '\n\n' + toolsGuide
    return estimateMessageTokens({ role: 'system', content: systemContent }) + countText(toolsJson)
  }, [])

  // 是否正在生成(用于底部固定指示器):最新非工具非思考的 assistant 正在 load,
  // 且其后没有正在执行的工具调用(那种情况 AI 是在等工具结果)
  const lastAssistant = useMemo(
    () => findLastAssistant(messages, { excludeThinking: true }),
    [messages]
  )
  // outline 按钮块用的"最新非工具调用 assistant"——提到 map 外面,
  // 避免 N 消息 × O(N) 查找 = O(N²)
  const lastAdoptableAssistant = useMemo(
    () => findLastAssistant(messages),
    [messages]
  )
  const isGenerating = useMemo(() => {
    if (!lastAssistant || !lastAssistant.loading) return false
    const idx = messages.findIndex(m => m.id === lastAssistant.id)
    return !messages.slice(idx + 1).some(m => m.isToolCall && m.loading)
  }, [messages, lastAssistant])

  // 算"完整请求 token 数" = system + tools + 当前 apiConversationRef
  // runStream 里用真实 toolSystemPrompt 算；其他场景用静态估算
  const computeActualContextTokens = useCallback((sysContent?: string) => {
    const convTokens = estimateConversationTokens(apiConversationRef.current)
    const toolsTokens = countText(JSON.stringify(toolDefinitions))
    if (sysContent) {
      return convTokens + estimateMessageTokens({ role: 'system', content: sysContent }) + toolsTokens
    }
    return convTokens + staticSystemAndToolsTokens
  }, [staticSystemAndToolsTokens])

  // 上下文使用率：直接读 state（新对话 = 0，发 API 时更新）
  const usedContextTokens = actualContextTokens
  const totalContextTokens = getContextWindow(apiConfig?.context_length)
  const contextPct = totalContextTokens > 0 ? (usedContextTokens / totalContextTokens) * 100 : 0
  const contextLevel: 'normal' | 'warn' | 'danger' | 'limit' =
    contextPct >= 100 ? 'limit' : contextPct >= 80 ? 'danger' : contextPct >= 60 ? 'warn' : 'normal'
  const isContextAtLimit = contextLevel === 'limit'
  activeProjectIdRef.current = activeProjectId

  const getHistoryKey = (pid: string) => `ai-chat-history-${pid}`

  // 集中封装"读 localStorage history":
  //   - 无数据 / saved 为空 → 返回 []
  //   - 解析成功但不是数组 → 返回 []
  //   - 解析抛错 → 返回 null(让调用方区分"无历史"和"损坏历史",前者可清空,后者要保留内存)
  // 此前在 loadLatest / openHistory / loadHistory 三处各写一份,行为漂移不可控。
  const readHistoryFromStorage = (pid: string): any[] | null => {
    try {
      const saved = localStorage.getItem(getHistoryKey(pid))
      const parsed = saved ? JSON.parse(saved) : []
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      console.warn('[AIPanel] readHistoryFromStorage: 解析失败', e)
      return null
    }
  }

  // 校验 history 数组里单个 session 是不是一个合法快照。
  // 注意:必须用 Array.isArray,不能用 typeof === 'object' —— typeof 对 {} 也返回 true,
  // 然后 deserializeMessages({}).map 会抛 TypeError 把整个 effect 干掉。
  // loadLatest 和 loadHistory 都用同一份,避免规则漂移。
  const isValidSession = (s: any): s is { id: string; messages: any[]; apiConversation: any[]; time?: string } =>
    !!s && typeof s === 'object' &&
    typeof s.id === 'string' &&
    Array.isArray((s as any).messages) &&
    Array.isArray((s as any).apiConversation)

  const trimConversation = (ref: React.MutableRefObject<ChatMessage[]>, maxTokens: number) => {
    if (ref.current.length === 0) return

    const prefix = buildPrefixSum(ref.current)
    const totalTokens = prefix[prefix.length - 1]
    if (totalTokens <= maxTokens) return

    const userPositions: number[] = []
    for (let i = 0; i < ref.current.length; i++) {
      if (ref.current[i].role === 'user') userPositions.push(i)
    }
    if (userPositions.length <= 1) return

    for (let i = 0; i < userPositions.length - 1; i++) {
      const cutAt = userPositions[i + 1]
      const remainingTokens = tokensInRange(prefix, cutAt, ref.current.length)
      if (remainingTokens <= maxTokens) {
        ref.current = ref.current.slice(cutAt)
        return
      }
    }

    const lastUserPos = userPositions[userPositions.length - 1]
    if (lastUserPos > 0) {
      const lastTurnTokens = tokensInRange(prefix, lastUserPos, ref.current.length)
      if (lastTurnTokens > maxTokens) {
        console.warn(
          `[trimConversation] Last turn alone (${lastTurnTokens} tokens) exceeds budget (${maxTokens}). Keeping it as-is.`
        )
      }
      ref.current = ref.current.slice(lastUserPos)
    }
  }

  const serializeMessages = (msgs: ChatMsg[]) => msgs.map(m => ({
    role: m.role,
    content: m.content,
    rawContent: m.rawContent,
    systemPrompt: m.systemPrompt,
    isThinking: m.isThinking,
    isToolCall: m.isToolCall,
    isInlineText: m.isInlineText,
    reasoning: m.reasoning,
    toolSummary: m.toolSummary,
    toolResult: m.toolResult,
    candidates: m.candidates,
    activeCandidate: m.activeCandidate,
    toolName: m.toolName,
    toolCalls: m.toolCalls,
    tool_call_id: m.tool_call_id,
    status: m.status,
    taskType: m.taskType,
  }))

  const deserializeMessages = (msgs: any[]): ChatMsg[] => msgs.map(m => ({
    id: generateId(),
    role: m.role,
    content: m.content,
    rawContent: m.rawContent,
    systemPrompt: m.systemPrompt,
    isThinking: m.isThinking,
    isToolCall: m.isToolCall,
    isInlineText: m.isInlineText,
    reasoning: m.reasoning,
    reasoningDone: true,
    toolSummary: m.toolSummary,
    toolResult: m.toolResult,
    candidates: m.candidates,
    activeCandidate: m.activeCandidate,
    toolName: m.toolName,
    toolCalls: m.toolCalls,
    tool_call_id: m.tool_call_id,
    status: m.status,
    taskType: m.taskType,
    loading: false,
  }))

  const saveToHistory = (pid: string | null | undefined, msgs: ChatMsg[]) => {
    if (!pid || msgs.length === 0) return
    try {
      const saved = localStorage.getItem(getHistoryKey(pid))
      const history = saved ? JSON.parse(saved) : []
      const sid = sessionIdRef.current
      const existingIdx = history.findIndex((h: any) => h.id === sid)
      const existing = existingIdx >= 0 ? history[existingIdx] : null
      // 防御: 如果内存里 apiConversation 暂时为空(例如加载某个空快照后、
      // 流式生成前、或者切到历史时 sessionIdRef 还没更新),绝不能把空数组
      // 覆盖到历史 entry 里——否则下次再点这个 session 时就会走
      // `loadHistory` 的 `setMessages([])` 分支,内容直接消失。
      const safeApiConversation = (
        Array.isArray(apiConversationRef.current) && apiConversationRef.current.length > 0
      )
        ? JSON.parse(JSON.stringify(apiConversationRef.current))
        : (Array.isArray(existing?.apiConversation) ? existing.apiConversation : [])
      const entry = {
        id: sid,
        time: lastActiveTime || new Date().toLocaleString('zh-CN'),
        messages: serializeMessages(msgs),
        apiConversation: safeApiConversation,
      }
      if (existingIdx >= 0) {
        history.splice(existingIdx, 1)
      }
      history.unshift(entry)
      // 按 time 倒序排序（最新在前），避免依赖 unshift 副作用
      // 兜底:toLocaleString 字符串在某些环境下 new Date() 解析可能返回 NaN,
      // 此时降级到字符串比较,避免 sort 行为未定义导致顺序错乱
      history.sort((a: any, b: any) => {
        const ta = new Date(a.time).getTime()
        const tb = new Date(b.time).getTime()
        if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta
        return String(b.time).localeCompare(String(a.time))
      })
      try {
        localStorage.setItem(getHistoryKey(pid), JSON.stringify(history.slice(0, 50)))
      } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
          console.warn('localStorage quota exceeded, trying to save fewer sessions')
          // Try saving fewer sessions
          try {
            localStorage.setItem(getHistoryKey(pid), JSON.stringify(history.slice(0, 10)))
          } catch (e2) {
            console.error('Failed to save history even with fewer sessions:', e2)
          }
        } else {
          throw e
        }
      }
    } catch (err) {
      logger.errorObj('ai.saveHistory', 'failed', err, { projectId: activeProjectIdRef.current })
    }
  }

  // 上下文使用率跨级时自动打开警告条；降到 normal 时自动收起
  useEffect(() => {
    if (contextLevel === 'normal') {
      setTokenWarningVisible(false)
    } else {
      setTokenWarningVisible(true)
    }
  }, [contextLevel])

  // Auto-save & switch history on project change
  useEffect(() => {
    const saveCurrent = (pid: string) => {
      saveToHistory(pid, messagesRef.current)
    }

    const loadLatest = (pid: string) => {
      // 兜底:任何解析异常都不能清空内存里的对话
      const history = readHistoryFromStorage(pid)
      if (history === null) return  // 解析失败 → 保留内存(避免覆盖用户当前对话)

      if (history.length > 0) {
        const session = history[0]
        if (isValidSession(session) && session.apiConversation.length > 0) {
          setMessages(deserializeMessages(session.messages))
          apiConversationRef.current = JSON.parse(JSON.stringify(session.apiConversation))
          sessionIdRef.current = session.id
          setActualContextTokens(computeActualContextTokens())
          if (session.time) setLastActiveTime(session.time)
        } else {
          // history[0] 损坏或 apiConversation 为空 —— 保留内存里的 UI messages,
          // 但**重置身份标识**(sessionId / lastActiveTime),避免下次 saveToHistory
          // 用旧 sessionId 把"新对话"写到 entry 里污染历史时间戳。
          if (!isValidSession(session)) {
            console.warn('[AIPanel] loadLatest: history[0] 损坏,保留内存 messages', session)
          } else {
            console.warn('[AIPanel] loadLatest: history[0].apiConversation 为空,保留内存 messages')
          }
          sessionIdRef.current = generateId()
          setLastActiveTime(new Date().toLocaleString('zh-CN'))
        }
      } else {
        // 该项目确实没有任何历史记录,才走清空分支
        setMessages([])
        apiConversationRef.current = []
        sessionIdRef.current = generateId()
        setActualContextTokens(0)
        setLastActiveTime(new Date().toLocaleString('zh-CN'))
      }
    }

    if (prevProjectRef.current && prevProjectRef.current !== activeProjectId) {
      abortAndCleanup()
      saveCurrent(prevProjectRef.current)
    }
    prevProjectRef.current = activeProjectId
    if (activeProjectId) {
      loadLatest(activeProjectId)
    }
  }, [activeProjectId])

  useEffect(() => {
    const onBeforeUnload = () => {
      saveToHistory(activeProjectIdRef.current, messagesRef.current)
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // 任务完成（AI 流结束）时自动落盘 — lastActiveTime 只在流完成、loadHistory、
  // loadLatest、handleNewChat 几个节点更新，不会被流式 chunk 改写，所以这里同步保存即可
  useEffect(() => {
    if (!activeProjectId) return
    if (messagesRef.current.length === 0) return
    saveToHistory(activeProjectId, messagesRef.current)
  }, [lastActiveTime, activeProjectId])

  useEffect(() => {
    const el = viewportRef.current || document.querySelector('.ai-panel-scroll [data-radix-scroll-area-viewport]') as HTMLElement | null
    if (!el) return
    scrollRef.current = el
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    const threshold = 30
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
      wasAtBottomRef.current = atBottom
      setShowScrollDown(!atBottom)
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    if (wasAtBottomRef.current) {
      const el = getViewport()
      if (el) el.scrollTop = el.scrollHeight
    }
    const loadingMsg = messages.find(m => m.loading)
    if (loadingMsg && loadingMsg.reasoning && loadingMsg.reasoning.length > 0) {
      const lastIdx = loadingMsg.reasoning.length - 1
      const idPrefix = loadingMsg.isThinking ? loadingMsg.id : `${loadingMsg.id}-${lastIdx}`
      const rEl = document.getElementById(`reasoning-${idPrefix}`)
      if (rEl) rEl.scrollTop = rEl.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (wasAtBottomRef.current) {
      requestAnimationFrame(() => {
        const el = getViewport()
        if (el) el.scrollTop = el.scrollHeight
      })
    }
  }, [expandedToolCalls])

  useEffect(() => {
    const toExpand = new Set<string>()
    for (const msg of messages) {
      if (msg.isToolCall && !msg.loading && (msg.confirmUpdate || msg.editChapterButtons || msg.editVolumeButtons || msg.proposal)) {
        toExpand.add(msg.id)
      }
    }
    if (toExpand.size > 0) {
      setExpandedToolCalls((prev) => {
        const next = new Set(prev)
        let changed = false
        for (const id of toExpand) {
          if (!next.has(id)) { next.add(id); changed = true }
        }
        return changed ? next : prev
      })
    }
  }, [messages])

  useEffect(() => {
    if (!cmdCtxMenu) return
    const onDown = (e: MouseEvent) => {
      if (cmdCtxMenuRef.current && !cmdCtxMenuRef.current.contains(e.target as Node)) {
        setCmdCtxMenu(null)
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCmdCtxMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [cmdCtxMenu])

  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const update = () => setPanelHeight(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const loadApiConfig = useCallback(async () => {
    const configs = await window.electronAPI.apiConfig.list()
    setAllConfigs(configs)
    const config = await window.electronAPI.apiConfig.getDefault()
    if (config) {
      setApiConfig(config)
      const p = await window.electronAPI.preset.getByConfig(config.id)
      if (p) setPreset(p)
    }
  }, [])

  useEffect(() => { loadApiConfig() }, [loadApiConfig, configVersion])

  const switchApiConfig = async (configId: string) => {
    const config = allConfigs.find((c) => c.id === configId)
    if (!config) return
    setApiConfig(config)
    const p = await window.electronAPI.preset.getByConfig(configId)
    setPreset(p)
    setSwitchMenuOpen(false)
  }

  useEffect(() => {
    const loading = messages.some(m => m.loading)
    if (!loading) { setDotTick(0); return }
    const timer = setInterval(() => setDotTick((t) => t + 1), 400)
    return () => clearInterval(timer)
  }, [messages.some(m => m.loading)])

  useEffect(() => {
    if (!apiConfig) return
    const interval = setInterval(() => {
      const pending = getPendingAction()
      if (!pending) return
      setPendingAction(null)
      if (pending.action === 'sendToChat') {
        setFreeInput(pending.text)
        return
      }
      if (pending.action === 'autoOutlinePrompt') {
        // freshSession: 升级迁移等场景要在干净的新对话里跑 prompt,避免污染当前对话
        if (pending.freshSession && messagesRef.current.length > 0 && activeProjectId) {
          saveToHistory(activeProjectId, messagesRef.current)
          setMessages([])
          messagesRef.current = []
          apiConversationRef.current = []
          sessionIdRef.current = generateId()
        }
        // 旧大纲迁移(freshSession)需 Write 调 create_volume/write_volume；新书规划保持 Chat
        setWriteMode(!!pending.freshSession)
        const userPrompt = buildUserPrompt(pending.text)
        runStream(userPrompt, 'outlinePlan')
        return
      }
      if (pending.action === 'expandOutline') {
        const userPrompt = buildUserPrompt(pending.text)
        runStream(userPrompt, 'free')
        return
      }
      if (pending.action === 'polish') {
        setWriteMode(true)
        runStream(
          buildUserPrompt(buildParagraphActionPrompt('polish', pending.chapterIndex, pending.paragraphIndices), pending.text),
          'free',
        )
        return
      }
      if (pending.action === 'condense') {
        setWriteMode(true)
        runStream(
          buildUserPrompt(buildParagraphActionPrompt('condense', pending.chapterIndex, pending.paragraphIndices), pending.text),
          'free',
        )
        return
      }
      if (pending.action === 'expand') {
        setWriteMode(true)
        runStream(
          buildUserPrompt(buildParagraphActionPrompt('expand', pending.chapterIndex, pending.paragraphIndices), pending.text),
          'free',
        )
        return
      }
      if (pending.action === 'customCommand') {
        const customPrompt = pending.customPrompt?.trim()
        if (customPrompt) {
          setWriteMode(true)
          runStream(
            buildUserPrompt(buildParagraphCustomPrompt(customPrompt, pending.chapterIndex, pending.paragraphIndices), pending.text),
            'free',
          )
        }
        return
      }
      if (pending.action === 'chapterReviewFix') {
        const reviewText = pending.reviewText?.trim()
        if (!reviewText) return
        setWriteMode(true)
        runStream(
          buildUserPrompt(buildChapterReviewFixPrompt(pending.chapterIndex, reviewText)),
          'free',
        )
        return
      }
      const cmd = commands.find((c) => c.id === pending.action)
      if (cmd) {
        const prompt = buildUserPrompt(cmd.prompt, pending.text)
        runStream(prompt, cmd.id)
      }
    }, 300)
    return () => clearInterval(interval)
  }, [apiConfig, preset])

  const runStream = async (userPrompt: string, taskType?: string) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal
    const genId = ++genIdRef.current
    finalMsgRef.current = null
    pendingReasoningIdRef.current = null
    roundReasoningRef.current = null
    const isCurrent = () => genId === genIdRef.current
    try {
      const state = useEditorStore.getState()
      const cfg = apiConfig
      const pid = state.activeProjectId
      const cid = state.activeChapterId
      if (!cfg || !pid) {
        setMessages((prev) => [...prev, { id: generateId(), role: 'assistant', content: !cfg ? '请先在设置中配置 API' : '请先选择作品', loading: false }])
        return
      }

      const msgId = generateId()
      const writeMode = isWriteModeRef.current
      const isMulti = writeMode && taskType !== 'free' && taskType !== 'outlinePlan' && (commands.find((c) => c.id === taskType)?.multiCandidate !== false)
      const effectivePrompt = isMulti ? userPrompt + '\n\n请生成三份不同的版本，调用propose_action，供我选择。' : userPrompt
      const count = 1

      let activePreset = preset
      if (taskType) {
        const boundPreset = await window.electronAPI.taskBinding.getByTask(pid, taskType)
        if (boundPreset) activePreset = boundPreset
      }

      const isFirstExchange = messagesRef.current.filter((m) => m.role === 'user' && !m.isToolCall).length === 0
      const useWriteContext = writeMode
      const currentContent = useEditorStore.getState().chapters.find((c) => c.id === cid)?.content
      const freshCtx = useWriteContext
        ? await assembleContext({
            projectId: pid,
            chapterId: cid || '',
            editorView: useAppStore.getState().editorView,
            currentContent,
            styleGuidance: getStyleGuidance() || undefined,
            styleRestrictions: getStyleRestrictions() || undefined,
            outlineOverride: getSummaryOutline() || undefined,
          })
        : await assembleContext({
            projectId: pid,
            chapterId: cid || '',
            editorView: useAppStore.getState().editorView,
          })
      // 构建状态+变更通知，放到用户消息中（稳定性优先，system 消息保持不变以提升缓存命中率）
      const modeLabel = writeMode ? 'Write' : 'Chat'
      let contextPrefix = ''
      let systemPrompt: string
      if (freshCtx) {
        systemPrompt = freshCtx.systemPrompt
        if (isFirstExchange) {
          lastSectionsRef.current = { ...freshCtx.sections }
          contextPrefix = buildContextPrefix(freshCtx.sections)
        } else {
          const stateParts: string[] = []
          const projectChanged = freshCtx.sections.project !== lastSectionsRef.current['project']
          if (projectChanged && freshCtx.sections.project) stateParts.push(freshCtx.sections.project)
          if (freshCtx.sections.location) stateParts.push(freshCtx.sections.location)
          if (stateParts.length > 0) contextPrefix += stateParts.join('\n\n')

          const diffParts: string[] = []
          if (freshCtx.sections.project !== lastSectionsRef.current['project'] && !stateParts.includes(freshCtx.sections.project!)) {
            diffParts.push(freshCtx.sections.project!)
          }
          if (freshCtx.sections.location !== lastSectionsRef.current['location'] && !stateParts.includes(freshCtx.sections.location!)) {
            diffParts.push(freshCtx.sections.location!)
          }
          const changes = consumeChanges(pid)
          if (changes.length > 0) {
            diffParts.push('【变更通知】\n' + changes.join('\n'))
          }
          if (diffParts.length > 0) {
            contextPrefix += (contextPrefix ? '\n\n' : '') + diffParts.join('\n\n')
          }
          lastSectionsRef.current = { ...freshCtx.sections }
        }
      } else {
        systemPrompt = buildSystemPrompt()
      }
      // 按顺序组装：铁律 -> 工具 guide -> 风格要求/限制/敏感词 -> 知识库状态
      let fullSystemPrompt: string
      const sensitiveWordsList = await window.electronAPI.sensitive.list()
      const sensitiveWords = sensitiveWordsList.map((w: any) => w.word).filter(Boolean)
      const stylePrompt = buildStylePrompt(getStyleGuidance() || undefined, getStyleRestrictions() || undefined, sensitiveWords.length > 0 ? sensitiveWords : undefined)
      const corePrompt = freshCtx ? systemPrompt.split('\n\n【风格要求】')[0].split('\n\n【风格限制】')[0].split('\n\n【敏感词】')[0] : systemPrompt
      fullSystemPrompt = corePrompt + '\n\n' + toolUsageGuide()
      if (stylePrompt) {
        fullSystemPrompt += '\n\n' + stylePrompt
      }
      if (freshCtx?.sections.knowledgeHint) {
        fullSystemPrompt += '\n\n' + freshCtx.sections.knowledgeHint
      }
      contextPrefix = `【当前模式】${modeLabel}` + (contextPrefix ? '\n\n' + contextPrefix : '')
      const augmentedPrompt = contextPrefix + '\n\n' + effectivePrompt
      const userMsgId = generateId()
      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: 'user', content: augmentedPrompt, rawContent: userPrompt.replace(/【[^】]*】\s*/g, '').trim().split('注意：')[0].trim(), systemPrompt: fullSystemPrompt },
        { id: msgId, role: 'assistant', content: '', loading: true, userPrompt, taskType, candidates: Array(count).fill(''), activeCandidate: 0 },
      ])

      let charBuffers: string[] = Array(count).fill('')
      let rafScheduled: boolean[] = Array(count).fill(false)
      let emitAccumArr: number[] = Array(count).fill(1)
      let currentRateArr: number[] = Array(count).fill(100)
      let contentStartedArr: boolean[] = Array(count).fill(false)
      let doneCount = 0

      const scrollViewport = (): HTMLElement | null => {
        return viewportRef.current || scrollRef.current
      }

      const createTokenBuffer = (writeBatch: (batch: string, isFirst: boolean) => void) => {
        let buffer = ''
        let rafScheduled = false
        let emitAccum = 1
        let currentRate = 100
        let started = false

        const consume = () => {
          rafScheduled = false
          if (!isCurrent() || !buffer) return
          const targetRate = Math.max(Math.min(20 * Math.pow((buffer.length + 1) / 20, 0.5), 120), 50)
          currentRate += (targetRate - currentRate) * 0.5
          emitAccum += currentRate / 60
          const toEmit = Math.min(Math.floor(emitAccum), buffer.length)
          emitAccum -= toEmit
          if (toEmit <= 0) {
            rafScheduled = true
            requestAnimationFrame(consume)
            return
          }
          const batch = buffer.slice(0, toEmit)
          buffer = buffer.slice(toEmit)
          if (!started) {
            started = true
            flushSync(() => { writeBatch(batch, true) })
          } else {
            writeBatch(batch, false)
          }
          if (buffer) {
            rafScheduled = true
            requestAnimationFrame(consume)
          }
        }

        const schedule = () => {
          if (!rafScheduled) {
            rafScheduled = true
            requestAnimationFrame(consume)
          }
        }

        const push = (token: string) => {
          if (!isCurrent()) return
          buffer += token
          schedule()
        }

        const flush = () => {
          if (!isCurrent() || !buffer) return
          const remaining = buffer
          buffer = ''
          writeBatch(remaining, !started)
        }

        return { push, flush }
      }

      const consumeBuffer = (idx: number) => {
        rafScheduled[idx] = false
        if (!isCurrent()) return
        if (!charBuffers[idx]) return
        const targetRate = Math.max(Math.min(20 * Math.pow((charBuffers[idx].length + 1) / 20, 0.5), 120), 50)
        currentRateArr[idx] += (targetRate - currentRateArr[idx]) * 0.5
        emitAccumArr[idx] += currentRateArr[idx] / 60
        const toEmit = Math.min(Math.floor(emitAccumArr[idx]), charBuffers[idx].length)
        emitAccumArr[idx] -= toEmit
        if (toEmit <= 0) {
          if (charBuffers[idx]) {
            rafScheduled[idx] = true
            requestAnimationFrame(() => consumeBuffer(idx))
          }
          return
        }
        const batch = charBuffers[idx].slice(0, toEmit)
        charBuffers[idx] = charBuffers[idx].slice(toEmit)
        if (!contentStartedArr[idx]) {
          contentStartedArr[idx] = true
          flushSync(() => {
            setMessages((prev) => prev.map((m) => {
              if (m.id !== msgId) return m
              const candidates = [...(m.candidates || [])]
              candidates[idx] = (candidates[idx] || '') + batch
              return { ...m, candidates, content: candidates[m.activeCandidate || 0], reasoningDone: true }
            }))
          })
          const el = scrollViewport()
          if (el) el.scrollTop = el.scrollHeight
        } else {
          setMessages((prev) => prev.map((m) => {
            if (m.id !== msgId) return m
            const candidates = [...(m.candidates || [])]
            candidates[idx] = (candidates[idx] || '') + batch
            return { ...m, candidates, content: candidates[m.activeCandidate || 0] }
          }))
        }
        if (charBuffers[idx]) {
          rafScheduled[idx] = true
          requestAnimationFrame(() => consumeBuffer(idx))
        }
      }

      const scheduleConsume = (idx: number) => {
        if (!rafScheduled[idx]) {
          rafScheduled[idx] = true
          requestAnimationFrame(() => consumeBuffer(idx))
        }
      }

      const doOnToken = (idx: number, token: string) => {
        if (!isCurrent()) return
        charBuffers[idx] += token
        scheduleConsume(idx)
      }

      const flushBuffer = (idx: number) => {
        if (!isCurrent()) return
        if (!charBuffers[idx]) return
        const remaining = charBuffers[idx]
        charBuffers[idx] = ''
        setMessages((prev) => prev.map((m) => {
          if (m.id !== msgId) return m
          const candidates = [...(m.candidates || [])]
          candidates[idx] = (candidates[idx] || '') + remaining
          return { ...m, candidates, content: candidates[m.activeCandidate || 0] || '' }
        }))
      }

      const doOnDone = (texts?: string[], idx?: number) => {
        if (!isCurrent()) return
        if (texts) {
          charBuffers = Array(count).fill('')
          setMessages((prev) => prev.map((m) => {
            if (m.id !== msgId) return m
            return { ...m, candidates: texts, content: texts[m.activeCandidate || 0] || '', loading: false, status: 'completed' }
          }))
          return
        }
        if (idx !== undefined) flushBuffer(idx)
        doneCount++
        if (doneCount >= count) {
          setMessages((prev) => prev.map((m) => {
            if (m.id !== msgId) return m
            return { ...m, loading: false, status: 'completed' }
          }))
        }
      }

      const doOnError = (err: Error) => {
        if (!isCurrent()) return
        const fid = finalMsgRef.current
        setMessages((prev) => prev.map((m) => {
          if (m.id === msgId) return { ...m, content: m.content || `错误: ${err.message}`, loading: false, reasoningDone: true, ...(!fid ? { status: 'error' as const } : {}) }
          if (fid && m.id === fid) return { ...m, loading: false, status: 'error' as const }
          return m
        }))
      }

      const isDeepSeek = /deepseek/i.test(cfg.model) || /deepseek/i.test(cfg.base_url) || cfg.provider === 'deepseek'
      const thinkingEnabled = !!activePreset?.thinking_enabled
      const thinkingParam = {
        thinking: { type: thinkingEnabled ? 'enabled' as const : 'disabled' as const },
        ...(thinkingEnabled && isDeepSeek ? { reasoningEffort: (activePreset.reasoning_effort || 'high') as 'high' | 'max' } : {}),
      }

      const chatMode = !writeMode
        const toolsToUse = toolDefinitions
        const guideToUse = toolUsageGuide()
        const coreForTool = freshCtx ? systemPrompt.split('\n\n【风格要求】')[0].split('\n\n【风格限制】')[0].split('\n\n【敏感词】')[0] : systemPrompt
        const toolSystemPrompt = coreForTool + '\n\n' + guideToUse + (stylePrompt ? '\n\n' + stylePrompt : '')
        apiConversationRef.current.push({ role: 'user', content: augmentedPrompt })
        conversationLenBeforeRef.current = apiConversationRef.current.length
        // "首"：用户发消息时立即更新圆环（包含 user 消息 + system+tools）
        // 流式接收和 tool result 过程中不更新，stream 整体完成后再算一次（"尾"）
        setActualContextTokens(computeActualContextTokens(toolSystemPrompt))
        const toolMessages: any[] = [
          { role: 'system', content: toolSystemPrompt },
          ...apiConversationRef.current,
        ]
        let toolCallCount = 0
        const finalTokenWriter = createTokenBuffer((batch) => {
          let fid = finalMsgRef.current
          if (!fid) {
            fid = generateId()
            finalMsgRef.current = fid
            const newId = fid
            setMessages((prev) => [...prev, { id: newId, role: 'assistant' as const, content: batch, loading: true, taskType }])
          } else {
            const existingId = fid
            setMessages((prev) => prev.map((m) => m.id === existingId ? { ...m, content: m.content + batch } : m))
          }
        })
        let reasoningBuffer = ''
        let reasoningScheduled = false
        const consumeReasoning = () => {
          reasoningScheduled = false
          if (!isCurrent() || !reasoningBuffer) return
          const batch = reasoningBuffer
          reasoningBuffer = ''
          const tid = pendingReasoningIdRef.current
          if (!tid) {
            const newId = generateId()
            pendingReasoningIdRef.current = newId
            setMessages((prev) => [...prev, { id: newId, role: 'assistant' as const, content: '', reasoning: [batch], reasoningDone: false, isThinking: true, loading: true }])
          } else {
            setMessages((prev) => prev.map((m) => {
              if (m.id !== tid) return m
              const cur = m.reasoning ? [...m.reasoning] : ['']
              cur[cur.length - 1] += batch
              return { ...m, reasoning: cur }
            }))
            const rEl = document.getElementById(`reasoning-${tid}`)
            if (rEl) rEl.scrollTop = rEl.scrollHeight
          }
        }
        const finalReasoningWriter = {
          push: (token: string) => {
            if (!isCurrent()) return
            roundReasoningRef.current = (roundReasoningRef.current || '') + token
            reasoningBuffer += token
            if (!reasoningScheduled) {
              reasoningScheduled = true
              requestAnimationFrame(consumeReasoning)
            }
          },
          flush: () => {
            if (!isCurrent() || !reasoningBuffer) return
            const batch = reasoningBuffer
            reasoningBuffer = ''
            const tid = pendingReasoningIdRef.current
            if (tid) {
              setMessages((prev) => prev.map((m) => {
                if (m.id !== tid) return m
                const cur = m.reasoning ? [...m.reasoning] : ['']
                cur[cur.length - 1] += batch
                return { ...m, reasoning: cur }
              }))
            }
          },
        }
        const newApiMessages = await streamChatWithTools(
          {
            baseUrl: cfg.base_url,
            apiKey: cfg.api_key,
            model: cfg.model,
            messages: toolMessages,
            tools: toolsToUse as any,
            temperature: activePreset?.temperature,
            topP: activePreset?.top_p,
            maxTokens: activePreset?.max_tokens,
            ...thinkingParam,
            abortSignal: signal,
            onToken: (token) => doOnToken(0, token),
            onReasoning: (reasoning: string) => {
              if (!isCurrent()) return
              roundReasoningRef.current = (roundReasoningRef.current || '') + reasoning
              setMessages((prev) => prev.map((m) => {
                if (m.id !== msgId) return m
                const cur = m.reasoning ? [...m.reasoning] : []
                if (cur.length === 0) cur.push('')
                cur[cur.length - 1] += reasoning
                return { ...m, reasoning: cur }
              }))
              const rEl = document.getElementById(`reasoning-${msgId}-0`)
              if (rEl) rEl.scrollTop = 999999
            },
            onFinalReasoning: (token: string) => finalReasoningWriter.push(token),
            onFinalToken: (token: string) => finalTokenWriter.push(token),
            onDone: () => {},
            onError: doOnError,
          },
          async (name, args, toolCall) => {
            if (!isCurrent()) throw new DOMException('操作已取消', 'AbortError')
            await flushChapterSave()
            toolCallCount++
            if (toolCallCount === 1) {
              flushBuffer(0)
            } else {
              finalTokenWriter.flush()
              finalReasoningWriter.flush()
            }
            const toolMsgId = generateId()
            const pendingThinkingId = pendingReasoningIdRef.current
            pendingReasoningIdRef.current = null
            const prematureFinalId = finalMsgRef.current
            finalMsgRef.current = null
            const inlineTextId = prematureFinalId ? generateId() : undefined
            flushSync(() => {
              setMessages((prev) => {
                const idx = prev.findIndex((m) => m.id === msgId)
                if (idx >= 0) {
                  const copy = prev.map((m) => pendingThinkingId && m.id === pendingThinkingId ? { ...m, loading: false, reasoningDone: true } : m)
                  if (toolCallCount === 1) {
                    copy[idx] = { ...copy[idx], reasoningDone: true }
                  }
                  let insertIdx = idx + 1
                  while (insertIdx < copy.length && (copy[insertIdx].isToolCall || copy[insertIdx].isThinking || copy[insertIdx].isInlineText)) insertIdx++
                  if (inlineTextId) {
                    const prematureMsg = copy.find((m) => m.id === prematureFinalId)
                    copy.splice(insertIdx, 0, { id: inlineTextId, role: 'assistant', content: prematureMsg?.content || '', loading: false, isInlineText: true })
                    insertIdx++
                  }
                  let reasoningForTool: string[] | undefined
                  const roundReasoning = roundReasoningRef.current
                  if (roundReasoning) {
                    reasoningForTool = [roundReasoning]
                  } else {
                    reasoningForTool = copy.find((m) => m.id === pendingThinkingId)?.reasoning
                    if (!reasoningForTool) {
                      reasoningForTool = copy.find((m) => m.id === msgId)?.reasoning
                    }
                  }
                  copy.splice(insertIdx, 0, { id: toolMsgId, role: 'assistant', content: `🔧 调用工具: ${name}`, loading: true, isToolCall: true, toolName: name, toolArgs: args, reasoning: reasoningForTool })
                  return prematureFinalId ? copy.filter((m) => m.id !== prematureFinalId) : copy
                }
                const base = prev.map((m) => pendingThinkingId && m.id === pendingThinkingId ? { ...m, loading: false, reasoningDone: true } : m)
                if (inlineTextId) {
                  const prematureMsg = base.find((m) => m.id === prematureFinalId)
                  base.push({ id: inlineTextId, role: 'assistant', content: prematureMsg?.content || '', loading: false, isInlineText: true })
                }
                let reasoningForTool: string[] | undefined
                const roundReasoning = roundReasoningRef.current
                if (roundReasoning) {
                  reasoningForTool = [roundReasoning]
                } else {
                  reasoningForTool = base.find((m) => m.id === pendingThinkingId)?.reasoning
                  if (!reasoningForTool) {
                    reasoningForTool = base.find((m) => m.id === msgId)?.reasoning
                  }
                }
                base.push({ id: toolMsgId, role: 'assistant', content: `🔧 调用工具: ${name}`, loading: true, isToolCall: true, toolName: name, toolArgs: args, reasoning: reasoningForTool })
                return prematureFinalId ? base.filter((m) => m.id !== prematureFinalId) : base
              })
            })
            if (name === 'write_volume') {
              const result = await executeToolCall(name, args, pid)
              try {
                const parsed = JSON.parse(result)
                if (parsed._edit_volume) {
                  useEditorStore.getState().setPendingVolumeEdit({
                    volumeId: parsed.volumeId,
                    original: parsed.original,
                    modified: parsed.modified,
                    summary: parsed.summary,
                    pendingMeta: parsed.pendingMeta,
                  })
                  useEditorStore.getState().setActiveVolumeId(parsed.volumeId)
                  setEditorView('outline')
                  setMessages((prev) => prev.map((m) =>
                    m.id === toolMsgId ? { ...m, content: `🔧 修改待审阅：${parsed.summary}`, loading: false, editVolumeButtons: true, toolSummary: `修改待审阅：${parsed.summary}`, toolCalls: toolCall ? [toolCall] : undefined } : m
                  ))
                  return new Promise<string>((resolve) => {
                    setPendingOutlineResolve(async (action, message) => {
                      if (action === 'accept') {
                        const volumes = useEditorStore.getState().volumes
                        const vol = volumes.find((v) => v.id === parsed.volumeId)
                        if (vol) {
                          const merged = { ...vol, outline: parsed.modified, ...parsed.pendingMeta }
                          await window.electronAPI.volume.save(merged)
                          const next = await window.electronAPI.volume.list(pid)
                          useEditorStore.getState().setVolumes(next)
                        }
                        useEditorStore.getState().setPendingVolumeEdit(null)
                        setEditorView('outline')
                        setMessages((prev) => prev.map((m) =>
                          m.id === toolMsgId ? { ...m, content: `🔧 已完成修改\n\n${parsed.summary}`, loading: false, editVolumeButtons: false, toolSummary: `修改已完成：${parsed.summary}` } : m
                        ))
                        resolve('用户已确认修改卷级大纲')
                      } else {
                        useEditorStore.getState().setPendingVolumeEdit(null)
                        const rejectResult = formatEditRejectResult(message)
                        setMessages((prev) => prev.map((m) =>
                          m.id === toolMsgId ? { ...m, content: `🔧 ${rejectResult}`, loading: false, editVolumeButtons: false, toolSummary: rejectResult } : m
                        ))
                        resolve(rejectResult)
                      }
                    })
                  })
                }
              } catch {}
              const displayResult = result.split('\n')[0]
              const summaryResult = getToolSummary(name, result, args)
              setMessages((prev) => prev.map((m) =>
                m.id === toolMsgId ? { ...m, content: `🔧 调用工具: ${name}\n\n${displayResult}`, loading: false, toolTitle: summaryResult.title, toolSummary: summaryResult.summary, toolResult: result, toolCalls: toolCall ? [toolCall] : undefined } : m
              ))
              return result
            }
            if (name === 'write_character_card') {
              const existingCards = await window.electronAPI.character.list(pid)
              const charName = (args.name as string)?.trim()
              const cardsArr = args.cards ? (typeof args.cards === 'string' ? JSON.parse(args.cards) : args.cards) as Record<string, unknown>[] : null
              const batchNames = cardsArr ? cardsArr.map((c: any) => (c.name as string)?.trim()).filter(Boolean) : []
              const singleOverwrite = charName && existingCards.some((c: any) => c.name === charName)
              const batchOverwrites = batchNames.filter((n: string) => existingCards.some((c: any) => c.name === n))
              if (singleOverwrite || batchOverwrites.length > 0) {
                  const displayNames = singleOverwrite ? [charName!] : batchOverwrites
                  const label = displayNames.length === 1 ? `角色卡「${displayNames[0]}」` : `${displayNames.length} 个角色卡（${displayNames.slice(0, 3).join('、')}${displayNames.length > 3 ? '等' : ''}）`
                  const reason = (args.reason as string) || (cardsArr?.map((c: any) => c.reason as string).filter(Boolean)[0]) || ''
                  const newName = (args.new_name as string)?.trim()
                  const renameInfo = newName ? ` → 「${newName}」` : ''
                  setMessages((prev) => prev.map((m) =>
                    m.id === toolMsgId ? { ...m, content: `🔧 AI 请求更新${label}${renameInfo}${reason ? `\n修改原因：${reason}` : ''}`, loading: false, confirmUpdate: { type: 'character', label: `${label}${renameInfo}` }, toolName: name, toolSummary: reason ? `AI 请求更新${label}\n修改原因：${reason}` : `AI 请求更新${label}` } : m
                  ))
                  return new Promise<string>((resolve) => {
                    confirmResolveRef.current = async (action, rejectReason) => {
                      confirmResolveRef.current = null
                      if (action === 'reject') {
                        const rejectResult = formatEditRejectResult(rejectReason)
                        setMessages((prev) => prev.map((m) =>
                          m.id === toolMsgId ? { ...m, content: `🔧 ${rejectResult}`, loading: false, confirmUpdate: undefined, toolSummary: rejectResult } : m
                        ))
                        return resolve(rejectResult)
                      }
                      const result = await executeToolCall(name, args, pid)
                      const summaryResult = getToolSummary(name, result, args)
                      setMessages((prev) => prev.map((m) =>
                        m.id === toolMsgId ? { ...m, content: `🔧 调用工具: ${name}\n\n${result}`, loading: false, confirmUpdate: undefined, toolTitle: summaryResult.title, toolSummary: summaryResult.summary, toolResult: result } : m
                      ))
                      resolve(result)
                    }
                    })
                }
              }
              if (name === 'write_world_setting') {
              const existingCards = await window.electronAPI.world.list(pid)
              const worldName = (args.name as string)?.trim()
              const cardsArr = args.cards ? (typeof args.cards === 'string' ? JSON.parse(args.cards) : args.cards) as Record<string, unknown>[] : null
              const batchNames = cardsArr ? cardsArr.map((c: any) => (c.name as string)?.trim()).filter(Boolean) : []
              const singleOverwrite = worldName && existingCards.some((w: any) => w.name === worldName)
              const batchOverwrites = batchNames.filter((n: string) => existingCards.some((w: any) => w.name === n))
              if (singleOverwrite || batchOverwrites.length > 0) {
                  const displayNames = singleOverwrite ? [worldName!] : batchOverwrites
                  const label = displayNames.length === 1 ? `世界观设定「${displayNames[0]}」` : `${displayNames.length} 个世界观设定（${displayNames.slice(0, 3).join('、')}${displayNames.length > 3 ? '等' : ''}）`
                  const reason = (args.reason as string) || (cardsArr?.map((c: any) => c.reason as string).filter(Boolean)[0]) || ''
                  const newName = (args.new_name as string)?.trim()
                  const renameInfo = newName ? ` → 「${newName}」` : ''
                  setMessages((prev) => prev.map((m) =>
                    m.id === toolMsgId ? { ...m, content: `🔧 AI 请求更新${label}${renameInfo}${reason ? `\n修改原因：${reason}` : ''}`, loading: false, confirmUpdate: { type: 'world', label: `${label}${renameInfo}` }, toolName: name, toolSummary: reason ? `AI 请求更新${label}\n修改原因：${reason}` : `AI 请求更新${label}`, toolCalls: toolCall ? [toolCall] : undefined } : m
                  ))
                  return new Promise<string>((resolve) => {
                    confirmResolveRef.current = async (action, rejectReason) => {
                      confirmResolveRef.current = null
                      if (action === 'reject') {
                        const rejectResult = formatEditRejectResult(rejectReason)
                        setMessages((prev) => prev.map((m) =>
                          m.id === toolMsgId ? { ...m, content: `🔧 ${rejectResult}`, loading: false, confirmUpdate: undefined, toolSummary: rejectResult } : m
                        ))
                        return resolve(rejectResult)
                      }
                      const result = await executeToolCall(name, args, pid)
                      const summaryResult = getToolSummary(name, result, args)
                      setMessages((prev) => prev.map((m) =>
                        m.id === toolMsgId ? { ...m, content: `🔧 调用工具: ${name}\n\n${result}`, loading: false, confirmUpdate: undefined, toolTitle: summaryResult.title, toolSummary: summaryResult.summary, toolResult: result } : m
                      ))
                      resolve(result)
                    }
                    })
                }
              }
              if (name === 'write_chapter_content') {
              const result = await executeToolCall(name, args, pid)
              try {
                const parsed = JSON.parse(result)
                if (parsed._edit_chapter) {
                   useEditorStore.getState().setPendingChapterEdit({ chapterId: parsed.chapter_id, original: parsed.original, modified: parsed.modified, summary: parsed.summary })
                  setMessages((prev) => prev.map((m) =>
                    m.id === toolMsgId ? { ...m, content: `🔧 修改待审阅：${parsed.summary}`, loading: false, editChapterButtons: true, toolSummary: `修改待审阅：${parsed.summary}`, toolCalls: toolCall ? [toolCall] : undefined } : m
                  ))
                  return new Promise<string>((resolve) => {
                    setPendingDiffResolve(async (action, message) => {
                      const s = useEditorStore.getState()
                      if (action === 'accept') {
                        const cid = parsed.chapter_id || s.activeChapterId
                        const chapter = s.chapters.find((c) => c.id === cid)
                        if (chapter && parsed.modified) {
                          s.setActiveChapter(chapter.id)
                          s.updateChapterContent(chapter.id, parsed.modified)
                          await window.electronAPI.chapter.save({ ...chapter, content: parsed.modified, word_count: countChars(parsed.modified) })
                          s.setDirty(false)
                          const ed = getEditor()
                          if (ed) {
                            ed.commands.setContent(parsed.modified, false, { preserveWhitespace: 'full' })
                          }
                          s.setPendingChapterEdit(null)
                          setMessages((prev) => prev.map((m) =>
                            m.id === toolMsgId ? { ...m, content: `🔧 已完成修改\n\n${parsed.summary}`, loading: false, editChapterButtons: false, toolSummary: `修改已完成：${parsed.summary}` } : m
                          ))
                          resolve('用户已确认修改')
                        } else {
                          s.setPendingChapterEdit(null)
                          setMessages((prev) => prev.map((m) =>
                            m.id === toolMsgId ? { ...m, content: '🔧 章节已被删除，修改未应用', loading: false, editChapterButtons: false, toolSummary: '章节已被删除，修改未应用' } : m
                          ))
                          resolve('章节已被删除，修改未应用')
                        }
                      } else {
                        s.setPendingChapterEdit(null)
                        const rejectResult = formatEditRejectResult(message)
                        setMessages((prev) => prev.map((m) =>
                          m.id === toolMsgId ? { ...m, content: `🔧 ${rejectResult}`, loading: false, editChapterButtons: false, toolSummary: rejectResult } : m
                        ))
                        resolve(rejectResult)
                      }
                    })
                  })
                }
              } catch {}
              const displayResult = result.split('\n')[0]
              const summaryResult = getToolSummary(name, result, args)
              setMessages((prev) => prev.map((m) =>
                m.id === toolMsgId ? { ...m, content: `🔧 调用工具: ${name}\n\n${displayResult}`, loading: false, toolTitle: summaryResult.title, toolSummary: summaryResult.summary, toolResult: result, toolCalls: toolCall ? [toolCall] : undefined } : m
              ))
              return result
            }
            if (name === 'delete') {
              const preview = await describeDeleteAction(args, pid)
              if (preview.error) {
                setMessages((prev) => prev.map((m) =>
                  m.id === toolMsgId ? { ...m, content: `🔧 ${preview.error}`, loading: false, toolSummary: preview.error, toolCalls: toolCall ? [toolCall] : undefined } : m
                ))
                return preview.error
              }
              const reason = (args.reason as string) || ''
              setMessages((prev) => prev.map((m) =>
                m.id === toolMsgId ? {
                  ...m,
                  content: `🔧 AI 请求删除${preview.label}${reason ? `\n删除原因：${reason}` : ''}`,
                  loading: false,
                  confirmUpdate: { type: 'delete', label: preview.label },
                  toolName: name,
                  toolSummary: reason ? `AI 请求删除${preview.label}\n删除原因：${reason}` : `AI 请求删除${preview.label}`,
                  toolCalls: toolCall ? [toolCall] : undefined,
                } : m
              ))
              return new Promise<string>((resolve) => {
                confirmResolveRef.current = async (action, rejectReason) => {
                  confirmResolveRef.current = null
                  if (action === 'reject') {
                    const rejectResult = formatDeleteRejectResult(rejectReason)
                    setMessages((prev) => prev.map((m) =>
                      m.id === toolMsgId ? { ...m, content: `🔧 ${rejectResult}`, loading: false, confirmUpdate: undefined, toolSummary: rejectResult } : m
                    ))
                    return resolve(rejectResult)
                  }
                  const result = await executeToolCall(name, args, pid)
                  const summaryResult = getToolSummary(name, result, args)
                  setMessages((prev) => prev.map((m) =>
                    m.id === toolMsgId ? { ...m, content: `🔧 调用工具: ${name}\n\n${result}`, loading: false, confirmUpdate: undefined, toolTitle: summaryResult.title, toolSummary: summaryResult.summary, toolResult: result } : m
                  ))
                  resolve(result)
                }
              })
            }
            if (name === 'propose_action') {
              const { type, chapter_index, options, params } = args as any
              const proposal: ProposalData = { type, chapter_index, options, params }
              pendingProposalRef.current = proposal
              setMessages((prev) => prev.map((m) =>
                m.id === toolMsgId ? { ...m, content: '🔧 请选择:', loading: false, proposal, toolSummary: '请选择操作方案', toolCalls: toolCall ? [toolCall] : undefined } : m
              ))
              return new Promise<string>((resolve) => {
                pendingResolveRef.current = async (choice: string) => {
                  pendingProposalRef.current = null
                  pendingResolveRef.current = null
                  const isCustom = !options?.includes(choice)
                  const result = `用户${isCustom ? '自定义' : '选择'}: ${choice}`
                  setMessages((prev) => prev.map((m) =>
                    m.id === toolMsgId ? { ...m, proposal: undefined, content: `🔧 已完成\n\n${result}`, loading: false, toolSummary: result, toolResult: result } : m
                  ))
                  resolve(result)
                }
              })
            }
            const result = await executeToolCall(name, args, pid)
            let displayResult: string
            if (name === 'list') {
              displayResult = ''
            } else if (name === 'read') {
              const type = args?.type as string
              if (type === 'chapter_content' || type === 'character' || type === 'world' || type === 'knowledge') {
                displayResult = result.split('\n')[0]
              } else {
                displayResult = ''
              }
            } else {
              displayResult = result
            }
            const summaryResult = getToolSummary(name, result, args)
            setMessages((prev) => prev.map((m) =>
              m.id === toolMsgId ? { ...m, content: `🔧 调用工具: ${name}${displayResult ? '\n\n' + displayResult : ''}`, loading: false, toolTitle: summaryResult.title, toolSummary: summaryResult.summary, toolResult: result, toolCalls: toolCall ? [toolCall] : undefined } : m
            ))
            return result
          },
        )
        if (!isCurrent()) return
        apiConversationRef.current.push(...newApiMessages)
        conversationLenBeforeRef.current = apiConversationRef.current.length
        const contextWindow = getContextWindow(cfg?.context_length)
        const reservedOutput = activePreset?.max_tokens ?? 2048
        // 动态计算 system prompt + tool definitions 占用
        // 加 20% 安全垫（tokenx 估算精度约 96%）
        const sysTokens = estimateMessageTokens({ role: 'system', content: toolSystemPrompt })
        const toolsTokens = countText(JSON.stringify(toolDefinitions))
        const reservedSystemAndTools = Math.ceil((sysTokens + toolsTokens) * 1.2)
        const tokenBudget = Math.max(1000, contextWindow - reservedOutput - reservedSystemAndTools)
        trimConversation(apiConversationRef, tokenBudget)
        // 算"完整请求 token 数" = system + tools + 累积对话历史（含 contextPrefix）
        // 用真实的 toolSystemPrompt 算（最准），更新圆环显示
        setActualContextTokens(computeActualContextTokens(toolSystemPrompt))
        // 消息变化了 → 更新"最后活跃时间"
        setLastActiveTime(new Date().toLocaleString('zh-CN'))
        clearChanges(pid)
        finalReasoningWriter.flush()
        finalTokenWriter.flush()
        setMessages((prev) => {
          const fid = finalMsgRef.current
          const result = prev.map((m) => {
            if (m.id === msgId) return { ...m, loading: false, reasoningDone: true, ...(!fid ? { status: 'completed' as const } : {}) }
            if (fid && m.id === fid) return { ...m, loading: false, status: 'completed' as const }
            const tid = pendingReasoningIdRef.current
            if (tid && m.id === tid) return { ...m, loading: false, reasoningDone: true }
            return m
          })
          return result
        })
        return

    } catch (err) {
      logger.errorObj('ai.runStream', 'top-level error', err, {
        projectId: activeProjectIdRef.current,
      })
      // Rollback apiConversationRef to the state before this turn
      apiConversationRef.current = apiConversationRef.current.slice(0, conversationLenBeforeRef.current)
      // 重新算 token 数（apiConversationRef 已回滚到本轮之前）
      setActualContextTokens(computeActualContextTokens())
      const fid = finalMsgRef.current
      setMessages((prev) => {
        // 找到最后一个非思考、非工具调用的助手消息
        const lastAssistantMsg = findLastAssistant(prev, { excludeThinking: true, excludeInlineText: true, extra: m => !!m.loading })
        return prev.map((m) => {
          if (!m.loading) return m
          // 优先设置 finalMsg，否则设置最后一个助手消息
          if (fid && m.id === fid) return { ...m, loading: false, status: 'error' as const }
          if (!fid && lastAssistantMsg && m.id === lastAssistantMsg.id) return { ...m, loading: false, content: m.content || `发送失败: ${err}`, reasoningDone: true, status: 'error' as const }
          return { ...m, loading: false }
        })
      })
    }
  }

  const handleResend = async (msg: ChatMsg) => {
    if (!apiConfig || !activeProjectId) return

    // Abort any in-progress stream first
    abortAndCleanup()

    // Find the index of this user message in the messages array
    const msgIndex = messagesRef.current.findIndex(m => m.id === msg.id)
    if (msgIndex === -1) return

    // Count how many user messages come before this one (excluding tool calls)
    const userMsgIndex = messagesRef.current.slice(0, msgIndex).filter(m => m.role === 'user' && !m.isToolCall).length

    // Find the corresponding user message in apiConversationRef
    let apiUserCount = 0
    let apiCutIndex = -1
    for (let i = 0; i < apiConversationRef.current.length; i++) {
      if (apiConversationRef.current[i].role === 'user') {
        if (apiUserCount === userMsgIndex) {
          apiCutIndex = i
          break
        }
        apiUserCount++
      }
    }

    // Remove this user message and everything after it from apiConversationRef
    if (apiCutIndex >= 0) {
      apiConversationRef.current = apiConversationRef.current.slice(0, apiCutIndex)
    } else {
      // apiConversationRef was trimmed and doesn't contain this message's turn
      // 保留当前剩余上下文（不要清空，否则模型会完全失忆）
      // 用户会看到一个 console 提示，知道原始上下文已被裁剪
      console.warn(
        '[handleResend] Target turn was already trimmed from apiConversationRef. ' +
        'Sending new message with whatever context remains.'
      )
    }

    // Remove this message and everything after it from UI state
    const sliced = messagesRef.current.slice(0, msgIndex)
    messagesRef.current = sliced
    setMessages(sliced)

    // Now run the stream with the new prompt
    const userPrompt = buildUserPrompt(msg.rawContent || msg.content)
    runStream(userPrompt, 'free')
  }

  const handleCommand = async (command: QuickCommand) => {
    if (!apiConfig) { setMessages((prev) => [...prev, { id: generateId(), role: 'assistant', content: '请先在设置中配置 API', loading: false }]); return }
    if (isContextAtLimit) {
      setMessages((prev) => [...prev, { id: generateId(), role: 'assistant', content: '⚠️ 上下文已满，请点击「＋ 新对话」开始新对话后再继续。', loading: false }])
      return
    }
    if (command.autoSend) {
      if (messages.some(m => m.loading)) {
        setFreeInput(command.prompt)
        inputRef.current?.focus()
        return
      }
      const userPrompt = buildUserPrompt(command.prompt)
      runStream(userPrompt, command.id)
    } else {
      setFreeInput(command.prompt)
      inputRef.current?.focus()
    }
  }

  const openCmdDialog = (cmd?: QuickCommand) => {
    setEditingCmd(cmd || null)
    setCmdName(cmd?.name || '')
    setCmdPrompt(cmd?.prompt || '')
    setCmdAutoSend(cmd?.autoSend ?? true)
    setCmdMultiCandidate(cmd?.multiCandidate ?? true)
    setCmdDialogOpen(true)
  }

  const saveCmd = () => {
    if (!cmdName.trim()) return
    const updated = [...commands]
    if (editingCmd) {
      const idx = updated.findIndex((c) => c.id === editingCmd.id)
      if (idx >= 0) updated[idx] = { ...editingCmd, name: cmdName.trim(), prompt: cmdPrompt, autoSend: cmdAutoSend, multiCandidate: cmdMultiCandidate }
    } else {
      updated.push({ id: Date.now().toString(36), name: cmdName.trim(), prompt: cmdPrompt, autoSend: cmdAutoSend, multiCandidate: cmdMultiCandidate })
    }
    setCommands(updated)
    localStorage.setItem('quick-commands', JSON.stringify(updated))
    setCmdDialogOpen(false)
  }

  const deleteCmd = (id: string) => {
    const updated = commands.filter((c) => c.id !== id)
    setCommands(updated)
    localStorage.setItem('quick-commands', JSON.stringify(updated))
    setCmdCtxMenu(null)
  }

  const handleFreeSubmit = async () => {
    if (!freeInput.trim()) return
    if (messages.some(m => m.loading)) {
      abortRef.current?.abort()
      setMessages((prev) => prev.map((m) => m.loading ? { ...m, loading: false } : m))
      return
    }
    if (!apiConfig) { setMessages((prev) => [...prev, { id: generateId(), role: 'assistant', content: '请先在设置中配置 API', loading: false }]); return }
    if (isContextAtLimit) {
      setMessages((prev) => [...prev, { id: generateId(), role: 'assistant', content: '⚠️ 上下文已满，请点击「＋ 新对话」开始新对话后再继续。', loading: false }])
      return
    }
    const userPrompt = buildUserPrompt(freeInput)
    setFreeInput('')
    if (inputRef.current) { inputRef.current.style.height = 'auto' }
    runStream(userPrompt, 'free')
  }

  const handleAdoptOutline = async (msgId: string) => {
    if (!activeProjectId) return

    setWriteMode(true)
    const userPrompt = `看起来不错，根据以上内容，帮我完成新书设定。

按顺序执行，上一步完成并经用户确认前不要开始下一步：
1. 用 create_volume 创建各卷，再用 write_volume 逐卷填写分卷剧情
2. 创建所有角色卡
3. 创建所有世界观设定
4. 各卷分卷剧情全部确认后，再 create_chapter 创建空白章节，并用 write_chapter_title / write_chapter_outline 写标题与章节大纲`
    runStream(buildUserPrompt(userPrompt), 'free')
  }

  const handleSwitchCandidate = (msgId: string, idx: number) => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msgId) return m
      return { ...m, activeCandidate: idx, content: m.candidates?.[idx] || '' }
    }))
  }

  const abortAndCleanup = useCallback(() => {
    abortRef.current?.abort()
    genIdRef.current++
    confirmResolveRef.current?.('reject', '用户已取消')
    resolvePendingDiff('revert', '用户已取消')
    pendingResolveRef.current?.('用户已取消')
    pendingProposalRef.current = null
    useEditorStore.getState().setPendingChapterEdit(null)
    resolvePendingOutline('revert', '用户已取消')
    useEditorStore.getState().setPendingVolumeEdit(null)
    apiConversationRef.current = apiConversationRef.current.slice(0, conversationLenBeforeRef.current)
    // abort 后 apiConversationRef 已回滚，圆环要同步（用静态估算）
    setActualContextTokens(computeActualContextTokens())
    setMessages((prev) => {
      // 找到最后一个非思考、非工具调用的助手消息
      const lastAssistantMsg = findLastAssistant(prev, { excludeThinking: true, excludeInlineText: true })
      return prev.map((m) => {
        if (!m.loading) return m
        // 只在最终的助手消息上设置 aborted 状态
        if (lastAssistantMsg && m.id === lastAssistantMsg.id) {
          return { ...m, loading: false, status: 'aborted' as const }
        }
        return { ...m, loading: false }
      })
    })
  }, [])

  const handleNewChat = async () => {
    abortAndCleanup()
    if (messages.length === 0) return
    if (!activeProjectId) return
    clearChanges(activeProjectId)
    saveToHistory(activeProjectId, messagesRef.current)
    setMessages([])
    messagesRef.current = []
    apiConversationRef.current = []
    sessionIdRef.current = generateId()
    setTokenWarningVisible(false)
    setActualContextTokens(0)
    // 新 session 重新计时
    setLastActiveTime(new Date().toLocaleString('zh-CN'))
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const openHistory = () => {
    if (!activeProjectId) return
    setHistoryList(readHistoryFromStorage(activeProjectId) ?? [])
    setHistoryOpen(true)
  }

  const loadHistory = (session: any) => {
    if (!activeProjectId) return
    // 无论加载成功/失败,先把当前 session 存盘——用户在历史面板里挑来挑去
    // 时,不能让当前对话被吞掉
    saveToHistory(activeProjectId, messagesRef.current)
    const history = readHistoryFromStorage(activeProjectId) ?? []
    const fresh = history.find((h: any) => h.id === session.id) || session
    if (!isValidSession(fresh) || fresh.apiConversation.length === 0) {
      // 目标 session 损坏或 apiConversation 为空 —— 留在当前 session 不切换,
      // 关闭历史面板,弹一个明确提示,避免用户的对话被无声清空。
      // 原因:loadLatest 同类路径(649-660)已经改成"保留内存 messages",
      // loadHistory 之前还是老逻辑"setMessages([]) + apiConversationRef = []",
      // 两个函数降级策略不一致,会导致"点了历史里的某条 → 对话面板整个清空"的
      // 体感事故(用户会以为 app 把他的对话删了)。
      if (!isValidSession(fresh)) {
        console.warn('[AIPanel] loadHistory: 目标 session 损坏,保留当前 session', fresh)
      } else {
        console.warn('[AIPanel] loadHistory: 目标 session.apiConversation 为空,保留当前 session')
      }
      setHistoryOpen(false)
      setTokenWarningVisible(false)
      // TODO: 后续统一 toast 系统后,这里改用 toast.error() 替代 alert。
      // 现在用 alert 是因为项目里还没有 toast 系统,阻塞式弹窗虽然丑但
      // 能保证用户一定看到"加载失败"的反馈,不会以为 app 静默丢数据。
      alert('该对话已损坏或为空,无法加载。已保留当前对话。')
      return
    }
    // 正常路径:切换到目标 session
    abortAndCleanup()
    setMessages(deserializeMessages(fresh.messages))
    apiConversationRef.current = JSON.parse(JSON.stringify(fresh.apiConversation))
    sessionIdRef.current = fresh.id
    // 重新算 token 数(用静态估算 system+tools;下次发 API 时会被真实值覆盖)
    setActualContextTokens(computeActualContextTokens())
    // 同步 lastActiveTime 为加载 session 的原始时间(不刷新为"现在")
    if (fresh.time) setLastActiveTime(fresh.time)
    setHistoryOpen(false)
    setTokenWarningVisible(false)
  }

  const deleteHistory = (id: string) => {
    if (!activeProjectId) return
    const updated = historyList.filter((h: any) => h.id !== id)
    setHistoryList(updated)
    try {
      localStorage.setItem(getHistoryKey(activeProjectId), JSON.stringify(updated))
    } catch (e) {
      console.error('[AIPanel] deleteHistory: 写入 localStorage 失败,已回滚', e)
      // 写盘失败时回滚 UI,避免内存和磁盘不一致
      setHistoryList(historyList)
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
    <div ref={panelRef} className="floating-glass flex h-full flex-col relative overflow-hidden" style={{ width }}>
      <div className="flex h-12 items-center justify-between px-4 border-b border-white/30">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <div className="text-xs font-medium tracking-wide">InkArk</div>
          </div>
          <ContextUsageRing used={usedContextTokens} total={totalContextTokens} />
        </div>
        <div className="flex gap-1 items-center">
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2.5 rounded-md hover:bg-accent/60" onClick={handleNewChat} disabled={messages.length === 0}>
            ＋ 新对话
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2.5 rounded-md hover:bg-accent/60" onClick={openHistory}>
            📋 历史
          </Button>
          {onClose && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onClose}
                  className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  <PanelRightClose className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">收起面板</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 py-3 ai-panel-scroll" viewportRef={viewportRef}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-xs text-muted-foreground py-10 text-center px-4">
            <div className="mb-2 text-2xl opacity-40">💬</div>
            <div>聊聊你想要什么样的作品吧</div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`mb-3 ${msg.role === 'user' ? 'flex justify-end items-end gap-1' : ''}`}>
            {msg.role === 'user' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => handleResend(msg)} className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground shrink-0 mb-0.5">
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">重新发送</TooltipContent>
              </Tooltip>
            )}
            {msg.role === 'user' ? (
              <div className="max-w-[90%] flex">
                <div className="w-[3px] rounded-full bg-primary/70 mr-2 shrink-0" aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:my-0.5 prose-ul:my-0.5 prose-li:my-0 prose-code:text-foreground prose-code:bg-white/60 prose-code:px-1 prose-code:rounded prose-pre:bg-white/40 prose-pre:border prose-pre:border-white/60 prose-pre:text-foreground prose-table:text-xs prose-th:border prose-th:border-white/60 prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-white/60 prose-td:px-2 prose-td:py-1 prose-th:bg-white/30 prose-td:break-all [&_table]:w-full [&_table]:table-fixed [&_table]:overflow-hidden [&_pre_code]:bg-transparent [&_pre_code]:p-0" style={bodyFontStyle}><ReactMarkdown remarkPlugins={[remarkGfm]}>{debugMode ? msg.content : (msg.rawContent || msg.content)}</ReactMarkdown></div>
                  {debugMode && msg.systemPrompt && (
                    <details className="mt-2 pt-2 border-t border-white/40">
                      <summary className="text-[10px] cursor-pointer text-muted-foreground hover:text-foreground select-none">debug: 上下文</summary>
                      <pre className="text-[9px] mt-1 whitespace-pre-wrap text-muted-foreground/80 max-h-40 overflow-y-auto">{msg.systemPrompt}</pre>
                    </details>
                  )}
                </div>
              </div>
            ) : msg.isThinking ? (
              <div className="w-full">
                {msg.reasoning && msg.reasoning.length > 0 && (
                  (() => {
                    const round = msg.reasoning[0]
                    const reasonKey = msg.id
                    const thinkingActive = msg.loading && !msg.reasoningDone
                    const isExpanded = thinkingActive ? true : expandedReasoning.has(reasonKey)
                    const toggleExpanded = () => {
                      setExpandedReasoning((prev) => {
                        const next = new Set(prev)
                        if (next.has(reasonKey)) next.delete(reasonKey)
                        else next.add(reasonKey)
                        return next
                      })
                    }
                    return (
                      <div>
                        <button
                          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors w-full text-left" style={smallFontStyle}
                          onClick={toggleExpanded}
                        >
                          <span className="text-[#4d6bfe]"><ThinkingIcon /></span>
                          <span>{thinkingActive ? '思考中...' : '已思考'}</span>
                          <ChevronDown className={`h-3 w-3 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                        {isExpanded && (
                          <div className="mt-1.5 pl-5 rounded border border-muted bg-muted/30 p-2 max-h-[120px] overflow-y-auto text-muted-foreground leading-tight [&::-webkit-scrollbar]:hidden" id={`reasoning-${reasonKey}`} style={smallFontStyle}>
                            {round}
                          </div>
                        )}
                      </div>
                    )
                  })()
                )}
              </div>
            ) : msg.isInlineText ? (
              <div className="w-full">
                <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:my-0.5 prose-ul:my-0.5 prose-li:my-0 prose-code:text-foreground prose-code:bg-muted/70 prose-code:px-1 prose-code:rounded prose-pre:bg-muted/30 prose-pre:text-foreground prose-pre:border prose-pre:shadow-none prose-table:text-xs prose-th:border prose-th:border-border prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1 prose-th:bg-muted/50 prose-td:break-all [&_table]:w-full [&_table]:table-fixed [&_table]:overflow-hidden [&_pre_code]:bg-transparent [&_pre_code]:p-0" style={bodyFontStyle}>
                  {msg.content ? <div><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown></div> : null}
                </div>
              </div>
            ) : msg.isToolCall ? (
              <div className="w-full">
                {(() => {
                  const isExpanded = expandedToolCalls.has(msg.id)
                  const toggleExpanded = () => {
                    setExpandedToolCalls((prev) => {
                      const next = new Set(prev)
                      if (next.has(msg.id)) next.delete(msg.id)
                      else next.add(msg.id)
                      return next
                    })
                  }
                  const isInteractive = !!(msg.confirmUpdate || msg.editChapterButtons || msg.editVolumeButtons || msg.proposal)
                  const isBatch = ((msg.toolName === 'write_character_card' || msg.toolName === 'write_world_setting') && Array.isArray(msg.toolArgs?.cards) && msg.toolArgs.cards.length > 1)
                    || (msg.toolName === 'write_chapter_title' && Array.isArray(msg.toolArgs?.chapters) && msg.toolArgs.chapters.length > 1)
                  const showSummary = msg.toolName === 'search' || msg.toolName === 'propose_action' || isInteractive || isBatch
                  const summary = msg.content.split('\n')[0].replace(/^🔧\s*/, '')
                  const getToolDisplayName = (name?: string, args?: Record<string, unknown>) => {
                     if (name === 'search') {
                       const scope = args?.scope as string[] | undefined
                       const keyword = args?.keyword as string
                       const semantic = args?.semantic as string
                       const scopeLabels: Record<string, string> = { settings: '设定', outlines: '大纲', knowledge: '知识库', content: '正文' }
                       const scopeText = scope?.map(s => scopeLabels[s] || s).join('+') || '工作区'
                       const parts: string[] = []
                       if (keyword) parts.push(`在${scopeText}中检索「${keyword}」`)
                       if (semantic) parts.push(`语义检索「${semantic}」`)
                       return parts.join('，')
                     }
                     if (name === 'list') {
                       const listType = args?.type as string | undefined
                       const labels: Record<string, string> = { chapter: '章节列表', character: '角色卡列表', world: '世界观设定列表' }
                       return `查看了${labels[listType || ''] || '列表'}`
                     }
                     const map: Record<string, string> = {
                       list: '查看列表', read: '读取内容',
                       write_volume: '修改卷级大纲', create_volume: '创建卷', write_character_card: '操作角色卡', write_world_setting: '操作世界观',
                       write_chapter_content: '修改章节', write_chapter_outline: '更新章节大纲', write_chapter_title: '更新章节标题',
                       create_chapter: '创建章节', propose_action: '请选择'
                     }
                     return map[name || ''] || name || '调用工具'
                   }
                  return (
                    <>
                      <button
                        className={`flex items-center gap-1.5 transition-colors w-full text-left group ${isInteractive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`} style={smallFontStyle}
                        onClick={showSummary ? toggleExpanded : undefined}
                      >
                        <Settings className="h-3 w-3 shrink-0" />
                        <span>{msg.toolTitle || getToolDisplayName(msg.toolName, msg.toolArgs)}</span>
                        {msg.loading ? (
                          <span className="animate-pulse ml-1" style={smallFontStyle}>执行中...</span>
                        ) : showSummary ? (
                          <ChevronDown className={`h-3 w-3 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                        ) : null}
                      </button>
                      {isExpanded && !msg.loading && (
                        <div className="mt-1.5 pl-5">
                          {msg.toolSummary && (
                            <p className="text-muted-foreground" style={smallFontStyle}>{msg.toolSummary}</p>
                          )}
                          {(!msg.toolSummary && msg.content) && (
                              <div className="text-muted-foreground prose prose-sm max-w-none prose-headings:text-foreground prose-p:my-0.5 prose-ul:my-0.5 prose-li:my-0 prose-code:text-foreground prose-code:bg-muted/70 prose-code:px-1 prose-code:rounded prose-pre:bg-muted/30 prose-pre:text-foreground prose-pre:border prose-pre:shadow-none prose-table:text-xs prose-th:border prose-th:border-border prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1 prose-th:bg-muted/50 prose-td:break-all [&_table]:w-full [&_table]:table-fixed [&_table]:overflow-hidden [&_pre_code]:bg-transparent [&_pre_code]:p-0" style={smallFontStyle}>
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                            </div>
                          )}
                          {msg.confirmUpdate && !msg.loading && (
                            <div className="mt-3 flex items-center gap-2 border-t border-border/50 pt-3">
                              <Button variant={msg.confirmUpdate.type === 'delete' ? 'destructive' : 'default'} size="sm" className="h-7 text-xs px-3"
                                onClick={() => confirmResolveRef.current?.('accept')}>
                                {msg.confirmUpdate.type === 'delete' ? '确认删除' : '接受'}
                              </Button>
                              <Button variant="outline" size="sm" className="h-7 text-xs px-3"
                                onClick={() => { confirmResolveRef.current?.('reject', confirmRejectText); setConfirmRejectText('') }}>
                                {msg.confirmUpdate.type === 'delete' ? '取消' : '拒绝'}
                              </Button>
                              <Input value={confirmRejectText} onChange={(e) => setConfirmRejectText(e.target.value)}
                                placeholder={msg.confirmUpdate.type === 'delete' ? '取消原因（可选）...' : '拒绝原因（可选）...'}
                                className="flex-1 h-7 text-xs"
                                onKeyDown={(e) => { if (e.key === 'Enter') { confirmResolveRef.current?.('reject', confirmRejectText); setConfirmRejectText('') } }} />
                            </div>
                          )}
                          {msg.editChapterButtons && !msg.loading && (
                            <div className="mt-3 flex items-center gap-2 border-t border-border/50 pt-3">
                              <Button variant="default" size="sm" className="h-7 text-xs px-3"
                                onClick={() => resolvePendingDiff('accept')}>
                                接受
                              </Button>
                              <Button variant="outline" size="sm" className="h-7 text-xs px-3"
                                onClick={() => { resolvePendingDiff('revert', revertText); setRevertText('') }}>
                                拒绝
                              </Button>
                              <Input value={revertText} onChange={(e) => setRevertText(e.target.value)}
                                placeholder="拒绝原因（可选）..."
                                className="flex-1 h-7 text-xs"
                                onKeyDown={(e) => { if (e.key === 'Enter') { resolvePendingDiff('revert', revertText); setRevertText('') } }} />
                            </div>
                          )}
                          {msg.editVolumeButtons && !msg.loading && (
                            <div className="mt-3 flex items-center gap-2 border-t border-border/50 pt-3">
                              <Button variant="default" size="sm" className="h-7 text-xs px-3"
                                onClick={() => resolvePendingOutline('accept')}>
                                接受
                              </Button>
                              <Button variant="outline" size="sm" className="h-7 text-xs px-3"
                                onClick={() => { resolvePendingOutline('revert', volumeRejectText); setVolumeRejectText('') }}>
                                拒绝
                              </Button>
                              <Input value={volumeRejectText} onChange={(e) => setVolumeRejectText(e.target.value)}
                                placeholder="拒绝原因（可选）..."
                                className="flex-1 h-7 text-xs"
                                onKeyDown={(e) => { if (e.key === 'Enter') { resolvePendingOutline('revert', volumeRejectText); setVolumeRejectText('') } }} />
                            </div>
                          )}
                          {msg.proposal && !msg.loading && <ProposalView proposal={msg.proposal} onSelect={(choice) => pendingResolveRef.current?.(choice)} />}
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            ) : (
              <div className="w-full">
                {msg.candidates && msg.candidates.filter((c) => c).length > 1 && (
                  <div className="mb-2">
                    <Tabs value={String(msg.activeCandidate || 0)} onValueChange={(v) => handleSwitchCandidate(msg.id, Number(v))}>
                      <TabsList className="h-6">
                        {msg.candidates.map((_, i) => (
                          msg.candidates![i] ? (
                            <TabsTrigger key={i} value={String(i)} className="text-[10px] px-2 h-5">v{i + 1}</TabsTrigger>
                          ) : null
                        ))}
                      </TabsList>
                    </Tabs>
                  </div>
                )}
                {msg.reasoning && msg.reasoning.length > 0 && (
                  (() => {
                    const round = msg.reasoning[0]
                    const reasonKey = `${msg.id}-0`
                    const thinkingActive = msg.loading && !msg.reasoningDone
                    const isExpanded = thinkingActive ? true : expandedReasoning.has(reasonKey)
                    const toggleExpanded = () => {
                      setExpandedReasoning((prev) => {
                        const next = new Set(prev)
                        if (next.has(reasonKey)) next.delete(reasonKey)
                        else next.add(reasonKey)
                        return next
                      })
                    }
                    return (
                      <div className="mb-2">
                        <button
                          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors w-full text-left" style={smallFontStyle}
                          onClick={toggleExpanded}
                        >
                          <span className="text-[#4d6bfe]"><ThinkingIcon /></span>
                          <span>{thinkingActive ? '思考中...' : '已思考'}</span>
                          <ChevronDown className={`h-3 w-3 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                        {isExpanded && (
                          <div className="mt-1.5 pl-5 rounded border border-muted bg-muted/30 p-2 max-h-[120px] overflow-y-auto text-muted-foreground leading-tight [&::-webkit-scrollbar]:hidden" id={`reasoning-${reasonKey}`} style={smallFontStyle}>
                            {round}
                          </div>
                        )}
                      </div>
                    )
                  })()
                )}
                <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:my-0.5 prose-ul:my-0.5 prose-li:my-0 prose-code:text-foreground prose-code:bg-muted/70 prose-code:px-1 prose-code:rounded prose-pre:bg-muted/30 prose-pre:text-foreground prose-pre:border prose-pre:shadow-none prose-table:text-xs prose-th:border prose-th:border-border prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1 prose-th:bg-muted/50 prose-td:break-all [&_table]:w-full [&_table]:table-fixed [&_table]:overflow-hidden [&_pre_code]:bg-transparent [&_pre_code]:p-0" style={bodyFontStyle}>
                  {msg.loading && !msg.content && (!msg.reasoning || msg.reasoning.length === 0) && <span className="animate-pulse text-muted-foreground">生成中...</span>}
                  {msg.content ? <div><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown></div> : null}
                  {!msg.loading && msg.status === 'completed' && !msg.content && (
                    <div className="text-xs text-muted-foreground italic mt-1" style={bodyFontStyle}>（AI 未返回正文 — 仅生成了思考）</div>
                  )}
                </div>
                {msg.role === 'assistant' && !msg.isThinking && lastAssistant?.id === msg.id && msg.status && (
                  <div className="mt-1.5 flex items-center gap-1.5" style={smallFontStyle}>
                    {msg.status === 'completed' && (
                      <span className="text-green-600">√ 任务完成</span>
                    )}
                    {msg.status === 'aborted' && (
                      <span className="text-yellow-600">■ 手动中止</span>
                    )}
                    {msg.status === 'error' && (
                      <span className="text-red-600">异常退出</span>
                    )}
                  </div>
                )}
                {!msg.loading && msg.content && (() => {
                  const isLatest = lastAdoptableAssistant?.id === msg.id
                  if (!isLatest) return null
                  if (!(msg.taskType === 'outlinePlan' && isOutlinePlanAdoptable(volumes))) return null
                  return (
                  <div className="flex gap-1 mt-2 pt-2 border-t border-border/50">
                    <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => handleAdoptOutline(msg.id)}>
                      <FileText className="h-3 w-3 mr-1" /> 采纳生成全书大纲
                    </Button>
                  </div>
                  )
                })()}
              </div>
            )}
          </div>
        ))}
      </ScrollArea>

      {(() => {
        if (!tokenWarningVisible || contextLevel === 'normal') return null
        const isDanger = contextLevel === 'danger' || contextLevel === 'limit'
        const tip = isDanger
          ? '⚠️ 上下文使用已达80%，建议让AI总结对话后复制到新对话继续。'
          : '上下文使用已达60%，开新对话有助于提升生成质量。'
        return (
          <div className={`mx-4 mb-1 px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between backdrop-blur ${isDanger ? 'bg-red-50/80 border border-red-200/60 text-red-700' : 'bg-amber-50/80 border border-amber-200/60 text-amber-700'}`}>
            <span>{tip}</span>
            <button onClick={() => setTokenWarningVisible(false)} className="ml-2 shrink-0 hover:opacity-70">✕</button>
          </div>
        )
      })()}

      {showScrollDown && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="absolute bottom-44 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/70 backdrop-blur border border-white/60 shadow-floating text-muted-foreground hover:text-foreground transition-all"
              onClick={() => {
                const el = scrollRef.current
                if (el) { el.scrollTop = el.scrollHeight; setShowScrollDown(false) }
              }}
            >
              ↓
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">回到底部</TooltipContent>
        </Tooltip>
      )}

      <div className="border-t border-white/30 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setWriteMode(!isWriteMode)}
            className="flex items-center rounded-full bg-white/40 border border-white/50 p-0.5 text-[11px] hover-lift"
          >
            <span className={`px-2.5 py-0.5 rounded-full transition-colors font-medium ${isWriteMode ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'}`}>
              {isWriteMode ? 'Write ✍' : '✍'}
            </span>
            <span className={`px-2.5 py-0.5 rounded-full transition-colors font-medium ${!isWriteMode ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'}`}>
              {!isWriteMode ? 'Chat 💬' : '💬'}
            </span>
          </button>
          {isGenerating && (
            <div className="flex items-center gap-1.5 text-muted-foreground" style={smallFontStyle} aria-label="正在生成">
              <span className="inline-grid grid-cols-2 gap-[1px]" aria-hidden="true">
                <span className="gen-block gen-block-1" />
                <span className="gen-block gen-block-2" />
                <span className="gen-block gen-block-4" />
                <span className="gen-block gen-block-3" />
              </span>
              <span>正在生成</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setLongInputMode(v => !v)}
                className={`h-6 w-6 flex items-center justify-center rounded-md transition-colors ${longInputMode ? 'bg-white/60 text-foreground' : 'text-muted-foreground hover:bg-white/40 hover:text-foreground'}`}
                aria-label={longInputMode ? '退出长文本模式' : '长文本输入模式'}
              >
                {longInputMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{longInputMode ? '退出长文本模式' : '长文本输入模式'}</TooltipContent>
          </Tooltip>
          {apiConfig ? (
            <div className="relative">
              <button
                onClick={() => setSwitchMenuOpen(!switchMenuOpen)}
                className="flex items-center gap-1 hover:text-foreground transition-colors rounded-md px-1.5 py-0.5 hover:bg-white/40"
              >
                API：{apiConfig.name}
                <ChevronDown className={`h-2.5 w-2.5 transition-transform ${switchMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {switchMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSwitchMenuOpen(false)} />
                  <div className="absolute top-full right-0 mt-1 w-44 rounded-md border bg-popover shadow-md z-50 py-1">
                    {allConfigs.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => switchApiConfig(c.id)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent ${c.id === apiConfig?.id ? 'bg-accent/50 font-medium' : ''}`}
                      >
                        <span className="truncate">{c.name}</span>
                        {c.id === apiConfig?.id && (
                          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <span className="text-amber-600 flex items-center gap-1"><Settings className="h-3 w-3" /> 未配置 API</span>
          )}
        </div>
      </div>

      <div className="px-4 pb-2">
        <div className="flex gap-2 items-end">
          <Textarea ref={inputRef} value={freeInput} onChange={(e) => setFreeInput(e.target.value)}
            disabled={isContextAtLimit}
            placeholder={isContextAtLimit ? '上下文已满，请点击「＋ 新对话」开始新对话' : messages.some(m => m.loading) ? `生成中${'.'.repeat(dotTick % 4)}` : '输入自由指令...'} className={`text-xs resize-none overflow-y-auto disabled:opacity-60 disabled:cursor-not-allowed bg-white/40 border-white/40 focus-visible:ring-1 rounded-xl transition-[max-height,min-height] duration-200 ${longInputMode && panelHeight > 0 ? '' : 'min-h-[4em] max-h-[30vh]'}`} rows={3}
            style={longInputMode && panelHeight > 0 ? {
              minHeight: Math.round(panelHeight * 2 / 3),
              maxHeight: Math.round(panelHeight * 2 / 3),
            } : undefined}
            onCompositionStart={() => { imeComposingRef.current = true }}
            onCompositionEnd={() => { imeComposingRef.current = false }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey) return
              if (imeComposingRef.current || e.nativeEvent.isComposing) return
              if (messages.some(m => m.loading) || isContextAtLimit) return
              e.preventDefault()
              handleFreeSubmit()
            }} />
           <Button size="sm" className="h-9 shrink-0 rounded-xl hover-lift" onClick={messages.some(m => m.loading) ? abortAndCleanup : handleFreeSubmit} disabled={isContextAtLimit && !messages.some(m => m.loading)}>
            {messages.some(m => m.loading) ? <Square className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className="px-4 pt-0.5 pb-3">
        <div className="flex gap-1 flex-wrap">
          {commands.map((cmd) => (
            <div
              key={cmd.id}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setCmdCtxMenu({ x: e.clientX, y: e.clientY, cmd })
              }}
            >
              <Button variant="outline" size="sm" className="h-6 text-[11px] px-2 disabled:opacity-50 rounded-md bg-white/30 border-white/40 hover:bg-white/60" onClick={() => handleCommand(cmd)} disabled={isContextAtLimit}>
                {cmd.name.slice(0, 5)}
              </Button>
            </div>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={() => openCmdDialog()} className="flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-white/50 text-muted-foreground hover:bg-white/40 hover:text-foreground">
                <Plus className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">添加快捷指令</TooltipContent>
          </Tooltip>
        </div>
        {cmdCtxMenu && createPortal(
          <div
            ref={cmdCtxMenuRef}
            className="fixed z-[100] w-28 rounded-md border bg-popover p-1 shadow-md"
            style={{
              left: Math.min(cmdCtxMenu.x, window.innerWidth - 112 - 8),
              top: Math.min(cmdCtxMenu.y, window.innerHeight - 64 - 8),
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent" onClick={() => { setCmdCtxMenu(null); openCmdDialog(cmdCtxMenu.cmd) }}>编辑</button>
            {commands.length > 1 && (
              <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent text-destructive" onClick={() => deleteCmd(cmdCtxMenu.cmd.id)}>删除</button>
            )}
          </div>,
          document.body,
        )}
      </div>

      {historyOpen && (
        <div className="absolute inset-0 z-50 bg-white/85 backdrop-blur-xl flex flex-col">
          <div className="flex items-center justify-between border-b border-white/50 px-4 py-3">
            <span className="text-sm font-medium">历史对话</span>
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2.5 rounded-md hover:bg-white/60" onClick={() => setHistoryOpen(false)}>关闭</Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {historyList.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">暂无历史对话</p>
            )}
            {(() => {
              const now = new Date()
              const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
              const yesterday = new Date(today)
              yesterday.setDate(today.getDate() - 1)
              const isSameDay = (a: Date, b: Date) =>
                a.getFullYear() === b.getFullYear() &&
                a.getMonth() === b.getMonth() &&
                a.getDate() === b.getDate()
              const groups: { today: any[]; yesterday: any[]; earlier: any[] } = { today: [], yesterday: [], earlier: [] }
              for (const session of historyList) {
                const d = new Date(session.time)
                // 兜底:如果 time 解析失败,统一归到 earlier,避免分桶逻辑炸掉
                if (Number.isNaN(d.getTime())) {
                  groups.earlier.push(session)
                  continue
                }
                if (isSameDay(d, today)) groups.today.push(session)
                else if (isSameDay(d, yesterday)) groups.yesterday.push(session)
                else groups.earlier.push(session)
              }
              const formatTime = (s: string) => {
                const d = new Date(s)
                if (Number.isNaN(d.getTime())) return '—'
                return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
              }
              const renderGroup = (title: string, sessions: any[]) => (
                <div key={title}>
                  <div className="text-xs font-medium text-muted-foreground px-2 pt-2 pb-1">{title}</div>
                  {sessions.map((session: any) => (
                    <div key={session.id} className="group flex items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-white/60 cursor-pointer transition-colors" onClick={() => loadHistory(session)}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px]">{session.messages[0]?.rawContent || session.messages[0]?.content || '空对话'}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{formatTime(session.time)}</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); deleteHistory(session.id) }} className="ml-1 hidden group-hover:flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              )
              return (
                <>
                  {groups.today.length > 0 && renderGroup('今天', groups.today)}
                  {groups.yesterday.length > 0 && renderGroup('昨天', groups.yesterday)}
                  {groups.earlier.length > 0 && renderGroup('更多', groups.earlier)}
                </>
              )
            })()}
          </div>
        </div>
      )}

      <Dialog open={cmdDialogOpen} onOpenChange={setCmdDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editingCmd ? '编辑快捷指令' : '添加快捷指令'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">名称</Label>
              <Input value={cmdName} onChange={(e) => setCmdName(e.target.value)} className="h-8 text-xs" placeholder="按钮名称" />
            </div>
            <div>
              <Label className="text-xs">命令文本</Label>
              <Textarea value={cmdPrompt} onChange={(e) => setCmdPrompt(e.target.value)} className="min-h-[80px] text-xs" placeholder="指令内容" />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch checked={cmdAutoSend} onCheckedChange={setCmdAutoSend} id="auto-send" />
                <Label htmlFor="auto-send" className="text-xs">直接发送</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={cmdMultiCandidate} onCheckedChange={setCmdMultiCandidate} id="multi-candidate" />
                <Label htmlFor="multi-candidate" className="text-xs">生成三份</Label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCmdDialogOpen(false)}>取消</Button>
              <Button size="sm" className="h-7 text-xs" onClick={saveCmd} disabled={!cmdName.trim() || !cmdPrompt.trim()}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  )
}

function ProposalView({ proposal, onSelect }: { proposal: ProposalData; onSelect: (choice: string) => void }) {
  const [customText, setCustomText] = useState('')
  return (
    <div className="mt-2 space-y-1.5 border-t border-border/50 pt-2">
      {proposal.options.map((opt, i) => (
        <button
          key={i}
          onClick={() => onSelect(opt)}
          className="w-full text-left rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-[11px] leading-relaxed hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {i + 1}. {opt}
        </button>
      ))}
      <div className="flex gap-1 pt-1">
        <input
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder="其他..."
          className="flex-1 h-7 rounded border border-border/50 bg-muted/30 px-2 text-[11px] outline-none focus:border-border placeholder:text-muted-foreground/40"
          onKeyDown={(e) => { if (e.key === 'Enter' && customText.trim()) { onSelect(customText.trim()); setCustomText('') } }}
        />
        <Button
          size="sm"
          className="h-7 text-[10px] px-2"
          disabled={!customText.trim()}
          onClick={() => { onSelect(customText.trim()); setCustomText('') }}
        >
          确定
        </Button>
      </div>
    </div>
  )
}
