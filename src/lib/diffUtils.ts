import { splitParagraphs } from './chapterParagraph'

interface DiffItem {
  type: 'eq' | 'del' | 'ins'
  items: string[]
}

function lcsDiff(a: string[], b: string[]): DiffItem[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const result: DiffItem[] = []
  let i = n
  let j = m

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: 'eq', items: [a[i - 1]] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'ins', items: [b[j - 1]] })
      j--
    } else {
      result.unshift({ type: 'del', items: [a[i - 1]] })
      i--
    }
  }

  return mergeConsecutive(result)
}

function mergeConsecutive(items: DiffItem[]): DiffItem[] {
  const merged: DiffItem[] = []
  for (const item of items) {
    if (item.items.length === 0) continue
    const last = merged[merged.length - 1]
    if (last && last.type === item.type) {
      last.items.push(...item.items)
    } else {
      merged.push({ type: item.type, items: [...item.items] })
    }
  }
  return merged
}

function lcsDiffMerged(a: string[], b: string[]): DiffItem[] {
  if (a.length === 0 && b.length === 0) return []
  if (a.length === 0) return [{ type: 'ins', items: [...b] }]
  if (b.length === 0) return [{ type: 'del', items: [...a] }]
  return lcsDiff(a, b)
}

function splitSentences(text: string): string[] {
  const raw = text
    .replace(/([。！？；\n]+)(["'）」』》\u2019\u2018\u201c\u201d]?)/g, '$1$2\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const merged: string[] = []
  for (const s of raw) {
    if (!/[\u4e00-\u9fff\w]/.test(s)) {
      if (merged.length > 0) merged[merged.length - 1] += s
    } else {
      merged.push(s)
    }
  }
  return merged
}

export interface DiffSegment {
  type: 'eq' | 'del' | 'ins' | 'para_break'
  text: string
}

const PARA_SEP = '\u0000'

function sentencesWithBreaks(paragraphs: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0) result.push(PARA_SEP)
    result.push(...splitSentences(paragraphs[i]))
  }
  return result
}

function segmentFromDiff(diff: DiffItem[]): DiffSegment[] {
  const result: DiffSegment[] = []
  for (const chunk of diff) {
    for (const text of chunk.items) {
      if (text === PARA_SEP) {
        result.push({ type: 'para_break', text: '' })
      } else {
        result.push({ type: chunk.type as 'eq' | 'del' | 'ins', text })
      }
    }
  }
  return result
}

export function computeDiff(originalHtml: string, modifiedHtml: string): DiffSegment[] {
  if (!originalHtml && !modifiedHtml) return []
  if (!originalHtml) {
    const paragraphs = splitParagraphs(modifiedHtml)
    const result: DiffSegment[] = []
    paragraphs.forEach((p, i) => {
      if (i > 0) result.push({ type: 'para_break', text: '' })
      splitSentences(p).forEach((s) => result.push({ type: 'ins', text: s }))
    })
    return result
  }
  if (!modifiedHtml) {
    const paragraphs = splitParagraphs(originalHtml)
    const result: DiffSegment[] = []
    paragraphs.forEach((p, i) => {
      if (i > 0) result.push({ type: 'para_break', text: '' })
      splitSentences(p).forEach((s) => result.push({ type: 'del', text: s }))
    })
    return result
  }

  const origParas = splitParagraphs(originalHtml)
  const modParas = splitParagraphs(modifiedHtml)

  const paraDiff = lcsDiffMerged(origParas, modParas)

  const result: DiffSegment[] = []
  let paraIdx = 0

  for (let i = 0; i < paraDiff.length; i++) {
    const chunk = paraDiff[i]

    if (chunk.type === 'eq') {
      for (const paraText of chunk.items) {
        if (paraIdx > 0) result.push({ type: 'para_break', text: '' })
        splitSentences(paraText).forEach((s) => result.push({ type: 'eq', text: s }))
        paraIdx++
      }
      continue
    }

    if (chunk.type === 'del') {
      const nextChunk = paraDiff[i + 1]
      if (nextChunk && nextChunk.type === 'ins') {
        const delAll = sentencesWithBreaks(chunk.items)
        const insAll = sentencesWithBreaks(nextChunk.items)
        const sentDiff = lcsDiffMerged(delAll, insAll)
        const segs = segmentFromDiff(sentDiff)
        if (paraIdx > 0) result.push({ type: 'para_break', text: '' })
        for (const seg of segs) result.push(seg)
        paraIdx += chunk.items.length
        i++
        continue
      }
    }

    if (chunk.type === 'del') {
      for (const paraText of chunk.items) {
        if (paraIdx > 0) result.push({ type: 'para_break', text: '' })
        splitSentences(paraText).forEach((s) => result.push({ type: 'del', text: s }))
        paraIdx++
      }
    } else if (chunk.type === 'ins') {
      for (const paraText of chunk.items) {
        if (paraIdx > 0) result.push({ type: 'para_break', text: '' })
        splitSentences(paraText).forEach((s) => result.push({ type: 'ins', text: s }))
        paraIdx++
      }
    }
  }

  const filtered: DiffSegment[] = []
  for (let i = 0; i < result.length; i++) {
    const seg = result[i]
    if (seg.type === 'para_break') {
      const next = result[i + 1]
      if (!next) continue
      if (next.type === 'para_break') continue
    }
    filtered.push(seg)
  }

  return filtered
}
