import { ipcMain } from 'electron'
import { getDatabase } from './db'
import { stripHtml, parseArrayField, buildCharacterContent, buildWorldContent } from './fts'
import { splitChunks } from '../../src/lib/chunkSplitter'
import { tokenizeChinese } from './tokenizer'

interface FTSResult {
  type: 'character' | 'world' | 'outline' | 'synopsis' | 'outline_volume' | 'chapter_outline' | 'chapter_content' | 'knowledge'
  entity_id: string
  name: string
  chunk_idx: number
  chunk_text: string
  score: number
  chunkId: number
  chapter_index: number | null
}

const scopeTypeMap: Record<string, string[]> = {
  settings: ['character', 'world'],
  outlines: ['outline_volume', 'chapter_outline', 'outline'],
  knowledge: ['knowledge'],
  content: ['chapter_content'],
}

function buildMatchExpr(keyword: string): string {
  const keywords = keyword.trim().split(/\s+/).filter(Boolean)
  if (keywords.length === 0) return ''
  return keywords
    .map(kw => `"${tokenizeChinese(kw)}"`)
    .join(' OR ')
}

function getEnabledKnowledgeIds(db: ReturnType<typeof getDatabase>, projectId: string): Set<string> {
  const rows = db.queryAll(
    'SELECT knowledge_item_id FROM project_knowledge WHERE project_id = ? AND enabled = 1',
    [projectId]
  )
  return new Set(rows.map((r: any) => r.knowledge_item_id))
}

function getOriginalContent(db: ReturnType<typeof getDatabase>, type: string, entityId: string): { text: string; meta: any } | null {
  switch (type) {
    case 'character': {
      const card = db.queryOne('SELECT * FROM character_cards WHERE id = ?', [entityId])
      return card ? { text: buildCharacterContent(card), meta: card } : null
    }
    case 'world': {
      const card = db.queryOne('SELECT * FROM world_cards WHERE id = ?', [entityId])
      return card ? { text: buildWorldContent(card), meta: card } : null
    }
    case 'chapter_outline':
    case 'chapter_content': {
      const chapter = db.queryOne('SELECT * FROM chapters WHERE id = ?', [entityId])
      return chapter ? { text: stripHtml(chapter.content || ''), meta: chapter } : null
    }
    case 'outline': {
      const project = db.queryOne('SELECT * FROM projects WHERE id = ?', [entityId])
      return project ? { text: stripHtml(project.outline || ''), meta: project } : null
    }
    case 'synopsis': {
      const project = db.queryOne('SELECT * FROM projects WHERE id = ?', [entityId])
      return project ? { text: stripHtml(project.synopsis || ''), meta: project } : null
    }
    case 'outline_volume': {
      const volume = db.queryOne('SELECT * FROM outline_volumes WHERE id = ?', [entityId])
      if (!volume) return null
      const text = stripHtml([volume.outline, volume.progress_notes].filter(Boolean).join('\n'))
      return { text, meta: volume }
    }
    case 'knowledge': {
      const item = db.queryOne('SELECT * FROM knowledge_items WHERE id = ?', [entityId])
      return item ? { text: stripHtml(item.content || ''), meta: item } : null
    }
    default:
      return null
  }
}

