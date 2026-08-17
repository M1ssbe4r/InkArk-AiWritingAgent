import { getDatabase } from './db'
import { tokenizeChinese as _defaultTokenizeChinese } from './tokenizer'

type TokenizeFn = (text: string) => string
let _tokenizeOverride: TokenizeFn | null = null

export function setTokenizeOverride(fn: TokenizeFn | null) {
  _tokenizeOverride = fn
}

export function tokenizeChinese(text: string): string {
  if (_tokenizeOverride) {
    try {
      return _tokenizeOverride(text)
    } catch {
      return _defaultTokenizeChinese(text)
    }
  }
  return _defaultTokenizeChinese(text)
}

type DbType = ReturnType<typeof getDatabase>

// stripHtml 抽到 src/lib/html.ts(前后端共用,保证 offset 坐标系一致)
import { stripHtml } from '../../src/lib/html'
import { splitChunks } from '../../src/lib/chunkSplitter'
export { stripHtml }

export function parseArrayField(v: any): string[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') {
    try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
  }
  return []
}

function joinArray(v: any): string {
  return parseArrayField(v).join('、')
}

export function buildCharacterContent(card: any): string {
  const parts: string[] = [`名称：${card.name || ''}`]
  if (card.alias) parts.push(`别名：${card.alias}`)
  if (card.description) parts.push(`描述：${card.description}`)
  if (card.role) parts.push(`定位：${card.role}`)
  if (card.gender) parts.push(`性别：${card.gender}`)
  if (card.age) parts.push(`年龄：${card.age}`)
  const traits = joinArray(card.traits)
  if (traits) parts.push(`性格：${traits}`)
  if (card.appearance) parts.push(`外貌：${card.appearance}`)
  if (card.background) parts.push(`背景：${card.background}`)
  if (card.relationships) parts.push(`关系：${card.relationships}`)
  if (card.notes) parts.push(`备注：${card.notes}`)
  return parts.join('\n')
}

export function buildWorldContent(card: any): string {
  const parts: string[] = [`名称：${card.name || ''}`]
  if (card.card_type) parts.push(`类型：${card.card_type}`)
  if (card.description) parts.push(`描述：${card.description}`)
  if (card.notes) parts.push(`备注：${card.notes}`)
  const tags = joinArray(card.tags)
  if (tags) parts.push(`标签：${tags}`)
  return parts.join('\n')
}


export function createFTSTable(db: DbType): void {
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      content,
      type UNINDEXED,
      entity_id UNINDEXED,
      name UNINDEXED,
      project_id UNINDEXED,
      chunk_idx UNINDEXED,
      start_pos UNINDEXED,
      end_pos UNINDEXED,
      chapter_index UNINDEXED,
      tokenize=unicode61
    )
  `)
}

export function deleteEntityFromFTS(db: DbType, type: string, entityId: string): void {
  db.run('DELETE FROM search_index WHERE type = ? AND entity_id = ?', [type, entityId])
}

export function syncCharacterToFTS(db: DbType, card: any): void {
  const content = buildCharacterContent(card)
  db.transaction(() => {
    deleteEntityFromFTS(db, 'character', card.id)
    db.run(
      `INSERT INTO search_index (content, type, entity_id, name, project_id, chunk_idx, start_pos, end_pos, chapter_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tokenizeChinese(content), 'character', card.id, card.name, card.project_id, 0, 0, content.length, null]
    )
  })
}

export function syncWorldToFTS(db: DbType, card: any): void {
  const content = buildWorldContent(card)
  db.transaction(() => {
    deleteEntityFromFTS(db, 'world', card.id)
    db.run(
      `INSERT INTO search_index (content, type, entity_id, name, project_id, chunk_idx, start_pos, end_pos, chapter_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tokenizeChinese(content), 'world', card.id, card.name, card.project_id, 0, 0, content.length, null]
    )
  })
}

export function syncChapterToFTS(db: DbType, chapter: any): void {
  const chapterIndex = (chapter.sort_order ?? 0) + 1
  // 用事务包起来, 减少 fsync/wal flush 次数, 避免主进程被频繁 IO 切碎
  db.transaction(() => {
    deleteEntityFromFTS(db, 'chapter_outline', chapter.id)
    deleteEntityFromFTS(db, 'chapter_content', chapter.id)

    if (chapter.chapter_outline?.trim()) {
      const plainOutline = stripHtml(chapter.chapter_outline)
      db.run(
        `INSERT INTO search_index (content, type, entity_id, name, project_id, chunk_idx, start_pos, end_pos, chapter_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tokenizeChinese(plainOutline), 'chapter_outline', chapter.id, chapter.title || '未命名章节', chapter.project_id, 0, 0, plainOutline.length, chapterIndex]
      )
    }

    if (chapter.content?.trim()) {
      const plainContent = stripHtml(chapter.content)
      const chunks = splitChunks(plainContent)
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        db.run(
          `INSERT INTO search_index (content, type, entity_id, name, project_id, chunk_idx, start_pos, end_pos, chapter_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [tokenizeChinese(chunk.text), 'chapter_content', chapter.id, chapter.title || '未命名章节', chapter.project_id, i, chunk.start, chunk.end, chapterIndex]
        )
      }
    }
  })
}

export function syncOutlineToFTS(db: DbType, project: any): void {
  if (!project.outline?.trim()) {
    deleteEntityFromFTS(db, 'outline', project.id)
    return
  }
  const plainOutline = stripHtml(project.outline)
  const chunks = splitChunks(plainOutline)
  db.transaction(() => {
    deleteEntityFromFTS(db, 'outline', project.id)
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      db.run(
        `INSERT INTO search_index (content, type, entity_id, name, project_id, chunk_idx, start_pos, end_pos, chapter_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tokenizeChinese(chunk.text), 'outline', project.id, project.title || '全书大纲', project.id, i, chunk.start, chunk.end, null]
      )
    }
  })
}

