import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSystemPrompt, buildUserPrompt, buildCorePrompt, buildStylePrompt, streamChatCompletion } from './api'

describe('buildCorePrompt', () => {
  it('返回核心静态内容', () => {
    const result = buildCorePrompt()
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
    expect(result).toContain('专业小说写作助手')
    expect(result).toContain('【铁律】')
  })
})

describe('buildStylePrompt', () => {
  it('不传参数时返回空字符串', () => {
    const result = buildStylePrompt()
    expect(result).toBe('')
  })

  it('传入风格要求时包含对应内容', () => {
    const result = buildStylePrompt('请使用古风文笔')
    expect(result).toContain('【风格要求】')
    expect(result).toContain('请使用古风文笔')
  })

  it('传入风格限制时包含对应内容', () => {
    const result = buildStylePrompt(undefined, '避用成语\n每段200字')
    expect(result).toContain('【风格限制】')
    expect(result).toContain('避用成语')
    expect(result).toContain('每段200字')
    expect(result).not.toContain('【风格要求】')
  })

  it('传入敏感词时包含对应内容', () => {
    const result = buildStylePrompt(undefined, undefined, ['敏感词1', '敏感词2'])
    expect(result).toContain('【敏感词】')
    expect(result).toContain('敏感词1')
    expect(result).toContain('敏感词2')
  })

  it('同时传入风格要求、限制和敏感词', () => {
    const result = buildStylePrompt('古风', '避用成语', ['敏感词1'])
    expect(result).toContain('【风格要求】')
    expect(result).toContain('【风格限制】')
    expect(result).toContain('【敏感词】')
  })

  it('敏感词为空数组时不包含敏感词区块', () => {
    const result = buildStylePrompt(undefined, undefined, [])
    expect(result).not.toContain('【敏感词】')
  })
})

describe('buildSystemPrompt', () => {
  it('不传参数时返回核心静态内容', () => {
    const result = buildSystemPrompt()
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
    expect(result).toContain('专业小说写作助手')
  })

  it('包含铁律', () => {
    const result = buildSystemPrompt()
    expect(result).toContain('【铁律】')
    expect(result).toContain('先查后写')
    expect(result).toContain('绝不直接在对话中输出正文')
    expect(result).toContain('尊重工具错误')
  })

  it('包含模式感知铁律', () => {
    const result = buildSystemPrompt()
    expect(result).toContain('模式感知')
    expect(result).toContain('Chat 模式下你只能查阅信息')
    expect(result).toContain('Write 模式下你可以自由调用全部工具')
  })

  it('传入风格要求时包含对应内容', () => {
    const result = buildSystemPrompt('请使用古风文笔')
    expect(result).toContain('【风格要求】')
    expect(result).toContain('请使用古风文笔')
  })

  it('不传风格要求时不包含风格区块', () => {
    const result = buildSystemPrompt()
    expect(result).not.toContain('【风格要求】')
  })

  it('不包含书名、章节等不应在 system 中的动态信息', () => {
    const result = buildSystemPrompt()
    expect(result).not.toContain('书名：《')
    expect(result).not.toContain('【当前位置】')
  })

  it('传入风格限制时包含对应内容', () => {
    const result = buildSystemPrompt(undefined, '避用成语\n每段200字')
    expect(result).toContain('【风格限制】')
    expect(result).toContain('避用成语')
    expect(result).toContain('每段200字')
    expect(result).not.toContain('【风格要求】')
  })

  it('同时传入风格要求和限制', () => {
    const result = buildSystemPrompt('古风', '避用成语')
    expect(result).toContain('【风格要求】')
    expect(result).toContain('【风格限制】')
  })

  it('传入敏感词时包含对应内容', () => {
    const result = buildSystemPrompt(undefined, undefined, ['敏感词1', '敏感词2'])
    expect(result).toContain('【敏感词】')
    expect(result).toContain('敏感词1')
    expect(result).toContain('敏感词2')
  })

  it('无参数调用时幂等', () => {
    const a = buildSystemPrompt()
    const b = buildSystemPrompt()
    expect(a).toBe(b)
  })
})

describe('buildUserPrompt', () => {
  it('包含指令', () => {
    const result = buildUserPrompt('扩写这段内容')
    expect(result).toContain('扩写这段内容')
    expect(result).toContain('【指令】')
  })

  it('包含选中文本', () => {
    const result = buildUserPrompt('润色', '这是一段需要润色的文字')
    expect(result).toContain('【选中文本】')
    expect(result).toContain('这是一段需要润色的文字')
  })

  it('不包含选中文本当未提供', () => {
    const result = buildUserPrompt('扩写')
    expect(result).not.toContain('【选中文本】')
  })

  it('包含前文上下文', () => {
    const result = buildUserPrompt('续写', undefined, '前面发生了很多事情')
    expect(result).toContain('【前文上下文】')
    expect(result).toContain('前面发生了很多事情')
  })

  it('不包含前文上下文当未提供', () => {
    const result = buildUserPrompt('续写')
    expect(result).not.toContain('【前文上下文】')
  })

  it('同时包含三种信息', () => {
    const result = buildUserPrompt('扩写', '选中文本', '前文')
    expect(result).toContain('【指令】')
    expect(result).toContain('【选中文本】')
    expect(result).toContain('【前文上下文】')
  })

  it('选中文本为空字符串时不显示', () => {
    const result = buildUserPrompt('润色', '')
    expect(result).not.toContain('【选中文本】')
  })
})

