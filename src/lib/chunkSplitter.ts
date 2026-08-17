/**
 * RecursiveCharacterTextSplitter — 前后端共用的统一分块方案
 *
 * 参数与 LangChain 的 RecursiveCharacterTextSplitter 一致:
 *   chunk_size=800, chunk_overlap=100,
 *   separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""]
 */

export interface Chunk {
  text: string
  start: number  // 在原始 stripHtml 文本中的字符偏移
  end: number
}

const DEFAULT_SEPARATORS = ['\n\n', '\n', '。', '！', '？', '；', '，', ' ', '']

/**
 * 将文本按 RecursiveCharacterTextSplitter 算法切分为 chunks。
 * 返回的数组下标即为 chunkId。
 */
export function splitChunks(
  text: string,
  opts?: { chunkSize?: number; chunkOverlap?: number; separators?: string[] }
): Chunk[] {
  const chunkSize = opts?.chunkSize ?? 800
  const chunkOverlap = opts?.chunkOverlap ?? 100
  const separators = opts?.separators ?? DEFAULT_SEPARATORS
  if (!text || !text.trim()) return []
  if (text.length <= chunkSize) {
    return [{ text: text.trim(), start: 0, end: text.length }]
  }

  /**
   * 递归用 separators 切分文本，返回 { text, originalStart } 原子片段。
   * 原子片段的坐标始终相对于最外层的原始文本。
   */
  function recursiveSplit(
    txt: string,
    seps: string[],
    offset: number
  ): Array<{ text: string; originalStart: number }> {
    if (txt.length <= chunkSize) {
      return [{ text: txt, originalStart: offset }]
    }
    if (seps.length === 0) {
      return [{ text: txt, originalStart: offset }]
    }

    const sep = seps[0]
    const remaining = seps.slice(1)

    let pieces: Array<{ text: string; originalStart: number }>

    if (sep === '') {
      // 空分隔符 = 逐字符切分，每个字符都是原子片段
      pieces = []
      for (let i = 0; i < txt.length; i++) {
        pieces.push({ text: txt[i], originalStart: offset + i })
      }
    } else {
      pieces = []
      let pos = 0
      const parts = txt.split(sep)
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (part.length > 0) {
          pieces.push({ text: part, originalStart: offset + pos })
        }
        pos += part.length
        if (i < parts.length - 1) pos += sep.length
      }
    }

    // 递归拆分过大的原子片段
    const finalPieces: Array<{ text: string; originalStart: number }> = []
    for (const piece of pieces) {
      if (piece.text.length > chunkSize) {
        finalPieces.push(...recursiveSplit(piece.text, remaining, piece.originalStart))
      } else {
        finalPieces.push(piece)
      }
    }
    return finalPieces
  }

  const allSeparators = separators
  const pieces = recursiveSplit(text, allSeparators, 0)

  // ---- 合并阶段：按 chunkSize + overlap 落盘 ----
  const chunks: Chunk[] = []
  let buf = ''
  let bufStart = 0  // buf 对应原文的起始偏移

  function saveChunk(t: string, start: number) {
    const trimmed = t.trim()
    if (!trimmed) return
    const leading = t.length - t.trimStart().length
    chunks.push({ text: trimmed, start: start + leading, end: start + t.length })
  }

  for (const piece of pieces) {
    if (piece.text.length > chunkSize) {
      // 不可再分的超长片段 — 硬切（含 overlap）
      if (buf) { saveChunk(buf, bufStart); buf = ''; }
      const full = piece.text
      let cutIdx = 0
      while (cutIdx < full.length) {
        const seg = full.slice(cutIdx, cutIdx + chunkSize)
        const chunkText = buf + seg
        const start = buf ? bufStart : piece.originalStart + cutIdx
        saveChunk(chunkText, start)
        cutIdx += chunkSize - buf.length
        buf = ''
        if (cutIdx < full.length) {
          buf = full.slice(Math.max(0, cutIdx - chunkOverlap), cutIdx)
          bufStart = piece.originalStart + Math.max(0, cutIdx - chunkOverlap)
        }
      }
      continue
    }

    if (buf.length + piece.text.length > chunkSize) {
      saveChunk(buf, bufStart)
      // 用前一个 chunk 末尾 chunkOverlap 作为下一个 chunk 开头
      buf = buf.slice(-chunkOverlap) + piece.text
      bufStart = buf.length > chunkOverlap
        ? chunks[chunks.length - 1].end - chunkOverlap
        : piece.originalStart
    } else {
      if (!buf) bufStart = piece.originalStart
      buf += piece.text
    }
  }

  if (buf.trim()) saveChunk(buf, bufStart)

  return chunks
}

/**
 * 将一组连续 chunks 合并为完整文本，自动去除相邻 chunk 的重叠部分。
 * chunks 必须是 splitChunks 返回的连续子序列（即 chunkId 连续）。
 */
export function mergeChunks(chunks: Chunk[]): string {
  if (chunks.length === 0) return ''
  if (chunks.length === 1) return chunks[0].text

  let result = chunks[0].text
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1].text
    const curr = chunks[i].text
    const maxOverlap = Math.min(prev.length, curr.length)
    let overlapLen = 0
    for (let len = maxOverlap; len > 0; len--) {
      if (prev.slice(-len) === curr.slice(0, len)) {
        overlapLen = len
        break
      }
    }
    result += curr.slice(overlapLen)
  }
  return result
}
