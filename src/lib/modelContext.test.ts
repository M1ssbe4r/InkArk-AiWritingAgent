import { describe, it, expect } from 'vitest'
import { getContextWindow, clampContextK, MIN_CONTEXT_K, MAX_CONTEXT_K, DEFAULT_CONTEXT_K } from './modelContext'

describe('clampContextK', () => {
  it('returns default for null/undefined/NaN', () => {
    expect(clampContextK(null)).toBe(DEFAULT_CONTEXT_K)
    expect(clampContextK(undefined)).toBe(DEFAULT_CONTEXT_K)
    expect(clampContextK('abc')).toBe(DEFAULT_CONTEXT_K)
    expect(clampContextK(NaN)).toBe(DEFAULT_CONTEXT_K)
  })

  it('floors to integer', () => {
    expect(clampContextK(128.7)).toBe(128)
    expect(clampContextK('200.9')).toBe(200)
  })

  it('clamps below min', () => {
    expect(clampContextK(0)).toBe(MIN_CONTEXT_K)
    expect(clampContextK(-100)).toBe(MIN_CONTEXT_K)
    expect(clampContextK(10)).toBe(MIN_CONTEXT_K)
  })

  it('clamps above max', () => {
    expect(clampContextK(2000)).toBe(MAX_CONTEXT_K)
    expect(clampContextK(MAX_CONTEXT_K + 1)).toBe(MAX_CONTEXT_K)
  })

  it('passes through valid values', () => {
    expect(clampContextK(200)).toBe(200)
    expect(clampContextK(32)).toBe(32)
    expect(clampContextK(1000)).toBe(1000)
  })
})

describe('getContextWindow', () => {
  it('returns k * 1000', () => {
    expect(getContextWindow(200)).toBe(200000)
    expect(getContextWindow(128)).toBe(128000)
    expect(getContextWindow(1)).toBe(MIN_CONTEXT_K * 1000)  // 1 < MIN so clamps
  })

  it('falls back to default for missing input', () => {
    expect(getContextWindow(undefined)).toBe(DEFAULT_CONTEXT_K * 1000)
    expect(getContextWindow(null)).toBe(DEFAULT_CONTEXT_K * 1000)
  })

  it('clamps out-of-range input', () => {
    expect(getContextWindow(0)).toBe(MIN_CONTEXT_K * 1000)
    expect(getContextWindow(99999)).toBe(MAX_CONTEXT_K * 1000)
  })
})
