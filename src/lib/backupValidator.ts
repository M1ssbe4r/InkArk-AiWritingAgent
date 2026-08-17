export interface BackupChapter {
  id: string
  title: string
  content: string
  chapter_outline: string
  summary?: string
  sort_order: number
  status: string
  word_count: number
  created_at?: string
  updated_at?: string
}

export interface BackupProject {
  id: string
  title: string
  outline: string
  word_count?: number
  style_guidance?: string
  created_at?: string
  updated_at?: string
}

export interface BackupCharacterCard {
  id: string
  name: string
  alias?: string
  description?: string
  role?: string
  traits?: string | string[]
  appearance?: string
  background?: string
  relationships?: string
  notes?: string
  tags?: string | string[]
  card_group?: string
  sort_order?: number
  gender?: string
  age?: string
  created_at?: string
  updated_at?: string
}

export interface BackupWorldCard {
  id: string
  name: string
  card_type: string
  description?: string
  tags?: string | string[]
  card_group?: string
  parent_id?: string | null
  sort_order?: number
  notes?: string
  created_at?: string
  updated_at?: string
}

export interface BackupData {
  version: number
  exportedAt?: string
  project: BackupProject
  chapters: BackupChapter[]
  characterCards?: BackupCharacterCard[]
  worldCards?: BackupWorldCard[]
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

const MAX_TITLE_LENGTH = 1000
const MAX_CONTENT_LENGTH = 50_000_000
const MAX_CHAPTERS = 50_000
const MAX_CARDS = 50_000
const MAX_OUTLINE_LENGTH = 200_000
const MAX_STRING_LENGTH = 50_000

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || isString(value)
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || value === null || isNumber(value)
}

function hasProtoPollution(obj: unknown): boolean {
  if (obj === null || typeof obj !== 'object') return false
  if (Object.prototype.hasOwnProperty.call(obj, '__proto__')) return true
  if (Object.prototype.hasOwnProperty.call(obj, 'constructor')) {
    const ctor = (obj as Record<string, unknown>).constructor
    if (typeof ctor === 'object' && ctor !== null) return true
  }
  return false
}

function validateStringField(value: unknown, name: string, maxLength: number, required = true): string | null {
  if (required) {
    if (!isString(value)) return `${name} 必须是字符串`
  } else {
    if (value !== undefined && value !== null && !isString(value)) return `${name} 必须是字符串或空值`
    if (!isString(value)) return null
  }
  if (value.length > maxLength) return `${name} 超过最大长度 ${maxLength}`
  return null
}

function validateNumberField(value: unknown, name: string, min: number, max: number, required = true): string | null {
  if (required) {
    if (!isNumber(value)) return `${name} 必须是数字`
  } else {
    if (value !== undefined && value !== null && !isNumber(value)) return `${name} 必须是数字或空值`
    if (!isNumber(value)) return null
  }
  if (value < min || value > max) return `${name} 必须在 ${min} 到 ${max} 之间`
  return null
}

