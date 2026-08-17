import { buildStylePrompt } from './api'
import { streamChatWithTools } from './api'
import { getStyleRestrictions } from './editorRef'
import { toolDefinitions, executeToolCall } from './tools'

export interface ChapterReviewResult {
  status: 'idle' | 'running' | 'done' | 'error'
  text: string
  error?: string
  contentHash: string
  updatedAt: number
}

const reviewCache = new Map<string, ChapterReviewResult>()
const runningJobs = new Map<string, AbortController>()

const REVIEW_TOOL_NAMES = new Set(['list', 'read', 'search'])

export const reviewToolDefinitions = toolDefinitions.filter((t) =>
  REVIEW_TOOL_NAMES.has(t.function.name),
)

export function hashChapterContent(content: string): string {
  let h = 0
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0
  }
  return String(h)
}

export function getChapterReview(chapterId: string): ChapterReviewResult | undefined {
  return reviewCache.get(chapterId)
}

export function isChapterReviewRunning(chapterId: string): boolean {
  return runningJobs.has(chapterId)
}

export function buildChapterReviewSystemPrompt(
  styleRestrictions?: string,
  sensitiveWords?: string[],
): string {
  const parts = [
    '你是专业小说审稿编辑。你的唯一任务是审阅指定章节，给出简要的审稿意见。',
    '',
    '【审稿流程】必须按顺序执行：',
    '1. read(type=chapter_content, chapter_index=N) 读取本章正文',
    '2. 确定本章所属卷，read(type=volume) 读取该卷及前后卷的卷纲',
    '3. search(keyword=..., scope=["settings"]) 或 list(type=character/world) 读取本章涉及的角色卡和世界观设定',
    '4. 必要时 read/search 查阅更多章节大纲、知识库等内容',
    '5. 对照用户的规则与限制、敏感词进行检查',
    '6. 检查情节是否符合章节大纲和卷纲设计、角色卡与世界观是否一致、时间线是否合理、逻辑是否有缺陷',
    '7. 输出简要的审稿意见',
    '',
    '【硬性约束】',
    '- 只能使用 list / read / search 工具，禁止调用任何写入类工具',
    '- 不要在对话中输出修改后的正文，只输出审稿意见',
    '- 禁止输出过渡性语句（如「现在我已掌握…」「开始输出审稿意见」），查阅资料时保持沉默，最终直接输出审稿意见正文',
    '- 简洁明了，总篇幅控制在 500 字以内',
    '- 按严重程度分类：🔴严重 / 🟡一般 / 💡建议',
  ]
  const style = buildStylePrompt(undefined, styleRestrictions, sensitiveWords)
  if (style) parts.push('', style)
  return parts.join('\n')
}

export function buildChapterReviewUserPrompt(chapterIndex: number, chapterTitle?: string): string {
  const title = chapterTitle ? `「${chapterTitle}」` : ''
  return `请审稿：第 ${chapterIndex} 章${title}。按系统提示的审稿流程执行，最后输出审稿意见。`
}

export function buildChapterReviewFixPrompt(chapterIndex: number | undefined, reviewText: string): string {
  const chapterLabel = chapterIndex ? `第 ${chapterIndex} 章` : '当前章节'
  return [
    `请根据以下审稿意见，审慎修改${chapterLabel}正文。`,
    '',
    '【执行流程】',
    '1. read 本章内容及段落编号，必要时 read/search 查阅卷纲、角色卡、世界观等上下文',
    '2. 逐条核对审稿意见：确认问题是否真实存在、是否确需修改（审稿可能有误判或过度建议）',
    '3. 仅对「确认存在且确有必要修改」的条目，按段修改',
    '4. 对不成立或无需修改的条目，在回复中简要说明理由，不要强行改动',
    '5. 不要修改审稿未提及的部分，也不要为了迎合审稿而大改无关内容',
    '',
    '【审稿意见】',
    reviewText,
  ].join('\n')
}

function extractReviewText(messages: Array<{ role: string; content: string | null }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.content?.trim()) return sanitizeReviewText(m.content.trim())
  }
  return ''
}

const REVIEW_PREAMBLE_RE = /^(?:现在我)?已[\s\S]{0,40}?(?:掌握|获取)[\s\S]{0,40}?(?:开始)?输出[\s\S]{0,20}?审稿意见[。．]?\s*/m

