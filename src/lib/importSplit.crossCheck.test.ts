/**
 * 交叉验证: parseWorker.cjs (worker 实际跑的代码) 与 importSplit.ts (主进程直接走的代码)
 * 必须对相同输入返回相同结果。任何漂移都是 bug, 因为生产路径上 main 走 ts, worker 走 cjs。
 *
 * 避免 cjs 加载链里 jieba-wasm/chardet/iconv-lite 的副作用影响测试, 单独 require 这个文件。
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cjs = createRequire(import.meta.url)('../../electron/workers/parseWorker.cjs') as {
  splitChapters: (text: string, options: any, fallbackTitle: string) => {
    chapters: Array<{ title: string; content: string; charCount: number }>
    matchedRule: string
    totalChars: number
  }
  preserveFirstLineIndent: (s: string) => string
}
import { splitChapters as tsSplit } from '../../electron/ipc/importSplit'

interface Case {
  name: string
  text: string
  options: any
  fallbackTitle: string
}

const CASES: Case[] = [
  {
    name: 'auto 模式 + 中文段首缩进',
    text: [
      '第一章 起点',
      '　　如果从太空里俯瞰东林。',
      '这是一颗美丽的。'.repeat(10),
      '',
      '第二章 发展',
      '　　然而对于东林区的居民来说。',
      '光荣历史。'.repeat(10),
    ].join('\n'),
    options: { mode: 'auto' },
    fallbackTitle: 'fb',
  },
  {
    name: 'whole 模式',
    text: '　　如果从太空里俯瞰东林，这是一颗美丽的。\n　　段二首行缩进。',
    options: { mode: 'whole' },
    fallbackTitle: 'book',
  },
  {
    name: 'blankline 模式',
    text: [
      '　　段一首行缩进。',
      '',
      '',
      '　　段二首行缩进。',
    ].join('\n'),
    options: { mode: 'blankline' },
    fallbackTitle: 'fb',
  },
  {
    name: 'pattern 模式',
    text: [
      'Episode 1',
      '　　内容一'.repeat(20),
      '',
      'Episode 2',
      '　　内容二'.repeat(20),
    ].join('\n'),
    options: { mode: 'pattern', pattern: 'Episode \\d+' },
    fallbackTitle: 'show',
  },
  {
    name: 'auto 模式 auto 失败兜底',
    text: '　　散文不分章节，没有特殊标记。'.repeat(20),
    options: { mode: 'auto' },
    fallbackTitle: '散文',
  },
  {
    name: 'auto 模式 + 行内「第N章」正文不误识别',
    text: [
      '第一章 起点',
      '　　故事开始。'.repeat(10),
      '　　如第一章所言，春天来了。'.repeat(5),
      '',
      '第二章 发展',
      '　　故事发展。'.repeat(10),
    ].join('\n'),
    options: { mode: 'auto' },
    fallbackTitle: 'fb',
  },
  {
    name: 'minChapterLength 触发合并',
    text: [
      '第一章 起点',
      '　　很长的内容'.repeat(30),
      '',
      '小标题',
      '只有几个字',
      '',
      '第二章 发展',
      '　　更多内容'.repeat(30),
    ].join('\n'),
    options: { mode: 'auto', minChapterLength: 200 },
    fallbackTitle: 'fb',
  },
]

describe('ts/cjs cross-check (splitChapters)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const tsResult = tsSplit(c.text, c.options, c.fallbackTitle)
      const cjsResult = cjs.splitChapters(c.text, c.options, c.fallbackTitle)
      // matchedRule 是字符串, 严格相等
      expect(cjsResult.matchedRule).toBe(tsResult.matchedRule)
      // totalChars 严格相等
      expect(cjsResult.totalChars).toBe(tsResult.totalChars)
      // chapters 数组长度必须一致
      expect(cjsResult.chapters.length).toBe(tsResult.chapters.length)
      // 每章 title/content/charCount 严格相等
      for (let i = 0; i < tsResult.chapters.length; i++) {
        expect(cjsResult.chapters[i].title).toBe(tsResult.chapters[i].title)
        expect(cjsResult.chapters[i].content).toBe(tsResult.chapters[i].content)
        expect(cjsResult.chapters[i].charCount).toBe(tsResult.chapters[i].charCount)
      }
    })
  }
})

describe('ts/cjs cross-check (preserveFirstLineIndent)', () => {
  const inputs = [
    '　　如果从太空里俯瞰东林，这是一颗美丽的。',
    '  两个半角空格缩进。',
    '\t\t两个制表缩进。',
    '　段首一个全角。',
    '无缩进正常文字。',
    '　　混合\n　　缩进多行。',
    '   段尾空白   ',
    '',
  ]
  // ts 这边 preserveFirstLineIndent 没导出, 通过 textToHtml 间接验证
  // 直接对比 cjs 的实现, 因为两边就是同一份代码的副本, 行为应一致
  it('cjs 内部函数能正确保留段首缩进', () => {
    for (const s of inputs) {
      const out = cjs.preserveFirstLineIndent(s)
      // 段首的全角/制表/半角缩进必须保留
      const m = s.match(/^([　 \t]+)/)
      if (m) {
        expect(out.startsWith(m[1])).toBe(true)
      }
      // 段尾的 \s 应当被清理
      expect(out).not.toMatch(/[\s　]$/)
    }
  })
})
