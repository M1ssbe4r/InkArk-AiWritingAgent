import { describe, it, expect } from 'vitest'
import { buildMigrationPrompt } from './OutlineMigrationDialog'

describe('buildMigrationPrompt', () => {
  it('把 outlineHtml 嵌入 prompt 中', () => {
    const html = '<h2>第一卷</h2><p>大纲内容</p>'
    const prompt = buildMigrationPrompt(html)
    expect(prompt).toContain(html)
  })

  it('包含 create_volume 和 write_volume 工具指引', () => {
    const prompt = buildMigrationPrompt('<h2>x</h2>')
    expect(prompt).toContain('create_volume')
    expect(prompt).toContain('write_volume')
  })

  it('明确禁止从卷数推断章节范围', () => {
    const prompt = buildMigrationPrompt('<h2>x</h2>')
    expect(prompt).toContain('从卷数推断章节数')
  })

  it('明确禁止修改 projects.outline 字段', () => {
    const prompt = buildMigrationPrompt('<h2>x</h2>')
    expect(prompt).toContain('projects.outline')
    expect(prompt).toContain('原文存档')
  })
})
