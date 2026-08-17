import { createHash } from 'crypto'
import { runConsistencyChecks } from './consistency'
import { rebuildProjectFTSIndex } from './fts'
import { getLogger } from '../logger/core'
import { deleteProjectVolumes, parseLegacyOutlineToVolumes, insertParsedVolumes, mergeSynopsisIntoVolumes } from './outlineMigration'

function hashContent(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

function toBase36Id(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

function manifestHash(v: string): string {
  try {
    const parsed = JSON.parse(v)
    if (parsed && typeof parsed === 'object' && parsed.h) return parsed.h
  } catch {}
  return v
}

export function commitProjectState(db: any, projectId: string, message: string): string | null {
  const fixes = runConsistencyChecks(db)
  if (fixes.length > 0) {
    getLogger().warn('version.commit', 'consistency fixes before commit', { projectId, count: fixes.length, fixes })
  }
  const project = db.queryOne('SELECT * FROM projects WHERE id=?', [projectId])
  if (!project) {
    getLogger().warn('version.commit', 'project not found', { projectId })
    return null
  }

  const chapters = db.queryAll('SELECT * FROM chapters WHERE project_id=? ORDER BY sort_order ASC', [projectId])
  const characters = db.queryAll('SELECT * FROM character_cards WHERE project_id=? ORDER BY sort_order ASC', [projectId])
  const worlds = db.queryAll('SELECT * FROM world_cards WHERE project_id=? ORDER BY sort_order ASC', [projectId])
  const volumes = db.queryAll('SELECT * FROM outline_volumes WHERE project_id=? ORDER BY sort_order ASC', [projectId])

  let commitId: string | null = null

  db.transaction(() => {
    const manifest: Record<string, string> = {}

    const titleData = JSON.stringify(project.title)
    const titleHash = hashContent(titleData)
    db.run('INSERT OR IGNORE INTO version_blobs (hash, data, size) VALUES (?, ?, ?)', [titleHash, titleData, Buffer.byteLength(titleData)])
    manifest['project_title'] = titleHash

    const outline = project.outline || ''
    const outlineHash = hashContent(outline)
    db.run('INSERT OR IGNORE INTO version_blobs (hash, data, size) VALUES (?, ?, ?)', [outlineHash, outline, Buffer.byteLength(outline)])
    manifest['outline'] = outlineHash

    for (const vol of volumes) {
      const data = JSON.stringify({
        id: vol.id,
        project_id: vol.project_id,
        sort_order: vol.sort_order,
        title: vol.title,
        outline: vol.outline,
        chapter_start: vol.chapter_start,
        chapter_end: vol.chapter_end,
        status: vol.status,
        progress_notes: vol.progress_notes,
      })
      const h = hashContent(data)
      db.run('INSERT OR IGNORE INTO version_blobs (hash, data, size) VALUES (?, ?, ?)', [h, data, Buffer.byteLength(data)])
      manifest[`volume:${vol.id}`] = JSON.stringify({ h, n: vol.title, s: vol.sort_order })
    }
    if (volumes.length === 0) {
      manifest['volumes_empty'] = '1'
    }

    for (const ch of chapters) {
      const data = JSON.stringify({ id: ch.id, project_id: ch.project_id, title: ch.title, content: ch.content, chapter_outline: ch.chapter_outline, sort_order: ch.sort_order, status: ch.status })
      const h = hashContent(data)
      db.run('INSERT OR IGNORE INTO version_blobs (hash, data, size) VALUES (?, ?, ?)', [h, data, Buffer.byteLength(data)])
      manifest[`chapter:${ch.id}`] = JSON.stringify({ h, n: ch.title, s: ch.sort_order })
    }

    for (const c of characters) {
      const data = JSON.stringify({ id: c.id, project_id: c.project_id, name: c.name, alias: c.alias, description: c.description, role: c.role, traits: c.traits, appearance: c.appearance, background: c.background, relationships: c.relationships, notes: c.notes, tags: c.tags, card_group: c.card_group, sort_order: c.sort_order, gender: c.gender, age: c.age })
      const h = hashContent(data)
      db.run('INSERT OR IGNORE INTO version_blobs (hash, data, size) VALUES (?, ?, ?)', [h, data, Buffer.byteLength(data)])
      manifest[`character:${c.id}`] = JSON.stringify({ h, n: c.name })
    }

    for (const w of worlds) {
      const data = JSON.stringify({ id: w.id, project_id: w.project_id, name: w.name, card_type: w.card_type, description: w.description, tags: w.tags, card_group: w.card_group, parent_id: w.parent_id, sort_order: w.sort_order, notes: w.notes })
      const h = hashContent(data)
      db.run('INSERT OR IGNORE INTO version_blobs (hash, data, size) VALUES (?, ?, ?)', [h, data, Buffer.byteLength(data)])
      manifest[`world:${w.id}`] = JSON.stringify({ h, n: w.name })
    }

    const lastCommit = db.queryOne('SELECT id FROM version_commits WHERE project_id=? ORDER BY created_at DESC LIMIT 1', [projectId])
    const newCommitId = toBase36Id()
    const manifestJson = JSON.stringify(manifest)
    const now = new Date()
    const localTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    db.run('INSERT INTO version_commits (id, project_id, parent_id, message, manifest, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [newCommitId, projectId, lastCommit?.id || null, message, manifestJson, localTime])

    commitId = newCommitId
  })

  return commitId
}

const toJson = (v: any) => (typeof v === 'string' ? v : JSON.stringify(v))

export function restoreProjectState(db: any, projectId: string, commitId: string): void {
  const vlog = getLogger()
  const commit = db.queryOne('SELECT * FROM version_commits WHERE id=? AND project_id=?', [commitId, projectId])
  if (!commit) {
    vlog.warn('version.restore', 'commit not found', { projectId, commitId })
    throw new Error('Commit not found')
  }

  const manifest: Record<string, string> = JSON.parse(commit.manifest)
  const manifestEntries = Object.entries(manifest)
  const hasVolumeKeys = manifestEntries.some(([k]) => k.startsWith('volume:'))
  const volumesEmpty = manifest['volumes_empty'] === '1'

  db.transaction(() => {
    const titleHash = manifest['project_title']
    if (titleHash) {
      const blob = db.queryOne('SELECT data FROM version_blobs WHERE hash=?', [titleHash])
      if (blob) {
        const title = JSON.parse(blob.data)
        db.run("UPDATE projects SET title=?, updated_at=datetime('now') WHERE id=?", [title, projectId])
      }
    }

    if (hasVolumeKeys || volumesEmpty) {
      if (!manifest['outline']) {
        vlog.warn('version.restore', 'volume manifest missing outline hash', { projectId, commitId })
      }

      const volumeIdsInManifest = manifestEntries
        .filter(([k]) => k.startsWith('volume:'))
        .map(([k]) => k.slice(7))

      const currentVolumes = db.queryAll('SELECT id FROM outline_volumes WHERE project_id=?', [projectId])
      for (const row of currentVolumes) {
        if (!volumeIdsInManifest.includes(row.id)) {
          db.run('DELETE FROM outline_volumes WHERE id=?', [row.id])
        }
      }

      for (const [key, val] of manifestEntries) {
        if (!key.startsWith('volume:')) continue
        const blob = db.queryOne('SELECT data FROM version_blobs WHERE hash=?', [manifestHash(val)])
        if (!blob) continue
        const vol = JSON.parse(blob.data)
        const outlineText = vol.outline || vol.summary || ''
        const existing = db.queryOne('SELECT id FROM outline_volumes WHERE id=?', [vol.id])
        if (existing) {
          db.run(
            `UPDATE outline_volumes SET title=?, outline=?, sort_order=?, chapter_start=?, chapter_end=?, status=?, progress_notes=?, updated_at=datetime('now') WHERE id=?`,
            [vol.title, outlineText, vol.sort_order, vol.chapter_start, vol.chapter_end, vol.status, vol.progress_notes || '', vol.id],
          )
        } else {
          db.run(
            `INSERT INTO outline_volumes (id, project_id, sort_order, title, outline, chapter_start, chapter_end, status, progress_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [vol.id, projectId, vol.sort_order, vol.title, outlineText, vol.chapter_start, vol.chapter_end, vol.status, vol.progress_notes || ''],
          )
        }
      }

      const synopsisHash = manifest['synopsis']
      if (synopsisHash) {
        const blob = db.queryOne('SELECT data FROM version_blobs WHERE hash=?', [synopsisHash])
        if (blob?.data?.trim()) {
          const rows = db.queryAll(
            'SELECT * FROM outline_volumes WHERE project_id=? ORDER BY sort_order ASC',
            [projectId],
          )
          if (rows.length > 0) {
            const vol = rows[0]
            const [merged] = mergeSynopsisIntoVolumes(blob.data, [{
              title: vol.title || '',
              outline: vol.outline || '',
              chapter_start: vol.chapter_start ?? null,
              chapter_end: vol.chapter_end ?? null,
              status: vol.status || 'planned',
              progress_notes: vol.progress_notes || '',
              sort_order: vol.sort_order ?? 0,
            }])
            db.run('UPDATE outline_volumes SET outline=? WHERE id=?', [merged.outline, vol.id])
          }
        }
      }
      db.run("UPDATE projects SET synopsis='' WHERE id=?", [projectId])
    } else {
      const outlineHash = manifest['outline']
      if (outlineHash) {
        const blob = db.queryOne('SELECT data FROM version_blobs WHERE hash=?', [outlineHash])
        if (blob) {
          const parsed = parseLegacyOutlineToVolumes(blob.data)
          db.run("UPDATE projects SET outline=?, updated_at=datetime('now') WHERE id=?", [blob.data, projectId])
          deleteProjectVolumes(db, projectId)
          insertParsedVolumes(db, projectId, parsed)
        }
      } else {
        db.run("UPDATE projects SET outline='', synopsis='', updated_at=datetime('now') WHERE id=?", [projectId])
        deleteProjectVolumes(db, projectId)
      }
    }

    const chapterIdsInManifest = manifestEntries
      .filter(([k]) => k.startsWith('chapter:'))
      .map(([k]) => k.slice(8))

    const currentChapters = db.queryAll('SELECT id FROM chapters WHERE project_id=?', [projectId])
    const currentChapterIds = currentChapters.map((c: any) => c.id)

    const toDeleteChapters = currentChapterIds.filter((id: string) => !chapterIdsInManifest.includes(id))
    for (const id of toDeleteChapters) {
      db.run('DELETE FROM chapters WHERE id=?', [id])
    }

    for (const [key, val] of manifestEntries) {
      if (!key.startsWith('chapter:')) continue
      const blob = db.queryOne('SELECT data FROM version_blobs WHERE hash=?', [manifestHash(val)])
      if (!blob) continue
      const ch = JSON.parse(blob.data)
      const chOutline = ch.chapter_outline || ch.summary || ''
      const existing = db.queryOne('SELECT id FROM chapters WHERE id=?', [ch.id])
      if (existing) {
        db.run('UPDATE chapters SET title=?, content=?, chapter_outline=?, sort_order=?, status=?, word_count=?, updated_at=datetime(\'now\') WHERE id=?',
          [ch.title, ch.content, chOutline, ch.sort_order, ch.status, ch.content.replace(/<[^>]*>/g, '').length, ch.id])
      } else {
        db.run('INSERT INTO chapters (id, project_id, title, content, chapter_outline, sort_order, status, word_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [ch.id, ch.project_id, ch.title, ch.content, chOutline, ch.sort_order, ch.status, ch.content.replace(/<[^>]*>/g, '').length])
      }
    }

    const charIdsInManifest = manifestEntries
      .filter(([k]) => k.startsWith('character:'))
      .map(([k]) => k.slice(10))

    const currentChars = db.queryAll('SELECT id FROM character_cards WHERE project_id=?', [projectId])
    const currentCharIds = currentChars.map((c: any) => c.id)

    const toDeleteChars = currentCharIds.filter((id: string) => !charIdsInManifest.includes(id))
    for (const id of toDeleteChars) {
      db.run('DELETE FROM character_cards WHERE id=?', [id])
    }

    for (const [key, val] of manifestEntries) {
      if (!key.startsWith('character:')) continue
      const blob = db.queryOne('SELECT data FROM version_blobs WHERE hash=?', [manifestHash(val)])
      if (!blob) continue
      const c = JSON.parse(blob.data)
      const existing = db.queryOne('SELECT id FROM character_cards WHERE id=?', [c.id])
      if (existing) {
        db.run('UPDATE character_cards SET name=?, alias=?, description=?, role=?, traits=?, appearance=?, background=?, relationships=?, notes=?, tags=?, card_group=?, sort_order=?, gender=?, age=?, updated_at=datetime(\'now\') WHERE id=?',
          [c.name, c.alias, c.description, c.role, toJson(c.traits), c.appearance, c.background, c.relationships, c.notes, toJson(c.tags), c.card_group, c.sort_order, c.gender || '', c.age || '', c.id])
      } else {
        db.run('INSERT INTO character_cards (id, project_id, name, alias, description, role, traits, appearance, background, relationships, notes, tags, card_group, sort_order, gender, age) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [c.id, c.project_id, c.name, c.alias, c.description, c.role, toJson(c.traits), c.appearance, c.background, c.relationships, c.notes, toJson(c.tags), c.card_group, c.sort_order, c.gender || '', c.age || ''])
      }
    }

    const worldIdsInManifest = manifestEntries
      .filter(([k]) => k.startsWith('world:'))
      .map(([k]) => k.slice(6))

    const currentWorlds = db.queryAll('SELECT id FROM world_cards WHERE project_id=?', [projectId])
    const currentWorldIds = currentWorlds.map((w: any) => w.id)

    const toDeleteWorlds = currentWorldIds.filter((id: string) => !worldIdsInManifest.includes(id))
    for (const id of toDeleteWorlds) {
      db.run('DELETE FROM world_cards WHERE id=?', [id])
    }

    for (const [key, val] of manifestEntries) {
      if (!key.startsWith('world:')) continue
      const blob = db.queryOne('SELECT data FROM version_blobs WHERE hash=?', [manifestHash(val)])
      if (!blob) continue
      const w = JSON.parse(blob.data)
      const existing = db.queryOne('SELECT id FROM world_cards WHERE id=?', [w.id])
      if (existing) {
        db.run('UPDATE world_cards SET name=?, card_type=?, description=?, tags=?, card_group=?, parent_id=?, sort_order=?, notes=?, updated_at=datetime(\'now\') WHERE id=?',
          [w.name, w.card_type, w.description, toJson(w.tags), w.card_group, w.parent_id, w.sort_order, w.notes || '', w.id])
      } else {
        db.run('INSERT INTO world_cards (id, project_id, name, card_type, description, tags, card_group, parent_id, sort_order, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [w.id, w.project_id, w.name, w.card_type, w.description, toJson(w.tags), w.card_group, w.parent_id, w.sort_order, w.notes || ''])
      }
    }
  })

  db.transaction(() => {
    rebuildProjectFTSIndex(db, projectId)
  })

  vlog.info('version.restore', 'success', { projectId, commitId, entriesRestored: manifestEntries.length })
}

export function registerVersionHandlers(ipcMain: any, db: any) {
  ipcMain.handle('db:version:commit', (_e: any, projectId: string, message: string) => {
    const commitId = commitProjectState(db, projectId, message)
    if (!commitId) throw new Error('Project not found')
    return { id: commitId, message, created_at: new Date().toISOString() }
  })

  ipcMain.handle('db:version:list', (_e: any, projectId: string) => {
    const commits = db.queryAll('SELECT id, parent_id, message, manifest, created_at FROM version_commits WHERE project_id=? ORDER BY created_at DESC', [projectId])
    return commits.map((c: any) => ({
      id: c.id,
      parent_id: c.parent_id,
      message: c.message,
      manifest: c.manifest,
      created_at: c.created_at,
    }))
  })

  ipcMain.handle('db:version:restore', (_e: any, projectId: string, commitId: string) => {
    const vlog = getLogger()
    vlog.info('version.restore', 'start', { projectId, commitId })
    const preMessage = '恢复版本 — 自动保存当前状态'
    commitProjectState(db, projectId, preMessage)
    restoreProjectState(db, projectId, commitId)
    return { success: true }
  })

  ipcMain.handle('db:version:deleteProjectCommits', (_e: any, projectId: string) => {
    db.transaction(() => {
      const commits = db.queryAll('SELECT manifest FROM version_commits WHERE project_id=?', [projectId])
      const allHashes = new Set<string>()
      for (const c of commits) {
        const manifest: Record<string, string> = JSON.parse(c.manifest)
        for (const v of Object.values(manifest)) {
          allHashes.add(manifestHash(v))
        }
      }

      db.run('DELETE FROM version_commits WHERE project_id=?', [projectId])

      for (const hash of allHashes) {
        const refCount = db.queryOne('SELECT COUNT(*) as cnt FROM version_commits WHERE manifest LIKE ?', [`%${hash}%`])
        if (!refCount || refCount.cnt === 0) {
          db.run('DELETE FROM version_blobs WHERE hash=?', [hash])
        }
      }
    })
    return { success: true }
  })

  ipcMain.handle('db:version:stats', (_e: any, projectId: string) => {
    const commits = db.queryAll('SELECT manifest FROM version_commits WHERE project_id=?', [projectId])
    const count = commits.length
    const allHashes = new Set<string>()
    for (const c of commits) {
      const manifest: Record<string, string> = JSON.parse(c.manifest)
      for (const v of Object.values(manifest)) {
        allHashes.add(manifestHash(v))
      }
    }
    let totalSize = 0
    for (const hash of allHashes) {
      const blob = db.queryOne('SELECT size FROM version_blobs WHERE hash=?', [hash])
      if (blob) totalSize += blob.size
    }
    return { count, totalSize }
  })

  ipcMain.handle('db:version:deleteCommit', (_e: any, projectId: string, commitId: string) => {
    db.transaction(() => {
      const commit = db.queryOne('SELECT manifest FROM version_commits WHERE id=? AND project_id=?', [commitId, projectId])
      if (!commit) throw new Error('Commit not found')
      const manifest: Record<string, string> = JSON.parse(commit.manifest)

      db.run('DELETE FROM version_commits WHERE id=?', [commitId])

      for (const v of Object.values(manifest)) {
        const hash = manifestHash(v)
        const refCount = db.queryOne('SELECT COUNT(*) as cnt FROM version_commits WHERE manifest LIKE ?', [`%${hash}%`])
        if (!refCount || refCount.cnt === 0) {
          db.run('DELETE FROM version_blobs WHERE hash=?', [hash])
        }
      }
    })
    return { success: true }
  })
}
