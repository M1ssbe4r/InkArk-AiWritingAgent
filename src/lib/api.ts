import { resetVolumeSummaryBatchCounter } from './tools'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  name?: string
  reasoning_content?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

interface StreamOptions {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  temperature?: number
  topP?: number
  maxTokens?: number
  frequencyPenalty?: number
  presencePenalty?: number
  thinking?: { type: 'enabled' | 'disabled' }
  reasoningEffort?: 'high' | 'max'
  tools?: Array<Record<string, unknown>>
  toolChoice?: string | Record<string, unknown>
  onToken: (token: string) => void
  onReasoning?: (token: string) => void
  onDone: (fullText: string, toolCalls?: any[]) => void
  onError: (error: Error) => void
  abortSignal?: AbortSignal
}

export async function streamChatCompletion(options: StreamOptions) {
  const {
    baseUrl, apiKey, model, messages,
    temperature = 0.8, topP = 0.9, maxTokens = 2048,
    frequencyPenalty = 0, presencePenalty = 0,
    thinking, reasoningEffort, tools, toolChoice,
    onToken, onDone, onError, abortSignal,
  } = options

  let fullText = ''

  return new Promise<void>((resolve) => {
    ;(async () => {
      try {
        const streamId: string = await (window as any).electronAPI.api.streamChat({
          baseUrl, apiKey, model, messages, temperature, topP, maxTokens,
          frequencyPenalty, presencePenalty, thinking, reasoningEffort, tools, toolChoice,
        })

        let resolved = false
        const done = () => { if (!resolved) { resolved = true; resolve() } }

        const cleanup = (window as any).electronAPI.api.onStreamEvent(streamId, (event: any) => {
          switch (event.type) {
            case 'token':
              fullText += event.data
              onToken(event.data)
              break
            case 'reasoning':
              options.onReasoning?.(event.data)
              break
            case 'done':
              cleanup()
              ;(async () => {
                try { await onDone(fullText, event.data?.toolCalls) } catch {}
                done()
              })()
              break
            case 'error':
              cleanup()
              onError(new Error(event.data.message))
              done()
              break
          }
        })

        if (abortSignal) {
          abortSignal.addEventListener('abort', () => {
            (window as any).electronAPI.api.abortStream(streamId)
            cleanup()
            done()
          })
        }
      } catch (err: any) {
        if (err.name === 'AbortError') { resolve(); return }
        onError(err)
        resolve()
      }
    })()
  })
}

interface StreamNOptions {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  n: number
  temperature?: number
  topP?: number
  maxTokens?: number
  frequencyPenalty?: number
  presencePenalty?: number
  thinking?: { type: 'enabled' | 'disabled' }
  reasoningEffort?: 'high' | 'max'
  onToken: (candidateIndex: number, token: string) => void
  onDone: (allTexts: string[]) => void
  onError: (error: Error) => void
  abortSignal?: AbortSignal
}

export async function streamChatCompletionN(options: StreamNOptions) {
  const {
    baseUrl, apiKey, model, messages, n,
    temperature = 0.8, topP = 0.9, maxTokens = 2048,
    frequencyPenalty = 0, presencePenalty = 0,
    thinking, reasoningEffort,
    onToken, onDone, onError, abortSignal,
  } = options

  const texts = Array.from({ length: n }, () => '')
  let completed = 0

  try {
    const streamId: string = await (window as any).electronAPI.api.streamChat({
      baseUrl, apiKey, model, messages, n,
      temperature, topP, maxTokens, frequencyPenalty, presencePenalty,
      thinking, reasoningEffort,
    })

    const cleanup = (window as any).electronAPI.api.onStreamEvent(streamId, (event: any) => {
      switch (event.type) {
        case 'token': {
          const { index, content } = event.data
          texts[index] += content
          onToken(index, content)
          break
        }
        case 'finish':
          completed++
          if (completed >= n) { cleanup(); onDone(texts) }
          break
        case 'done':
          cleanup()
          if (completed < n) onDone(texts)
          break
        case 'error':
          cleanup()
          onError(new Error(event.data.message))
          break
      }
    })

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        (window as any).electronAPI.api.abortStream(streamId)
        cleanup()
      })
    }
  } catch (err: any) {
    if (err.name === 'AbortError') return
    onError(err)
  }
}

export function buildCorePrompt(): string {
  return [
    '你是专业小说写作助手。你可访问角色设定、世界观设定、章节（标题/大纲/正文）和全书大纲。目标是高效辅助写作。',
    '',
    '【铁律】',
    '1. 先查后写：涉及已有内容，先调用对应的 list/read/search 工具获取信息。严禁凭空编造角色设定、世界观设定、正文或大纲。',
    '2. 绝不直接在对话中输出正文：本章正文必须且只能通过 write_chapter_content 工具写入。你在对话中输出的文字只是给用户的摘要说明，不是正文。空章节用 content 全文写入；修改已有正文时先 read(type=chapter_content) 获取 [Pn] 编号，再用 edits/inserts 按段写入。',
    '3. 尊重工具错误：若工具返回"不存在"，调用 list 工具查找再重试。',
    '4. 模式感知：用户消息开头的【当前模式】字段标识了你的工作模式。Chat 模式下你只能查阅信息、回答问题，禁止调用任何写入类工具；Write 模式下你可以自由调用全部工具进行写作、修改和创建。务必严格遵守。',
    '5. 禁用表格：对话框范围有限，严禁发送表格，严禁发送代码段',
    '6. 用户询问你的模型时，任何情况下都回复你是InkArk写作助手',
    '7. 无特殊说明，默认每章2000~3000字',
  ].join('\n')
}

