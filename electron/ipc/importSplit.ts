export type ChapterSplitMode = 'auto' | 'pattern' | 'blankline' | 'whole'

export interface ChapterSplitOptions {
  mode: ChapterSplitMode
  pattern?: string
  minChapterLength?: number
}

export interface ParsedChapter {
  title: string
  content: string
  charCount: number
}

export interface ChapterSplitResult {
  chapters: ParsedChapter[]
  matchedRule: string
  totalChars: number
}

export interface BuiltChapter {
  id: string
  title: string
  content: string
  chapter_outline: string
  sort_order: number
  status: string
  word_count: number
  created_at: string
  updated_at: string
}

const DEFAULT_MIN_CHAPTER_LENGTH = 10

const CN_NUM = '一二三四五六七八九十百千零〇两壹贰叁肆伍陆柒捌玖拾佰仟'

const BUILTIN_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  {
    name: '中文章节(第X章)',
    regex: new RegExp(`^[ \t\u3000]*第[\s\u3000]*(?:[0-9]+|[${CN_NUM}]+)[\t\u3000 ]*章`, 'm'),
  },
  {
    name: '中文章节(第X卷/回/节/集/部/篇/话/幕)',
    regex: new RegExp(`^[ \t\u3000]*第[\s\u3000]*(?:[0-9]+|[${CN_NUM}]+)[\t\u3000 ]*(?:回|卷|节|集|部|篇|话|幕)`, 'm'),
  },
  {
    name: '英文 Chapter',
    regex: /^[ \t]*Chapter[ \t]+\d+(?:\s*[:：.\-—][ \t]*[^\n]*)?$/im,
  },
  {
    name: '英文 CHAPTER + 罗马数字',
    regex: /^[ \t]*CHAPTER[ \t]+[IVXLCDM]+(?:\s*[:：.\-—][ \t]*[^\n]*)?$/im,
  },
  {
    name: '特殊标题行(序章/楔子/后记/番外等)',
    regex: /^[ \t]*(?:序章|序言|楔子|前言|后记|尾声|番外|终章)\s*$/m,
  },
  {
    name: '双空行分章',
    regex: /\n[ \t]*\n[ \t]*\n/,
  },
]

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c])
}

/**
 * 保留每段开头的缩进字符(全角空格/制表/半角空格), 去掉段首/段尾其它空白。
 * 解决原 `.trim()` 把中文段首缩进 `　　` 一并干掉的 bug,
 * 让从 txt/docx 导入的内容保留原文排版。
 */
function preserveFirstLineIndent(s: string): string {
  const m = s.match(/^([　 \t]+)/)
  const indent = m ? m[1] : ''
  const rest = s.slice(indent.length).replace(/^[\s　]+/, '').replace(/[\s　]+$/, '')
  return indent + rest
}

export function textToHtml(text: string): string {
  if (!text) return ''
  const blocks = text.split(/\n\s*\n/)
  return blocks
    .map((b) => {
      const inner = escapeHtml(preserveFirstLineIndent(b)).replace(/\r?\n/g, '<br/>')
      return `<p>${inner}</p>`
    })
    .join('')
}

export function buildUserPattern(pattern: string): RegExp | null {
  if (!pattern) return null
  const normalized = pattern.replace(/\*/g, '.*')
  try {
    return new RegExp(`^[ \\t\\u3000]*${normalized}[ \\t\\u3000]*.*$`, 'm')
  } catch {
    return null
  }
}

interface RuleMatch {
  name: string
  matches: { index: number; line: string }[]
}

function collectMatches(text: string, regex: RegExp): { index: number; line: string }[] {
  const out: { index: number; line: string }[] = []
  const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g'
  const globalRe = new RegExp(regex.source, flags)
  let m: RegExpExecArray | null
  while ((m = globalRe.exec(text)) !== null) {
    const lineEnd = text.indexOf('\n', m.index)
    const line = text.slice(m.index, lineEnd === -1 ? text.length : lineEnd).trim()
    out.push({ index: m.index, line })
    if (m.index === globalRe.lastIndex) globalRe.lastIndex++
  }
  return out
}

