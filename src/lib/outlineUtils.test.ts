import { describe, it, expect } from 'vitest'
import { stripChapterRangeFromTitle } from './outlineUtils'

describe('stripChapterRangeFromTitle', () => {
  it('剥掉"（第N-M章）"形式', () => {
    expect(stripChapterRangeFromTitle('第一卷：天降神兵（第1-8章）')).toBe('第一卷：天降神兵')
  })

  it('支持全角括号', () => {
    expect(stripChapterRangeFromTitle('第一卷（第1-8章）')).toBe('第一卷')
  })

  it('支持半角括号', () => {
    expect(stripChapterRangeFromTitle('第一卷(第1-8章)')).toBe('第一卷')
  })

  it('支持多种分隔符', () => {
    expect(stripChapterRangeFromTitle('卷一（第1-8章）')).toBe('卷一')
    expect(stripChapterRangeFromTitle('卷一（第1–8章）')).toBe('卷一')
    expect(stripChapterRangeFromTitle('卷一（第1至8章）')).toBe('卷一')
    expect(stripChapterRangeFromTitle('卷一（第1到8章）')).toBe('卷一')
  })

  it('没有章节范围后缀时原样返回', () => {
    expect(stripChapterRangeFromTitle('第一卷：天降神兵')).toBe('第一卷：天降神兵')
  })

  it('空字符串', () => {
    expect(stripChapterRangeFromTitle('')).toBe('')
  })

  it('只清理章节范围,保留中间其他空格', () => {
    expect(stripChapterRangeFromTitle('第一卷  天降神兵')).toBe('第一卷 天降神兵')
  })

  it('剥掉后合并多余空格', () => {
    expect(stripChapterRangeFromTitle('第一卷：  天降神兵（第1-8章）')).toBe('第一卷： 天降神兵')
  })
})
