/**
 * tar 解析器 - 用于 E2E 验证诊断包内容
 *
 * 从 electron/logger/__tests__/export.test.ts 抽出共用。
 * 只支持普通文件(我们生成的就是),格式:
 *   每条 entry: 512 字节头 + 内容(padded 到 512 边界)
 *   结束: 连续两个 512 字节全 0
 */

export interface TarEntry {
  name: string
  size: number
  content: Buffer
}

export function parseTar(buf: Buffer): TarEntry[] {
  const out: TarEntry[] = []
  const BLOCK = 512
  let i = 0
  while (i < buf.length) {
    if (i + BLOCK > buf.length) break
    const header = buf.subarray(i, i + BLOCK)
    if (header.every((b) => b === 0)) break
    const name = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/, '')
    const sizeOct = header.subarray(124, 136).toString('utf-8').replace(/\0.*$/, '').trim()
    const size = parseInt(sizeOct, 8)
    if (Number.isNaN(size) || size < 0) break
    i += BLOCK
    const content = buf.subarray(i, i + size)
    out.push({ name, size, content: Buffer.from(content) })
    i += Math.ceil(size / BLOCK) * BLOCK
  }
  return out
}