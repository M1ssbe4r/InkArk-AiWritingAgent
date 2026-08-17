import { stripHtml } from '../../src/lib/html'
import { stripChapterRangeFromTitle } from '../../src/lib/outlineUtils'

export type VolumeStatus = 'planned' | 'writing' | 'done' | 'paused'

export interface ParsedVolume {
  title: string
  outline: string
  chapter_start: number | null
  chapter_end: number | null
  status: VolumeStatus
  progress_notes: string
  sort_order: number
}

export interface ParseLegacyOutlineResult {
  synopsis: string
  volumes: ParsedVolume[]
}

const PROGRESS_RE = /<h[1-3]>写作进度<\/h[1-3]>[\s\S]*?(?=<h[1-2]>|$)/i
const H2_SPLIT_RE = /(<h2[^>]*>[\s\S]*?)(?=<h2[^>]*>|$)/gi
const CHAPTER_RANGE_RE = /第\s*(\d+)\s*[-–—~至到]\s*(\d+)\s*章/

function parseChapterRange(html: string): { start: number; end: number } | null {
  const m = html.match(CHAPTER_RANGE_RE)
  if (!m) return null
  const start = parseInt(m[1], 10)
  const end = parseInt(m[2], 10)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null
  return { start, end }
}

function extractSynopsis(html: string): { synopsis: string; body: string } {
  const hrIdx = html.search(/<hr\s*\/?>/i)
  const h1Match = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/i)
  if (h1Match) {
    const beforeH1 = html.slice(0, h1Match.index ?? 0)
    const synopsisParts: string[] = []
    if (beforeH1.trim()) synopsisParts.push(stripHtml(beforeH1).trim())
    synopsisParts.push(stripHtml(h1Match[0]).trim())
    const afterH1 = html.slice((h1Match.index ?? 0) + h1Match[0].length)
    const bodyStart = hrIdx >= 0 && hrIdx > (h1Match.index ?? 0) ? afterH1.indexOf(html.slice(hrIdx, hrIdx + html.match(/<hr\s*\/?>/i)![0].length)) : 0
    let body = afterH1
    if (hrIdx >= 0) {
      const localHr = body.search(/<hr\s*\/?>/i)
      if (localHr >= 0) body = body.slice(localHr).replace(/<hr\s*\/?>/i, '')
    }
    return {
      synopsis: synopsisParts.filter(Boolean).join('\n').slice(0, 2000),
      body: body.trim(),
    }
  }
  if (hrIdx >= 0) {
    return {
      synopsis: stripHtml(html.slice(0, hrIdx)).trim().slice(0, 2000),
      body: html.slice(hrIdx).replace(/<hr\s*\/?>/i, '').trim(),
    }
  }
  return { synopsis: '', body: html }
}

function defaultVolume(outline: string, progressNotes = ''): ParsedVolume {
  return {
    title: '',
    outline,
    chapter_start: null,
    chapter_end: null,
    status: 'planned',
    progress_notes: progressNotes,
    sort_order: 0,
  }
}

export function parseLegacyOutlineToVolumes(html: string): ParseLegacyOutlineResult {
  const input = html || ''
  if (!input.trim()) {
    return { synopsis: '', volumes: [defaultVolume('')] }
  }

  let progressNotes = ''
  let working = input
  const progMatch = working.match(PROGRESS_RE)
  if (progMatch) {
    progressNotes = progMatch[0].replace(/<h[1-3]>写作进度<\/h[1-3]>/i, '').trim()
    working = working.replace(PROGRESS_RE, '')
  }

  const { synopsis, body } = extractSynopsis(working)
  const h2Blocks: string[] = []
  let m: RegExpExecArray | null
  const splitRe = new RegExp(H2_SPLIT_RE.source, 'gi')
  while ((m = splitRe.exec(body)) !== null) {
    const block = m[1].trim()
    if (block) h2Blocks.push(block)
  }

  if (h2Blocks.length === 0) {
    const vol = defaultVolume(body.trim() || input.trim(), progressNotes)
    return { synopsis, volumes: [vol] }
  }

  const volumes: ParsedVolume[] = h2Blocks.map((block, i) => {
    const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
    const rawTitle = titleMatch ? stripHtml(titleMatch[1]).trim() : `第${i + 1}卷`
    const title = stripChapterRangeFromTitle(rawTitle)
    const outline = titleMatch ? block.slice(titleMatch.index! + titleMatch[0].length).trim() : block
    const range = parseChapterRange(block)
    return {
      title,
      outline,
      chapter_start: range?.start ?? null,
      chapter_end: range?.end ?? null,
      status: 'planned' as VolumeStatus,
      progress_notes: i === h2Blocks.length - 1 ? progressNotes : '',
      sort_order: i,
    }
  })

  if (progressNotes && volumes.length > 0 && !volumes[volumes.length - 1].progress_notes) {
    volumes[volumes.length - 1].progress_notes = progressNotes
  }

  return { synopsis, volumes }
}

