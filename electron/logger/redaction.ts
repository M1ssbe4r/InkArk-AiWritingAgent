/**
 * 脱敏层 - 所有 entry 在写入文件/导出 zip 前必经此关
 *
 * 三道防线:
 *   1) 字段名黑名单:整字段直接替换为 ***REDACTED***
 *   2) 字符串值正则:抓 API key / Bearer token / 邮箱 / 私钥样式
 *   3) 内容字段白名单:章节正文/角色卡正文/style_guidance/messages/prompt 一律 OMIT
 *
 * 任何打包版本关不掉。INKARK_LOG_REDACTION=off 仅允许 dev 阶段调试时使用。
 */

const FIELD_NAME_REDACT = new Set([
  'apikey', 'api_key', 'apiKey',
  'authorization',
  'password', 'passwd', 'pwd',
  'token', 'accesstoken', 'accessToken', 'accesstoken', 'refreshtoken', 'refreshToken',
  'session_token', 'sessionToken',
  'secret', 'client_secret', 'clientSecret',
  'cookie', 'set-cookie', 'setCookie',
  'privatekey', 'privateKey', 'priv_key',
])

/** 整字段直接 omit 的 key,通常因为它是大块正文,直接记体积太大且包含创作内容 */
const FIELD_NAME_OMIT = new Set([
  'content', 'chapterContent',
  'outline', 'chapter_outline',
  'description', 'notes', 'background', 'appearance', 'relationships', 'traits', 'alias',
  'style_guidance', 'styleGuidance',
  'guidance',
  // messages(数组,装的是 chat messages)和 prompt/systemPrompt 都是 prompt 容器,整字段省略。
  // 注意:不要 omit 'message'(单数),它太常见 —— Error.message / log message / HTTP message 都会命中,
  // 会导致 ECONNREFUSED 这种无害信息被错误吞掉。message 走 redactString 字符串脱敏即可。
  'messages',
  'prompt', 'systemPrompt', 'systemprompt', 'userPrompt', 'userprompt',
  'tools',
  'fullText', 'rawText', 'text',
  'chapter', 'chapters', 'character', 'characterCard', 'worldCard',
])

/** API key 模式:sk- / ghp_ / glpat- / AIza / 长 base64 段 */
const API_KEY_REGEX = /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,})\b/g
const BEARER_REGEX = /Bearer\s+[A-Za-z0-9._\-+/=]{16,}/gi
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g
/** 长 hex (>=40 位) 可能是 hash / token */
const HEX_LONG_REGEX = /\b[A-Fa-f0-9]{40,}\b/g

const REDACTED = '***REDACTED***'
const OMITTED = '***OMITTED***'

/** 递归处理 unknown 值,返回脱敏后的安全结构 */
function redactValue(v: unknown, keyName?: string): unknown {
  // 1) 字段名命中黑名单 → 整字段替换
  if (keyName && FIELD_NAME_REDACT.has(keyName)) return REDACTED
  // 2) 字段名命中 omit 集合 → 整字段替换为 OMITTED(表明"这里有内容但故意不记")
  if (keyName && FIELD_NAME_OMIT.has(keyName)) return OMITTED

  if (v === null || v === undefined) return v
  if (typeof v === 'string') return redactString(v)
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.map((x) => redactValue(x))
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = redactValue(val, k)
    }
    return out
  }
  // function / symbol / bigint 等少见类型,丢弃
  return OMITTED
}

function redactString(s: string): string {
  if (s.length === 0) return s
  return s
    .replace(API_KEY_REGEX, REDACTED)
    .replace(BEARER_REGEX, 'Bearer ' + REDACTED)
    .replace(EMAIL_REGEX, REDACTED)
    .replace(HEX_LONG_REGEX, REDACTED)
}

/** 对外入口:对单条 entry 的 msg 和 data 字段做脱敏,其他字段保持原样 */
export function redactEntry<T extends { msg: string; data?: unknown }>(entry: T): T {
  return {
    ...entry,
    msg: redactString(entry.msg),
    data: entry.data === undefined ? undefined : (redactValue(entry.data) as Record<string, unknown>),
  }
}

/** 错误对象序列化:stack 里也可能藏 token,必须过 redact */
export function errorToObject(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack ? String(err.stack) : undefined,
    }
  }
  if (typeof err === 'string') return { message: err }
  if (typeof err === 'object' && err !== null) {
    try {
      return JSON.parse(JSON.stringify(err)) as Record<string, unknown>
    } catch {
      return { message: String(err) }
    }
  }
  return { message: String(err) }
}
