import type { Database } from './db'
import { suspendAutoSave, resumeAutoSave } from './db'
import { syncChapterToFTS, syncCharacterToFTS, syncWorldToFTS, syncOutlineToFTS, syncSynopsisToFTS, syncVolumeToFTS, deleteEntityFromFTS, setTokenizeOverride, stripHtml } from './fts'
import { migrateProjectOutlineToVolumes, toBase36Id as volumeId } from './outlineMigration'
import { rebuildProjectFTSIndex } from './fts'
import { splitChunks } from '../../src/lib/chunkSplitter'
import { tokenizeBatchInWorker } from '../workers/parseWorkerHost'
import { getLogger } from '../logger/core'

export interface ImportBackup {
  version: 1 | 2 | 3
  exportedAt?: string
  project: {
    id: string
    title: string
    outline?: string
    synopsis?: string
    word_count?: number
    style_guidance?: string
    style_custom_id?: string | null
    created_at: string
    updated_at: string
  }
  volumes?: Array<{
    id: string
    project_id: string
    sort_order: number
    title: string
    summary: string
    chapter_start: number | null
    chapter_end: number | null
    status: string
    progress_notes: string
    created_at?: string
    updated_at?: string
  }>
  chapters: Array<{
    id: string
    title: string
    content: string
    chapter_outline?: string
    summary?: string
    sort_order: number
    status?: string
    word_count?: number
    created_at: string
    updated_at: string
  }>
  characterCards?: any[]
  worldCards?: any[]
  customStyles?: any[]
}

function hasProtoPollution(obj: unknown): boolean {
  if (obj === null || typeof obj !== 'object') return false
  if (Object.prototype.hasOwnProperty.call(obj as Record<string, unknown>, '__proto__')) return true
  if (Object.prototype.hasOwnProperty.call(obj as Record<string, unknown>, 'constructor')) {
    const ctor = (obj as Record<string, unknown>).constructor
    if (typeof ctor === 'object' && ctor !== null) return true
  }
  return false
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function validateImportBackup(backup: any): { valid: boolean; error?: string } {
  if (!backup || typeof backup !== 'object') {
    return { valid: false, error: '备份数据必须是对象' }
  }
  if (hasProtoPollution(backup)) {
    return { valid: false, error: '检测到非法字段注入' }
  }
  if (backup.version !== 1 && backup.version !== 2 && backup.version !== 3) {
    return { valid: false, error: `不支持的备份版本: ${backup.version}` }
  }

  const project = backup.project
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    return { valid: false, error: 'project 必须是对象' }
  }
  if (hasProtoPollution(project)) {
    return { valid: false, error: 'project 包含非法字段' }
  }
  if (!isString(project.id) || project.id.length > 100) {
    return { valid: false, error: 'project.id 必须是长度不超过 100 的字符串' }
  }
  if (!isString(project.title) || project.title.length > 1000) {
    return { valid: false, error: 'project.title 必须是长度不超过 1000 的字符串' }
  }
  if (project.outline !== undefined && project.outline !== null && (!isString(project.outline) || project.outline.length > 200000)) {
    return { valid: false, error: 'project.outline 格式错误或超长' }
  }
  if (project.word_count !== undefined && project.word_count !== null && (!isNumber(project.word_count) || project.word_count < 0)) {
    return { valid: false, error: 'project.word_count 格式错误' }
  }

  if (!Array.isArray(backup.chapters)) {
    return { valid: false, error: 'chapters 必须是数组' }
  }
  if (backup.chapters.length > 50000) {
    return { valid: false, error: '章节数量超过上限 50000' }
  }
  const MAX_CONTENT = 50_000_000
  for (let i = 0; i < backup.chapters.length; i++) {
    const ch = backup.chapters[i]
    if (!ch || typeof ch !== 'object' || Array.isArray(ch)) {
      return { valid: false, error: `chapters[${i}] 必须是对象` }
    }
    if (hasProtoPollution(ch)) {
      return { valid: false, error: `chapters[${i}] 包含非法字段` }
    }
    if (!isString(ch.id) || ch.id.length > 100) {
      return { valid: false, error: `chapters[${i}].id 格式错误` }
    }
    if (!isString(ch.title) || ch.title.length > 1000) {
      return { valid: false, error: `chapters[${i}].title 格式错误` }
    }
    if (!isString(ch.content) || ch.content.length > MAX_CONTENT) {
      return { valid: false, error: `chapters[${i}].content 超过最大长度` }
    }
    if (ch.chapter_outline !== undefined && ch.chapter_outline !== null && (!isString(ch.chapter_outline) || ch.chapter_outline.length > 200000)) {
      return { valid: false, error: `chapters[${i}].chapter_outline 格式错误或超长` }
    }
    if (ch.status !== undefined && ch.status !== null && (!isString(ch.status) || ch.status.length > 50)) {
      return { valid: false, error: `chapters[${i}].status 格式错误` }
    }
    if (!isNumber(ch.sort_order) || ch.sort_order < 0) {
      return { valid: false, error: `chapters[${i}].sort_order 必须是正整数` }
    }
    if (ch.word_count !== undefined && ch.word_count !== null && (!isNumber(ch.word_count) || ch.word_count < 0)) {
      return { valid: false, error: `chapters[${i}].word_count 格式错误` }
    }
  }
  if (backup.version === 2) {
    if (backup.customStyles !== undefined && backup.customStyles !== null) {
      if (!Array.isArray(backup.customStyles)) {
        return { valid: false, error: 'customStyles 必须是数组' }
      }
      if (backup.customStyles.length > 1000) {
        return { valid: false, error: 'customStyles 数量超过上限 1000' }
      }
    }
  }
  return { valid: true }
}