export function syncSynopsisToFTS(db: DbType, project: any): void {
  const synopsis = (project.synopsis || '').trim()
  if (!synopsis) {
    deleteEntityFromFTS(db, 'synopsis', project.id)
    return
  }
  const plain = stripHtml(synopsis)
  db.transaction(() => {
    deleteEntityFromFTS(db, 'synopsis', project.id)
    db.run(
      `INSERT INTO search_index (content, type, entity_id, name, project_id, chunk_idx, start_pos, end_pos, chapter_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tokenizeChinese(plain), 'synopsis', project.id, project.title || '全书梗概', project.id, 0, 0, plain.length, null]
    )
  })
}

export function syncVolumeToFTS(db: DbType, volume: any): void {
  const content = [volume.outline, volume.progress_notes].filter(Boolean).join('\n')
  const plain = stripHtml(content)
  if (!plain.trim()) {
    deleteEntityFromFTS(db, 'outline_volume', volume.id)
    return
  }
  const chunks = splitChunks(plain)
  db.transaction(() => {
    deleteEntityFromFTS(db, 'outline_volume', volume.id)
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      db.run(
        `INSERT INTO search_index (content, type, entity_id, name, project_id, chunk_idx, start_pos, end_pos, chapter_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tokenizeChinese(chunk.text), 'outline_volume', volume.id, volume.title || '卷大纲', volume.project_id, i, chunk.start, chunk.end, null]
      )
    }
  })
}

export function syncKnowledgeToFTS(db: DbType, item: any): void {
  deleteEntityFromFTS(db, 'knowledge', item.id)
  if (!item.content?.trim()) return

  const plainContent = stripHtml(item.content)
  const chunks = splitChunks(plainContent)
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    db.run(
      `INSERT INTO search_index (content, type, entity_id, name, project_id, chunk_idx, start_pos, end_pos, chapter_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tokenizeChinese(chunk.text), 'knowledge', item.id, item.name, '', i, chunk.start, chunk.end, null]
    )
  }
}

export function rebuildProjectFTSIndex(db: DbType, projectId: string): void {
  db.run('DELETE FROM search_index WHERE project_id = ?', [projectId])

  const chapters = db.queryAll('SELECT * FROM chapters WHERE project_id = ? ORDER BY sort_order ASC', [projectId])
  for (const ch of chapters) {
    syncChapterToFTS(db, ch)
  }

  const characters = db.queryAll('SELECT * FROM character_cards WHERE project_id = ? ORDER BY sort_order ASC', [projectId])
  for (const card of characters) {
    syncCharacterToFTS(db, card)
  }

  const worlds = db.queryAll('SELECT * FROM world_cards WHERE project_id = ? ORDER BY sort_order ASC', [projectId])
  for (const card of worlds) {
    syncWorldToFTS(db, card)
  }

  const project = db.queryOne('SELECT * FROM projects WHERE id = ?', [projectId])
  if (project) {
    if (project.synopsis?.trim()) {
      syncSynopsisToFTS(db, project)
    }
    const volumes = db.queryAll('SELECT * FROM outline_volumes WHERE project_id=? ORDER BY sort_order ASC', [projectId])
    for (const vol of volumes) {
      syncVolumeToFTS(db, vol)
    }
    if (!volumes.length && project.outline?.trim()) {
      syncOutlineToFTS(db, project)
    }
  }
}

export function rebuildAllFTSIndex(db: DbType): void {
  db.run("DELETE FROM search_index")

  const projects = db.queryAll('SELECT * FROM projects')
  for (const project of projects) {
    rebuildProjectFTSIndex(db, project.id)
  }

  const knowledgeItems = db.queryAll('SELECT * FROM knowledge_items')
  for (const item of knowledgeItems) {
    syncKnowledgeToFTS(db, item)
  }
}

export function deleteProjectFromFTS(db: DbType, projectId: string): void {
  db.run('DELETE FROM search_index WHERE project_id = ?', [projectId])
}
