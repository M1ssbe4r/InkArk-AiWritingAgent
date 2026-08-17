import { describe, it, expect } from 'vitest'
import {
  splitChapters,
  buildChapters,
  buildUserPattern,
  escapeHtml,
  textToHtml,
  buildBackupFromChapters,
  stripChapterPrefix,
} from '../../electron/ipc/importSplit'

describe('escapeHtml', () => {
  it('escapes basic HTML chars', () => {
    expect(escapeHtml('<div class="x">a & b</div>')).toBe('&lt;div class=&quot;x&quot;&gt;a &amp; b&lt;/div&gt;')
  })

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('escapes single quote', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s')
  })
})

describe('textToHtml', () => {
  it('returns empty string for empty input', () => {
    expect(textToHtml('')).toBe('')
  })

  it('wraps each block in <p>', () => {
    expect(textToHtml('a\n\nb')).toBe('<p>a</p><p>b</p>')
  })

  it('converts single newlines to <br/>', () => {
    expect(textToHtml('line1\nline2')).toBe('<p>line1<br/>line2</p>')
  })

  it('escapes HTML inside content', () => {
    const out = textToHtml('<script>alert(1)</script>')
    expect(out).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(out).not.toContain('<script>')
  })

  it('preserves 全角空格 首行缩进 in first paragraph', () => {
    const out = textToHtml('　　如果从太空里俯瞰东林。')
    expect(out).toBe('<p>　　如果从太空里俯瞰东林。</p>')
  })

  it('preserves 两半角空格 首行缩进 in first paragraph', () => {
    const out = textToHtml('  段首两个半角空格缩进。')
    expect(out).toBe('<p>  段首两个半角空格缩进。</p>')
  })

  it('strips trailing whitespace per paragraph but keeps leading indent', () => {
    const out = textToHtml('　　段首缩进  \n\n  下一段首尾空白  ')
    // 段首全角/半角缩进都保留, 段尾/段间空白被清除
    expect(out).toBe('<p>　　段首缩进</p><p>  下一段首尾空白</p>')
  })
})

describe('splitChapters - 首行缩进保留', () => {
  it('auto 模式切章后保留每段开头的全角缩进', () => {
    const text = [
      '第一章 起点',
      '　　段一首行缩进。如果从太空里俯瞰东林，',
      '这是一颗美丽的。',
      '',
      '　　段二首行缩进。然而对于东林区的居民和孤儿们来说，',
      '光荣历史上的青色草皮。',
      '',
      '第二章 发展',
      '　　段三首行缩进。从行政规划来说，',
      '东林是二级行政天区。',
    ].join('\n')

    const result = splitChapters(text, { mode: 'auto' }, 'fb')
    expect(result.chapters.length).toBe(2)
    // 第一段正文必须保留全角缩进
    expect(result.chapters[0].content).toMatch(/^　　段一首行缩进/)
    expect(result.chapters[0].content).toContain('　　段二首行缩进')
    expect(result.chapters[1].content).toMatch(/^　　段三首行缩进/)
    // 拼成 HTML 后首段也保留
    const html = textToHtml(result.chapters[0].content)
    expect(html).toContain('<p>　　段一首行缩进')
  })

  it('whole 模式兜底也保留首行缩进', () => {
    const text = '　　如果从太空里俯瞰东林，这是一颗美丽的。\n　　段二首行缩进。'
    const result = splitChapters(text, { mode: 'whole' }, 'fb')
    expect(result.chapters[0].content).toMatch(/^　　如果从太空里俯瞰东林/)
  })

  it('blankline 模式保留每段开头缩进', () => {
    const text = [
      '　　段一首行缩进。',
      '',
      '',
      '　　段二首行缩进。',
    ].join('\n')
    const result = splitChapters(text, { mode: 'blankline' }, 'fb')
    expect(result.chapters.length).toBeGreaterThanOrEqual(1)
    expect(result.chapters[0].content).toMatch(/^　　段一首行缩进/)
  })
})

