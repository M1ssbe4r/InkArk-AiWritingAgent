/**
 * HTML 工具(纯函数,前后端共用,确保坐标系一致)
 *
 * 重要:任何改动都要保持前后端行为一致,否则 search / vector / FTS / read
 * 四方的 offset 坐标系会对不上,start/end 跟 text.slice(start, end) 错位
 */

/**
 * 把 HTML 字符串转成纯文本。
 *
 * 关键点:
 * - 规范化换行(CRLF / CR → LF),否则 Windows 风格文件会让坐标系偏
 * - 不切单 \n(只切 HTML 标签),让 plainContent 里的 \n 字符保留,
 *   后续 chunkText 才能正确算 start/end
 * - &nbsp; 等 HTML 实体要解码,否则字符数会偏
 * - 末尾 .trim() 砍首尾空白,start 跟着调整
 */
export function stripHtml(html: string): string {
  return html
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
