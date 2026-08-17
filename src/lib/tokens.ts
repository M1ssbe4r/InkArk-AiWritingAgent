import { estimateTokenCount } from 'tokenx'
import type { ChatMessage } from '@/lib/api'

const MESSAGE_OVERHEAD = 4
const TOOL_CALL_OVERHEAD = 10
// tokenx 内置 CJK 识别（基本平面 + Ext-A + 日韩 + 标点 + 全角）走 1 char = 1 token
// 自定义 languageConfigs 对 CJK 无效，user options 只对 alphanumeric 段生效
const tokenxOptions = {}

function estimate(text: string | null | undefined): number {
  if (!text) return 0
  return estimateTokenCount(text, tokenxOptions)
}

export function countText(text: string | null | undefined): number {
  if (!text) return 0
  return estimateTokenCount(text, tokenxOptions)
}

export function estimateMessageTokens(msg: ChatMessage): number {
  let tokens = MESSAGE_OVERHEAD

  tokens += countText(msg.content)
  tokens += countText(msg.reasoning_content)

  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      tokens += TOOL_CALL_OVERHEAD
      tokens += countText(tc.function.name)
      tokens += countText(tc.function.arguments)
    }
  }

  if (msg.tool_call_id) tokens += countText(msg.tool_call_id)
  if (msg.name) tokens += countText(msg.name)

  return tokens
}

export function estimateConversationTokens(messages: ChatMessage[]): number {
  let total = 0
  for (const msg of messages) {
    total += estimateMessageTokens(msg)
  }
  return total
}

export function buildPrefixSum(messages: ChatMessage[]): number[] {
  const prefix = [0]
  for (const msg of messages) {
    prefix.push(prefix[prefix.length - 1] + estimateMessageTokens(msg))
  }
  return prefix
}

export function tokensInRange(prefix: number[], start: number, end: number): number {
  return prefix[end] - prefix[start]
}