describe('buildUserPattern', () => {
  it('builds anchor regex with prefix whitespace tolerance', () => {
    const re = buildUserPattern('Chapter \\d+')
    expect(re).toBeInstanceOf(RegExp)
    expect(re!.test('Chapter 7 begins')).toBe(true)
    expect(re!.test('this is Chapter 7 begins')).toBe(false)
  })

  it('converts * glob into .* (通配任意字符)', () => {
    const re = buildUserPattern('第*章')
    expect(re).toBeInstanceOf(RegExp)
    expect(re!.test('第一章 起点')).toBe(true)
    expect(re!.test('第一百二十三章 决战')).toBe(true)
    expect(re!.test('第 1 章 起点')).toBe(true)
    expect(re!.test('第一节 起点')).toBe(false)
  })

  it('returns null for empty pattern', () => {
    expect(buildUserPattern('')).toBeNull()
  })
})

describe('splitChapters - 中文章节', () => {
  it('识别"第X章"模式', () => {
    const text = [
      '第一章 开始',
      '故事开始了。',
      '很长的内容。'.repeat(20),
      '',
      '第二章 发展',
      '故事发展了。',
      '更多内容。'.repeat(20),
      '',
      '第三章 高潮',
      '故事高潮了。',
      '大量内容。'.repeat(20),
    ].join('\n')

    const result = splitChapters(text, { mode: 'auto' }, '未命名')
    expect(result.matchedRule).toContain('中文章节')
    expect(result.chapters.length).toBe(3)
    expect(result.chapters[0].title).toBe('第一章 开始')
    expect(result.chapters[1].title).toBe('第二章 发展')
    expect(result.chapters[2].title).toBe('第三章 高潮')
    expect(result.chapters[0].content).toContain('故事开始了')
  })

  it('同一行"第1章"和"第一章"不重复匹配', () => {
    const text = [
      '第一章 钟楼街的游行',
      '如果从太空里俯瞰东林。'.repeat(20),
      '',
      '第二章 黑衣少年',
      '黑衣少年内容。'.repeat(20),
    ].join('\n')
    const result = splitChapters(text, { mode: 'auto' }, 'fb')
    expect(result.chapters.length).toBe(2)
    expect(result.chapters[0].title).toBe('第一章 钟楼街的游行')
    expect(result.chapters[1].title).toBe('第二章 黑衣少年')
  })

  it('ASCII 数字章节"第1章"被识别', () => {
    const text = [
      '第1章 起点',
      '内容'.repeat(20),
      '',
      '第2章 发展',
      '内容'.repeat(20),
    ].join('\n')
    const result = splitChapters(text, { mode: 'auto' }, 'fb')
    expect(result.chapters.length).toBe(2)
    expect(result.chapters[0].title).toBe('第1章 起点')
    expect(result.chapters[1].title).toBe('第2章 发展')
  })

  it('《间客》场景:同时有卷和章,按章裁切,preamble 丢弃', () => {
    const text = [
      '《间客》',
      '795 字前言内容'.repeat(40),
      '',
      '第一卷 东林皆石',
      '第一卷简短内容。',
      '',
      '第一章 钟楼街的游行',
      '钟楼街内容。'.repeat(100),
      '',
      '第二章 一百个黑衣少年的背后',
      '黑衣少年内容。'.repeat(80),
      '',
      '第三章 他比烟花寂寞',
      '烟花寂寞内容。'.repeat(70),
    ].join('\n')

    const result = splitChapters(text, { mode: 'auto' }, '间客')
    expect(result.matchedRule).toContain('第X章')
    expect(result.chapters.length).toBe(3)
    expect(result.chapters[0].title).toBe('第一章 钟楼街的游行')
    expect(result.chapters[1].title).toBe('第二章 一百个黑衣少年的背后')
    expect(result.chapters[2].title).toBe('第三章 他比烟花寂寞')
    expect(result.chapters[0].content).toContain('钟楼街内容')
    expect(result.chapters[0].content).not.toContain('前言内容')
    expect(result.chapters[0].content).not.toContain('第一卷简短内容')
  })

  it('识别中文数字章节(第二十章)', () => {
    const text = [
      '第十章 过渡',
      '内容'.repeat(10),
      '',
      '第二十章 决战',
      '内容'.repeat(10),
    ].join('\n')
    const result = splitChapters(text, { mode: 'auto' }, '兜底')
    expect(result.chapters.length).toBe(2)
    expect(result.chapters[1].title).toBe('第二十章 决战')
  })

  it('识别卷/节/篇/话/幕', () => {
    const text = [
      '第一卷 序幕',
      '内容'.repeat(10),
      '',
      '第二节 启程',
      '内容'.repeat(10),
      '',
      '第三话 冲突',
      '内容'.repeat(10),
    ].join('\n')
    const result = splitChapters(text, { mode: 'auto' }, '兜底')
    expect(result.chapters.length).toBe(3)
    expect(result.chapters[0].title).toBe('第一卷 序幕')
    expect(result.chapters[1].title).toBe('第二节 启程')
    expect(result.chapters[2].title).toBe('第三话 冲突')
  })
})