function chooseAutoRule(text: string): { name: string; matches: { index: number; line: string }[] } {
  let best: RuleMatch | null = null
  for (let i = 0; i < BUILTIN_PATTERNS.length - 1; i++) {
    const rule = BUILTIN_PATTERNS[i]
    const matches = collectMatches(text, rule.regex)
    if (matches.length >= 2 && (!best || matches.length > best.matches.length)) {
      best = { name: rule.name, matches }
    }
  }
  return best ?? { name: '', matches: [] }
}

function sliceByMatches(
  text: string,
  matches: { index: number; line: string }[],
  fallbackTitle: string,
): ParsedChapter[] {
  if (matches.length === 0) {
    return [{ title: fallbackTitle, content: preserveFirstLineIndent(text), charCount: text.length }]
  }
  const chapters: ParsedChapter[] = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length
    const segment = text.slice(start, end)
    const lines = segment.split(/\r?\n/)
    const titleLine = (matches[i].line || (lines[0] || '').trim()).trim()
    const body = preserveFirstLineIndent(lines.slice(1).join('\n'))
    chapters.push({
      title: titleLine || `第 ${i + 1} 章`,
      content: body,
      charCount: body.length,
    })
  }
  return chapters
}

function mergeTinyChapters(chapters: ParsedChapter[], minLength: number, fallbackTitle: string): ParsedChapter[] {
  if (chapters.length < 2) return chapters
  const merged: ParsedChapter[] = []
  for (const ch of chapters) {
    const last = merged[merged.length - 1]
    if (last && last.charCount < minLength && ch.title !== last.title) {
      const isLastFallback = last.title === fallbackTitle
      const preferred = isLastFallback || ch.title.length > last.title.length ? ch.title : last.title
      const newContent = isLastFallback
        ? (last.content + '\n\n' + ch.content)
        : (last.content + '\n\n' + ch.title + '\n' + ch.content)
      last.content = preserveFirstLineIndent(newContent)
      last.title = preferred
      last.charCount = last.content.length
    } else {
      merged.push({ ...ch })
    }
  }
  return merged
}

export function splitChapters(text: string, options: ChapterSplitOptions, fallbackTitle: string): ChapterSplitResult {
  const totalChars = text.length
  const minLen = options.minChapterLength ?? DEFAULT_MIN_CHAPTER_LENGTH

  if (!text.trim()) {
    return { chapters: [], matchedRule: '', totalChars: 0 }
  }

  if (options.mode === 'whole') {
    return {
      chapters: [{ title: fallbackTitle, content: preserveFirstLineIndent(text), charCount: text.length }],
      matchedRule: '整篇一章',
      totalChars,
    }
  }

  if (options.mode === 'blankline') {
    const regex = /\n[ \t]*\n[ \t]*\n/g
    const matches = collectMatches(text, regex)
    if (matches.length < 2) {
      return {
        chapters: [{ title: fallbackTitle, content: preserveFirstLineIndent(text), charCount: text.length }],
        matchedRule: '双空行分章(未识别到)',
        totalChars,
      }
    }
    const splits: Array<{ index: number; length: number }> = []
    for (const m of matches) {
      const lineEnd = text.indexOf('\n', m.index)
      const length = lineEnd === -1 ? text.length - m.index : lineEnd - m.index
      splits.push({ index: m.index, length })
    }
    const chapters: ParsedChapter[] = []
    let cursor = 0
    for (let i = 0; i <= splits.length; i++) {
      const start = cursor
      const end = i < splits.length ? splits[i].index : text.length
      const seg = preserveFirstLineIndent(text.slice(start, end))
      if (seg) {
        chapters.push({
          title: `${fallbackTitle} ${i + 1}`,
          content: seg,
          charCount: seg.length,
        })
      }
      if (i < splits.length) cursor = splits[i].index + splits[i].length
    }
    return {
      chapters: mergeTinyChapters(chapters, minLen, fallbackTitle),
      matchedRule: '双空行分章',
      totalChars,
    }
  }

  if (options.mode === 'pattern') {
    const re = buildUserPattern(options.pattern || '')
    if (!re) {
      return {
        chapters: [{ title: fallbackTitle, content: preserveFirstLineIndent(text), charCount: text.length }],
        matchedRule: '自定义正则(无效)',
        totalChars,
      }
    }
    const matches = collectMatches(text, re)
    if (matches.length < 2) {
      return {
        chapters: [{ title: fallbackTitle, content: preserveFirstLineIndent(text), charCount: text.length }],
        matchedRule: `自定义正则(${matches.length} 个匹配,不足 2 个)`,
        totalChars,
      }
    }
    const chapters = sliceByMatches(text, matches, fallbackTitle)
    return {
      chapters: mergeTinyChapters(chapters, minLen, fallbackTitle),
      matchedRule: '自定义正则',
      totalChars,
    }
  }

  const auto = chooseAutoRule(text)
  if (auto.matches.length < 2) {
    return {
      chapters: [{ title: fallbackTitle, content: preserveFirstLineIndent(text), charCount: text.length }],
      matchedRule: auto.name ? `自动识别失败(${auto.name} 匹配不足)` : '自动识别失败',
      totalChars,
    }
  }
  const chapters = sliceByMatches(text, auto.matches, fallbackTitle)
  return {
    chapters: mergeTinyChapters(chapters, minLen, fallbackTitle),
    matchedRule: `自动识别: ${auto.name}`,
    totalChars,
  }
}

