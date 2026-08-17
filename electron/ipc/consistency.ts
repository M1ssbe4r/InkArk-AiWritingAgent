import { mergeSynopsisIntoVolumes } from './outlineMigration'
import { rebuildProjectFTSIndex, deleteEntityFromFTS, syncVolumeToFTS } from './fts'
import { listVolumes } from './volume'
import { stripHtml } from '../../src/lib/html'

interface ConsistencyCheck {
  version: number
  name: string
  run: (db: any) => string
}

const pendingFtsRebuildProjectIds: string[] = []

const checks: ConsistencyCheck[] = [
  // 0.9.1 新增: word_count 算法换成了 "剥 HTML + 剥空白 + 剥零宽字符" (与渲染端 countChars 完全一致)
  // 用新 version 标识, 让所有用户的库在首次升级后重算一次, 后续启动跳过
  {
    version: 2,
    name: 'word_count_v2',
    run: (db: any) => {
      const chapters = db.queryAll('SELECT id, content, word_count FROM chapters')
      let fixed = 0
      for (const ch of chapters) {
        const text = (ch.content || '').replace(/<[^>]*>/g, '')
        const textLen = text.replace(/\s+/g, '').replace(/[​-‍﻿]/g, '').length
        if (ch.word_count !== textLen) {
          db.run('UPDATE chapters SET word_count=? WHERE id=?', [textLen, ch.id])
          fixed++
        }
      }
      return fixed > 0 ? `fixed word_count_v2 for ${fixed} chapters` : 'ok'
    },
  },
  // 注: 原 version 3 `outline_to_volumes` 已移除。老用户升级时,projects.outline
  // 不再由 consistency check 自动切分到 outline_volumes,而是交由前端弹窗
  // (切到项目时检测 outline 有内容 + volumes 全空 → 弹 OutlineMigrationDialog)
  // 让用户主动选 AI 整理 / 手动迁移,避免一致性检查"默默切错"的情况。
  // 旧库里的 outline_volumes 数据保留不动,version 4 (merge_synopsis_into_volumes)
  // 仍会处理已经存在的 volumes。
  {
    version: 4,
    name: 'merge_synopsis_into_volumes',
    run: (db: any) => {
      const projects = db.queryAll("SELECT id, synopsis FROM projects WHERE synopsis IS NOT NULL AND synopsis != ''")
      let merged = 0
      for (const p of projects) {
        const syn = stripHtml(p.synopsis || '').trim()
        if (!syn) {
          db.run("UPDATE projects SET synopsis='' WHERE id=?", [p.id])
          deleteEntityFromFTS(db, 'synopsis', p.id)
          continue
        }
        const volumes = listVolumes(db, p.id)
        if (volumes.length === 0) continue
        const [first] = mergeSynopsisIntoVolumes(syn, volumes.map((v) => ({
          title: v.title,
          outline: v.outline || '',
          chapter_start: v.chapter_start,
          chapter_end: v.chapter_end,
          status: v.status,
          progress_notes: v.progress_notes,
          sort_order: v.sort_order,
        })))
        const mergedOutline = first.outline
        db.run('UPDATE outline_volumes SET outline=? WHERE id=?', [mergedOutline, volumes[0].id])
        db.run("UPDATE projects SET synopsis='' WHERE id=?", [p.id])
        deleteEntityFromFTS(db, 'synopsis', p.id)
        syncVolumeToFTS(db, { ...volumes[0], outline: mergedOutline })
        merged++
      }
      return merged > 0 ? `merged synopsis into first volume for ${merged} projects` : 'ok'
    },
  },
]

export function runConsistencyChecks(db: any, forceVersion?: number): string[] {
  const results: string[] = []
  pendingFtsRebuildProjectIds.length = 0

  db.run(`
    CREATE TABLE IF NOT EXISTS consistency_checks (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      run_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `)

  for (const check of checks) {
    const alreadyRan = db.queryOne('SELECT version FROM consistency_checks WHERE version=?', [check.version])

    if (alreadyRan) {
      if (forceVersion !== check.version) {
        console.log(`[consistency] ${check.name}(v${check.version}) already done, skip`)
        continue
      }
      db.run('DELETE FROM consistency_checks WHERE version=?', [check.version])
    }

    try {
      let result = ''
      db.transaction(() => {
        result = check.run(db)
        db.run('INSERT INTO consistency_checks (version, name) VALUES (?, ?)', [check.version, check.name])
      })
      results.push(`[${check.name}] ${result}`)
    } catch (err: any) {
      results.push(`[${check.name}] failed: ${err.message || err}`)
    }
  }

  for (const projectId of pendingFtsRebuildProjectIds) {
    try {
      rebuildProjectFTSIndex(db, projectId)
    } catch (err: any) {
      results.push(`[outline_to_volumes] fts rebuild failed for ${projectId}: ${err.message || err}`)
    }
  }

  return results
}
