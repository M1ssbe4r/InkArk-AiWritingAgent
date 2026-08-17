/**
 * 操作审计 helper
 *
 * 把"用户做了什么"集中记录在 audit.* scope,便于:
 *   - 诊断包导出时一目了然用户最近做过哪些操作
 *   - 事故回看时筛 audit.* 立刻看到时间线
 *
 * 风格:warn 级(比 info 醒目),scope 严格 `audit.<entity>.<action>`
 * 不脱敏(数据全是 ID / 计数 / 元数据,不含正文/token)
 */

import { getLogger } from './core'

export type AuditAction =
  | 'project.create' | 'project.delete' | 'project.import' | 'project.export'
  | 'chapter.delete' | 'character.delete' | 'world.delete'
  | 'version.restore' | 'version.delete'
  | 'log.export'

export function audit(action: AuditAction, data: Record<string, unknown>): void {
  try {
    getLogger().warn(`audit.${action}`, action, data)
  } catch {
    // logger 未初始化时静默 - 不阻塞业务
  }
}