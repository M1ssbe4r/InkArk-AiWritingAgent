import { describe, it, expect } from 'vitest'
import { computeDiff } from './diffUtils'

describe('computeDiff', () => {
  function labels(segments: ReturnType<typeof computeDiff>) {
    return segments.map((s) => `${s.type}:${s.text}`)
  }

  it('identical paragraphs produce all eq', () => {
    const r = computeDiff('<p>你好。世界。</p>', '<p>你好。世界。</p>')
    expect(labels(r)).toEqual(['eq:你好。', 'eq:世界。'])
  })

  it('one paragraph deleted', () => {
    const r = computeDiff('<p>A</p><p>B</p>', '<p>A</p>')
    expect(labels(r)[0]).toBe('eq:A')
    expect(r.some((s) => s.type === 'del' && s.text === 'B')).toBe(true)
  })

  it('one paragraph inserted', () => {
    const r = computeDiff('<p>A</p>', '<p>A</p><p>B</p>')
    expect(r.some((s) => s.type === 'eq' && s.text === 'A')).toBe(true)
    expect(r.some((s) => s.type === 'ins' && s.text === 'B')).toBe(true)
  })

  it('paragraph modified with sentence-level diff', () => {
    const r = computeDiff(
      '<p>张三走进房间。他看到桌上放着一封信。</p>',
      '<p>张三走进房间。他瞥见桌上搁着一封泛黄的信笺。</p>',
    )
    const l = labels(r)
    expect(l).toContain('eq:张三走进房间。')
    expect(l.some((s) => s.startsWith('del:') && s.includes('他看'))).toBe(true)
    expect(l.some((s) => s.startsWith('ins:') && s.includes('他瞥'))).toBe(true)
  })

  it('one paragraph split into multiple', () => {
    const r = computeDiff(
      '<p>第一句。第二句。第三句。</p>',
      '<p>第一句。</p><p>第二句。第三句。</p>',
    )
    const hasParaBreak = r.some((s) => s.type === 'para_break')
    expect(hasParaBreak).toBe(true)
    const eqCount = r.filter((s) => s.type === 'eq').length
    expect(eqCount).toBeGreaterThan(0)
  })

  it('empty original treats all as insert', () => {
    const r = computeDiff('', '<p>新内容。继续写。</p>')
    expect(r.every((s) => s.type === 'ins' || s.type === 'para_break')).toBe(true)
    const texts = r.filter((s) => s.type !== 'para_break').map((s) => s.text)
    expect(texts.some((t) => t.includes('新内容'))).toBe(true)
  })

  it('empty modified treats all as delete', () => {
    const r = computeDiff('<p>旧内容。全部删除。</p>', '')
    expect(r.every((s) => s.type === 'del' || s.type === 'para_break')).toBe(true)
  })

  it('both empty returns empty', () => {
    const r = computeDiff('', '')
    expect(r).toEqual([])
  })

  it('handles br tags as line breaks within paragraphs', () => {
    const r = computeDiff(
      '<p>行一。<br>行二。</p>',
      '<p>行一。<br>行三。</p>',
    )
    const hasDel = r.some((s) => s.type === 'del' && s.text.includes('行二'))
    const hasIns = r.some((s) => s.type === 'ins' && s.text.includes('行三'))
    expect(hasDel).toBe(true)
    expect(hasIns).toBe(true)
  })

  it('handles Chinese punctuation correctly', () => {
    const r = computeDiff(
      '<p>他说："你好。"她笑了。阳光很好。</p>',
      '<p>他说："你好。"她微微笑了。阳光很好。</p>',
    )
    const l = labels(r)
    expect(l.some((s) => s.startsWith('eq:') && s.includes('阳光很好'))).toBe(true)
    expect(l.some((s) => s.startsWith('del:') && s.includes('她笑了'))).toBe(true)
    expect(l.some((s) => s.startsWith('ins:') && s.includes('她微微笑了'))).toBe(true)
  })

  it('trailing quote not split to separate line', () => {
    const r = computeDiff(
      '<p>他说："你好。"</p>',
      '<p>他说："你好吗？"</p>',
    )
    expect(r.every((s) => !(s.text === '"' || s.text === '」' || s.text === '』'))).toBe(true)
    const hasDelQuote = r.some((s) => s.type === 'del' && s.text.includes('你好。"'))
    const hasInsQuote = r.some((s) => s.type === 'ins' && s.text.includes('你好吗？"'))
    expect(hasDelQuote).toBe(true)
    expect(hasInsQuote).toBe(true)
  })

  it('consecutive punctuation not split', () => {
    const r = computeDiff(
      '<p>怎么会这样？！不可思议......</p>',
      '<p>怎么会这样？！不可思议。</p>',
    )
    expect(r.some((s) => s.text.includes('？！'))).toBe(true)
    expect(r.some((s) => s.text.includes('......'))).toBe(true)
    expect(r.every((s) => s.text !== '！' && s.text !== '？')).toBe(true)
  })

  it('random special punctuation not split to own line', () => {
    const r = computeDiff(
      '<p>你好《》～～～【】test</p>',
      '<p>你好《》～test</p>',
    )
    expect(r.every((s) => !['《', '》', '【', '】', '～'].includes(s.text))).toBe(true)
  })

  it('TipTap adjacent p tags split into two paragraphs', () => {
    const r = computeDiff('<p>a</p><p>b</p>', '<p>a</p><p>c</p>')
    expect(r.some((s) => s.type === 'eq' && s.text === 'a')).toBe(true)
    expect(r.some((s) => s.type === 'del' && s.text === 'b')).toBe(true)
    expect(r.some((s) => s.type === 'ins' && s.text === 'c')).toBe(true)
  })
})
