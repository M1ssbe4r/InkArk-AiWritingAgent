import { describe, it, expect } from 'vitest'
import { validateBackup } from './backupValidator'

function validBackup(overrides?: Record<string, unknown>) {
  return {
    version: 1,
    project: { id: 'p1', title: '测试小说', outline: '', word_count: 0 },
    chapters: [],
    ...overrides,
  }
}

describe('validateBackup', () => {
  describe('基本结构校验', () => {
    it('合法备份通过验证', () => {
      expect(validateBackup(validBackup()).valid).toBe(true)
    })

    it('null 输入被拒绝', () => {
      expect(validateBackup(null).valid).toBe(false)
    })

    it('非对象输入被拒绝', () => {
      expect(validateBackup('string').valid).toBe(false)
      expect(validateBackup(123).valid).toBe(false)
    })

    it('不支持的版本被拒绝', () => {
      expect(validateBackup(validBackup({ version: 4 })).valid).toBe(false)
    })

    it('v3 备份通过', () => {
      expect(validateBackup(validBackup({ version: 3, volumes: [] })).valid).toBe(true)
    })

    it('v1 备份通过', () => {
      expect(validateBackup(validBackup({ version: 1 })).valid).toBe(true)
    })

    it('v2 备份通过', () => {
      expect(validateBackup(validBackup({ version: 2 })).valid).toBe(true)
    })

    it('缺少 project 被拒绝', () => {
      const { project, ...rest } = validBackup()
      expect(validateBackup(rest).valid).toBe(false)
    })

    it('project 为数组被拒绝', () => {
      expect(validateBackup(validBackup({ project: [] })).valid).toBe(false)
    })

    it('缺少 chapters 被拒绝', () => {
      const { chapters, ...rest } = validBackup()
      expect(validateBackup(rest).valid).toBe(false)
    })

    it('chapters 非数组被拒绝', () => {
      expect(validateBackup(validBackup({ chapters: {} })).valid).toBe(false)
    })
  })

  describe('原型污染防护', () => {
    it('顶层 __proto__ 被拒绝', () => {
      const data = validBackup()
      Object.defineProperty(data, '__proto__', { value: {}, enumerable: true, configurable: true })
      expect(validateBackup(data).valid).toBe(false)
    })

    it('project 中 __proto__ 被拒绝', () => {
      const data = validBackup()
      Object.defineProperty(data.project, '__proto__', { value: {}, enumerable: true, configurable: true })
      expect(validateBackup(data).valid).toBe(false)
    })

    it('chapter 中 __proto__ 被拒绝', () => {
      const data = validBackup({
        chapters: [{ id: 'c1', title: '第一章', content: '内容', summary: '', status: 'draft', sort_order: 0, word_count: 0 }],
      })
      Object.defineProperty(data.chapters[0], '__proto__', { value: {}, enumerable: true, configurable: true })
      expect(validateBackup(data).valid).toBe(false)
    })

    it('characterCard 中 __proto__ 被拒绝', () => {
      const data = validBackup({
        characterCards: [{ id: 'ch1', name: '叶凡' }],
      })
      Object.defineProperty(data.characterCards[0], '__proto__', { value: {}, enumerable: true, configurable: true })
      expect(validateBackup(data).valid).toBe(false)
    })

    it('worldCard 中 __proto__ 被拒绝', () => {
      const data = validBackup({
        worldCards: [{ id: 'w1', name: '荒古禁地', card_type: 'location' }],
      })
      Object.defineProperty(data.worldCards[0], '__proto__', { value: {}, enumerable: true, configurable: true })
      expect(validateBackup(data).valid).toBe(false)
    })
  })

  describe('project 字段校验', () => {
    it('project.id 非字符串被拒绝', () => {
      expect(validateBackup(validBackup({ project: { id: 123, title: '测试' } })).valid).toBe(false)
    })

    it('project.id 缺失被拒绝', () => {
      expect(validateBackup(validBackup({ project: { title: '测试' } })).valid).toBe(false)
    })

    it('project.id 超过 100 字符被拒绝', () => {
      expect(validateBackup(validBackup({ project: { id: 'a'.repeat(101), title: '测试' } })).valid).toBe(false)
    })

    it('project.title 非字符串被拒绝', () => {
      expect(validateBackup(validBackup({ project: { id: 'p1', title: 123 } })).valid).toBe(false)
    })

    it('project.title 缺失被拒绝', () => {
      expect(validateBackup(validBackup({ project: { id: 'p1' } })).valid).toBe(false)
    })

    it('project.title 超过 1000 字符被拒绝', () => {
      expect(validateBackup(validBackup({ project: { id: 'p1', title: 'a'.repeat(1001) } })).valid).toBe(false)
    })

    it('project.outline 可选但不超过 200000 字符', () => {
      expect(validateBackup(validBackup({ project: { id: 'p1', title: '测试', outline: 'a'.repeat(200001) } })).valid).toBe(false)
    })

    it('project.outline 为 null 时通过', () => {
      expect(validateBackup(validBackup({ project: { id: 'p1', title: '测试', outline: null } })).valid).toBe(true)
    })

    it('project.word_count 为负数被拒绝', () => {
      expect(validateBackup(validBackup({ project: { id: 'p1', title: '测试', word_count: -1 } })).valid).toBe(false)
    })

    it('project.word_count 非数字被拒绝', () => {
      expect(validateBackup(validBackup({ project: { id: 'p1', title: '测试', word_count: 'abc' } })).valid).toBe(false)
    })
  })

  describe('chapters 字段校验', () => {
    it('章节数量超过 50000 被拒绝', () => {
      const chapters = Array.from({ length: 50001 }, (_, i) => ({
        id: `c${i}`, title: '章节', content: '', summary: '', status: 'draft', sort_order: i, word_count: 0,
      }))
      expect(validateBackup(validBackup({ chapters })).valid).toBe(false)
    })

    it('chapter 必须是对象', () => {
      expect(validateBackup(validBackup({ chapters: ['not an object'] })).valid).toBe(false)
    })

    it('chapter.id 非字符串被拒绝', () => {
      expect(validateBackup(validBackup({ chapters: [{ id: 123, title: '章节', content: '内容', summary: '', status: 'draft', sort_order: 0, word_count: 0 }] })).valid).toBe(false)
    })

    it('chapter.content 超过 50000000 字符被拒绝', () => {
      expect(validateBackup(validBackup({ chapters: [{ id: 'c1', title: '章节', content: 'a'.repeat(50000001), summary: '', status: 'draft', sort_order: 0, word_count: 0 }] })).valid).toBe(false)
    })

    it('chapter.sort_order 必须是数字', () => {
      expect(validateBackup(validBackup({ chapters: [{ id: 'c1', title: '章节', content: '', summary: '', status: 'draft', sort_order: 'zero', word_count: 0 }] })).valid).toBe(false)
    })

    it('chapter.word_count 为负数被拒绝', () => {
      expect(validateBackup(validBackup({ chapters: [{ id: 'c1', title: '章节', content: '', summary: '', status: 'draft', sort_order: 0, word_count: -1 }] })).valid).toBe(false)
    })
  })

  describe('characterCards 字段校验', () => {
    it('characterCards 非数组被拒绝', () => {
      expect(validateBackup(validBackup({ characterCards: 'not array' })).valid).toBe(false)
    })

    it('characterCards 超过 50000 被拒绝', () => {
      const cards = Array.from({ length: 50001 }, (_, i) => ({ id: `ch${i}`, name: '角色' }))
      expect(validateBackup(validBackup({ characterCards: cards })).valid).toBe(false)
    })

    it('characterCard.name 非字符串被拒绝', () => {
      expect(validateBackup(validBackup({ characterCards: [{ id: 'ch1', name: 123 }] })).valid).toBe(false)
    })

    it('characterCard.name 超过 1000 字符被拒绝', () => {
      expect(validateBackup(validBackup({ characterCards: [{ id: 'ch1', name: 'a'.repeat(1001) }] })).valid).toBe(false)
    })

    it('characterCard 可选字段为 null 时通过', () => {
      expect(validateBackup(validBackup({ characterCards: [{ id: 'ch1', name: '叶凡', alias: null, description: null }] })).valid).toBe(true)
    })
  })

  describe('worldCards 字段校验', () => {
    it('worldCards 非数组被拒绝', () => {
      expect(validateBackup(validBackup({ worldCards: 'not array' })).valid).toBe(false)
    })

    it('worldCard.name 非字符串被拒绝', () => {
      expect(validateBackup(validBackup({ worldCards: [{ id: 'w1', name: 123, card_type: 'location' }] })).valid).toBe(false)
    })

    it('worldCard.card_type 非字符串被拒绝', () => {
      expect(validateBackup(validBackup({ worldCards: [{ id: 'w1', name: '地点', card_type: 123 }] })).valid).toBe(false)
    })

    it('worldCard.card_type 超过 100 字符被拒绝', () => {
      expect(validateBackup(validBackup({ worldCards: [{ id: 'w1', name: '地点', card_type: 'a'.repeat(101) }] })).valid).toBe(false)
    })
  })

  describe('style_guidance 校验', () => {
    it('style_guidance 为合法字符串时通过', () => {
      expect(validateBackup(validBackup({ project: { id: 'p1', title: '测试', style_guidance: '古风文笔' } })).valid).toBe(true)
    })

    it('style_guidance 非字符串被拒绝', () => {
      expect(validateBackup(validBackup({ project: { id: 'p1', title: '测试', style_guidance: 123 } })).valid).toBe(false)
    })

    it('style_guidance 超长被拒绝', () => {
      expect(validateBackup(validBackup({ project: { id: 'p1', title: '测试', style_guidance: 'a'.repeat(50000001) } })).valid).toBe(false)
    })
  })

  describe('边界值', () => {
    it('project.id 恰好 100 字符通过', () => {
      expect(validateBackup(validBackup({ project: { id: 'a'.repeat(100), title: '测试' } })).valid).toBe(true)
    })

    it('project.title 恰好 1000 字符通过', () => {
      expect(validateBackup(validBackup({ project: { id: 'p1', title: 'a'.repeat(1000) } })).valid).toBe(true)
    })

    it('project.word_count 为 0 通过', () => {
      expect(validateBackup(validBackup({ project: { id: 'p1', title: '测试', word_count: 0 } })).valid).toBe(true)
    })

    it('chapter.sort_order 为 0 通过', () => {
      expect(validateBackup(validBackup({ chapters: [{ id: 'c1', title: '章节', content: '', summary: '', status: 'draft', sort_order: 0, word_count: 0 }] })).valid).toBe(true)
    })

    it('characterCards 为 null 时被忽略', () => {
      expect(validateBackup(validBackup({ characterCards: null })).valid).toBe(true)
    })

    it('worldCards 为 undefined 时被忽略', () => {
      expect(validateBackup(validBackup({ worldCards: undefined })).valid).toBe(true)
    })
  })
})
