import { app } from 'electron'
import path from 'path'
import fs from 'fs'

let jiebaAvailable = false

const fallbackTokenize = (text: string): string =>
  text.replace(/([\u4e00-\u9fff])/g, ' $1 ').replace(/\s+/g, ' ').trim()

function getDataDir(): string {
  return path.join(app.getAppPath(), 'electron', 'data')
}

function getCustomDictPath(): string {
  const dataDir = getDataDir()
  return path.join(dataDir, 'jieba-custom-dict.txt')
}

export function initTokenizer(): void {
  try {
    const jieba = require('jieba-wasm')
    jieba.cut('预热', true)
    jiebaAvailable = true
    console.log('[tokenizer] jieba-wasm 加载成功')
  } catch (err) {
    console.error('[tokenizer] jieba-wasm 加载失败，降级为逐字分词:', err)
    jiebaAvailable = false
  }
}

export function isJiebaAvailable(): boolean {
  return jiebaAvailable
}

export function tokenizeChinese(text: string): string {
  if (jiebaAvailable) {
    try {
      return require('jieba-wasm').cut(text, true).join(' ')
    } catch {
      return fallbackTokenize(text)
    }
  }
  return fallbackTokenize(text)
}

export function addCustomWord(word: string, freq?: number): void {
  if (jiebaAvailable) {
    try {
      require('jieba-wasm').add_word(word, freq)
    } catch (err) {
      console.error('[tokenizer] addCustomWord 失败:', err)
    }
  }
}

export function loadCustomDict(): void {
  if (!jiebaAvailable) return
  const dictPath = getCustomDictPath()
  if (!fs.existsSync(dictPath)) {
    console.log('[tokenizer] 自定义词典不存在，跳过:', dictPath)
    return
  }
  try {
    const content = fs.readFileSync(dictPath, 'utf-8')
    if (content.trim()) {
      require('jieba-wasm').with_dict(content)
      const lineCount = content.split('\n').filter((l: string) => l.trim()).length
      console.log(`[tokenizer] 自定义词典已加载，共 ${lineCount} 条`)
    }
  } catch (err) {
    console.error('[tokenizer] 自定义词典加载失败:', err)
  }
}
