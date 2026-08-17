// 从卷标题里把"（第N-M章）"这种章节范围后缀剥掉,避免和独立的 chapter_start/end 字段重复显示
const CHAPTER_RANGE_TITLE_RE = /[（(]\s*第\s*\d+\s*[-–—~至到]\s*\d+\s*章\s*[)）]/g

export function stripChapterRangeFromTitle(title: string): string {
  if (!title) return ''
  return title.replace(CHAPTER_RANGE_TITLE_RE, '').replace(/\s{2,}/g, ' ').trim()
}
