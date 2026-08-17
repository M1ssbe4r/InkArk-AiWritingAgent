import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import {
  createTestDb,
  getManifest,
  initTestSqlJs,
  insertLegacyOutlineCommit,
  insertVolumeManifestWithoutOutline,
  listVolumes,
  seedProject,
  seedProjectWithLegacyOutline,
  seedProjectWithVolumes,
  seedVolume,
  type TestDb,
} from './helpers/testDb'
import { setTokenizeOverride } from '../fts'

vi.mock('../../logger/core', () => ({
  getLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    errorObj: vi.fn(),
  }),
}))

import { commitProjectState, restoreProjectState } from '../version'

const LEGACY_OUTLINE = '<h1>全书梗概</h1><hr/><h2>第一卷</h2><p>卷A内容</p><h2>第二卷</h2><p>卷B内容</p>'

describe('volume version integration', () => {
  let db: TestDb

  beforeAll(async () => {
    await initTestSqlJs()
    setTokenizeOverride((text) => text)
  })

  beforeEach(() => {
    db = createTestDb()
  })

  it('E1: commit 写入 volume:* manifest', () => {
    const projectId = seedProjectWithVolumes(db, [
      { title: '第一卷', outline: '<p>卷一</p>' },
      { title: '第二卷', outline: '<p>卷二</p>', sort_order: 1 },
    ])
    const commitId = commitProjectState(db, projectId, 'snapshot')!
    expect(commitId).toBeTruthy()

    const manifest = getManifest(db, commitId)
    const volumeKeys = Object.keys(manifest).filter((k) => k.startsWith('volume:'))
    expect(volumeKeys).toHaveLength(2)
    expect(manifest.outline).toBeTruthy()
    expect(manifest.volumes_empty).toBeUndefined()
  })

  it('commit 无卷时写入 volumes_empty', () => {
    const projectId = seedProjectWithVolumes(db, [])
    db.run('DELETE FROM outline_volumes WHERE project_id=?', [projectId])

    const commitId = commitProjectState(db, projectId, 'empty volumes')!
    const manifest = getManifest(db, commitId)
    expect(manifest.volumes_empty).toBe('1')
    expect(Object.keys(manifest).filter((k) => k.startsWith('volume:'))).toHaveLength(0)
  })

  it('E3: restore 新 manifest 恢复卷且 projects.outline 不变', () => {
    const backupOutline = '<p>legacy backup outline</p>'
    const projectId = seedProjectWithVolumes(
      db,
      [
        { id: 'vol-a', title: '第一卷', outline: '<p>原始卷一</p>' },
        { id: 'vol-b', title: '第二卷', outline: '<p>原始卷二</p>', sort_order: 1 },
      ],
      { outline: backupOutline },
    )
    const commitId = commitProjectState(db, projectId, 'v1')!

    db.run('UPDATE outline_volumes SET outline=? WHERE id=?', ['<p>改坏了</p>', 'vol-a'])
    db.run('UPDATE outline_volumes SET title=? WHERE id=?', ['改坏标题', 'vol-b'])

    restoreProjectState(db, projectId, commitId)

    const volumes = listVolumes(db, projectId)
    expect(volumes).toHaveLength(2)
    expect(volumes[0].outline).toBe('<p>原始卷一</p>')
    expect(volumes[1].title).toBe('第二卷')

    const project = db.queryOne('SELECT outline FROM projects WHERE id=?', [projectId])
    expect(project.outline).toBe(backupOutline)
  })

  it('E4: restore 删除 manifest 外的卷', () => {
    const projectId = seedProjectWithVolumes(db, [
      { id: 'vol-keep', title: '保留卷', outline: '<p>keep</p>' },
    ])
    const commitId = commitProjectState(db, projectId, 'one volume')!

    seedVolume(db, projectId, { id: 'vol-extra', title: '多余卷', outline: '<p>extra</p>', sort_order: 1 })
    expect(listVolumes(db, projectId)).toHaveLength(2)

    restoreProjectState(db, projectId, commitId)

    const volumes = listVolumes(db, projectId)
    expect(volumes).toHaveLength(1)
    expect(volumes[0].id).toBe('vol-keep')
  })

  it('restore volumes_empty 清空所有卷', () => {
    const projectId = seedProjectWithVolumes(db, [
      { title: '第一卷', outline: '<p>一</p>' },
      { title: '第二卷', outline: '<p>二</p>', sort_order: 1 },
    ])
    db.run('DELETE FROM outline_volumes WHERE project_id=?', [projectId])
    const emptyCommitId = commitProjectState(db, projectId, 'cleared')!

    seedVolume(db, projectId, { title: '后来加的卷', outline: '<p>new</p>' })
    expect(listVolumes(db, projectId)).toHaveLength(1)

    restoreProjectState(db, projectId, emptyCommitId)
    expect(listVolumes(db, projectId)).toHaveLength(0)
  })

  it('E5: restore 旧 manifest 仅 outline 时解析重建卷', () => {
    const projectId = seedProjectWithLegacyOutline(db, '')
    seedVolume(db, projectId, { title: '旧卷', outline: '<p>将被替换</p>' })

    const legacyCommitId = insertLegacyOutlineCommit(db, projectId, LEGACY_OUTLINE, 'legacy only outline')

    restoreProjectState(db, projectId, legacyCommitId)

    const project = db.queryOne('SELECT outline FROM projects WHERE id=?', [projectId])
    expect(project.outline).toBe(LEGACY_OUTLINE)

    const volumes = listVolumes(db, projectId)
    expect(volumes.length).toBeGreaterThanOrEqual(2)
    expect(volumes.some((v) => v.outline.includes('卷A') || stripPlain(v.outline).includes('卷A'))).toBe(true)
  })

  it('E6: 新 commit → 旧 commit → 新 commit 往返', () => {
    const projectId = seedProjectWithVolumes(db, [
      { id: 'vol-x', title: '精确卷', outline: '<p>精确内容XYZ</p>' },
    ])
    const newCommitId = commitProjectState(db, projectId, 'new style')!

    const legacyCommitId = insertLegacyOutlineCommit(db, projectId, LEGACY_OUTLINE, 'legacy style')
    restoreProjectState(db, projectId, legacyCommitId)
    const afterLegacy = listVolumes(db, projectId)
    expect(afterLegacy.length).toBeGreaterThanOrEqual(2)

    restoreProjectState(db, projectId, newCommitId)
    const restored = listVolumes(db, projectId)
    expect(restored).toHaveLength(1)
    expect(restored[0].id).toBe('vol-x')
    expect(restored[0].outline).toBe('<p>精确内容XYZ</p>')
  })

  it('E7: volume manifest 缺 outline hash 时不改 projects.outline', () => {
    const backupOutline = '<p>不要动我</p>'
    const projectId = seedProject(db, { outline: backupOutline })
    const volId = seedVolume(db, projectId, { title: '卷', outline: '<p>卷内容</p>' })

    const commitId = insertVolumeManifestWithoutOutline(db, projectId, [
      { id: volId, title: '卷', outline: '<p>卷内容</p>' },
    ])

    db.run('UPDATE projects SET outline=? WHERE id=?', ['<p>当前态</p>', projectId])
    restoreProjectState(db, projectId, commitId)

    const project = db.queryOne('SELECT outline FROM projects WHERE id=?', [projectId])
    expect(project.outline).toBe('<p>当前态</p>')
    expect(listVolumes(db, projectId)[0].outline).toBe('<p>卷内容</p>')
  })

  it('E8: restore 后卷内容进入 FTS', () => {
    const projectId = seedProjectWithVolumes(db, [
      { id: 'vol-fts', title: 'FTS卷', outline: '<p>唯一关键词AlphaVolume</p>' },
    ])
    const commitId = commitProjectState(db, projectId, 'fts snapshot')!

    db.run('UPDATE outline_volumes SET outline=? WHERE id=?', ['<p>empty</p>', 'vol-fts'])
    restoreProjectState(db, projectId, commitId)

    const hits = db.queryAll(
      "SELECT * FROM search_index WHERE project_id=? AND type='outline_volume'",
      [projectId],
    )
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => String(h.content).includes('AlphaVolume'))).toBe(true)
  })
})

function stripPlain(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}
