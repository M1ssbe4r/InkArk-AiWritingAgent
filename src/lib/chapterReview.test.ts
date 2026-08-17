import { describe, it, expect } from 'vitest'
import { buildChapterReviewSystemPrompt, buildChapterReviewUserPrompt, hashChapterContent, sanitizeReviewText, buildChapterReviewFixPrompt } from './chapterReview'

describe('chapterReview', () => {
  it('buildChapterReviewSystemPrompt 包含审稿流程与限制', () => {
    const prompt = buildChapterReviewSystemPrompt('禁止穿越', ['敏感词A'])
    expect(prompt).toContain('审稿流程')
    expect(prompt).toContain('list / read / search')
    expect(prompt).toContain('【规则与限制】')
    expect(prompt).toContain('禁止穿越')
    expect(prompt).toContain('【敏感词】')
    expect(prompt).toContain('敏感词A')
  })

  it('buildChapterReviewUserPrompt 包含章节序号与标题', () => {
    expect(buildChapterReviewUserPrompt(3)).toContain('第 3 章')
    expect(buildChapterReviewUserPrompt(3, '风起')).toContain('「风起」')
  })

  it('hashChapterContent 对相同内容返回相同哈希', () => {
    expect(hashChapterContent('abc')).toBe(hashChapterContent('abc'))
    expect(hashChapterContent('abc')).not.toBe(hashChapterContent('abd'))
  })

  it('sanitizeReviewText 移除过渡性语句', () => {
    const raw = '现在我已掌握全部所需信息，开始输出审稿意见。\n\n审稿意见 | 第 1 章\n🔴 严重'
    expect(sanitizeReviewText(raw)).toBe('审稿意见 | 第 1 章\n🔴 严重')
  })

  it('buildChapterReviewFixPrompt 要求核实问题再修改', () => {
    const prompt = buildChapterReviewFixPrompt(1, '测试意见')
    expect(prompt).toContain('确认问题是否真实存在')
    expect(prompt).toContain('确有必要修改')
    expect(prompt).toContain('不要强行改动')
    expect(prompt).not.toContain('write_chapter_content')
    expect(prompt).toContain('测试意见')
  })
})