export function toBase36Id(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

type Db = ReturnType<typeof import('./db').getDatabase>

export function deleteProjectVolumes(db: Db, projectId: string): void {
  db.run('DELETE FROM outline_volumes WHERE project_id=?', [projectId])
}

export function mergeSynopsisIntoVolumes(synopsis: string, volumes: ParsedVolume[]): ParsedVolume[] {
  const syn = synopsis.trim()
  if (!syn || volumes.length === 0) return volumes
  const first = { ...volumes[0] }
  if (!first.outline.trim()) {
    first.outline = syn
  } else {
    first.outline = `<p>${syn.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>\n${first.outline}`
  }
  return [first, ...volumes.slice(1)]
}

export function insertParsedVolumes(
  db: Db,
  projectId: string,
  parsed: ParseLegacyOutlineResult,
  options?: { markMigrated?: boolean },
): void {
  const volumes = mergeSynopsisIntoVolumes(parsed.synopsis, parsed.volumes)
  for (const vol of volumes) {
    const id = toBase36Id()
    db.run(
      `INSERT INTO outline_volumes (
        id, project_id, sort_order, title, outline,
        chapter_start, chapter_end, status, progress_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        projectId,
        vol.sort_order,
        vol.title,
        vol.outline,
        vol.chapter_start,
        vol.chapter_end,
        vol.status,
        vol.progress_notes,
      ],
    )
  }
  if (options?.markMigrated !== false) {
    db.run(
      "UPDATE projects SET outline_migrated_at=datetime('now'), synopsis='', updated_at=datetime('now') WHERE id=?",
      [projectId],
    )
  } else {
    // 仍然清空旧版 synopsis(避免和新结构重复),但不动 outline_migrated_at
    db.run("UPDATE projects SET synopsis='', updated_at=datetime('now') WHERE id=?", [projectId])
  }
}

export function migrateProjectOutlineToVolumes(
  db: Db,
  projectId: string,
  options?: { markMigrated?: boolean },
): boolean {
  const project = db.queryOne('SELECT id, outline, synopsis, outline_migrated_at FROM projects WHERE id=?', [projectId])
  if (!project) return false

  const existingCount = db.queryOne(
    'SELECT COUNT(*) as cnt FROM outline_volumes WHERE project_id=?',
    [projectId],
  )
  if (project.outline_migrated_at && (existingCount?.cnt ?? 0) > 0) {
    return false
  }

  const outline = project.outline || ''
  let parsed: ParseLegacyOutlineResult
  try {
    parsed = parseLegacyOutlineToVolumes(outline)
  } catch {
    parsed = { synopsis: '', volumes: [defaultVolume(outline)] }
  }
  const standaloneSynopsis = stripHtml(project.synopsis || '').trim()
  if (standaloneSynopsis) {
    parsed = {
      ...parsed,
      synopsis: parsed.synopsis
        ? `${parsed.synopsis}\n${standaloneSynopsis}`.slice(0, 2000)
        : standaloneSynopsis.slice(0, 2000),
    }
  }

  db.transaction(() => {
    deleteProjectVolumes(db, projectId)
    insertParsedVolumes(db, projectId, parsed, { markMigrated: options?.markMigrated })
  })
  return true
}

export function restoreVolumesFromOutline(
  db: Db,
  projectId: string,
  outlineHtml: string,
  options?: { markMigrated?: boolean },
): void {
  let parsed: ParseLegacyOutlineResult
  try {
    parsed = parseLegacyOutlineToVolumes(outlineHtml)
  } catch {
    parsed = { synopsis: '', volumes: [defaultVolume(outlineHtml)] }
  }
  db.transaction(() => {
    db.run("UPDATE projects SET outline=?, updated_at=datetime('now') WHERE id=?", [outlineHtml, projectId])
    deleteProjectVolumes(db, projectId)
    insertParsedVolumes(db, projectId, parsed, { markMigrated: options?.markMigrated })
  })
}
