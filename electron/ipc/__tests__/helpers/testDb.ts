import { createHash } from 'crypto'
import { createFTSTable } from '../../fts'

let SQL: any = null
let idCounter = 0

export interface TestDb {
  queryAll(sql: string, params?: any[]): any[]
  queryOne(sql: string, params?: any[]): any | null
  run(sql: string, params?: any[]): void
  transaction(fn: () => void): void
}

export async function initTestSqlJs(): Promise<void> {
  if (SQL) return
  const mod = await import('fts5-sql-bundle')
  SQL = await mod.initSqlJs()
}

function wrapDb(raw: any): TestDb {
  let inTransaction = 0

  function queryAll(sql: string, params?: any[]): any[] {
    const stmt = raw.prepare(sql)
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
    if (params) raw.run(sql, params)
    else raw.run(sql)
  }

  function transaction(fn: () => void) {
    inTransaction++
    const isNested = inTransaction > 1
    const spName = isNested ? `sp_${inTransaction - 1}` : null
    if (isNested) raw.run(`SAVEPOINT ${spName}`)
    else raw.run('BEGIN')
    try {
      fn()
      if (isNested) raw.run(`RELEASE SAVEPOINT ${spName}`)
      else raw.run('COMMIT')
    } catch (e) {
      try {
        if (isNested) {
          raw.run(`ROLLBACK TO SAVEPOINT ${spName}`)
          raw.run(`RELEASE SAVEPOINT ${spName}`)
        } else {
          raw.run('ROLLBACK')
        }
      } catch {}
      inTransaction--
      throw e
    }
    inTransaction--
  }

  return { queryAll, queryOne, run, transaction }
}

function nextId(prefix: string): string {
  idCounter++
  return `${prefix}-${idCounter}`
}

function initSchema(db: TestDb): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      word_count INTEGER DEFAULT 0,
      outline TEXT DEFAULT '',
      synopsis TEXT NOT NULL DEFAULT '',
      outline_migrated_at TEXT,
      style_guidance TEXT DEFAULT '',
      writing_restrictions TEXT DEFAULT ''
    );

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
      gender TEXT DEFAULT '',
      age TEXT DEFAULT '',
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
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS version_blobs (
      hash TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      size INTEGER NOT NULL
    );

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
  createFTSTable(db as any)
}

export function createTestDb(): TestDb {
  if (!SQL) throw new Error('call initTestSqlJs() first')
  idCounter = 0
  const raw = new SQL.Database()
  const db = wrapDb(raw)
  initSchema(db)
  return db
}

export interface SeedVolumeInput {
  id?: string
  title?: string
  outline?: string
  sort_order?: number
  chapter_start?: number | null
  chapter_end?: number | null
  status?: string
  progress_notes?: string
}

export function seedProject(
  db: TestDb,
  opts?: { id?: string; title?: string; outline?: string; synopsis?: string },
): string {
  const id = opts?.id ?? nextId('proj')
  db.run(
    'INSERT INTO projects (id, title, outline, synopsis) VALUES (?, ?, ?, ?)',
    [id, opts?.title ?? '测试书目', opts?.outline ?? '', opts?.synopsis ?? ''],
  )
  return id
}