describe('splitChapters - 英文 Chapter', () => {
  it('识别 Chapter 1/2/3', () => {
    const text = [
      'Chapter 1: The Beginning',
      'Once upon a time.',
      'More content here.'.repeat(10),
      '',
      'Chapter 2: The Middle',
      'The middle part of the story.',
      'Lots of content here.'.repeat(10),
    ].join('\n')
    const result = splitChapters(text, { mode: 'auto' }, 'Novel')
    expect(result.matchedRule).toContain('Chapter')
    expect(result.chapters.length).toBe(2)
    expect(result.chapters[0].title).toBe('Chapter 1: The Beginning')
  })
})

describe('splitChapters - 双空行', () => {
  it('用双空行切分', () => {
    const text = [
      '第一段标题',
      '内容A'.repeat(10),
      '',
      '',
      '第二段标题',
      '内容B'.repeat(10),
      '',
      '',
      '第三段标题',
      '内容C'.repeat(10),
    ].join('\n')
    const result = splitChapters(text, { mode: 'blankline' }, 'fallback')
    expect(result.matchedRule).toBe('双空行分章')
    expect(result.chapters.length).toBe(3)
  })

  it('双空行识别失败时整篇一章', () => {
    const text = '只有一段内容,中间没有空行分隔。'
    const result = splitChapters(text, { mode: 'blankline' }, 'fallback')
    expect(result.chapters.length).toBe(1)
    expect(result.matchedRule).toContain('未识别到')
  })
})

describe('splitChapters - 整篇一章', () => {
  it('任何内容都返回 1 章', () => {
    const text = '随便什么内容\n第二行\n第三行'.repeat(50)
    const result = splitChapters(text, { mode: 'whole' }, 'book')
    expect(result.chapters.length).toBe(1)
    expect(result.matchedRule).toBe('整篇一章')
    expect(result.chapters[0].title).toBe('book')
  })
})

describe('splitChapters - 自定义正则', () => {
  it('用户自定义正则匹配', () => {
    const text = [
      'Episode 1',
      '内容一'.repeat(20),
      '',
      'Episode 2',
      '内容二'.repeat(20),
      '',
      'Episode 3',
      '内容三'.repeat(20),
    ].join('\n')
    const result = splitChapters(text, { mode: 'pattern', pattern: 'Episode \\d+' }, 'show')
    expect(result.matchedRule).toBe('自定义正则')
    expect(result.chapters.length).toBe(3)
    expect(result.chapters[1].title).toBe('Episode 2')
  })

  it('正则只有 1 个匹配回退', () => {
    const text = 'Episode 1\nonly one'
    const result = splitChapters(text, { mode: 'pattern', pattern: 'Episode \\d+' }, 'fb')
    expect(result.matchedRule).toContain('不足')
    expect(result.chapters.length).toBe(1)
  })
})

describe('splitChapters - auto 兜底', () => {
  it('没有规则命中时整篇一章', () => {
    const text = '散文不分章节,没有特殊标记。'.repeat(20)
    const result = splitChapters(text, { mode: 'auto' }, '散文')
    expect(result.chapters.length).toBe(1)
    expect(result.matchedRule).toContain('失败')
  })

  it('空文本返回空数组', () => {
    const result = splitChapters('', { mode: 'auto' }, 'fb')
    expect(result.chapters.length).toBe(0)
    expect(result.totalChars).toBe(0)
  })

  it('纯空白文本返回空数组', () => {
    const result = splitChapters('   \n\n  \n  ', { mode: 'auto' }, 'fb')
    expect(result.chapters.length).toBe(0)
  })
})

describe('splitChapters - 微章合并', () => {
  it('把字数过少的相邻章合并到上一章', () => {
    const text = [
      '第一章 起点',
      '很长的内容'.repeat(30),
      '',
      '小标题',
      '只有几个字',
      '',
      '第二章 发展',
      '更多内容'.repeat(30),
    ].join('\n')
    const result = splitChapters(text, { mode: 'auto', minChapterLength: 200 }, 'fb')
    expect(result.chapters.length).toBeLessThan(3)
    const main = result.chapters.find((c) => c.title.includes('第一章'))
    expect(main?.content).toContain('小标题')
  })
})

