import { ipcMain } from 'electron'
import {
  rebuildProjectFTSIndex,
  syncSynopsisToFTS,
  syncVolumeToFTS,
  deleteEntityFromFTS,
} from './fts'
import { toBase36Id, migrateProjectOutlineToVolumes, deleteProjectVolumes } from './outlineMigration'

// 兜底清洗: AI 偶尔会把"第N卷：xxx"或"（第N-M章）"写进 outline,这里 strip
// 掉,避免和 title / chapter_start / chapter_end 独立字段重复
function sanitizeOutline(outline: string): string {
  let s = outline
  // 去掉开头的"第N卷：xxx"或"第N卷 xxx"形式(限一行)
  s = s.replace(/^第\s*\d+\s*卷[：:\s]+[^\n]{0,80}\n?/, '')
  // 去掉首行里的章节范围后缀
  s = s.replace(/^[ \t]*[（(]\s*第\s*\d+\s*[-–—~至到]\s*\d+\s*章\s*[)）][ \t]*\n?/, '')
  return s.trimStart()
}

export type VolumeStatus = 'planned' | 'writing' | 'done' | 'paused'

export interface OutlineVolume {
  id: string
  project_id: string
  sort_order: number
  title: string
  outline: string
  chapter_start: number | null
  chapter_end: number | null
  status: VolumeStatus
  progress_notes: string
  created_at?: string
  updated_at?: string
}

const MAX_OUTLINE_LENGTH = 50_000
const MAX_SYNOPSIS_LENGTH = 2_000
const MAX_VOLUMES_PER_PROJECT = 200
const VALID_STATUSES = new Set<VolumeStatus>(['planned', 'writing', 'done', 'paused'])

type Db = ReturnType<typeof import('./db').getDatabase>