export function seedVolume(db: TestDb, projectId: string, vol: SeedVolumeInput = {}): string {
  const id = vol.id ?? nextId('vol')
  db.run(
    `INSERT INTO outline_volumes (id, project_id, sort_order, title, outline, chapter_start, chapter_end, status, progress_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      projectId,
      vol.sort_order ?? 0,
      vol.title ?? '',
      vol.outline ?? '',
      vol.chapter_start ?? null,
      vol.chapter_end ?? null,
      vol.status ?? 'planned',
      vol.progress_notes ?? '',
    ],
  )
  return id
}

export function seedProjectWithLegacyOutline(db: TestDb, outlineHtml: string): string {
  return seedProject(db, { outline: outlineHtml })
}

export function seedProjectWithVolumes(
  db: TestDb,
  volumes: SeedVolumeInput[],
  opts?: { outline?: string },
): string {
  const projectId = seedProject(db, { outline: opts?.outline ?? '' })
  volumes.forEach((v, i) => {
    seedVolume(db, projectId, { ...v, sort_order: v.sort_order ?? i })
  })
  return projectId
}

export function getManifest(db: TestDb, commitId: string): Record<string, string> {
  const row = db.queryOne('SELECT manifest FROM version_commits WHERE id=?', [commitId])
  if (!row) throw new Error(`commit not found: ${commitId}`)
  return JSON.parse(row.manifest)
}

export function listVolumes(db: TestDb, projectId: string) {
  return db.queryAll(
    'SELECT * FROM outline_volumes WHERE project_id=? ORDER BY sort_order ASC',
    [projectId],
  )
}

function hashContent(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function insertLegacyOutlineCommit(
  db: TestDb,
  projectId: string,
  outlineHtml: string,
  message: string,
): string {
  const project = db.queryOne('SELECT * FROM projects WHERE id=?', [projectId])
  if (!project) throw new Error('project not found')

  let commitId = ''
  db.transaction(() => {
    const manifest: Record<string, string> = {}
    const titleData = JSON.stringify(project.title)
    const titleHash = hashContent(titleData)
    db.run('INSERT OR IGNORE INTO version_blobs (hash, data, size) VALUES (?, ?, ?)', [titleHash, titleData, Buffer.byteLength(titleData)])
    manifest['project_title'] = titleHash

    const outlineHash = hashContent(outlineHtml)
    db.run('INSERT OR IGNORE INTO version_blobs (hash, data, size) VALUES (?, ?, ?)', [outlineHash, outlineHtml, Buffer.byteLength(outlineHtml)])
    manifest['outline'] = outlineHash

    commitId = `legacy-${Date.now().toString(36)}`
    db.run(
      'INSERT INTO version_commits (id, project_id, parent_id, message, manifest, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))',
      [commitId, projectId, null, message, JSON.stringify(manifest)],
    )
  })
  return commitId
}

export function insertVolumeManifestWithoutOutline(
  db: TestDb,
  projectId: string,
  volumes: SeedVolumeInput[],
): string {
  const project = db.queryOne('SELECT * FROM projects WHERE id=?', [projectId])
  if (!project) throw new Error('project not found')

  let commitId = ''
  db.transaction(() => {
    const manifest: Record<string, string> = {}
    const titleData = JSON.stringify(project.title)
    const titleHash = hashContent(titleData)
    db.run('INSERT OR IGNORE INTO version_blobs (hash, data, size) VALUES (?, ?, ?)', [titleHash, titleData, Buffer.byteLength(titleData)])
    manifest['project_title'] = titleHash

    for (let i = 0; i < volumes.length; i++) {
      const v = volumes[i]
      const volId = v.id ?? nextId('vol')
      const data = JSON.stringify({
        id: volId,
        project_id: projectId,
        sort_order: v.sort_order ?? i,
        title: v.title ?? '',
        outline: v.outline ?? '',
        chapter_start: v.chapter_start ?? null,
        chapter_end: v.chapter_end ?? null,
        status: v.status ?? 'planned',
        progress_notes: v.progress_notes ?? '',
      })
      const h = hashContent(data)
      db.run('INSERT OR IGNORE INTO version_blobs (hash, data, size) VALUES (?, ?, ?)', [h, data, Buffer.byteLength(data)])
      manifest[`volume:${volId}`] = JSON.stringify({ h, n: v.title ?? '', s: v.sort_order ?? i })
    }

    commitId = `vol-no-outline-${Date.now().toString(36)}`
    db.run(
      'INSERT INTO version_commits (id, project_id, parent_id, message, manifest, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))',
      [commitId, projectId, null, 'volume manifest without outline hash', JSON.stringify(manifest)],
    )
  })
  return commitId
}