export function registerSearchHandlers() {
  ipcMain.handle('db:search:workspace', (_e, params: {
    query: string
    project_id?: string
    scope?: string[]
    top_k?: number[]
  }) => {
    try {
      const db = getDatabase()
      const keyword = params.query?.trim()
      if (!keyword) return { results: [], summary: { total: 0 } }

      const projectId = params.project_id
      if (!projectId) return { results: [], summary: { total: 0 } }

      const rawScope = params.scope || ['settings', 'outlines', 'knowledge']
      const expandedTypes: Set<string> = new Set()
      for (const s of rawScope) {
        if (scopeTypeMap[s]) {
          for (const t of scopeTypeMap[s]) expandedTypes.add(t)
        }
      }

      const matchExpr = buildMatchExpr(keyword)
      if (!matchExpr) return { results: [], summary: { total: 0 } }

      const defaultTopK: Record<string, number> = { settings: 5, outlines: 5, knowledge: 10, content: 10 }
      const topKArr = params.top_k || rawScope.map(s => defaultTopK[s] ?? 5)

      const typeToScope: Record<string, string> = {}
      for (const [scope, types] of Object.entries(scopeTypeMap)) {
        for (const type of types) typeToScope[type] = scope
      }

      // 按 scope 分 SQL 跑,避免 BM25 共享 LIMIT 时某 scope 被抢名额
      // (旧实现:一次拿 totalLimit*3 条,后按 scope 分桶,后到的 scope 容易被空)
      const enabledKnowledgeIds = expandedTypes.has('knowledge')
        ? getEnabledKnowledgeIds(db, projectId)
        : new Set<string>()

      const filtered: FTSResult[] = []

      for (let i = 0; i < rawScope.length; i++) {
        const scope = rawScope[i]
        const types = scopeTypeMap[scope]
        if (!types || types.length === 0) continue
        const limit = topKArr[i] ?? 5

        // 占位符: types 个 '?' + 1 个 project_id
        const typePlaceholders = types.map(() => '?').join(',')
        const ftsResults = db.queryAll(
          `SELECT type, entity_id, name, chunk_idx, project_id, bm25(search_index) AS score, start_pos, end_pos, chapter_index
           FROM search_index
           WHERE search_index MATCH ?
             AND type IN (${typePlaceholders})
             AND (project_id = ? OR project_id = '')
           ORDER BY bm25(search_index)
           LIMIT ?`,
          [matchExpr, ...types, projectId, limit * 3]
        )

        const seen = new Set<string>()

        for (const row of ftsResults) {
          const type = row.type as FTSResult['type']

          if (type === 'knowledge') {
            if (!enabledKnowledgeIds.has(row.entity_id)) continue
          }

          const isShortEntity = type === 'character' || type === 'world' || type === 'chapter_outline' || type === 'synopsis'

          if (isShortEntity) {
            const dedupeKey = `${type}:${row.entity_id}`
            if (seen.has(dedupeKey)) continue
            seen.add(dedupeKey)
          }

          const original = getOriginalContent(db, type, row.entity_id)
          if (!original) continue
          // stripHtml 内部已含 .trim(),坐标系与向量索引一致

          let chunkText: string
          let chunkId: number

          if (isShortEntity) {
            chunkText = original.text
            chunkId = 0
          } else {
            const chunks = splitChunks(original.text)
            const chunkIdx = row.chunk_idx || 0
            const matchedIdx = chunkIdx < chunks.length ? chunkIdx : -1
            if (matchedIdx >= 0) {
              chunkText = chunks[matchedIdx].text
              chunkId = matchedIdx
            } else {
              // chunk_idx 越界时回退到第一块
              chunkText = chunks[0]?.text ?? ''
              chunkId = 0
            }
          }

          filtered.push({
            type,
            entity_id: row.entity_id,
            name: row.name,
            chunk_idx: row.chunk_idx || 0,
            chunk_text: chunkText,
            score: row.score,
            chunkId,
            chapter_index: row.chapter_index ?? null,
          })

          if (filtered.filter(r => typeToScope[r.type] === scope).length >= limit) break
        }
      }

      // 相邻 chunk 去重：同一 entity_id 内 chunk_idx 差 ≤ 1 的只保留 score 最优的
      const deduped: FTSResult[] = []
      const entityGroups = new Map<string, FTSResult[]>()
      for (const r of filtered) {
        const key = `${r.type}:${r.entity_id}`
        if (!entityGroups.has(key)) entityGroups.set(key, [])
        entityGroups.get(key)!.push(r)
      }
      for (const group of entityGroups.values()) {
        group.sort((a, b) => a.chunk_idx - b.chunk_idx)
        let prev = group[0]
        deduped.push(prev)
        for (let i = 1; i < group.length; i++) {
          if (group[i].chunk_idx - prev.chunk_idx <= 1) {
            // 相邻 chunk，保留 score 更优的
            if (group[i].score < prev.score) {  // BM25 score 越小越好
              deduped.pop()
              deduped.push(group[i])
              prev = group[i]
            }
          } else {
            deduped.push(group[i])
            prev = group[i]
          }
        }
      }

      const summary = {
        total: deduped.length,
        characters: deduped.filter(r => r.type === 'character').length,
        worlds: deduped.filter(r => r.type === 'world').length,
        outline: deduped.filter(r => r.type === 'outline_volume' || r.type === 'outline' || r.type === 'chapter_outline').length,
        knowledge: deduped.filter(r => r.type === 'knowledge').length,
        chapters: deduped.filter(r => r.type === 'chapter_content').length,
      }

      return { results: deduped, summary }
    } catch (err: any) {
      return { results: [], summary: { total: 0 }, error: err.message }
    }
  })
}
