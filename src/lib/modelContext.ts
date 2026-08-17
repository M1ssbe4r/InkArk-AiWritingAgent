export const MIN_CONTEXT_K = 32
export const MAX_CONTEXT_K = 1000
export const DEFAULT_CONTEXT_K = 200

// 把用户输入的 k 值清洗到合法区间，强制取整
export function clampContextK(k: unknown): number {
  // 注意：Number(null) === 0，所以必须先单独判 null/undefined
  if (k === null || k === undefined || k === '') return DEFAULT_CONTEXT_K
  const n = typeof k === 'string' ? parseInt(k, 10) : Number(k)
  if (!Number.isFinite(n)) return DEFAULT_CONTEXT_K
  const intN = Math.floor(n)
  if (intN < MIN_CONTEXT_K) return MIN_CONTEXT_K
  if (intN > MAX_CONTEXT_K) return MAX_CONTEXT_K
  return intN
}

// 给 AIPanel / 圆环用的：输入 k，输出 tokens
export function getContextWindow(contextK: unknown): number {
  return clampContextK(contextK) * 1000
}
