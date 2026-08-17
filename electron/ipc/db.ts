import fs from 'fs'
import path from 'path'
import { app } from 'electron'

let dbPath: string
let SQL: any = null
let db: any = null

async function initSqlJs() {
  const initSqlJsModule = await import('fts5-sql-bundle')
  return await initSqlJsModule.initSqlJs()
}

export async function initDatabase() {
  SQL = await initSqlJs()
  dbPath = path.join(app.getPath('userData'), 'inkark.db')

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run('PRAGMA journal_mode=WAL')

  db.run(`
    CREATE TABLE IF NOT EXISTS api_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      context_length INTEGER DEFAULT 200,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_config_id TEXT NOT NULL,
      temperature REAL DEFAULT 1,
      top_p REAL DEFAULT 1,
      max_tokens INTEGER DEFAULT 8192,
      frequency_penalty REAL DEFAULT 0,
      presence_penalty REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (api_config_id) REFERENCES api_configs(id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      word_count INTEGER DEFAULT 0,
      outline TEXT DEFAULT '',
      style_guidance TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '未命名章节',
      content TEXT DEFAULT '',
      chapter_outline TEXT DEFAULT '',
      sort_order INTEGER NOT NULL,
      status TEXT DEFAULT 'draft',
      word_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS task_bindings (
      id TEXT PRIMARY KEY,
      task_type TEXT NOT NULL,
      chapter_id TEXT,
      project_id TEXT,
      preset_id TEXT NOT NULL,
      FOREIGN KEY (preset_id) REFERENCES api_presets(id)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      content TEXT NOT NULL,
      prompt TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (chapter_id) REFERENCES chapters(id)
    );

    CREATE TABLE IF NOT EXISTS custom_styles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      guidance TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_custom_styles_sort ON custom_styles(sort_order);

    CREATE TABLE IF NOT EXISTS sensitive_words (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL UNIQUE,
      is_builtin INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS character_cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      alias TEXT DEFAULT '',
      description TEXT DEFAULT '',
      role TEXT DEFAULT '',
      traits TEXT DEFAULT '[]',
      appearance TEXT DEFAULT '',
      background TEXT DEFAULT '',
      relationships TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      card_group TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS world_cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      card_type TEXT NOT NULL DEFAULT 'location',
      description TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      card_group TEXT DEFAULT '',
      parent_id TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
  `)

  // Migration: add thinking mode columns to api_presets
  try { db.run("ALTER TABLE api_presets ADD COLUMN thinking_enabled INTEGER DEFAULT 1") } catch {}
  try { db.run("ALTER TABLE api_presets ADD COLUMN reasoning_effort TEXT DEFAULT 'high'") } catch {}
  // Migration: add context_length to api_configs (user-defined, replaces preset model->window map)
  try { db.run("ALTER TABLE api_configs ADD COLUMN context_length INTEGER DEFAULT 200") } catch {}
  // Migration: add outline column to projects
  try { db.run("ALTER TABLE projects ADD COLUMN outline TEXT DEFAULT ''") } catch {}
  try { db.run("ALTER TABLE projects ADD COLUMN style_guidance TEXT DEFAULT ''") } catch {}
  // Migration: 不再需要 migration_dismissed_at — 弹窗判定改为纯数据状态
  // (outline 有内容 + volumes 全空),无需记录用户决策历史
  // Migration: add gender, age to character_cards
  try { db.run("ALTER TABLE character_cards ADD COLUMN gender TEXT DEFAULT ''") } catch {}
  try { db.run("ALTER TABLE character_cards ADD COLUMN age TEXT DEFAULT ''") } catch {}
  // Migration: add notes to world_cards
  try { db.run("ALTER TABLE world_cards ADD COLUMN notes TEXT DEFAULT ''") } catch {}
  // Migration: rename chapters.summary to chapter_outline
  try { db.run("ALTER TABLE chapters RENAME COLUMN summary TO chapter_outline") } catch {}
  // Migration: add style_custom_id to projects (FK to custom_styles)
  try { db.run("ALTER TABLE projects ADD COLUMN style_custom_id TEXT REFERENCES custom_styles(id) ON DELETE SET NULL") } catch {}
  // 显式建索引:SQLite 不会为 REFERENCES 列自动建索引,db:customStyle:delete 里
  // `UPDATE projects WHERE style_custom_id=?` 会全表扫描 + 持写锁阻塞所有 DB IPC
  try { db.run("CREATE INDEX IF NOT EXISTS idx_projects_style_custom_id ON projects(style_custom_id)") } catch {}

  db.run(`
    CREATE TABLE IF NOT EXISTS outline_volumes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      outline TEXT NOT NULL DEFAULT '',
      chapter_start INTEGER,
      chapter_end INTEGER,
      status TEXT NOT NULL DEFAULT 'planned',
      progress_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_outline_volumes_project ON outline_volumes(project_id, sort_order);
  `)
  // 老库升级:加 outline 列(从旧 summary 字段迁移,一次性)
  // 注意:不再双写 summary,开发阶段不需要兼容
  try { db.run("ALTER TABLE outline_volumes ADD COLUMN outline TEXT NOT NULL DEFAULT ''") } catch {}
  try { db.run("ALTER TABLE projects ADD COLUMN synopsis TEXT NOT NULL DEFAULT ''") } catch {}
  try { db.run("ALTER TABLE projects ADD COLUMN outline_migrated_at TEXT") } catch {}
  try { db.run("ALTER TABLE projects ADD COLUMN writing_restrictions TEXT DEFAULT ''") } catch {}

  // Version management tables
  db.run(`
    CREATE TABLE IF NOT EXISTS version_blobs (
      hash TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      size INTEGER NOT NULL
    );
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS version_commits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      message TEXT NOT NULL DEFAULT '',
      manifest TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
  `)

  // Knowledge base tables
  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'other',
      content TEXT DEFAULT '',
      file_name TEXT DEFAULT '',
      file_type TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      chunk_count INTEGER DEFAULT 0,
      item_type TEXT DEFAULT 'embedding',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_knowledge (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      knowledge_item_id TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(project_id, knowledge_item_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Migration: add item_type to knowledge_items (for existing DBs)
  try { db.run("ALTER TABLE knowledge_items ADD COLUMN item_type TEXT DEFAULT 'embedding'") } catch {}

  // Migration: merge vector_index_status columns into knowledge_items
  try { db.run("ALTER TABLE knowledge_items ADD COLUMN content_hash TEXT DEFAULT NULL") } catch {}
  try { db.run("ALTER TABLE knowledge_items ADD COLUMN embedding_model TEXT DEFAULT ''") } catch {}
  try { db.run("ALTER TABLE knowledge_items ADD COLUMN indexed_at TEXT DEFAULT NULL") } catch {}
  try {
    const migrated = db.queryOne("SELECT value FROM settings WHERE key = 'vector_status_migrated'")
    if (!migrated) {
      const rows = db.queryAll('SELECT knowledge_item_id, content_hash, chunk_count, embedding_model, indexed_at FROM vector_index_status')
      for (const row of rows) {
        db.run(
          'UPDATE knowledge_items SET content_hash = ?, chunk_count = ?, embedding_model = ?, indexed_at = ? WHERE id = ?',
          [row.content_hash, row.chunk_count, row.embedding_model, row.indexed_at, row.knowledge_item_id]
        )
      }
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('vector_status_migrated', '1')")
      try { db.run('DROP TABLE IF EXISTS vector_index_status') } catch {}
    }
  } catch {}

  // Drop old snapshot system
  try { db.run('DROP TABLE IF EXISTS snapshots') } catch {}

  saveDatabase()
}

export function initFTSIndex(): boolean {
  const needsRebuild = queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name='search_index'") === null
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
  saveDatabase()
  return needsRebuild
}

let _inTransaction = 0
let _dirty = false
let _saveScheduled = false
let _saving = false
/**
 * 自动落盘暂停计数. > 0 时 scheduleSave 立即 return, db.run/transaction 末尾不会排
 * 自动 save. 出口必须 resumeAutoSave + flushDatabase 兜底, 否则会丢改动.
 *
 * 设计场景: 大批量派生数据重建 (例如导入 950 章时的 FTS 后台重建), 期间所有写入
 * 走 in-memory, 全部完成后一次性 export+fsync. 中途崩溃 → search_index 留空,
 * 不影响 chapters 主表.
 */
let _autoSaveSuspended = 0

/**
 * 原子写: 先写到 dbPath + '.tmp', fsync 落盘, 再 rename 覆盖 dbPath.
 * 这样断电/OS 强杀/crash 不会留半截文件, 旧 dbPath 始终是上一次完整成功的状态.
 */
function _doSave() {
  if (!db || !dbPath) return
  if (_saving) return
  _saving = true
  try {
    const data = db.export()
    const buffer = Buffer.from(data)
    const tmpPath = dbPath + '.tmp'
    const fd = fs.openSync(tmpPath, 'w')
    try {
      fs.writeSync(fd, buffer, 0, buffer.length, 0)
      // fsync: 强制数据落盘, 避免 page cache 在 crash 时丢数据
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    // rename 在同目录下是原子的 (POSIX/NTFS 都保证)
    fs.renameSync(tmpPath, dbPath)
    // 写盘成功: 清掉脏标志, finally 块就不会无限自旋.
    // 失败时 _dirty 保留为 true, finally 块会再 schedule 一次重试.
    _dirty = false
  } catch (e) {
    console.error('[db] _doSave failed:', e)
  } finally {
    _saving = false
    // 写盘过程中可能又有新的脏数据 (_dirty 被设回 true),
    // 重 schedule 一次确保后续变更也能落盘
    if (_dirty && _inTransaction === 0) scheduleSave()
  }
}

function scheduleSave() {
  if (_autoSaveSuspended > 0) return
  if (_saveScheduled) return
  if (_saving) return  // 正在写, _doSave 完成后会 re-schedule
  _saveScheduled = true
  setImmediate(() => {
    _saveScheduled = false
    if (_dirty && _inTransaction === 0) _doSave()
  })
}

function saveDatabase() {
  if (!db || !dbPath) return
  if (_inTransaction > 0) return
  _dirty = true
  scheduleSave()
}

/**
 * 同步落盘: 用于 app 退出前, 确保最后几次 SQL 写入一定持久化.
 * 直接同步执行原子写, 不依赖 setImmediate 调度.
 */
function flushDatabase() {
  if (!db || !dbPath) return
  if (_inTransaction > 0) return
  if (!_dirty) return
  // _doSave 是同步原子写, 直接调
  _doSave()
}

function queryAll(sql: string, params?: any[]): any[] {
  const stmt = db.prepare(sql)
  if (params) stmt.bind(params)
  const results: any[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject())
  }
  stmt.free()
  return results
}

function queryOne(sql: string, params?: any[]): any | null {
  const results = queryAll(sql, params)
  return results.length > 0 ? results[0] : null
}

function run(sql: string, params?: any[]) {
  if (params) {
    db.run(sql, params)
  } else {
    db.run(sql)
  }
  if (_inTransaction === 0) {
    _dirty = true
    scheduleSave()
  }
}

function transaction(fn: () => void) {
  _inTransaction++
  // 嵌套事务降级为 SAVEPOINT, 避免 SQLite 抛
  // "cannot start a transaction within a transaction".
  const isNested = _inTransaction > 1
  const spName = isNested ? `sp_${_inTransaction - 1}` : null
  if (isNested) {
    db.run(`SAVEPOINT ${spName}`)
  } else {
    db.run('BEGIN')
  }
  try {
    fn()
    if (isNested) {
      db.run(`RELEASE SAVEPOINT ${spName}`)
    } else {
      db.run('COMMIT')
      _dirty = true
      scheduleSave()
    }
  } catch (e) {
    try {
      if (isNested) {
        db.run(`ROLLBACK TO SAVEPOINT ${spName}`)
        db.run(`RELEASE SAVEPOINT ${spName}`)
      } else {
        db.run('ROLLBACK')
      }
    } catch {}
    _inTransaction--
    throw e
  }
  _inTransaction--
}

/**
 * 暂停自动落盘. suspend 期间所有 db.run / transaction.commit 都不会排自动 save,
 * 数据累积在 in-memory, 期间崩溃会丢未落盘改动.
 *
 * 必须配对 resumeAutoSave + flushDatabase:
 *   suspendAutoSave()
 *   try { ... 大量 db.run ... } finally {
 *     resumeAutoSave()
 *     flushDatabase()  // 同步落盘, 确保改动持久化
 *   }
 */
export function suspendAutoSave(): void {
  _autoSaveSuspended++
}

export function resumeAutoSave(): void {
  if (_autoSaveSuspended > 0) _autoSaveSuspended--
}

export function getDatabase() {
  return {
    queryAll,
    queryOne,
    run,
    transaction,
    flushDatabase,
  }
}
