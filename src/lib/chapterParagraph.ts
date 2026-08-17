import { stripHtml } from './html'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export type ChapterBlockInfo = {
  index: number
  offset: number
  node: ProseMirrorNode
}

export function isChapterDocEmpty(doc: ProseMirrorNode): boolean {
  return doc.textContent.trim().length === 0
}

/** 与段号 gutter 共用：按 ProseMirror 顶层 block 顺序枚举段落（1-based index） */
export function enumerateChapterBlocks(
  doc: ProseMirrorNode,
  onBlock: (info: ChapterBlockInfo) => void,
): void {
  let index = 0
  doc.forEach((node, offset) => {
    if (!node.isBlock) return
    index++
    onBlock({ index, offset, node })
  })
}

export function splitParagraphsFromDoc(doc: ProseMirrorNode): string[] {
  const paragraphs: string[] = []
  enumerateChapterBlocks(doc, ({ node }) => {
    paragraphs.push(node.textContent)
  })
  return paragraphs
}

/** 按选区在文档中的位置解析段号，与 gutter 编号一致 */
export function resolveParagraphIndicesFromDoc(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): number[] {
  const indices: number[] = []
  enumerateChapterBlocks(doc, ({ index, offset, node }) => {
    const blockEnd = offset + node.nodeSize
    if (from < blockEnd && to > offset) indices.push(index)
  })
  return indices
}

export function resolveChapterSelectionContext(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): { text: string; paragraphIndices: number[] } | null {
  const text = doc.textBetween(from, to)
  if (!text) return null
  const paragraphIndices = resolveParagraphIndicesFromDoc(doc, from, to)
  return { text, paragraphIndices }
}

