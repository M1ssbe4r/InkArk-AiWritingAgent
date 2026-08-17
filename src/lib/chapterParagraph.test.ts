import { describe, it, expect } from 'vitest'
import {
  splitParagraphs,
  joinParagraphsToHtml,
  escapeHtmlInline,
  resolveParagraphIndices,
  resolveParagraphIndicesFromDoc,
  splitParagraphsFromDoc,
  applyChapterParagraphEdits,
  normalizeChapterContentHtml,
  chapterContentToPlainText,
} from './chapterParagraph'
import { Schema } from '@tiptap/pm/model'

describe('splitParagraphs', () => {
  it('single p tag', () => {
    expect(splitParagraphs('<p>一段文字</p>')).toEqual(['一段文字'])
  })

  it('multiple p tags without newlines between tags', () => {
    expect(splitParagraphs('<p>a</p><p>b</p>')).toEqual(['a', 'b'])
  })

  it('preserves br as inline newline within paragraph', () => {
    expect(splitParagraphs('<p>行一<br>行二</p>')).toEqual(['行一\n行二'])
  })

  it('heading and paragraph are separate', () => {
    expect(splitParagraphs('<h1>标题</h1><p>正文</p>')).toEqual(['标题', '正文'])
  })

  it('blockquote with inner p is one paragraph', () => {
    expect(splitParagraphs('<blockquote><p>a</p></blockquote>')).toEqual(['a'])
  })

  it('plain text with double newlines', () => {
    expect(splitParagraphs('第一段\n\n第二段', true)).toEqual(['第一段', '第二段'])
  })

  it('preserves empty p blocks', () => {
    expect(splitParagraphs('<p>a</p><p></p><p>b</p>')).toEqual(['a', '', 'b'])
  })
})

describe('joinParagraphsToHtml', () => {
  it('round-trips with splitParagraphs', () => {
    const html = joinParagraphsToHtml(['第一段', '第二段'])
    expect(splitParagraphs(html)).toEqual(['第一段', '第二段'])
  })

  it('restores inline newlines as br', () => {
    const html = joinParagraphsToHtml(['行一\n行二'])
    expect(html).toContain('<br>')
    expect(splitParagraphs(html)).toEqual(['行一\n行二'])
  })
})

describe('escapeHtmlInline', () => {
  it('escapes dangerous tags', () => {
    const raw = '<img src=x onerror=alert(1)>'
    expect(escapeHtmlInline(raw)).not.toContain('<img')
    const html = joinParagraphsToHtml([raw])
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})

describe('resolveParagraphIndices', () => {
  const paragraphs = ['张三走进房间。他看到桌上放着一封信。', '窗外下着雨。', '第三段内容。']

  it('partial selection within paragraph', () => {
    expect(resolveParagraphIndices(paragraphs, '他看到桌上')).toEqual([1])
  })

  it('full paragraph selection', () => {
    expect(resolveParagraphIndices(paragraphs, '窗外下着雨。')).toEqual([2])
  })

  it('cross-paragraph continuous selection', () => {
    expect(resolveParagraphIndices(paragraphs, '一封信。窗外下着雨')).toEqual([1, 2])
  })

  it('empty selection returns empty', () => {
    expect(resolveParagraphIndices(paragraphs, '   ')).toEqual([])
  })

  it('selection with br newline', () => {
    const paras = ['行一\n行二', '其他']
    expect(resolveParagraphIndices(paras, '行一\n行二')).toEqual([1])
  })
})

const testSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: { group: 'inline' },
  },
})

function docFromParagraphs(texts: string[]) {
  return testSchema.node('doc', null, texts.map((t) => testSchema.node('paragraph', null, t ? [testSchema.text(t)] : [])))
}

function posAtParagraphText(doc: ReturnType<typeof docFromParagraphs>, paraIndex: number, offsetInText = 0): number {
  let pos = 1
  for (let i = 0; i < paraIndex; i++) pos += doc.child(i).nodeSize
  return pos + 1 + offsetInText
}