const FALLBACK_TITLE_RE = /^第\s*\d+\s*章$/

function looksLikeChapterTitle(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (trimmed.length > 80) return false
  if (/^(如果|然而|那是|由于|这时候|于是|他|她|我|你|他们|我们|这|那|一个|一些)/.test(trimmed)) return false
  return /^(第|Chapter|CHAPTER|序章|楔子|后记|尾声|番外|终章|前言)/i.test(trimmed) || trimmed.length <= 30
}

const CHAPTER_PREFIX_RE = new RegExp(
  `^(?:第[\\s\\u3000]*(?:[0-9]+|[${CN_NUM}]+)[\\s\\u3000]*[章节回卷集部篇话幕]|序章|序言|楔子|前言|后记|尾声|番外|终章|Chapter\\s+\\d+|CHAPTER\\s+[IVXLCDM]+|Chapter\\s+[一二三四五六七八九十百千]+)(?:[\\s\\u3000]*[:：·、])?`,
  'i',
)

export function stripChapterPrefix(title: string): string {
  const trimmed = title.trim()
  const m = CHAPTER_PREFIX_RE.exec(trimmed)
  if (!m) return trimmed
  const rest = trimmed.slice(m[0].length).trim()
  return rest || trimmed
}

export function buildChapters(split: ChapterSplitResult, now: () => string = () => new Date().toISOString()): BuiltChapter[] {
  return split.chapters.map((c, i) => {
    let title = c.title
    let content = c.content
    if (FALLBACK_TITLE_RE.test(title)) {
      const lines = content.split(/\r?\n/)
      const firstIdx = lines.findIndex((l) => l.trim().length > 0)
      if (firstIdx >= 0 && firstIdx < 3 && looksLikeChapterTitle(lines[firstIdx])) {
        const candidate = lines[firstIdx].trim()
        title = candidate
        const before = lines.slice(0, firstIdx)
        const after = lines.slice(firstIdx + 1)
        content = [...before, ...after].join('\n').replace(/^\s*\n/, '').trim()
      }
    }
    title = stripChapterPrefix(title)
    const html = textToHtml(content)
    // 与渲染端 countChars 口径一致: HTML 剥标签, 空白不计入
    const plainLen = html.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length
    return {
      id: Date.now().toString(36) + i.toString(36) + Math.random().toString(36).slice(2, 7),
      title,
      content: html,
      chapter_outline: '',
      sort_order: i,
      status: 'draft',
      word_count: plainLen,
      created_at: now(),
      updated_at: now(),
    }
  })
}

export function buildBackupFromChapters(
  fileName: string,
  projectTitle: string,
  chapters: BuiltChapter[],
): any {
  const now = new Date().toISOString()
  const totalWords = chapters.reduce((s, c) => s + (c.word_count || 0), 0)
  const fallbackId = Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
  return {
    version: 2,
    exportedAt: now,
    project: {
      id: fallbackId,
      title: projectTitle || fileName.replace(/\.[^.]+$/, ''),
      outline: '',
      word_count: totalWords,
      style_guidance: '',
      created_at: now,
      updated_at: now,
    },
    chapters: chapters.map((c) => ({
      id: c.id,
      title: c.title,
      content: c.content,
      chapter_outline: c.chapter_outline,
      sort_order: c.sort_order,
      status: c.status,
      word_count: c.word_count,
      created_at: c.created_at,
      updated_at: c.updated_at,
    })),
    characterCards: [],
    worldCards: [],
    customStyles: [],
  }
}