export function escapeHtmlInline(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const BLOCK_TAGS = 'p|div|li|h[1-6]|blockquote|pre'

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function paragraphInnerText(inner: string): string {
  return decodeHtmlEntities(
    inner
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
}

function splitParagraphsFromChapterHtml(html: string): string[] | null {
  if (!/<p[\s>]/i.test(html)) return null
  const parts = [...html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
  if (parts.length === 0) return null

  const withoutPs = html.replace(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/gi, '')
  if (/<(?:h[1-6]|div|li|blockquote|pre)[\s>]/i.test(withoutPs)) return null

  const paragraphs: string[] = []
  for (const m of parts) {
    const inner = paragraphInnerText(m[1])
    if (inner.includes('\n\n')) {
      for (const piece of inner.split(/\n\n+/)) paragraphs.push(piece.trim())
    } else {
      paragraphs.push(inner)
    }
  }
  return paragraphs
}

function normalizeBlockBoundaries(html: string): string {
  return html
    .replace(new RegExp(`</(${BLOCK_TAGS})>\\s*<(${BLOCK_TAGS})(?:\\s[^>]*)?>`, 'gi'), '\n\n')
    .replace(new RegExp(`</(${BLOCK_TAGS})>`, 'gi'), '\n\n')
    .replace(new RegExp(`<(${BLOCK_TAGS})(?:\\s[^>]*)?>`, 'gi'), '\n\n')
}

export function splitParagraphs(htmlOrPlain: string, alreadyPlain = false): string[] {
  if (alreadyPlain) {
    if (!htmlOrPlain.trim()) return []
    return htmlOrPlain.split(/\n\n+/).map((p) => p.trim())
  }
  const trimmed = htmlOrPlain.trim()
  if (!trimmed) return []
  const fromP = splitParagraphsFromChapterHtml(trimmed)
  if (fromP !== null) return fromP
  const plain = stripHtml(normalizeBlockBoundaries(htmlOrPlain))
  if (!plain.trim()) return []
  return plain
    .split(/\n\n+/)
    .map((p) => p.trim())
}

export function joinParagraphsToHtml(paragraphs: string[]): string {
  if (paragraphs.length === 0) return ''
  return paragraphs
    .map((p) => `<p>${escapeHtmlInline(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** 将章节 HTML 转为导出用纯文本，段间双换行，与编辑器段号坐标系一致 */
export function chapterContentToPlainText(html: string): string {
  return splitParagraphs(html || '').join('\n\n')
}

/** 将任意章节 HTML 规范为每段一个 <p>，与 splitParagraphs / 段号 gutter 坐标系一致 */
export function normalizeChapterContentHtml(html: string): string {
  return joinParagraphsToHtml(splitParagraphs(html || ''))
}

function longestCommonSubstring(a: string, b: string): string {
  let best = ''
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let len = 0
      while (i + len < a.length && j + len < b.length && a[i + len] === b[j + len]) len++
      if (len > best.length) best = a.slice(i, i + len)
    }
  }
  return best
}

function rangeClosed(start: number, end: number): number[] {
  const result: number[] = []
  for (let i = start; i <= end; i++) result.push(i)
  return result
}

function bestMatchParagraph(paragraphs: string[], sel: string): number {
  let best = 1
  let bestLen = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const lcs = longestCommonSubstring(paragraphs[i], sel).length
    if (lcs > bestLen) {
      bestLen = lcs
      best = i + 1
    }
  }
  return best
}

function rangeCoversSelection(paragraphs: string[], start: number, end: number, sel: string): boolean {
  const slice = paragraphs.slice(start, end + 1)
  return slice.join('\n\n').includes(sel)
    || slice.join('').includes(sel)
    || slice.join('\n').includes(sel)
}

export function resolveParagraphIndices(
  paragraphs: string[],
  selectedText: string,
): number[] {
  const sel = selectedText.trim()
  if (!sel) return []

  let best: number[] | null = null
  let bestSpan = Infinity
  for (let start = 0; start < paragraphs.length; start++) {
    for (let end = start; end < paragraphs.length; end++) {
      if (!rangeCoversSelection(paragraphs, start, end, sel)) continue
      const span = end - start
      if (span < bestSpan) {
        bestSpan = span
        best = rangeClosed(start + 1, end + 1)
      }
    }
  }
  if (best) return best

  const MIN_HIT_LEN = 6
  const hits: number[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].includes(sel)) {
      hits.push(i + 1)
      continue
    }
    if (paragraphs[i].length >= MIN_HIT_LEN && sel.includes(paragraphs[i])) {
      hits.push(i + 1)
    }
  }
  if (hits.length === 0) return [bestMatchParagraph(paragraphs, sel)]
  if (hits.length === 1) return hits
  return rangeClosed(hits[0], hits[hits.length - 1])
}

export interface ChapterContentEdit {
  paragraph_index: number
  text: string
}

export interface ChapterContentInsert {
  after_paragraph_index: number
  text: string
}

export type ApplyChapterContentResult =
  | { ok: true; modifiedHtml: string }
  | { ok: false; error: string }

function originalToCurrentIndex(
  origIdx: number,
  inserts: ChapterContentInsert[],
): number {
  const count = inserts.filter((ins) => ins.after_paragraph_index <= origIdx).length
  return origIdx + count
}

export function applyChapterParagraphEdits(
  html: string,
  options: {
    content?: string
    edits?: ChapterContentEdit[]
    inserts?: ChapterContentInsert[]
  },
): ApplyChapterContentResult {
  const paragraphs = splitParagraphs(html)
  const isEmpty = paragraphs.length === 0 || paragraphs.every((p) => p.length === 0)
  const hasContent = options.content !== undefined && options.content !== null
  const edits = options.edits ?? []
  const inserts = options.inserts ?? []
  const hasEdits = edits.length > 0
  const hasInserts = inserts.length > 0

  if (hasContent && (hasEdits || hasInserts)) {
    return { ok: false, error: '错误：content 与 edits/inserts 互斥' }
  }

  if (isEmpty) {
    if (!hasContent) return { ok: false, error: '错误：空章节请传 content' }
    const modifiedHtml = joinParagraphsToHtml(splitParagraphs(String(options.content), true))
    return { ok: true, modifiedHtml }
  }

  if (hasContent) {
    return { ok: false, error: '错误：非空章节请使用 edits/inserts，勿传 content' }
  }
  if (!hasEdits && !hasInserts) {
    return { ok: false, error: '错误：非空章节请传 edits 或 inserts' }
  }

  for (const ins of inserts) {
    if (!ins.text?.trim()) return { ok: false, error: '错误：inserts.text 不可为空' }
    const after = ins.after_paragraph_index
    if (after < 0 || after > paragraphs.length) {
      return { ok: false, error: `错误：after_paragraph_index ${after} 须在 0..${paragraphs.length}（原始编号）` }
    }
  }

  const seen = new Set<number>()
  for (const edit of edits) {
    const idx = edit.paragraph_index
    if (idx < 1 || idx > paragraphs.length) {
      return { ok: false, error: `错误：paragraph_index ${idx} 超出范围（共 ${paragraphs.length} 段）` }
    }
    if (seen.has(idx)) return { ok: false, error: '错误：edits 中 paragraph_index 重复' }
    seen.add(idx)
  }

  let next = [...paragraphs]
  const sortedInserts = [...inserts].sort((a, b) => a.after_paragraph_index - b.after_paragraph_index)
  let insertOffset = 0
  for (const ins of sortedInserts) {
    const pos = ins.after_paragraph_index + insertOffset
    next.splice(pos, 0, ins.text)
    insertOffset++
  }

  const sortedEdits = [...edits].sort((a, b) => b.paragraph_index - a.paragraph_index)
  for (const edit of sortedEdits) {
    const origIdx = edit.paragraph_index - 1
    const currIdx = originalToCurrentIndex(origIdx, sortedInserts)
    if (edit.text === '') {
      next.splice(currIdx, 1)
    } else {
      next[currIdx] = edit.text
    }
  }

  return { ok: true, modifiedHtml: joinParagraphsToHtml(next) }
}