function rowToVolume(row: any): OutlineVolume {
  return {
    id: row.id,
    project_id: row.project_id,
    sort_order: row.sort_order,
    title: row.title || '',
    outline: row.outline || '',
    chapter_start: row.chapter_start ?? null,
    chapter_end: row.chapter_end ?? null,
    status: (row.status || 'planned') as VolumeStatus,
    progress_notes: row.progress_notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function listVolumes(db: Db, projectId: string): OutlineVolume[] {
  const rows = db.queryAll(
    'SELECT * FROM outline_volumes WHERE project_id=? ORDER BY sort_order ASC',
    [projectId],
  )
  return rows.map(rowToVolume)
}

function assertVolumeCount(db: Db, projectId: string, excludeId?: string): string | null {
  const rows = db.queryAll('SELECT id FROM outline_volumes WHERE project_id=?', [projectId])
  const count = excludeId ? rows.filter((r: any) => r.id !== excludeId).length : rows.length
  if (count >= MAX_VOLUMES_PER_PROJECT) return `每项目卷数不能超过 ${MAX_VOLUMES_PER_PROJECT}`
  return null
}

export function createDefaultVolume(db: Db, projectId: string): OutlineVolume {
  const existing = listVolumes(db, projectId)
  if (existing.length > 0) return existing[0]
  const vol: OutlineVolume = {
    id: toBase36Id(),
    project_id: projectId,
    sort_order: 0,
    title: '',
    outline: '',
    chapter_start: null,
    chapter_end: null,
    status: 'planned',
    progress_notes: '',
  }
  db.run(
    `INSERT INTO outline_volumes (
      id, project_id, sort_order, title, outline,
      chapter_start, chapter_end, status, progress_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [vol.id, vol.project_id, vol.sort_order, vol.title, vol.outline,
      vol.chapter_start, vol.chapter_end, vol.status, vol.progress_notes],
  )
  return vol
}

export function saveVolume(db: Db, volume: OutlineVolume): OutlineVolume | { error: string } {
  if (!volume.project_id) {
    return { error: 'project_id 必填' }
  }
  const outline = (volume.outline || '') as string
  if (outline.length > MAX_OUTLINE_LENGTH) {
    return { error: `outline 超过 ${MAX_OUTLINE_LENGTH} 字符上限` }
  }
  if (!VALID_STATUSES.has(volume.status)) {
    return { error: 'status 无效' }
  }
  if (volume.chapter_start != null && volume.chapter_end != null && volume.chapter_start > volume.chapter_end) {
    return { error: 'chapter_start 不能大于 chapter_end' }
  }

  // 兜底: AI 偶尔会把"第N卷：xxx"或章节范围后缀写进 outline, 这里 strip 掉
  // (title / chapter_start / chapter_end 是独立字段, 不应该在 outline 重复)
  const sanitized = sanitizeOutline(outline)

  const all = listVolumes(db, volume.project_id)
  const isNew = !volume.id || !all.some((v) => v.id === volume.id)
  if (isNew) {
    const countErr = assertVolumeCount(db, volume.project_id)
    if (countErr) return { error: countErr }
  }

  const id = volume.id || toBase36Id()
  const sortOrder = volume.sort_order ?? all.length
  const existing = db.queryOne('SELECT id FROM outline_volumes WHERE id=?', [id])

  if (existing) {
    db.run(
      `UPDATE outline_volumes SET
        title=?, outline=?, sort_order=?, chapter_start=?, chapter_end=?,
        status=?, progress_notes=?, updated_at=datetime('now')
      WHERE id=?`,
      [
        volume.title,
        sanitized,
        sortOrder,
        volume.chapter_start,
        volume.chapter_end,
        volume.status || 'planned',
        volume.progress_notes || '',
        id,
      ],
    )
  } else {
    db.run(
      `INSERT INTO outline_volumes (
        id, project_id, sort_order, title, outline,
        chapter_start, chapter_end, status, progress_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        volume.project_id,
        sortOrder,
        volume.title,
        sanitized,
        volume.chapter_start,
        volume.chapter_end,
        volume.status || 'planned',
        volume.progress_notes || '',
      ],
    )
  }

  const saved = db.queryOne('SELECT * FROM outline_volumes WHERE id=?', [id])
  const result = rowToVolume(saved)
  syncVolumeToFTS(db, result)
  return result
}

export function updateVolumeMeta(
  db: Db,
  patch: Partial<OutlineVolume> & { id: string },
): OutlineVolume | { error: string } {
  const existing = db.queryOne('SELECT * FROM outline_volumes WHERE id=?', [patch.id])
  if (!existing) return { error: '卷不存在' }
  const merged = rowToVolume({ ...existing, ...patch })
  return saveVolume(db, merged)
}

export function deleteVolume(db: Db, id: string): void {
  deleteEntityFromFTS(db, 'outline_volume', id)
  db.run('DELETE FROM outline_volumes WHERE id=?', [id])
}

export function reorderVolumes(db: Db, projectId: string, orderedIds: string[]): void {
  db.transaction(() => {
    orderedIds.forEach((id, index) => {
      db.run(
        "UPDATE outline_volumes SET sort_order=?, updated_at=datetime('now') WHERE id=? AND project_id=?",
        [index, id, projectId],
      )
    })
  })
}

export function updateProjectSynopsis(db: Db, projectId: string, synopsis: string): string | null {
  if (synopsis.length > MAX_SYNOPSIS_LENGTH) return `synopsis 超过 ${MAX_SYNOPSIS_LENGTH} 字符上限`
  db.run(
    "UPDATE projects SET synopsis=?, updated_at=datetime('now') WHERE id=?",
    [synopsis, projectId],
  )
  const project = db.queryOne('SELECT * FROM projects WHERE id=?', [projectId])
  if (project) syncSynopsisToFTS(db, project)
  return null
}

export function resetOutlinePlan(db: Db, projectId: string): OutlineVolume[] {
  deleteProjectVolumes(db, projectId)
  db.run("UPDATE projects SET synopsis='', updated_at=datetime('now') WHERE id=?", [projectId])
  deleteEntityFromFTS(db, 'synopsis', projectId)
  createDefaultVolume(db, projectId)
  const volumes = listVolumes(db, projectId)
  for (const vol of volumes) {
    syncVolumeToFTS(db, vol)
  }
  return volumes
}

export function registerVolumeHandlers(db: Db) {
  ipcMain.handle('db:volume:list', (_e, projectId: string) => listVolumes(db, projectId))

  ipcMain.handle('db:volume:save', (_e, volume: OutlineVolume) => {
    const result = saveVolume(db, volume)
    if ('error' in result) throw new Error(result.error)
    return result
  })

  ipcMain.handle('db:volume:updateMeta', (_e, patch: Partial<OutlineVolume> & { id: string }) => {
    const result = updateVolumeMeta(db, patch)
    if ('error' in result) throw new Error(result.error)
    return result
  })

  ipcMain.handle('db:volume:delete', (_e, id: string) => {
    deleteVolume(db, id)
    return { success: true }
  })

  ipcMain.handle('db:volume:reorder', (_e, payload: { projectId: string; orderedIds: string[] }) => {
    reorderVolumes(db, payload.projectId, payload.orderedIds)
    return { success: true }
  })

  ipcMain.handle('db:volume:forceRemigrate', (_e, projectId: string) => {
    db.run('UPDATE projects SET outline_migrated_at=NULL WHERE id=?', [projectId])
    migrateProjectOutlineToVolumes(db, projectId)
    rebuildProjectFTSIndex(db, projectId)
    return { success: true }
  })

  ipcMain.handle('db:volume:resetOutlinePlan', (_e, projectId: string) => {
    const volumes = resetOutlinePlan(db, projectId)
    return volumes
  })
}