describe('stripChapterPrefix', () => {
  it('剥掉"第N章"前缀,保留副标题', () => {
    expect(stripChapterPrefix('第一章 钟楼街的游行')).toBe('钟楼街的游行')
    expect(stripChapterPrefix('第1章 起点')).toBe('起点')
    expect(stripChapterPrefix('第123章 战斗')).toBe('战斗')
    expect(stripChapterPrefix('第一百二十三章 决战')).toBe('决战')
  })

  it('剥掉英文 Chapter 前缀', () => {
    expect(stripChapterPrefix('Chapter 1 The Beginning')).toBe('The Beginning')
    expect(stripChapterPrefix('Chapter 1: The Beginning')).toBe('The Beginning')
  })

  it('剥掉特殊标题(序章/楔子/后记等)', () => {
    expect(stripChapterPrefix('序章 风起云涌')).toBe('风起云涌')
    expect(stripChapterPrefix('楔子 一个故事')).toBe('一个故事')
    expect(stripChapterPrefix('后记 完')).toBe('完')
  })

  it('剥掉分隔符 : : · 、', () => {
    expect(stripChapterPrefix('第一章:起点')).toBe('起点')
    expect(stripChapterPrefix('第一章: 起点')).toBe('起点')
    expect(stripChapterPrefix('第一章·起点')).toBe('起点')
  })

  it('没有前缀时原样返回', () => {
    expect(stripChapterPrefix('钟楼街的游行')).toBe('钟楼街的游行')
    expect(stripChapterPrefix('序')).toBe('序')
  })
})

describe('buildChapters', () => {
  it('生成符合 DB schema 的章节', () => {
    const text = [
      '第一章 起点',
      '故事开始了。',
      '很长的内容。'.repeat(20),
      '',
      '第二章 发展',
      '故事发展了。',
      '更多内容。'.repeat(20),
    ].join('\n')
    const split = splitChapters(text, { mode: 'auto' }, 'fb')
    const chapters = buildChapters(split, () => '2026-01-01T00:00:00Z')
    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toBe('起点')
    expect(chapters[0].content).toContain('<p>')
    expect(chapters[0].word_count).toBeGreaterThan(0)
    expect(chapters[0].sort_order).toBe(0)
    expect(chapters[1].sort_order).toBe(1)
    expect(chapters[0].status).toBe('draft')
    expect(chapters[0].created_at).toBe('2026-01-01T00:00:00Z')
  })

  it('word_count 等于纯文本字符数(去掉 HTML 标签)', () => {
    const text = '第一章\n\n这是一段测试内容,共二十几个字。'
    const split = splitChapters(text, { mode: 'auto' }, 'fb')
    const chapters = buildChapters(split)
    const html = chapters[0].content
    const plainText = html.replace(/<[^>]*>/g, '')
    expect(chapters[0].word_count).toBe(plainText.length)
  })
})

describe('buildBackupFromChapters', () => {
  it('构造可被 validateImportBackup 接受的 backup', () => {
    const chapters = buildChapters({
      chapters: [
        { title: '第一章', content: 'a'.repeat(100), charCount: 100 },
        { title: '第二章', content: 'b'.repeat(100), charCount: 100 },
      ],
      matchedRule: 'test',
      totalChars: 200,
    }, () => '2026-01-01T00:00:00Z')
    const backup = buildBackupFromChapters('测试.txt', '测试', chapters)
    expect(backup.version).toBe(2)
    expect(backup.project.title).toBe('测试')
    expect(backup.project.word_count).toBeGreaterThan(0)
    expect(backup.chapters).toHaveLength(2)
    expect(backup.characterCards).toEqual([])
    expect(backup.worldCards).toEqual([])
    expect(backup.customStyles).toEqual([])
  })

  it('项目名为空时回退到文件名', () => {
    const chapters = buildChapters({ chapters: [{ title: 't', content: 'a', charCount: 1 }], matchedRule: '', totalChars: 1 })
    const backup = buildBackupFromChapters('凡人修仙传.txt', '', chapters)
    expect(backup.project.title).toBe('凡人修仙传')
  })
})