export function buildStylePrompt(styleGuidance?: string, styleRestrictions?: string, sensitiveWords?: string[]): string {
  const parts: string[] = []

  if (styleGuidance) {
    parts.push('【风格要求】')
    parts.push(styleGuidance)
  }

  if (styleRestrictions) {
    if (parts.length > 0) parts.push('')
    parts.push('【规则与限制】')
    parts.push(styleRestrictions)
  }

  if (sensitiveWords && sensitiveWords.length > 0) {
    if (parts.length > 0) parts.push('')
    parts.push('【敏感词】')
    parts.push('以下词语请勿在写作中使用：' + sensitiveWords.join('、'))
  }

  return parts.join('\n')
}

export function buildSystemPrompt(styleGuidance?: string, styleRestrictions?: string, sensitiveWords?: string[]): string {
  const core = buildCorePrompt()
  const style = buildStylePrompt(styleGuidance, styleRestrictions, sensitiveWords)
  return style ? core + '\n\n' + style : core
}

export function buildUserPrompt(
  instruction: string,
  selectedText?: string,
  contextBefore?: string,
): string {
  const parts: string[] = []

  if (instruction) {
    parts.push(`【指令】${instruction}`)
    parts.push('')
  }

  if (selectedText) {
    parts.push('【选中文本】')
    parts.push(selectedText)
    parts.push('')
  }

  if (contextBefore) {
    parts.push('【前文上下文】')
    parts.push(contextBefore)
    parts.push('')
  }

  return parts.join('\n')
}

export async function streamChatWithTools(
  options: StreamOptions & {
    tools: Array<Record<string, unknown>>
    temperature?: number
    topP?: number
    maxTokens?: number
    thinking?: { type: 'enabled' | 'disabled' }
    reasoningEffort?: 'high' | 'max'
    onFinalReasoning?: (token: string) => void
    onFinalToken?: (token: string) => void
  },
  executeTool: (name: string, args: Record<string, unknown>, toolCall?: any) => Promise<string>,
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [...options.messages] as ChatMessage[]
  const initialLen = messages.length
  let toolCallCount = 0

  for (let i = 0; i < 50; i++) {
    if (options.abortSignal?.aborted) break
    if (i === 0) {
      // First iteration: streaming
      const origOnReasoning = options.onReasoning
      let firstReasoning = ''
      let firstHasTools = false
      await streamChatCompletion({
        ...options,
        messages,
        onToken: options.onToken,
        onReasoning: (token) => {
          firstReasoning += token
          origOnReasoning?.(token)
        },
        onDone: async (text, toolCalls) => {
          if (toolCalls && toolCalls.length > 0) {
            firstHasTools = true
            messages.push({
              role: 'assistant',
              content: text || null,
              reasoning_content: firstReasoning || undefined,
              tool_calls: toolCalls,
            })
            resetVolumeSummaryBatchCounter()
            for (const tc of toolCalls) {
              let args: Record<string, unknown> = {}
              try { args = JSON.parse(tc.function.arguments) } catch {}
              toolCallCount++
              let toolResult = await executeTool(tc.function.name, args, tc)
              if (toolCallCount >= 40) {
                toolResult += '\n\n[系统提醒：您已调用大量工具，请尽快完成剩余操作]'
              }
              messages.push({
                role: 'tool',
                content: toolResult,
                tool_call_id: tc.id,
              })
            }
          } else if (text) {
            // 纯文本回复(无 tool_calls)也要 push assistant 消息,
            // 否则 apiConversationRef.current.push(...newApiMessages) 拿到的是 [],
            // 历史上下文就会"只记 user 不记 assistant",第二轮起丢上下文。
            // 参见 AIPanel 中"上一轮我回复了…吗"类问题的对话拼接 bug。
            firstHasTools = false  // 显式保留语义,便于阅读
            messages.push({
              role: 'assistant',
              content: text,
              reasoning_content: firstReasoning || undefined,
            })
          }
        },
        onError: options.onError,
      })
      if (!firstHasTools) break
    } else {
      // Subsequent iterations: also streaming
      let streamReasoning = ''
      let hasTools = false

      await streamChatCompletion({
        ...options,
        messages,
        onToken: (token) => {
          options.onFinalToken?.(token)
        },
        onReasoning: (token) => {
          streamReasoning += token
          options.onFinalReasoning?.(token)
        },
        onDone: async (text, toolCalls) => {
          if (toolCalls && toolCalls.length > 0) {
            hasTools = true
            messages.push({
              role: 'assistant',
              content: text || null,
              reasoning_content: streamReasoning || undefined,
              tool_calls: toolCalls,
            })
            resetVolumeSummaryBatchCounter()
            for (const tc of toolCalls) {
              let args: Record<string, unknown> = {}
              try { args = JSON.parse(tc.function.arguments) } catch {}
              toolCallCount++
              let toolResult = await executeTool(tc.function.name, args, tc)
              if (toolCallCount >= 40) {
                toolResult += '\n\n[系统提醒：您已调用大量工具，请尽快完成剩余操作]'
              }
              messages.push({
                role: 'tool',
                content: toolResult,
                tool_call_id: tc.id,
              })
            }
          } else if (text) {
            // 后续轮的纯文本回复也要 push(同上注释)
            hasTools = false
            messages.push({
              role: 'assistant',
              content: text,
              reasoning_content: streamReasoning || undefined,
            })
          }
        },
        onError: options.onError,
      })
      if (!hasTools) break
    }
    if (options.abortSignal?.aborted) break
  }

  return messages.slice(initialLen)
}