describe('resolveParagraphIndicesFromDoc', () => {
  it('matches gutter index for selection in later block after empty paragraphs', () => {
    const doc = docFromParagraphs(['a', '', '', '', '', '', '', '', '', '第十段文字'])
    expect(splitParagraphsFromDoc(doc)).toHaveLength(10)
    const from = posAtParagraphText(doc, 9, 0)
    const to = from + '第十段文字'.length
    expect(resolveParagraphIndicesFromDoc(doc, from, to)).toEqual([10])
  })

  it('cross-paragraph selection returns range', () => {
    const doc = docFromParagraphs(['第一段', '第二段'])
    const from = posAtParagraphText(doc, 0, 0)
    const to = posAtParagraphText(doc, 1, '第二段'.length)
    expect(resolveParagraphIndicesFromDoc(doc, from, to)).toEqual([1, 2])
  })
})

describe('applyChapterParagraphEdits', () => {
  const threePara = '<p>第一段</p><p>第二段</p><p>第三段</p>'

  it('empty chapter with content', () => {
    const r = applyChapterParagraphEdits('', { content: '新段一\n\n新段二' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(splitParagraphs(r.modifiedHtml)).toEqual(['新段一', '新段二'])
    }
  })

  it('replace single paragraph', () => {
    const r = applyChapterParagraphEdits(threePara, {
      edits: [{ paragraph_index: 2, text: '改写后的第二段' }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(splitParagraphs(r.modifiedHtml)).toEqual(['第一段', '改写后的第二段', '第三段'])
    }
  })

  it('delete paragraph with empty text', () => {
    const r = applyChapterParagraphEdits(threePara, {
      edits: [{ paragraph_index: 1, text: '' }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(splitParagraphs(r.modifiedHtml)).toEqual(['第二段', '第三段'])
    }
  })

  it('insert at start, middle, end', () => {
    const start = applyChapterParagraphEdits(threePara, {
      inserts: [{ after_paragraph_index: 0, text: '文首' }],
    })
    expect(start.ok).toBe(true)
    if (start.ok) {
      expect(splitParagraphs(start.modifiedHtml)[0]).toBe('文首')
    }

    const mid = applyChapterParagraphEdits(threePara, {
      inserts: [{ after_paragraph_index: 2, text: '过渡' }],
    })
    expect(mid.ok).toBe(true)
    if (mid.ok) {
      expect(splitParagraphs(mid.modifiedHtml)).toEqual(['第一段', '第二段', '过渡', '第三段'])
    }

    const end = applyChapterParagraphEdits(threePara, {
      inserts: [{ after_paragraph_index: 3, text: '文末' }],
    })
    expect(end.ok).toBe(true)
    if (end.ok) {
      expect(splitParagraphs(end.modifiedHtml)[3]).toBe('文末')
    }
  })

  it('edits and inserts in same call use original numbering', () => {
    const r = applyChapterParagraphEdits(threePara, {
      edits: [{ paragraph_index: 3, text: '' }],
      inserts: [{ after_paragraph_index: 2, text: '新过渡' }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(splitParagraphs(r.modifiedHtml)).toEqual(['第一段', '第二段', '新过渡'])
    }
  })

  it('rejects non-empty content on existing chapter', () => {
    const r = applyChapterParagraphEdits(threePara, { content: '整章覆盖' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('非空章节')
  })

  it('rejects duplicate paragraph_index', () => {
    const r = applyChapterParagraphEdits(threePara, {
      edits: [
        { paragraph_index: 1, text: 'a' },
        { paragraph_index: 1, text: 'b' },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('重复')
  })

  it('rejects out of range index', () => {
    const r = applyChapterParagraphEdits(threePara, {
      edits: [{ paragraph_index: 9, text: 'x' }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('超出范围')
  })

  it('normalizeChapterContentHtml splits single p with br gaps into multiple p', () => {
    const html = '<p>第一段<br><br>第二段<br><br>第三段</p>'
    const out = normalizeChapterContentHtml(html)
    expect(splitParagraphs(out)).toEqual(['第一段', '第二段', '第三段'])
  })
})

describe('chapterContentToPlainText', () => {
  it('preserves paragraph breaks for export', () => {
    expect(chapterContentToPlainText('<p>第一段</p><p>第二段</p>')).toBe('第一段\n\n第二段')
  })

  it('preserves inline line breaks within a paragraph', () => {
    expect(chapterContentToPlainText('<p>行一<br>行二</p>')).toBe('行一\n行二')
  })
})
