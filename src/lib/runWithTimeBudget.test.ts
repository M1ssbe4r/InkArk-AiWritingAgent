/**
 * 时间预算切片: 验证 runWithTimeBudget 在工作循环中按时间预算而非数量切片 yield.
 * 核心 invariant: 单次连续 work 不会超过 timeBudgetMs, 避免主进程长时间占用.
 *
 * 用注入的 now() 函数模拟时间流逝, 避免依赖 Windows 上 Date.now 的精度.
 */
import { describe, it, expect, vi } from 'vitest'
import { runWithTimeBudget, DEFAULT_DEFERRED_FTS_TIME_BUDGET_MS } from '../../electron/ipc/projectImport'

describe('runWithTimeBudget', () => {
  it('默认 8ms 预算', () => {
    expect(DEFAULT_DEFERRED_FTS_TIME_BUDGET_MS).toBe(8)
  })

  it('callback 实际耗时 > 预算时, yield 至少被调 4 次', async () => {
    // 20 个 callback, 每次 10ms, 预算 25ms
    // 旧"每 N 个 yield" 逻辑: 20 个 callback 最多 yield 1 次
    // 新"按时间预算 yield" 逻辑: 至少 yield 4-5 次 (远大于 1, 体现按时间切片)
    let now = 0
    const items = Array.from({ length: 20 })
    let yields = 0
    await runWithTimeBudget(items, () => { now += 10 }, {
      timeBudgetMs: 25,
      shouldYield: async () => { yields++ },
      now: () => now,
    })
    expect(yields).toBeGreaterThanOrEqual(4)
  })

  it('单次连续 work 不超过 timeBudgetMs 太多 (核心 invariant)', async () => {
    // mock: 每次 callback 推 5ms, 预算 12ms
    let now = 0
    const sliceTimes: number[] = []
    let sliceStart = 0
    const items = Array.from({ length: 10 })

    await runWithTimeBudget(items, () => { now += 5 }, {
      timeBudgetMs: 12,
      shouldYield: async () => {
        sliceTimes.push(now - sliceStart)
        sliceStart = now
      },
      now: () => now,
    })
    // 最后一段
    sliceTimes.push(now - sliceStart)

    // 每段连续 work 都不应超过 预算 + 一次 callback 的余量
    for (const t of sliceTimes) {
      expect(t).toBeLessThanOrEqual(12 + 5)
    }
  })

  it('空数组不调 yield, 不报错', async () => {
    const yields = vi.fn()
    await runWithTimeBudget([], () => {}, { shouldYield: yields })
    expect(yields).not.toHaveBeenCalled()
  })

  it('callback 抛错不中断整个流程', async () => {
    const items = [1, 2, 3, 4, 5]
    const seen: number[] = []
    await runWithTimeBudget(items, (it) => {
      if (it === 3) throw new Error('boom')
      seen.push(it)
    }, { timeBudgetMs: 1 })
    // 4 个 callback 中只有 3 抛错, 其余都应被处理
    expect(seen).toEqual([1, 2, 4, 5])
  })

  it('无实际耗时的 callback, yield 不被调 (空转不浪费 tick)', async () => {
    let yields = 0
    const items = Array.from({ length: 1000 })
    await runWithTimeBudget(items, () => {}, {
      timeBudgetMs: 8,
      shouldYield: async () => { yields++ },
    })
    expect(yields).toBe(0)
  })

  it('大量 callback 时 yield 次数明显多于"按数量切片"的旧逻辑', async () => {
    // 100 个 callback, 预算 20ms, 每次 callback 推 10ms
    let now = 0
    let yields = 0
    const items = Array.from({ length: 100 })
    await runWithTimeBudget(items, () => { now += 10 }, {
      timeBudgetMs: 20,
      shouldYield: async () => { yields++ },
      now: () => now,
    })
    // 100 * 10ms = 1000ms / 20ms = 50 次 yield
    expect(yields).toBeGreaterThanOrEqual(40)
    expect(yields).toBeLessThanOrEqual(60)
  })
})