export function validateBackup(data: unknown): ValidationResult {
  if (data === null || typeof data !== 'object') {
    return { valid: false, error: '备份数据必须是对象' }
  }

  if (hasProtoPollution(data)) {
    return { valid: false, error: '检测到非法字段注入' }
  }

  const backup = data as Record<string, unknown>

  if (backup.version !== 1 && backup.version !== 2 && backup.version !== 3) {
    return { valid: false, error: `不支持的备份版本: ${backup.version}` }
  }
  const backupVersion = backup.version as number

  const project = backup.project
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    return { valid: false, error: 'project 必须是对象' }
  }
  if (hasProtoPollution(project)) {
    return { valid: false, error: 'project 包含非法字段' }
  }

  let err = validateStringField((project as Record<string, unknown>).id, 'project.id', 100)
  if (err) return { valid: false, error: err }
  err = validateStringField((project as Record<string, unknown>).title, 'project.title', MAX_TITLE_LENGTH)
  if (err) return { valid: false, error: err }
  err = validateStringField((project as Record<string, unknown>).outline, 'project.outline', MAX_OUTLINE_LENGTH, false)
  if (err) return { valid: false, error: err }
  err = validateStringField((project as Record<string, unknown>).synopsis, 'project.synopsis', 2000, false)
  if (err) return { valid: false, error: err }
  err = validateNumberField((project as Record<string, unknown>).word_count, 'project.word_count', 0, Number.MAX_SAFE_INTEGER, false)
  if (err) return { valid: false, error: err }

  const chapters = backup.chapters
  if (!Array.isArray(chapters)) {
    return { valid: false, error: 'chapters 必须是数组' }
  }
  if (chapters.length > MAX_CHAPTERS) {
    return { valid: false, error: `章节数量超过上限 ${MAX_CHAPTERS}` }
  }

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    if (!ch || typeof ch !== 'object' || Array.isArray(ch)) {
      return { valid: false, error: `chapters[${i}] 必须是对象` }
    }
    if (hasProtoPollution(ch)) {
      return { valid: false, error: `chapters[${i}] 包含非法字段` }
    }
    const c = ch as Record<string, unknown>

    err = validateStringField(c.id, `chapters[${i}].id`, 100)
    if (err) return { valid: false, error: err }
    err = validateStringField(c.title, `chapters[${i}].title`, MAX_TITLE_LENGTH)
    if (err) return { valid: false, error: err }
    err = validateStringField(c.content, `chapters[${i}].content`, MAX_CONTENT_LENGTH)
    if (err) return { valid: false, error: err }
    err = validateStringField(c.chapter_outline || c.summary, `chapters[${i}].chapter_outline`, MAX_OUTLINE_LENGTH, false)
    if (err) return { valid: false, error: err }
    err = validateStringField(c.status, `chapters[${i}].status`, 50, false)
    if (err) return { valid: false, error: err }
    err = validateNumberField(c.sort_order, `chapters[${i}].sort_order`, 0, Number.MAX_SAFE_INTEGER)
    if (err) return { valid: false, error: err }
    err = validateNumberField(c.word_count, `chapters[${i}].word_count`, 0, Number.MAX_SAFE_INTEGER, false)
    if (err) return { valid: false, error: err }
  }

  const characterCards = backup.characterCards
  if (characterCards !== undefined && characterCards !== null) {
    if (!Array.isArray(characterCards)) {
      return { valid: false, error: 'characterCards 必须是数组' }
    }
    if (characterCards.length > MAX_CARDS) {
      return { valid: false, error: `角色卡数量超过上限 ${MAX_CARDS}` }
    }
    for (let i = 0; i < characterCards.length; i++) {
      const card = characterCards[i]
      if (!card || typeof card !== 'object' || Array.isArray(card)) {
        return { valid: false, error: `characterCards[${i}] 必须是对象` }
      }
      if (hasProtoPollution(card)) {
        return { valid: false, error: `characterCards[${i}] 包含非法字段` }
      }
      const c = card as Record<string, unknown>
      err = validateStringField(c.id, `characterCards[${i}].id`, 100)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.name, `characterCards[${i}].name`, MAX_TITLE_LENGTH)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.alias, `characterCards[${i}].alias`, MAX_STRING_LENGTH, false)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.description, `characterCards[${i}].description`, MAX_STRING_LENGTH, false)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.role, `characterCards[${i}].role`, MAX_STRING_LENGTH, false)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.appearance, `characterCards[${i}].appearance`, MAX_STRING_LENGTH, false)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.background, `characterCards[${i}].background`, MAX_STRING_LENGTH, false)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.relationships, `characterCards[${i}].relationships`, MAX_STRING_LENGTH, false)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.notes, `characterCards[${i}].notes`, MAX_STRING_LENGTH, false)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.card_group, `characterCards[${i}].card_group`, MAX_STRING_LENGTH, false)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.gender, `characterCards[${i}].gender`, 100, false)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.age, `characterCards[${i}].age`, 100, false)
      if (err) return { valid: false, error: err }
      err = validateNumberField(c.sort_order, `characterCards[${i}].sort_order`, 0, Number.MAX_SAFE_INTEGER, false)
      if (err) return { valid: false, error: err }
    }
  }

  const worldCards = backup.worldCards
  if (worldCards !== undefined && worldCards !== null) {
    if (!Array.isArray(worldCards)) {
      return { valid: false, error: 'worldCards 必须是数组' }
    }
    if (worldCards.length > MAX_CARDS) {
      return { valid: false, error: `世界观卡数量超过上限 ${MAX_CARDS}` }
    }
    for (let i = 0; i < worldCards.length; i++) {
      const card = worldCards[i]
      if (!card || typeof card !== 'object' || Array.isArray(card)) {
        return { valid: false, error: `worldCards[${i}] 必须是对象` }
      }
      if (hasProtoPollution(card)) {
        return { valid: false, error: `worldCards[${i}] 包含非法字段` }
      }
      const c = card as Record<string, unknown>
      err = validateStringField(c.id, `worldCards[${i}].id`, 100)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.name, `worldCards[${i}].name`, MAX_TITLE_LENGTH)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.card_type, `worldCards[${i}].card_type`, 100)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.description, `worldCards[${i}].description`, MAX_STRING_LENGTH, false)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.card_group, `worldCards[${i}].card_group`, MAX_STRING_LENGTH, false)
      if (err) return { valid: false, error: err }
      err = validateStringField(c.notes, `worldCards[${i}].notes`, MAX_STRING_LENGTH, false)
      if (err) return { valid: false, error: err }
      err = validateNumberField(c.sort_order, `worldCards[${i}].sort_order`, 0, Number.MAX_SAFE_INTEGER, false)
      if (err) return { valid: false, error: err }
    }
  }

  const volumes = backup.volumes
  if (volumes !== undefined && volumes !== null) {
    if (!Array.isArray(volumes)) {
      return { valid: false, error: 'volumes 必须是数组' }
    }
    if (volumes.length > 200) {
      return { valid: false, error: 'volumes 数量超过上限 200' }
    }
    const validStatuses = new Set(['planned', 'writing', 'done', 'paused'])
    for (let i = 0; i < volumes.length; i++) {
      const vol = volumes[i]
      if (!vol || typeof vol !== 'object' || Array.isArray(vol)) {
        return { valid: false, error: `volumes[${i}] 必须是对象` }
      }
      if (hasProtoPollution(vol)) {
        return { valid: false, error: `volumes[${i}] 包含非法字段` }
      }
      const v = vol as Record<string, unknown>
      err = validateStringField(v.title, `volumes[${i}].title`, MAX_TITLE_LENGTH)
      if (err) return { valid: false, error: err }
      // 兼容新旧备份格式:新版本用 outline,老备份用 summary
      err = validateStringField(v.outline, `volumes[${i}].outline`, MAX_OUTLINE_LENGTH, false)
      if (err) return { valid: false, error: err }
      if (v.status !== undefined && v.status !== null && (!isString(v.status) || !validStatuses.has(v.status as string))) {
        return { valid: false, error: `volumes[${i}].status 非法` }
      }
      err = validateNumberField(v.sort_order, `volumes[${i}].sort_order`, 0, Number.MAX_SAFE_INTEGER)
      if (err) return { valid: false, error: err }
    }
  }

  if ((project as Record<string, unknown>).style_guidance !== undefined && (project as Record<string, unknown>).style_guidance !== null && !isString((project as Record<string, unknown>).style_guidance)) {
    return { valid: false, error: 'style_guidance 必须是字符串' }
  }
  if (isString((project as Record<string, unknown>).style_guidance) && ((project as Record<string, unknown>).style_guidance as string).length > MAX_CONTENT_LENGTH) {
    return { valid: false, error: `style_guidance 超过最大长度 ${MAX_CONTENT_LENGTH}` }
  }

  if ((project as Record<string, unknown>).writing_restrictions !== undefined && (project as Record<string, unknown>).writing_restrictions !== null && !isString((project as Record<string, unknown>).writing_restrictions)) {
    return { valid: false, error: 'writing_restrictions 必须是字符串' }
  }
  if (isString((project as Record<string, unknown>).writing_restrictions) && ((project as Record<string, unknown>).writing_restrictions as string).length > MAX_CONTENT_LENGTH) {
    return { valid: false, error: `writing_restrictions 超过最大长度 ${MAX_CONTENT_LENGTH}` }
  }

  // v2: style_custom_id (optional string)
  if (backupVersion === 2) {
    const scid = (project as Record<string, unknown>).style_custom_id
    if (scid !== undefined && scid !== null && !isString(scid)) {
      return { valid: false, error: 'style_custom_id 必须是字符串' }
    }
    if (isString(scid) && (scid as string).length > 100) {
      return { valid: false, error: 'style_custom_id 超过最大长度' }
    }
  }

  // v2: customStyles array (optional)
  if (backupVersion === 2) {
    const customStyles = backup.customStyles
    if (customStyles !== undefined && customStyles !== null) {
      if (!Array.isArray(customStyles)) {
        return { valid: false, error: 'customStyles 必须是数组' }
      }
      if (customStyles.length > 1000) {
        return { valid: false, error: `customStyles 数量超过上限 1000` }
      }
      for (let i = 0; i < customStyles.length; i++) {
        const cs = customStyles[i]
        if (!cs || typeof cs !== 'object' || Array.isArray(cs)) {
          return { valid: false, error: `customStyles[${i}] 必须是对象` }
        }
        if (hasProtoPollution(cs)) {
          return { valid: false, error: `customStyles[${i}] 包含非法字段` }
        }
        let csErr = validateStringField((cs as any).id, `customStyles[${i}].id`, 100)
        if (csErr) return { valid: false, error: csErr }
        csErr = validateStringField((cs as any).name, `customStyles[${i}].name`, 200)
        if (csErr) return { valid: false, error: csErr }
        if ((cs as any).guidance !== undefined && (cs as any).guidance !== null && !isString((cs as any).guidance)) {
          return { valid: false, error: `customStyles[${i}].guidance 必须是字符串` }
        }
        if (isString((cs as any).guidance) && ((cs as any).guidance as string).length > MAX_CONTENT_LENGTH) {
          return { valid: false, error: `customStyles[${i}].guidance 超过最大长度` }
        }
      }
    }
  }

  return { valid: true }
}
