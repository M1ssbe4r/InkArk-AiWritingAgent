import { describe, it, expect } from 'vitest'
import { parseLegacyOutlineToVolumes, mergeSynopsisIntoVolumes } from './outlineMigration'

describe('parseLegacyOutlineToVolumes', () => {
  it('空大纲生成默认卷', () => {
    const r = parseLegacyOutlineToVolumes('')
    expect(r.synopsis).toBe('')
    expect(r.volumes).toHaveLength(1)
    expect(r.volumes[0].title).toBe('')
  })

  it('解析 h1 梗概并入第一卷', () => {
    const html = '<h1>全书梗概</h1><hr/><h2>第一卷（第1-10章）</h2><p>卷概要A</p><h2>第二卷</h2><p>卷概要B</p>'
    const r = parseLegacyOutlineToVolumes(html)
    expect(r.volumes.length).toBeGreaterThanOrEqual(2)
    expect(r.volumes[0].chapter_start).toBe(1)
    expect(r.volumes[0].chapter_end).toBe(10)
    const merged = mergeSynopsisIntoVolumes(r.synopsis, r.volumes)
    expect(merged[0].outline).toContain('全书梗概')
  })

  it('提取写作进度到 progress_notes', () => {
    const html = '<h1>梗概</h1><h2>第一卷</h2><p>内容</p><h2>写作进度</h2><p>已完成3章</p>'
    const r = parseLegacyOutlineToVolumes(html)
    const progress = r.volumes.find((v) => v.progress_notes.includes('已完成3章'))
    expect(progress).toBeTruthy()
  })
})