function toJson(v: any): string {
  if (v === undefined || v === null) return '[]'
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return '[]'
  }
}

let idCounter = 0
function newId(): string {
  return (Date.now() + idCounter++).toString(36) + Math.random().toString(36).slice(2, 9)
}

export interface RunImportResult {
  success: boolean
  projectId?: string
  error?: string
}

export interface RunImportOptions {
  onProgress?: (info: { phase: string; current: number; total: number; message: string }) => void
  shouldYield?: () => Promise<void>
  batchSize?: number
  deferFts?: boolean
}

const DEFAULT_BATCH_SIZE = 50

export async function runProjectImport(db: Database, backup: any, options: RunImportOptions = {}): Promise<RunImportResult> {
  const validation = validateImportBackup(backup)
  if (!validation.valid) {
    return { success: false, error: validation.error }
  }
  const onProgress = options.onProgress
  const yieldEventLoop = options.shouldYield || (() => new Promise<void>((r) => setTimeout(r, 0)))
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE

  idCounter = 0
  const newProjectId = newId()
  const worldIdMap = new Map<string, string>()
  for (const w of backup.worldCards || []) {
    worldIdMap.set(w.id, newId())
  }
  const customStyleIdMap = new Map<string, string>()
  if (Array.isArray(backup.customStyles)) {
    for (const s of backup.customStyles) {
      customStyleIdMap.set(s.id, newId())
    }
  }

  const totalChapters = backup.chapters?.length || 0
  const totalCards = (backup.characterCards?.length || 0) + (backup.worldCards?.length || 0)
  const deferFts = options.deferFts === true

  if (!deferFts) {
    onProgress?.({ phase: 'pre-tokenize', current: 0, total: 1, message: '正在预处理文本...' })
  }
  const tokenizeMap = new Map<string, string>()
  if (!deferFts) try {
    const tokenizeTargets: string[] = []
    for (const ch of backup.chapters || []) {
      const outlinePlain = stripHtml(ch.chapter_outline || '')
      if (outlinePlain.trim()) tokenizeTargets.push(outlinePlain)
      const contentPlain = stripHtml(ch.content || '')
      for (const chunk of splitChunks(contentPlain)) {
        if (chunk.text.trim()) tokenizeTargets.push(chunk.text)
      }
    }
    for (const c of backup.characterCards || []) {
      const parts = [`名称:${c.name || ''}`]
      if (c.alias) parts.push(`别名:${c.alias}`)
      if (c.description) parts.push(`描述:${c.description}`)
      if (c.role) parts.push(`定位:${c.role}`)
      if (c.appearance) parts.push(`外貌:${c.appearance}`)
      if (c.background) parts.push(`背景:${c.background}`)
      if (c.relationships) parts.push(`关系:${c.relationships}`)
      if (c.notes) parts.push(`备注:${c.notes}`)
      const traits = (() => {
        try {
          const arr = typeof c.traits === 'string' ? JSON.parse(c.traits || '[]') : (c.traits || [])
          return Array.isArray(arr) ? arr.join('、') : ''
        } catch { return '' }
      })()
      if (traits) parts.push(`性格:${traits}`)
      const text = parts.join('\n')
      if (text.trim()) tokenizeTargets.push(text)
    }
    for (const w of backup.worldCards || []) {
      const parts = [`名称:${w.name || ''}`]
      if (w.card_type) parts.push(`类型:${w.card_type}`)
      if (w.description) parts.push(`描述:${w.description}`)
      if (w.notes) parts.push(`备注:${w.notes}`)
      const tags = (() => {
        try {
          const arr = typeof w.tags === 'string' ? JSON.parse(w.tags || '[]') : (w.tags || [])
          return Array.isArray(arr) ? arr.join('、') : ''
        } catch { return '' }
      })()
      if (tags) parts.push(`标签:${tags}`)
      const text = parts.join('\n')
      if (text.trim()) tokenizeTargets.push(text)
    }
    if (backup.project?.outline) {
      const outlinePlain = stripHtml(backup.project.outline)
      if (outlinePlain.trim()) tokenizeTargets.push(outlinePlain)
    }
    if (tokenizeTargets.length > 0) {
      const dedup = Array.from(new Set(tokenizeTargets))
      const total = dedup.length
      const BATCH = 50
      let processed = 0
      for (let i = 0; i < total; i += BATCH) {
        const batch = dedup.slice(i, i + BATCH)
        const tokens = await tokenizeBatchInWorker(batch)
        batch.forEach((t, j) => tokenizeMap.set(t, tokens[j] || t))
        processed += batch.length
        onProgress?.({
          phase: 'pre-tokenize',
          current: processed,
          total,
          message: `正在分词 (${processed}/${total})...`,
        })
        await yieldEventLoop()
      }
    }
    setTokenizeOverride((text) => tokenizeMap.get(text) || text)
  } catch (e) {
    getLogger().warn('projectImport.tokenize', 'pre-tokenize failed, fallback to main process', {
      fileName: options?.fileName,
      chapterCount: options?.chapters?.length || 0,
    })
    setTokenizeOverride(null)
  }

  try {
    onProgress?.({ phase: 'insert-project', current: 0, total: 1, message: '正在创建项目...' })
    db.transaction(() => {
      const styleGuidance = backup.project.style_guidance || ''
      const writingRestrictions = backup.project.writing_restrictions || ''
      let styleCustomId: string | null = null
      if (backup.project.style_custom_id) {
        styleCustomId = customStyleIdMap.get(backup.project.style_custom_id) ?? null
      }
      db.run(
        'INSERT INTO projects (id, title, outline, synopsis, word_count, style_guidance, style_custom_id, writing_restrictions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          newProjectId,
          backup.project.title,
          backup.project.outline || '',
          backup.project.synopsis || '',
          backup.project.word_count || 0,
          styleGuidance,
          styleCustomId,
          writingRestrictions,
          backup.project.created_at,
          backup.project.updated_at,
        ],
      )
    })
    await yieldEventLoop()

    let insertedChapters = 0
    const chapters = backup.chapters || []
    onProgress?.({ phase: 'insert-chapters', current: 0, total: totalChapters, message: `正在写入章节 (0/${totalChapters})...` })
    db.transaction(() => {
      for (const ch of chapters) {
        const id = newId()
        db.run(
          'INSERT INTO chapters (id, project_id, title, content, chapter_outline, sort_order, status, word_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            id,
            newProjectId,
            ch.title,
            ch.content,
            ch.chapter_outline || ch.summary || '',
            ch.sort_order,
            ch.status || 'draft',
            ch.word_count || 0,
            ch.created_at,
            ch.updated_at,
          ],
        )
        if (!deferFts) {
          try { syncChapterToFTS(db, { ...ch, id, project_id: newProjectId }) } catch {}
        }
        insertedChapters++
      }
    })
    onProgress?.({
      phase: 'insert-chapters',
      current: insertedChapters,
      total: totalChapters,
      message: `章节写入完成 (${insertedChapters}/${totalChapters})`,
    })
    await yieldEventLoop()

    if (backup.characterCards?.length || backup.worldCards?.length) {
      onProgress?.({ phase: 'insert-cards', current: 0, total: totalCards, message: '正在写入角色 / 世界观...' })
    }
    const charCardRows: any[] = []
    for (const c of backup.characterCards || []) {
      charCardRows.push({
        ...c,
        id: newId(),
        project_id: newProjectId,
      })
    }
    const worldCardRows: any[] = []
    for (const w of backup.worldCards || []) {
      const newParentId = w.parent_id ? worldIdMap.get(w.parent_id) || null : null
      worldCardRows.push({
        ...w,
        id: worldIdMap.get(w.id) || newId(),
        project_id: newProjectId,
        parent_id: newParentId,
      })
    }
    db.transaction(() => {
      for (const card of charCardRows) {
        db.run(
          'INSERT INTO character_cards (id, project_id, name, alias, description, role, traits, appearance, background, relationships, notes, tags, card_group, sort_order, gender, age, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            card.id,
            card.project_id,
            card.name,
            card.alias,
            card.description,
            card.role,
            toJson(card.traits),
            card.appearance,
            card.background,
            card.relationships,
            card.notes,
            toJson(card.tags),
            card.card_group,
            card.sort_order,
            card.gender || '',
            card.age || '',
            card.created_at,
            card.updated_at,
          ],
        )
        if (!deferFts) {
          try { syncCharacterToFTS(db, card) } catch {}
        }
      }
      for (const card of worldCardRows) {
        db.run(
          'INSERT INTO world_cards (id, project_id, name, card_type, description, tags, card_group, parent_id, sort_order, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            card.id,
            card.project_id,
            card.name,
            card.card_type,
            card.description,
            toJson(card.tags),
            card.card_group,
            card.parent_id,
            card.sort_order,
            card.notes || '',
            card.created_at,
            card.updated_at,
          ],
        )
        if (!deferFts) {
          try { syncWorldToFTS(db, card) } catch {}
        }
      }
    })
    const insertedCards = charCardRows.length + worldCardRows.length
    if (insertedCards > 0) {
      onProgress?.({ phase: 'insert-cards', current: insertedCards, total: totalCards, message: '角色 / 世界观写入完成' })
      await yieldEventLoop()
    }

    if (Array.isArray(backup.customStyles) && backup.customStyles.length > 0) {
      onProgress?.({ phase: 'insert-styles', current: 0, total: backup.customStyles.length, message: '正在写入风格...' })
      db.transaction(() => {
        for (const s of backup.customStyles) {
          const newIdValue = customStyleIdMap.get(s.id)
          if (!newIdValue) continue
          db.run(
            'INSERT INTO custom_styles (id, name, guidance, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [
              newIdValue,
              s.name,
              s.guidance || '',
              s.sort_order ?? 0,
              s.created_at || new Date().toISOString(),
              s.updated_at || new Date().toISOString(),
            ],
          )
        }
      })
      onProgress?.({ phase: 'insert-styles', current: backup.customStyles.length, total: backup.customStyles.length, message: '风格写入完成' })
      await yieldEventLoop()
    }

    if (!deferFts) {
      onProgress?.({ phase: 'fts', current: 0, total: 1, message: '正在索引大纲...' })
      const project = db.queryOne('SELECT * FROM projects WHERE id = ?', [newProjectId])
      if (backup.version === 3 && Array.isArray(backup.volumes) && backup.volumes.length > 0) {
        db.transaction(() => {
          for (const vol of backup.volumes!) {
            const vid = volumeId()
            const outline = vol.outline || ''
            db.run(
              `INSERT INTO outline_volumes (id, project_id, sort_order, title, outline, chapter_start, chapter_end, status, progress_notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                vid,
                newProjectId,
                vol.sort_order,
                vol.title,
                outline,
                vol.chapter_start ?? null,
                vol.chapter_end ?? null,
                vol.status || 'planned',
                vol.progress_notes || '',
                vol.created_at || new Date().toISOString(),
                vol.updated_at || new Date().toISOString(),
              ],
            )
            if (!deferFts) {
              try {
                syncVolumeToFTS(db, { ...vol, id: vid, project_id: newProjectId })
              } catch {}
            }
          }
          db.run(
            "UPDATE projects SET outline_migrated_at=datetime('now'), updated_at=datetime('now') WHERE id=?",
            [newProjectId],
          )
        })
        if (project && !deferFts) {
          try { syncSynopsisToFTS(db, project) } catch {}
        }
      } else {
        migrateProjectOutlineToVolumes(db, newProjectId)
        if (!deferFts) {
          rebuildProjectFTSIndex(db, newProjectId)
        }
      }
    }
    await yieldEventLoop()
    onProgress?.({ phase: 'done', current: 1, total: 1, message: '导入完成' })
    if (!deferFts) setTokenizeOverride(null)
    return { success: true, projectId: newProjectId }
  } catch (e: any) {
    setTokenizeOverride(null)
    return { success: false, error: e?.message || '导入失败' }
  }
}

function collectTokenizeTargets(backup: any): string[] {
  const targets: string[] = []
  for (const ch of backup.chapters || []) {
    const outlinePlain = stripHtml(ch.chapter_outline || '')
    if (outlinePlain.trim()) targets.push(outlinePlain)
    const contentPlain = stripHtml(ch.content || '')
    for (const chunk of splitChunks(contentPlain)) {
      if (chunk.text.trim()) targets.push(chunk.text)
    }
  }
  for (const c of backup.characterCards || []) {
    const parts = [`名称:${c.name || ''}`]
    if (c.alias) parts.push(`别名:${c.alias}`)
    if (c.description) parts.push(`描述:${c.description}`)
    if (c.role) parts.push(`定位:${c.role}`)
    if (c.appearance) parts.push(`外貌:${c.appearance}`)
    if (c.background) parts.push(`背景:${c.background}`)
    if (c.relationships) parts.push(`关系:${c.relationships}`)
    if (c.notes) parts.push(`备注:${c.notes}`)
    const traits = (() => {
      try {
        const arr = typeof c.traits === 'string' ? JSON.parse(c.traits || '[]') : (c.traits || [])
        return Array.isArray(arr) ? arr.join('、') : ''
      } catch { return '' }
    })()
    if (traits) parts.push(`性格:${traits}`)
    const text = parts.join('\n')
    if (text.trim()) targets.push(text)
  }
  for (const w of backup.worldCards || []) {
    const parts = [`名称:${w.name || ''}`]
    if (w.card_type) parts.push(`类型:${w.card_type}`)
    if (w.description) parts.push(`描述:${w.description}`)
    if (w.notes) parts.push(`备注:${w.notes}`)
    const tags = (() => {
      try {
        const arr = typeof w.tags === 'string' ? JSON.parse(w.tags || '[]') : (w.tags || [])
        return Array.isArray(arr) ? arr.join('、') : ''
      } catch { return '' }
    })()
    if (tags) parts.push(`标签:${tags}`)
    const text = parts.join('\n')
    if (text.trim()) targets.push(text)
  }
  if (backup.project?.outline) {
    const outlinePlain = stripHtml(backup.project.outline)
    if (outlinePlain.trim()) targets.push(outlinePlain)
  }
  return targets
}

export interface DeferredFtsOptions {
  onProgress?: (info: { phase: string; current: number; total: number; message: string }) => void
  shouldYield?: () => Promise<void>
  batchSize?: number
  /** 单次连续 work 的时间预算(ms), 超过就 yield 给主进程. 默认 8ms (约 1 帧的 1/2). */
  timeBudgetMs?: number
}

export const DEFAULT_DEFERRED_FTS_TIME_BUDGET_MS = 8

/**
 * 时间预算切片: 给定一个工作循环, 每跑一次 callback 就累计耗时, 超 budget 就 yield.
 * 这样单次连续 work 不会超过 ~8ms, 主进程 IPC 通道始终可达, UI 不卡.
 *
 * 导出供测试验证, 生产路径仍然只在 runDeferredFtsRebuild 内部使用.
 */
export async function runWithTimeBudget<T>(
  items: T[],
  perItem: (item: T) => void,
  options: { timeBudgetMs?: number; shouldYield?: () => Promise<void>; now?: () => number } = {},
): Promise<void> {
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_DEFERRED_FTS_TIME_BUDGET_MS
  const shouldYield = options.shouldYield || (() => new Promise<void>((r) => setTimeout(r, 0)))
  const now = options.now || (() => Date.now())
  let sliceStart = now()
  for (const it of items) {
    try { perItem(it) } catch (e) { console.warn('[runWithTimeBudget] item failed', e) }
    if (now() - sliceStart >= timeBudgetMs) {
      await shouldYield()
      sliceStart = now()
    }
  }
}

export async function runDeferredFtsRebuild(
  db: Database,
  projectId: string,
  backup: any,
  options: DeferredFtsOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const yieldEventLoop = options.shouldYield || (() => new Promise<void>((r) => setTimeout(r, 0)))
  const batchSize = options.batchSize ?? 50
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_DEFERRED_FTS_TIME_BUDGET_MS
  const onProgress = options.onProgress

  /** 内部薄包装, 走统一的 timeBudgetMs + yieldEventLoop */
  const runWithBudget = <T>(items: T[], perItem: (it: T) => void) =>
    runWithTimeBudget(items, perItem, { timeBudgetMs, shouldYield: yieldEventLoop })

  try {
    onProgress?.({ phase: 'fts-background-prepare', current: 0, total: 1, message: '后台索引准备...' })
    const targets = collectTokenizeTargets(backup)
    if (targets.length === 0) {
      onProgress?.({ phase: 'fts-background-done', current: 1, total: 1, message: '无需索引' })
      return { success: true }
    }
    const dedup = Array.from(new Set(targets))
    const total = dedup.length
    const tokenizeMap = new Map<string, string>()
    for (let i = 0; i < total; i += batchSize) {
      const batch = dedup.slice(i, i + batchSize)
      const tokens = await tokenizeBatchInWorker(batch)
      batch.forEach((t, j) => tokenizeMap.set(t, tokens[j] || t))
      onProgress?.({
        phase: 'fts-background',
        current: Math.min(i + batch.length, total),
        total,
        message: `后台索引 (${Math.min(i + batch.length, total)}/${total})`,
      })
      await yieldEventLoop()
    }

    setTokenizeOverride((text) => tokenizeMap.get(text) || text)
    /**
     * 暂停自动落盘. syncChapterToFTS / syncCharacterToFTS / syncWorldToFTS / syncOutlineToFTS
     * 各自走 db.transaction + 多个 db.run, 每章/每卡都会触发一次完整 export+fsync.
     * 950 章会让 fsync 跑 190+ 次 (45+ 秒, 22+ GB 总写).
     *
     * suspend 期间所有写入累积在 sql.js in-memory, finally 里 resumeAutoSave
     * + flushDatabase 一次性原子落盘, 期间 UI 操作的 db.run 也一并合并.
     *
     * 中途崩溃: search_index 留空, 不会"搜到一半", 用户重启后该项目搜索为空
     * (主表 chapters 不受影响, 数据安全).
     */
    suspendAutoSave()
    try {
      // 入口先把这个项目已有的 FTS 行全删, 避免重建后残留旧 chapter 索引
      db.run('DELETE FROM search_index WHERE project_id = ?', [projectId])

      const chapters = db.queryAll('SELECT * FROM chapters WHERE project_id = ? ORDER BY sort_order ASC', [projectId])
      let lastReport = 0
      await runWithBudget(chapters, (chapter) => {
        try { syncChapterToFTS(db, chapter) } catch (e) { console.warn('[fts-bg] chapter failed', e) }
        // 进度回报也走时间预算, 避免大文档时 1 章 1 报让 UI 过载
      })
      onProgress?.({
        phase: 'fts-background-write',
        current: chapters.length,
        total: chapters.length,
        message: `正在写章节索引 (${chapters.length}/${chapters.length})...`,
      })
      await yieldEventLoop()

      const chars = db.queryAll('SELECT * FROM character_cards WHERE project_id = ?', [projectId])
      await runWithBudget(chars, (card) => {
        try { syncCharacterToFTS(db, card) } catch (e) { console.warn('[fts-bg] character failed', e) }
      })
      const worlds = db.queryAll('SELECT * FROM world_cards WHERE project_id = ?', [projectId])
      await runWithBudget(worlds, (card) => {
        try { syncWorldToFTS(db, card) } catch (e) { console.warn('[fts-bg] world failed', e) }
      })

      onProgress?.({ phase: 'fts-background-write', current: 1, total: 1, message: '正在写卡片索引...' })
      await yieldEventLoop()

      const project = db.queryOne('SELECT * FROM projects WHERE id = ?', [projectId])
      if (project) {
        try { syncOutlineToFTS(db, project) } catch (e) { console.warn('[fts-bg] outline failed', e) }
      }
      onProgress?.({ phase: 'fts-background-done', current: 1, total: 1, message: '后台索引完成' })
      return { success: true }
    } finally {
      resumeAutoSave()
      // 一次性同步落盘, 把 suspend 期间累积的所有改动 (FTS 重建 + 期间 UI 操作)
      // 原子写到磁盘. flushDatabase 走 _doSave, 不受 suspendAutoSave 影响.
      db.flushDatabase()
      setTokenizeOverride(null)
    }
  } catch (e: any) {
    setTokenizeOverride(null)
    console.error('[fts-bg] failed:', e)
    onProgress?.({ phase: 'fts-background-error', current: 0, total: 0, message: e?.message || '后台索引失败' })
    return { success: false, error: e?.message || '后台索引失败' }
  }
}
