/**
 * 固定容量环形缓冲
 *
 * 导出诊断包时直接 dump 整 ring,用于"用户在导出前 30 秒内发生什么"的回放。
 * 不做并发保护:写入只在主进程,单线程。
 */

export class RingBuffer<T> {
  private buf: (T | undefined)[]
  private head = 0
  private size = 0
  readonly capacity: number

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity)
    this.buf = new Array(this.capacity)
  }

  push(item: T) {
    this.buf[this.head] = item
    this.head = (this.head + 1) % this.capacity
    if (this.size < this.capacity) this.size++
  }

  /** 按时间正序返回(最旧 → 最新) */
  toArray(): T[] {
    const out: T[] = []
    if (this.size === 0) return out
    const start = this.size < this.capacity ? 0 : this.head
    for (let i = 0; i < this.size; i++) {
      const item = this.buf[(start + i) % this.capacity]
      if (item !== undefined) out.push(item)
    }
    return out
  }

  get length() { return this.size }
  clear() {
    this.buf = new Array(this.capacity)
    this.head = 0
    this.size = 0
  }
}
