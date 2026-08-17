import { describe, it, expect } from 'vitest'
import { RingBuffer } from '../ring'

describe('RingBuffer', () => {
  it('初始为空', () => {
    const r = new RingBuffer<number>(3)
    expect(r.length).toBe(0)
    expect(r.toArray()).toEqual([])
  })

  it('按顺序追加,toArray 返回最旧 → 最新', () => {
    const r = new RingBuffer<number>(5)
    r.push(1); r.push(2); r.push(3)
    expect(r.toArray()).toEqual([1, 2, 3])
  })

  it('满了之后旧的被挤掉', () => {
    const r = new RingBuffer<number>(3)
    r.push(1); r.push(2); r.push(3); r.push(4); r.push(5)
    expect(r.toArray()).toEqual([3, 4, 5])
    expect(r.length).toBe(3)
  })

  it('clear 后清空', () => {
    const r = new RingBuffer<number>(3)
    r.push(1); r.push(2)
    r.clear()
    expect(r.length).toBe(0)
    expect(r.toArray()).toEqual([])
    r.push(99)
    expect(r.toArray()).toEqual([99])
  })

  it('capacity 至少为 1', () => {
    const r = new RingBuffer<number>(0)
    expect(r.capacity).toBe(1)
    r.push(1); r.push(2)
    expect(r.toArray()).toEqual([2])
  })

  it('装满后再 push,length 不变', () => {
    const r = new RingBuffer<string>(2)
    r.push('a'); r.push('b'); r.push('c'); r.push('d')
    expect(r.length).toBe(2)
    expect(r.toArray()).toEqual(['c', 'd'])
  })
})