export function sanitizeReviewText(text: string): string {
  let out = text.trim()
  out = out.replace(REVIEW_PREAMBLE_RE, '')
  out = out.replace(/^(?:好的[，,]?|嗯[，,]?|接下来[，,]?)\s*/m, '')
  return out.trim()
}

export async function runChapterReview(opts: {
  projectId: string
  chapterId: string
  chapterIndex: number
  chapterTitle?: string
  content: string
  onToken?: (token: string) => void
  onStatusChange?: (status: ChapterReviewResult['status']) => void
  force?: boolean
}): Promise<ChapterReviewResult> {
  const contentHash = hashChapterContent(opts.content)
  const cached = reviewCache.get(opts.chapterId)
  if (!opts.force && cached?.status === 'done') {
    return cached
  }

  runningJobs.get(opts.chapterId)?.abort()
  const ac = new AbortController()
  runningJobs.set(opts.chapterId, ac)

  const result: ChapterReviewResult = { status: 'running', text: '', contentHash, updatedAt: Date.now() }
  reviewCache.set(opts.chapterId, result)
  opts.onStatusChange?.('running')

  let reviewText = ''
  let isFinalRound = false
  const appendToken = (token: string) => {
    if (!isFinalRound) {
      isFinalRound = true
      reviewText = ''
      result.text = ''
      reviewCache.set(opts.chapterId, { ...result })
    }
    reviewText += token
    result.text = sanitizeReviewText(reviewText)
    reviewCache.set(opts.chapterId, { ...result })
    opts.onToken?.(token)
  }
  const appendFirstRoundToken = (token: string) => {
    if (isFinalRound) return
    reviewText += token
    result.text = sanitizeReviewText(reviewText)
    reviewCache.set(opts.chapterId, { ...result })
    opts.onToken?.(token)
  }

  try {
    const config = await window.electronAPI.apiConfig.getDefault()
    if (!config) throw new Error('请先在设置中配置 API')

    const sensitiveWordsList = await window.electronAPI.sensitive.list()
    const sensitiveWords = sensitiveWordsList.map((w: { word: string }) => w.word).filter(Boolean)
    const restrictions = getStyleRestrictions()

    const newMessages = await streamChatWithTools(
      {
        baseUrl: config.base_url,
        apiKey: config.api_key,
        model: config.model,
        messages: [
          { role: 'system', content: buildChapterReviewSystemPrompt(restrictions, sensitiveWords.length > 0 ? sensitiveWords : undefined) },
          { role: 'user', content: buildChapterReviewUserPrompt(opts.chapterIndex, opts.chapterTitle) },
        ],
        tools: reviewToolDefinitions as any,
        temperature: 0.3,
        maxTokens: 2048,
        abortSignal: ac.signal,
        onToken: appendFirstRoundToken,
        onFinalToken: appendToken,
        onDone: () => {},
        onError: (err) => { throw err },
      },
      async (name, args) => {
        if (!REVIEW_TOOL_NAMES.has(name)) {
          return `错误：审稿模式只能使用 list/read/search，禁止调用 ${name}`
        }
        return executeToolCall(name, args, opts.projectId)
      },
    )

    const extracted = extractReviewText(newMessages)
    const finalText = extracted || sanitizeReviewText(reviewText)
    result.text = finalText
    result.status = 'done'
    result.updatedAt = Date.now()
    reviewCache.set(opts.chapterId, result)
    opts.onStatusChange?.('done')
    return result
  } catch (err: unknown) {
    if (ac.signal.aborted) {
      if (cached?.status === 'done') {
        reviewCache.set(opts.chapterId, cached)
        return cached
      }
      const idle: ChapterReviewResult = { status: 'idle', text: '', contentHash, updatedAt: Date.now() }
      reviewCache.set(opts.chapterId, idle)
      return idle
    }
    const message = err instanceof Error ? err.message : '审稿失败'
    result.status = 'error'
    result.error = message
    result.updatedAt = Date.now()
    reviewCache.set(opts.chapterId, result)
    opts.onStatusChange?.('error')
    return result
  } finally {
    runningJobs.delete(opts.chapterId)
  }
}

export function abortChapterReview(chapterId: string): void {
  runningJobs.get(chapterId)?.abort()
}