describe('streamChatCompletion', () => {
  let mockStreamChat: ReturnType<typeof vi.fn>
  let mockOnStreamEvent: ReturnType<typeof vi.fn>
  let mockAbortStream: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockStreamChat = vi.fn().mockResolvedValue('stream-123')
    mockOnStreamEvent = vi.fn()
    mockAbortStream = vi.fn()

    vi.stubGlobal('window', {
      electronAPI: {
        api: {
          streamChat: mockStreamChat,
          onStreamEvent: mockOnStreamEvent,
          abortStream: mockAbortStream,
        },
      },
    })
  })

  function setupStreamEvents(events: Array<{ type: string; data?: any }>) {
    mockOnStreamEvent.mockImplementation((_id: string, handler: Function) => {
      setTimeout(() => {
        for (const event of events) {
          handler(event)
        }
      }, 0)
      return vi.fn()
    })
  }

  it('调用 streamChat 传递正确参数', async () => {
    setupStreamEvents([{ type: 'done', data: {} }])

    await streamChatCompletion({
      baseUrl: 'https://api.test.com',
      apiKey: 'sk-test',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hello' }],
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    })

    expect(mockStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.test.com',
        apiKey: 'sk-test',
        model: 'gpt-4',
      })
    )
  })

  it('token 事件触发 onToken 回调', async () => {
    const onToken = vi.fn()

    setupStreamEvents([
      { type: 'token', data: '你好' },
      { type: 'token', data: '世界' },
      { type: 'done', data: {} },
    ])

    await streamChatCompletion({
      baseUrl: 'https://api.test.com',
      apiKey: 'sk-test',
      model: 'gpt-4',
      messages: [],
      onToken,
      onDone: vi.fn(),
      onError: vi.fn(),
    })

    expect(onToken).toHaveBeenCalledWith('你好')
    expect(onToken).toHaveBeenCalledWith('世界')
  })

  it('done 事件触发 onDone 回调并传递完整文本', async () => {
    const onDone = vi.fn()

    setupStreamEvents([
      { type: 'token', data: '你好' },
      { type: 'token', data: '世界' },
      { type: 'done', data: {} },
    ])

    await streamChatCompletion({
      baseUrl: 'https://api.test.com',
      apiKey: 'sk-test',
      model: 'gpt-4',
      messages: [],
      onToken: vi.fn(),
      onDone,
      onError: vi.fn(),
    })

    expect(onDone).toHaveBeenCalledWith('你好世界', undefined)
  })

  it('done 事件携带 toolCalls 时传递给 onDone', async () => {
    const onDone = vi.fn()
    const toolCalls = [{ id: 'tc1', type: 'function', function: { name: 'list', arguments: '{"type":"chapter"}' } }]

    setupStreamEvents([{ type: 'done', data: { toolCalls } }])

    await streamChatCompletion({
      baseUrl: 'https://api.test.com',
      apiKey: 'sk-test',
      model: 'gpt-4',
      messages: [],
      onToken: vi.fn(),
      onDone,
      onError: vi.fn(),
    })

    expect(onDone).toHaveBeenCalledWith('', toolCalls)
  })

  it('error 事件触发 onError 回调', async () => {
    const onError = vi.fn()

    setupStreamEvents([{ type: 'error', data: { message: 'API 限流' } }])

    await streamChatCompletion({
      baseUrl: 'https://api.test.com',
      apiKey: 'sk-test',
      model: 'gpt-4',
      messages: [],
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError,
    })

    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(onError.mock.calls[0][0].message).toBe('API 限流')
  })

  it('reasoning 事件触发 onReasoning 回调', async () => {
    const onReasoning = vi.fn()

    setupStreamEvents([
      { type: 'reasoning', data: '思考中...' },
      { type: 'done', data: {} },
    ])

    await streamChatCompletion({
      baseUrl: 'https://api.test.com',
      apiKey: 'sk-test',
      model: 'gpt-4',
      messages: [],
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onReasoning,
    })

    expect(onReasoning).toHaveBeenCalledWith('思考中...')
  })

  it('abort 信号触发 abortStream', async () => {
    const controller = new AbortController()

    mockOnStreamEvent.mockImplementation((_id: string, handler: Function) => {
      return vi.fn()
    })

    const promise = streamChatCompletion({
      baseUrl: 'https://api.test.com',
      apiKey: 'sk-test',
      model: 'gpt-4',
      messages: [],
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      abortSignal: controller.signal,
    })

    await new Promise(r => setTimeout(r, 0))
    controller.abort()
    await promise

    expect(mockAbortStream).toHaveBeenCalledWith('stream-123')
  })

  it('streamChat 抛出异常时触发 onError', async () => {
    const onError = vi.fn()
    mockStreamChat.mockRejectedValue(new Error('网络错误'))

    await streamChatCompletion({
      baseUrl: 'https://api.test.com',
      apiKey: 'sk-test',
      model: 'gpt-4',
      messages: [],
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError,
    })

    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('AbortError 不触发 onError', async () => {
    const onError = vi.fn()
    const abortErr = new Error('Aborted')
    abortErr.name = 'AbortError'
    mockStreamChat.mockRejectedValue(abortErr)

    await streamChatCompletion({
      baseUrl: 'https://api.test.com',
      apiKey: 'sk-test',
      model: 'gpt-4',
      messages: [],
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError,
    })

    expect(onError).not.toHaveBeenCalled()
  })
})
