import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

// \u5b57\u7b26\u6570 (\u4e0d\u8ba1\u7a7a\u767d) \u2014 \u4e0e db \u91cc chapter.word_count \u53e3\u5f84\u4e00\u81f4 (\u5bfc\u5165 / \u7f16\u8f91\u65f6\u90fd\u6309\u6b64\u7b97)
// \u7a7a\u767d = \s (\u7a7a\u683c/Tab/\u6362\u884c) + \u96f6\u5bbd\u5b57\u7b26 (ZWS/ZWNJ/ZWJ/BOM)
const ZERO_WIDTH_RE = /[\u200b-\u200d\ufeff]/g
export function countChars(text: string): number {
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, '').replace(ZERO_WIDTH_RE, '').length
}

// \u4e2d\u82f1\u6587\u6df7\u6392\u5b57\u6570: CJK \u6c49\u5b57\u6309\u5b57\u8ba1, \u62c9\u4e01\u8bcd\u6309\u8bcd\u8ba1 \u2014 \u7528\u4e8e\u5373\u65f6\u663e\u793a, \u4e0d\u6301\u4e45\u5316
export function countWords(text: string): number {
  if (!text.trim()) return 0
  const cleaned = text.replace(/<[^>]*>/g, '').trim()
  const latinWords = cleaned.match(/[a-zA-Z0-9]+(?:'[a-zA-Z]+)?/g) || []
  const cjkChars = cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []
  return latinWords.length + cjkChars.length
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^\.+/, '_')
    .trim() || '未命名'
}
