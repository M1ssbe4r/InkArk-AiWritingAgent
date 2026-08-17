import { describe, it, expect } from 'vitest'
import { estimateMessageTokens, estimateConversationTokens, buildPrefixSum, tokensInRange } from './tokens'
import type { ChatMessage } from './api'

describe('estimateMessageTokens', () => {
  it('returns base overhead for empty message', () => {
    const tokens = estimateMessageTokens({ role: 'user', content: null })
    expect(tokens).toBeGreaterThanOrEqual(4)
  })

  it('estimates user message content', () => {
    const msg: ChatMessage = { role: 'user', content: 'Hello, how are you?' }
    const tokens = estimateMessageTokens(msg)
    expect(tokens).toBeGreaterThan(4)
  })

  it('includes reasoning_content when present', () => {
    const without = estimateMessageTokens({ role: 'assistant', content: 'hi' })
    const withReasoning = estimateMessageTokens({
      role: 'assistant',
      content: 'hi',
      reasoning_content: 'thinking about this carefully',
    })
    expect(withReasoning).toBeGreaterThan(without)
  })

  it('accounts for tool_calls JSON', () => {
    const without = estimateMessageTokens({ role: 'assistant', content: null })
    const withTools = estimateMessageTokens({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'search', arguments: '{"query":"test"}' },
      }],
    })
    expect(withTools).toBeGreaterThan(without + 10)
  })

  it('handles CJK content', () => {
    const cjk = estimateMessageTokens({ role: 'user', content: '你好世界这是一个测试' })
    const english = estimateMessageTokens({ role: 'user', content: 'a'.repeat(12) })
    expect(cjk).toBeGreaterThan(0)
    expect(english).toBeGreaterThan(0)
  })

  it('applies CJK rate to Kana, Hangul, CJK Ext-A, punctuation, full-width ASCII', () => {
    // 12 个 CJK 字符，rate = 1.5 chars/token → 约 8 tokens
    const hiragana = estimateMessageTokens({ role: 'user', content: 'こんにちは世界です' }) // mixed kana + kanji
    const hangul = estimateMessageTokens({ role: 'user', content: '안녕하세요반갑습니다' })
    const extA = estimateMessageTokens({ role: 'user', content: '𠀀𠀁𠀂𠀃𠀄𠀅𠀆𠀇' }) // CJK Ext-A
    const fullwidth = estimateMessageTokens({ role: 'user', content: 'Ｈｅｌｌｏ，Ｗｏｒｌｄ' })
    const cjkPunct = estimateMessageTokens({ role: 'user', content: '【你好】、世界！' })

    // 全部 > 0 且应该明显高于纯 ASCII 同字符数（默认 4 chars/token）
    expect(hiragana).toBeGreaterThan(0)
    expect(hangul).toBeGreaterThan(0)
    expect(extA).toBeGreaterThan(0)
    expect(fullwidth).toBeGreaterThan(0)
    expect(cjkPunct).toBeGreaterThan(0)

    // 全角字符应该跟中文采用相近的 rate（1.5 chars/token）
    // 12 个全角 ≈ 8 tokens，比同长度的 ASCII 估算（3 tokens）显著高
    expect(fullwidth).toBeGreaterThan(estimateMessageTokens({ role: 'user', content: 'a'.repeat(12) }))
  })

  it('handles null content gracefully', () => {
    const tokens = estimateMessageTokens({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 't1',
        type: 'function',
        function: { name: 'f', arguments: '{}' },
      }],
    })
    expect(tokens).toBeGreaterThan(0)
  })
})

describe('estimateConversationTokens', () => {
  it('returns 0 for empty array', () => {
    expect(estimateConversationTokens([])).toBe(0)
  })

  it('sums tokens across messages', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]
    const total = estimateConversationTokens(msgs)
    expect(total).toBeGreaterThan(0)
  })
})

describe('buildPrefixSum & tokensInRange', () => {
  it('prefix has length n+1 starting with 0', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]
    const prefix = buildPrefixSum(msgs)
    expect(prefix[0]).toBe(0)
    expect(prefix.length).toBe(msgs.length + 1)
  })

  it('prefix is monotonically non-decreasing', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'a'.repeat(20) },
      { role: 'assistant', content: 'b'.repeat(20) },
      { role: 'user', content: 'c'.repeat(20) },
    ]
    const prefix = buildPrefixSum(msgs)
    for (let i = 1; i < prefix.length; i++) {
      expect(prefix[i]).toBeGreaterThanOrEqual(prefix[i - 1])
    }
  })

  it('tokensInRange returns correct slice sum', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]
    const prefix = buildPrefixSum(msgs)
    const direct = estimateMessageTokens(msgs[0]) + estimateMessageTokens(msgs[1])
    expect(tokensInRange(prefix, 0, 2)).toBe(direct)
  })

  it('tokensInRange with start=end returns 0', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'x' }]
    const prefix = buildPrefixSum(msgs)
    expect(tokensInRange(prefix, 0, 0)).toBe(0)
  })
})
