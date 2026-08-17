/**
 * 渲染端 logger - 极薄封装,转发到主进程 IPC
 *
 * 用法:
 *   import { logger } from '@/lib/logger'
 *   logger.error('api.streamChat', '请求失败', { code, message })
 *
 * 设计:
 *   - 永远不抛错(IPC 失败、preload 未就绪都吞掉)
 *   - 不依赖 React 状态;模块加载即用
 *   - 调用栈信息会用 Error().stack 截取到调用方,避免 V8 内部帧
 */

import type { LogLevel } from './logger-types'

interface SendArgs {
  level: LogLevel
  scope: string
  msg: string
  data?: Record<string, unknown>
}

function send(args: SendArgs): void {
  try {
    const api = (typeof window !== 'undefined' ? window.electronAPI : undefined)
    if (!api?.log?.send) return
    // fire-and-forget;失败由主进程 logger 自己兜底
    void api.log.send(args.level, args.scope, args.msg, args.data)
  } catch {
    // 永远不抛
  }
}

/** 错误对象便捷方法:自动序列化 Error + 截取调用栈 */
function errorObj(scope: string, msg: string, err: unknown, extra?: Record<string, unknown>): void {
  const data: Record<string, unknown> = { ...(extra || {}) }
  if (err instanceof Error) {
    data.errorName = err.name
    data.errorMessage = err.message
    if (err.stack) {
      // 截掉 V8 自身的前几行,保留应用栈
      data.errorStack = String(err.stack).split('\n').slice(0, 8).join('\n')
    }
  } else if (typeof err === 'string') {
    data.errorMessage = err
  } else if (err && typeof err === 'object') {
    data.errorObject = err as Record<string, unknown>
  }
  send({ level: 'error', scope, msg, data })
}

export const logger = {
  debug: (scope: string, msg: string, data?: Record<string, unknown>) => send({ level: 'debug', scope, msg, data }),
  info: (scope: string, msg: string, data?: Record<string, unknown>) => send({ level: 'info', scope, msg, data }),
  warn: (scope: string, msg: string, data?: Record<string, unknown>) => send({ level: 'warn', scope, msg, data }),
  error: (scope: string, msg: string, data?: Record<string, unknown>) => send({ level: 'error', scope, msg, data }),
  errorObj,
}