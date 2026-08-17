import { describe, it, expect } from 'vitest'
import { cn, generateId, countWords } from './utils'

describe('cn', () => {
  it('合并 class 名称', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('合并 tailwind class（处理冲突）', () => {
    expect(cn('px-4', 'px-2')).toBe('px-2')
  })

  it('处理条件 class', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible')
  })

  it('处理 undefined 和 null', () => {
    expect(cn('a', undefined, null, 'b')).toBe('a b')
  })

  it('处理空字符串', () => {
    expect(cn('', 'a', '')).toBe('a')
  })
})

describe('generateId', () => {
  it('生成唯一 ID', () => {
    const id1 = generateId()
    const id2 = generateId()
    expect(id1).not.toBe(id2)
  })

  it('ID 为字符串', () => {
    expect(typeof generateId()).toBe('string')
  })

  it('ID 不为空', () => {
    expect(generateId().length).toBeGreaterThan(0)
  })

  it('多次生成不重复', () => {
    const ids = Array.from({ length: 100 }, () => generateId())
    const unique = new Set(ids)
    expect(unique.size).toBe(100)
  })
})

describe('countWords', () => {
  it('统计空文本', () => {
    expect(countWords('')).toBe(0)
  })

  it('统计纯空格和换行', () => {
    expect(countWords('   \n  \t  ')).toBe(0)
  })

  it('统计纯英文', () => {
    expect(countWords('hello world')).toBe(2)
  })

  it('统计纯中文', () => {
    expect(countWords('你好世界')).toBe(4)
  })

  it('统计中英文混合', () => {
    expect(countWords('hello 你好 world 世界')).toBe(6)
  })

  it('处理多余空白', () => {
    expect(countWords('  hello   world  ')).toBe(2)
  })

  it('处理换行符', () => {
    expect(countWords('hello\nworld\nfoo')).toBe(3)
  })

  it('处理带标点的英文', () => {
    expect(countWords("hello, world! it's me")).toBe(4)
  })

  it('统计带 HTML 标签的内容', () => {
    expect(countWords('<p>hello world</p>')).toBe(2)
  })

  it('HTML 标签内的中文', () => {
    expect(countWords('<div>你好世界</div>')).toBe(4)
  })

  it('混合 HTML 和内容', () => {
    expect(countWords('<p>hello <b>world</b> 你好</p>')).toBe(4)
  })

  it('英文数字', () => {
    expect(countWords('test123 foo bar456')).toBe(3)
  })

  it('特殊字符不计数', () => {
    expect(countWords('!!! --- +++ ***')).toBe(0)
  })

  it('长文本性能检查', () => {
    const longText = 'word '.repeat(1000) + '你好'.repeat(1000)
    const result = countWords(longText)
    expect(result).toBe(3000)
  })
})
