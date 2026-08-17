const { parentPort } = require('worker_threads')
const fs = require('fs')
const path = require('path')
const chardet = require('chardet')
const iconv = require('iconv-lite')

let jieba = null
let jiebaOk = false
try {
  jieba = require('jieba-wasm')
  jieba.cut('预热', true)
  jiebaOk = true
} catch (e) {
  jiebaOk = false
}

function tryLoadCustomDict() {
  if (!jiebaOk) return
  try {
    const appPath = process.env.INKARK_APP_PATH || path.resolve(__dirname, '..', '..')
    const dictPath = path.join(appPath, 'electron', 'data', 'jieba-custom-dict.txt')
    if (fs.existsSync(dictPath)) {
      const content = fs.readFileSync(dictPath, 'utf-8')
      if (content.trim()) {
        jieba.with_dict(content)
      }
    }
  } catch (e) {
  }
}
tryLoadCustomDict()

function fallbackTokenize(text) {
  return text.replace(/([\u4e00-\u9fff])/g, ' $1 ').replace(/\s+/g, ' ').trim()
}

function tokenizeOne(text) {
  if (jiebaOk && jieba) {
    try {
      return jieba.cut(text, true).join(' ')
    } catch {
      return fallbackTokenize(text)
    }
  }
  return fallbackTokenize(text)
}

function parseTxt(filePath) {
  const buffer = fs.readFileSync(filePath)
  const detected = (chardet.detect(buffer) || 'UTF-8').toString().toUpperCase().replace(/[^A-Z0-9-]/g, '')
  if (detected === 'UTF-8' || detected === 'ASCII' || detected === '') {
    return buffer.toString('utf-8')
  }
  if (iconv.encodingExists(detected)) {
    return iconv.decode(buffer, detected)
  }
  return buffer.toString('utf-8')
}

async function parseDocx(filePath) {
  const mammoth = require('mammoth')
  const result = await mammoth.extractRawText({ path: filePath })
  return result.value
}

const DEFAULT_MIN_CHAPTER_LENGTH = 10

const CN_NUM = '一二三四五六七八九十百千零〇两壹贰叁肆伍陆柒捌玖拾佰仟'

const BUILTIN_PATTERNS = [
  {
    name: '中文章节(第X章)',
    regex: new RegExp(`^[ \\t\\u3000]*第[\\s\\u3000]*(?:[0-9]+|[${CN_NUM}]+)[ \\t\\u3000]*章`, 'm'),
  },
  {
    name: '中文章节(第X卷/回/节/集/部/篇/话/幕)',
    regex: new RegExp(`^[ \\t\\u3000]*第[\\s\\u3000]*(?:[0-9]+|[${CN_NUM}]+)[ \\t\\u3000]*(?:回|卷|节|集|部|篇|话|幕)`, 'm'),
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

function collectMatches(text, regex) {
  const out = []
  const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g'
  const globalRe = new RegExp(regex.source, flags)
  let m
  while ((m = globalRe.exec(text)) !== null) {
    const lineEnd = text.indexOf('\n', m.index)
    const line = text.slice(m.index, lineEnd === -1 ? text.length : lineEnd).trim()
    out.push({ index: m.index, line })
    if (m.index === globalRe.lastIndex) globalRe.lastIndex++
  }
  return out
}

function chooseAutoRule(text) {
  let best = null
  for (let i = 0; i < BUILTIN_PATTERNS.length - 1; i++) {
    const rule = BUILTIN_PATTERNS[i]
    const matches = collectMatches(text, rule.regex)
    if (matches.length >= 2 && (!best || matches.length > best.matches.length)) {
      best = { name: rule.name, matches }
    }
  }
  return best || { name: '', matches: [] }
}

function preserveFirstLineIndent(s) {
  const m = s.match(/^([　 \t]+)/)
  const indent = m ? m[1] : ''
  const rest = s.slice(indent.length).replace(/^[\s　]+/, '').replace(/[\s　]+$/, '')
  return indent + rest
}

function sliceByMatches(text, matches, fallbackTitle) {
  if (matches.length === 0) {
    return [{ title: fallbackTitle, content: preserveFirstLineIndent(text), charCount: text.length }]
  }
  const chapters = []
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

function mergeTinyChapters(chapters, minLength, fallbackTitle) {
  if (chapters.length < 2) return chapters
  const merged = []
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

function splitChapters(text, options, fallbackTitle) {
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
    const splits = []
    for (const m of matches) {
      const lineEnd = text.indexOf('\n', m.index)
      const length = lineEnd === -1 ? text.length - m.index : lineEnd - m.index
      splits.push({ index: m.index, length })
    }
    const chapters = []
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
    const normalized = (options.pattern || '').replace(/\*/g, '.*')
    let re
    try {
      re = new RegExp(`^[ \\t\\u3000]*${normalized}[ \\t\\u3000]*.*$`, 'm')
    } catch (e) {
      return {
        chapters: [{ title: fallbackTitle, content: preserveFirstLineIndent(text), charCount: text.length }],
        matchedRule: '自定义正则(无效)',
        totalChars,
      }
    }
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
    return {
      chapters: mergeTinyChapters(sliceByMatches(text, matches, fallbackTitle), minLen, fallbackTitle),
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
  return {
    chapters: mergeTinyChapters(sliceByMatches(text, auto.matches, fallbackTitle), minLen, fallbackTitle),
    matchedRule: `自动识别: ${auto.name}`,
    totalChars,
  }
}

async function handleParseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  const fileName = path.basename(filePath)
  let text
  if (ext === 'txt' || ext === 'md') {
    text = parseTxt(filePath)
  } else if (ext === 'doc' || ext === 'docx') {
    text = await parseDocx(filePath)
  } else {
    throw new Error(`不支持的格式: .${ext}`)
  }
  text = text.replace(/\r\n/g, '\n')
  return { text, fileName, ext }
}

function handleSplitChapters(text, splitOptions, fallbackTitle) {
  return splitChapters(text, splitOptions, fallbackTitle)
}

function handleTokenizeBatch(texts) {
  return texts.map((t) => tokenizeOne(t || ''))
}

if (parentPort) {
  parentPort.on('message', async (msg) => {
    const { id, type, payload } = msg
    try {
      let data
      if (type === 'parseFile') {
        data = await handleParseFile(payload.filePath)
      } else if (type === 'splitChapters') {
        data = handleSplitChapters(payload.text, payload.splitOptions, payload.fallbackTitle)
      } else if (type === 'tokenizeBatch') {
        data = handleTokenizeBatch(payload.texts)
      } else {
        throw new Error(`Unknown message type: ${type}`)
      }
      parentPort.postMessage({ id, ok: true, data })
    } catch (err) {
      parentPort.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) })
    }
  })
} else if (typeof module !== 'undefined' && module.exports) {
  // 测试入口: 暴露内部函数, 供 vitest 直接 require 验证 ts/cjs 一致性
  module.exports = { splitChapters, preserveFirstLineIndent }
}
