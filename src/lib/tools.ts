import type { Project, CharacterCard, WorldCard, OutlineVolume } from '@/types'
import { generateId } from './utils'
import { useEditorStore } from '@/stores/editorStore'
import { stripHtml } from './html'
import { splitParagraphs, applyChapterParagraphEdits } from './chapterParagraph'
import { splitChunks, mergeChunks } from './chunkSplitter'
import { flushChapterSave, resolvePendingDiff, resolvePendingOutline } from './editorRef'

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

type ToolHandler = (args: Record<string, unknown>, projectId: string) => Promise<string>

let volumeSummaryWritesThisBatch = 0

export function resetVolumeSummaryBatchCounter(): void {
  volumeSummaryWritesThisBatch = 0
}

const parseArrayField = (v: any): any[] => {
  let val = v
  for (let i = 0; i < 3; i++) {
    if (Array.isArray(val)) return val
    if (typeof val === 'string') { try { val = JSON.parse(val); continue } catch { return [] } }
    return []
  }
  return []
}

async function getVolumes(projectId: string): Promise<OutlineVolume[]> {
  return window.electronAPI.volume.list(projectId)
}

function plainHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

function formatVolumeChapterRange(vol: OutlineVolume): string {
  if (vol.chapter_start != null && vol.chapter_end != null) {
    return `第 ${vol.chapter_start}–${vol.chapter_end} 章`
  }
  return '未绑定章节'
}

function formatVolumeListLine(index: number, vol: OutlineVolume): string {
  return `[${index}] ${vol.title || '（未命名）'} | ${formatVolumeChapterRange(vol)} | ${vol.status}`
}

async function volumePlotBeforeChaptersError(projectId: string): Promise<string | null> {
  const volumes = await getVolumes(projectId)
  if (volumes.length < 2) return null
  const missing = volumes.filter((v) => !stripHtml(v.outline || '').trim())
  if (missing.length === 0) return null
  return `错误：尚有 ${missing.length} 卷未填写卷级大纲，请先 write_volume 完成各卷大纲规划，再 create_chapter / write_chapter_outline`
}

async function resolveDefaultVolumeIndex(projectId: string): Promise<number | null> {
  const volumes = await getVolumes(projectId)
  if (volumes.length === 0) return null
  const chapters = await window.electronAPI.chapter.list(projectId)
  const activeId = useEditorStore.getState().activeChapterId
  const ch = chapters.find((c: any) => c.id === activeId) ?? chapters[chapters.length - 1]
  if (!ch) return volumes.length
  const chNum = ch.sort_order + 1
  const matched = volumes.findIndex((v) =>
    v.chapter_start != null && v.chapter_end != null && chNum >= v.chapter_start && chNum <= v.chapter_end,
  )
  if (matched >= 0) return matched + 1
  return volumes.length
}

//工具定义
export const toolDefinitions: ToolDefinition[] = [
  { type: 'function', function: { name: 'list', description: '按类型列出实体概览。type 可选 chapter/character/world/volume。chapter 返回章节标题、章节大纲；volume 返回全部卷的序号、名称、起止章节、状态（仅需 type=volume，无需其它参数）；character/world 返回名称+核心字段摘要。list 后如需特定角色/世界观/卷详情，用 read 工具获取', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['chapter', 'character', 'world', 'volume'], description: '必填，列出哪种类型的实体' }, chapter_indices: { type: 'array', items: { type: 'number' }, description: 'type=chapter 时可选，章节序号数组' } }, required: ['type'] } } },
  { type: 'function', function: { name: 'read', description: '读取指定实体的完整信息。type 可选 chapter_content/character/world/outline/volume/knowledge。outline 返回卷目录（非全文）；volume 需传 volume_index 返回单卷分卷剧情详情', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['chapter_content', 'character', 'world', 'outline', 'volume', 'knowledge'], description: '必填' }, chapter_index: { type: 'number', description: 'type=chapter_content 时必填' }, volume_index: { type: 'number', description: 'type=volume 时必填，1-based' }, name: { type: 'string', description: 'type=character/world/knowledge 时必填' }, start: { type: 'number', description: 'type=knowledge 时必填' }, end: { type: 'number', description: 'type=knowledge 时必填' } }, required: ['type'] } } },
  { type: 'function', function: { name: 'search', description: '搜索工作区。keyword 按关键词精确匹配（多个关键词用空格分隔，按命中数量排序）。scope 必填，指定keyword搜索范围（可多选）：settings（项目内的角色卡+世界观卡）、outlines（分卷剧情+章节大纲）、knowledge（用户附加的知识库资料）、content（章节正文，非必要不搜索，会导致返回大量无用结果）。semantic 语义搜索向量知识库，仅在有向量化知识库时可用。知识库结果带 chunkId，如需更多上下文可调 read 工具传同名+chunkId 范围（start/end 闭区间，如 chunkId=5 可传 start=4, end=6 往前后各扩一个 chunk）。', parameters: { type: 'object', properties: { keyword: { type: 'string', description: '关键词搜索，与 semantic 至少传一个' }, scope: { type: 'array', items: { type: 'string', enum: ['settings', 'outlines', 'knowledge', 'content'] }, description: '必填，指定keyword搜索范围（可多选）。知识库资料选 knowledge，角色卡/世界观卡选 settings。非必要不使用 content', semantic: { type: 'string', description: '语义搜索，仅在有向量化知识库时可用' } }, top_k: { type: 'array', items: { type: 'number' }, description: '每个 scope 返回的最大结果数，与 scope 数组一一对应。如 scope=["settings","outlines"] 则 top_k=[3,2]。默认 settings/outlines 5 条，knowledge/content 10 条' } }, required: ['scope'] } } },
  { type: 'function', function: { name: 'write_chapter_outline', description: '更新章节大纲。须在对应卷的卷级大纲（write_volume.outline）完成后再写。可单章或批量（chapters 数组）；批量前请先 create_chapter', parameters: { type: 'object', properties: { chapter_index: { type: 'number', description: '章节序号，1 表示第一章。单章模式必填' }, outline: { type: 'string', description: '章节大纲，建议200字内。单章模式必填' }, chapters: { type: 'array', items: { type: 'object', properties: { chapter_index: { type: 'number', description: '章节序号' }, outline: { type: 'string', description: '章节大纲，建议200字内' } }, required: ['chapter_index', 'outline'] }, description: '批量更新多个章节的大纲。与 chapter_index/outline 二选一' } }, required: [] } } },
  { type: 'function', function: { name: 'write_character_card', description: '创建或更新角色卡。单张模式传 name + 其它字段；批量模式传 cards 数组（每项含 name + 其它字段），可一次处理多个角色。如果角色名不存在则直接创建；如果已存在则需传 reason 说明修改原因', parameters: { type: 'object', properties: { name: { type: 'string', description: '角色名称（单张模式）' }, new_name: { type: 'string', description: '修改后的新名称（单张模式）' }, reason: { type: 'string', description: '修改原因，更新已有角色时必传' }, alias: { type: 'string', description: '别名/称号' }, description: { type: 'string', description: '角色描述' }, role: { type: 'string', description: '角色定位' }, traits: { type: 'string', description: '性格标签，顿号分隔' }, appearance: { type: 'string', description: '外貌描述' }, background: { type: 'string', description: '背景故事' }, relationships: { type: 'string', description: '人际关系' }, notes: { type: 'string', description: '备注' }, gender: { type: 'string', description: '性别' }, age: { type: 'string', description: '年龄' }, cards: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', description: '角色名称' }, new_name: { type: 'string', description: '修改后的新名称' }, reason: { type: 'string', description: '修改原因' }, alias: { type: 'string' }, description: { type: 'string' }, role: { type: 'string' }, traits: { type: 'string' }, appearance: { type: 'string' }, background: { type: 'string' }, relationships: { type: 'string' }, notes: { type: 'string' }, gender: { type: 'string' }, age: { type: 'string' } }, required: ['name'] }, description: '批量模式：角色数组，传此参数时忽略顶层的 name 等单字段' } }, required: [] } } },
  { type: 'function', function: { name: 'write_world_setting', description: '创建或更新世界观设定。单张模式传 name + 其它字段；批量模式传 cards 数组（每项含 name + 其它字段），可一次处理多个设定。如果世界观名称不存在则直接创建；如果已存在则需传 reason 说明修改原因', parameters: { type: 'object', properties: { name: { type: 'string', description: '世界观元素名称（单张模式）' }, new_name: { type: 'string', description: '修改后的新名称（单张模式）' }, reason: { type: 'string', description: '修改原因，更新已有设定时必传' }, description: { type: 'string', description: '描述' }, type: { type: 'string', description: '类型' }, tags: { type: 'string', description: '标签，顿号分隔' }, notes: { type: 'string', description: '备注' }, cards: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', description: '世界观元素名称' }, new_name: { type: 'string' }, reason: { type: 'string' }, description: { type: 'string' }, type: { type: 'string' }, tags: { type: 'string' }, notes: { type: 'string' } }, required: ['name'] }, description: '批量模式：世界观数组，传此参数时忽略顶层的 name 等单字段' } }, required: [] } } },
  { type: 'function', function: { name: 'create_volume', description: '新建一卷占位，不写 outline。后续用 write_volume 填写卷级大纲', parameters: { type: 'object', properties: { title: { type: 'string', description: '卷名，必填' }, chapter_start: { type: 'number' }, chapter_end: { type: 'number' }, status: { type: 'string', enum: ['planned', 'writing', 'done', 'paused'] } }, required: ['title'] } } },
  { type: 'function', function: { name: 'write_volume', description: '写入或更新单卷，一轮工具调用只写入一卷，禁止一轮调用写入多卷。outline 为本卷卷级大纲（200-500 字的结构化叙事规划）。改 outline 走 diff 审阅；改 progress_notes/status/范围等立即落库。volume_index 改 outline/范围时必填；仅改 progress_notes 时可省略并由系统选择默认卷', parameters: { type: 'object', properties: { volume_index: { type: 'number', description: '卷序号，1-based' }, title: { type: 'string' }, outline: { type: 'string', description: '本卷卷级大纲，HTML 格式（卷级规划,只写卷级大纲正文，禁止写标题/序号等无关内容）' }, progress_notes: { type: 'string', description: '写作进度备注，HTML 或纯文本' }, chapter_start: { type: 'number' }, chapter_end: { type: 'number' }, status: { type: 'string', enum: ['planned', 'writing', 'done', 'paused'] }, reason: { type: 'string', description: '修改 outline 时的说明' } }, required: [] } } },
  { type: 'function', function: { name: 'write_chapter_title', description: '修改章节标题。可单章更新或批量更新。批量更新时传 chapters 数组，每项包含 chapter_index 和 title；单章更新时传 chapter_index 和 title', parameters: { type: 'object', properties: { chapter_index: { type: 'number', description: '章节序号，1 表示第一章。单章模式必填' }, title: { type: 'string', description: '新的章节标题。单章模式必填' }, chapters: { type: 'array', items: { type: 'object', properties: { chapter_index: { type: 'number', description: '章节序号' }, title: { type: 'string', description: '新的章节标题' } }, required: ['chapter_index', 'title'] }, description: '批量更新多个章节的标题。与 chapter_index/title 二选一' } }, required: [] } } },
  { type: 'function', function: { name: 'write_chapter_content', description: '写入或修改指定章节的正文。修改正文必须用 edits/inserts 按段落写入。未知段号时，先 read(type=chapter_content) 获取 [Pn] 编号再改写。空章节首次写作传 content（纯文本，段间 \\n\\n）；非空章节禁止传 content。text/content 为纯文本，勿含章节标题；空 text 表示删除该段。用户要求写作/润色/扩写/缩写/改写/删除时均使用此工具。', parameters: { type: 'object', properties: { chapter_index: { type: 'number', description: '章节序号，1 表示第一章。必填' }, summary: { type: 'string', description: '本次修改说明，如：首次写作、润色对话、扩写场景、删除段落等' }, content: { type: 'string', description: '空章节首次写作：纯文本全文，多段用 \\n\\n 分隔。与 edits/inserts 互斥' }, edits: { type: 'array', items: { type: 'object', properties: { paragraph_index: { type: 'number', description: '1-based 段落序号，须 ≤ 当前段数' }, text: { type: 'string', description: '新段落纯文本；空字符串表示删除该段' } }, required: ['paragraph_index', 'text'] }, description: '非空章节：按段替换或删除' }, inserts: { type: 'array', items: { type: 'object', properties: { after_paragraph_index: { type: 'number', description: '0=文首，N=第 N 段之后（原始编号）' }, text: { type: 'string', description: '新段纯文本，不可为空' } }, required: ['after_paragraph_index', 'text'] }, description: '非空章节：插入新段' } }, required: ['chapter_index', 'summary'] } } },
  { type: 'function', function: { name: 'create_chapter', description: '创建空白章节占位。多卷项目须先完成各卷卷级大纲（write_volume.outline）再创建章节', parameters: { type: 'object', properties: { count: { type: 'number', description: '创建章节数量，默认 1' } }, required: ['count'] } } },
  { type: 'function', function: { name: 'propose_action', description: '向用户提交多个选项供选择。当用户要求提供多个方案（如多个标题建议、多个剧情走向等）时使用此工具提交选项让用户选择。用户选择后，AI 会收到用户的选择结果，然后根据用户选择调用对应的工具来执行操作', parameters: { type: 'object', properties: { type: { type: 'string', description: '操作类型，如：rename_chapter 表示修改章节标题' }, chapter_index: { type: 'number', description: '章节序号，1 表示第一章' }, options: { type: 'array', items: { type: 'string' }, description: '多个建议选项，通常 2-3 个，用户将从中选择' }, params: { type: 'object', description: '其他参数，用户选择后执行操作时可能需要' } }, required: ['type', 'options'] } } },
  { type: 'function', function: { name: 'delete', description: '删除项目内的实体，不可恢复。type 指定类型；同类型支持批量删除（chapter 用 chapter_indices，character/world 用 names，volume 用 volume_indices）。调用后须用户确认才执行，必须传 reason 说明删除原因', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['chapter', 'character', 'world', 'volume'], description: '必填，要删除的实体类型' }, chapter_indices: { type: 'array', items: { type: 'number' }, description: 'type=chapter 时必填，章节序号数组（1-based）' }, names: { type: 'array', items: { type: 'string' }, description: 'type=character/world 时必填，名称数组' }, volume_indices: { type: 'array', items: { type: 'number' }, description: 'type=volume 时必填，卷序号数组（1-based）' }, reason: { type: 'string', description: '删除原因说明，必填' } }, required: ['type', 'reason'] } } },
]

type DeleteEntityType = 'chapter' | 'character' | 'world' | 'volume'

interface DeleteTarget {
  id: string
  label: string
}

const DELETE_TYPE_LABELS: Record<DeleteEntityType, string> = {
  chapter: '章节',
  character: '角色卡',
  world: '世界观设定',
  volume: '卷',
}

async function resolveDeleteTargets(
  type: DeleteEntityType,
  args: Record<string, unknown>,
  projectId: string,
): Promise<{ targets: DeleteTarget[]; skipped: string[]; error?: string }> {
  if (type === 'chapter') {
    const indices = args.chapter_indices as number[] | undefined
    if (!indices?.length) return { targets: [], skipped: [], error: '错误：type=chapter 时 chapter_indices 必填且不能为空' }
    const allChapters = await window.electronAPI.chapter.list(projectId)
    const targets: DeleteTarget[] = []
    const skipped: string[] = []
    for (const i of indices) {
      const ch = allChapters[i - 1]
      if (!ch) skipped.push(`第 ${i} 章`)
      else targets.push({ id: ch.id, label: `第${i}章 ${ch.title || '（未命名）'}` })
    }
    if (targets.length === 0) return { targets: [], skipped, error: '指定的章节都不存在' }
    return { targets, skipped }
  }

  if (type === 'character' || type === 'world') {
    const rawNames = args.names as string[] | undefined
    if (!rawNames?.length) return { targets: [], skipped: [], error: `错误：type=${type} 时 names 必填且不能为空` }
    const names = rawNames.map((n) => n.trim()).filter(Boolean)
    if (names.length === 0) return { targets: [], skipped: [], error: '错误：names 不能为空' }
    const list = type === 'character'
      ? await window.electronAPI.character.list(projectId)
      : await window.electronAPI.world.list(projectId)
    const targets: DeleteTarget[] = []
    const skipped: string[] = []
    for (const name of names) {
      const card = list.find((c: CharacterCard | WorldCard) => c.name === name)
      if (!card) skipped.push(`「${name}」`)
      else targets.push({ id: card.id, label: name })
    }
    if (targets.length === 0) return { targets: [], skipped, error: type === 'character' ? '指定的角色都不存在' : '指定的世界观设定都不存在' }
    return { targets, skipped }
  }

  const indices = args.volume_indices as number[] | undefined
  if (!indices?.length) return { targets: [], skipped: [], error: '错误：type=volume 时 volume_indices 必填且不能为空' }
  const volumes = await getVolumes(projectId)
  const targets: DeleteTarget[] = []
  const skipped: string[] = []
  for (const i of indices) {
    const vol = volumes[i - 1]
    if (!vol) skipped.push(`第 ${i} 卷`)
    else targets.push({ id: vol.id, label: vol.title || `第 ${i} 卷` })
  }
  if (targets.length === 0) return { targets: [], skipped, error: '指定的卷都不存在' }
  return { targets, skipped }
}

function formatDeleteLabel(type: DeleteEntityType, targets: DeleteTarget[]): string {
  const typeLabel = DELETE_TYPE_LABELS[type]
  if (targets.length === 1) return `${typeLabel}「${targets[0].label}」`
  const preview = targets.slice(0, 3).map((t) => t.label).join('、')
  return `${targets.length} 个${typeLabel}（${preview}${targets.length > 3 ? '等' : ''}）`
}

export async function describeDeleteAction(
  args: Record<string, unknown>,
  projectId: string,
): Promise<{ label: string; error?: string }> {
  const reason = (args.reason as string)?.trim()
  if (!reason) return { label: '', error: '错误：reason 必填' }
  const type = args.type as DeleteEntityType
  if (!type) return { label: '', error: '错误：type 必填' }
  if (!DELETE_TYPE_LABELS[type]) return { label: '', error: `错误：未知的 type "${type}"，可选 chapter/character/world/volume` }
  const { targets, error } = await resolveDeleteTargets(type, args, projectId)
  if (error) return { label: '', error }
  return { label: formatDeleteLabel(type, targets) }
}

const toolHandlers: Record<string, ToolHandler> = {
  list: async (args, projectId) => {
    const type = args.type as string
    if (type === 'chapter') {
      const allChapters = await window.electronAPI.chapter.listMeta(projectId)
      if (allChapters.length === 0) return '当前没有章节'

      const indices = args.chapter_indices as number[] | undefined
      let targets: any[]

      if (indices && indices.length > 0) {
        targets = indices.map(i => allChapters[i - 1]).filter(Boolean)
        if (targets.length === 0) return '指定的章节都不存在'
      } else {
        const activeChapterId = useEditorStore.getState().activeChapterId
        const activeIdx = allChapters.findIndex((c: any) => c.id === activeChapterId)
        if (activeIdx >= 0) {
          const start = Math.max(0, activeIdx - 10)
          const end = Math.min(allChapters.length, activeIdx + 6)
          targets = allChapters.slice(start, end)
        } else {
          targets = allChapters
        }
      }

      const lines = targets.map((c: any) => {
        const i = allChapters.indexOf(c)
        const outlineText = c.chapter_outline || c.summary || ''
        const storeChapter = useEditorStore.getState().chapters.find((sc) => sc.id === c.id)
        const wc = storeChapter?.word_count ?? c.word_count ?? 0
        const outline = outlineText ? `大纲：${outlineText}` : '无大纲'
        return `第${i + 1}章 ${c.title || '（未命名）'}（${wc}字）\n${outline}`
      })
      return targets.length === allChapters.length
        ? `共 ${allChapters.length} 个章节：\n${lines.join('\n')}`
        : lines.join('\n\n')
    }

    if (type === 'character') {
      const cards: CharacterCard[] = await window.electronAPI.character.list(projectId)
      if (cards.length === 0) return '当前没有角色'
      const lines = cards.map((c: any) => {
        const parts = [`名称：${c.name}`]
        if (c.role) parts.push(`定位：${c.role}`)
        if (c.description) parts.push(`描述：${c.description}`)
        return parts.join('，')
      })
      return `全部角色（共 ${cards.length} 个）：\n${lines.join('\n')}`
    }

    if (type === 'world') {
      const cards: WorldCard[] = await window.electronAPI.world.list(projectId)
      if (cards.length === 0) return '当前没有世界观设定'
      const lines = cards.map((c: any) => {
        const parts = [`名称：${c.name}`, `类型：${c.card_type}`]
        if (c.description) parts.push(`描述：${c.description}`)
        return parts.join('，')
      })
      return `全部世界观（共 ${cards.length} 个）：\n${lines.join('\n')}`
    }

    if (type === 'volume') {
      const volumes = await getVolumes(projectId)
      if (volumes.length === 0) return '当前没有卷'
      const lines = volumes.map((v, i) => formatVolumeListLine(i + 1, v))
      return `共 ${volumes.length} 卷：\n${lines.join('\n')}`
    }

    return `错误：未知的 type "${type}"，可选 chapter/character/world/volume`
  },

  read: async (args, projectId) => {
    const type = args.type as string

    if (type === 'chapter_content') {
      const index = args.chapter_index as number
      if (!index) return '错误：chapter_index 必填'
      const chapters = await window.electronAPI.chapter.list(projectId)
      const chapter = chapters[index - 1]
      if (!chapter) return `第 ${index} 章尚未创建，请先用 list(type=chapter) 查看现有章节`
      const storeChapter = useEditorStore.getState().chapters.find((c) => c.id === chapter.id)
      const content = storeChapter?.content ?? chapter.content
      const outline = chapter.chapter_outline ? `大纲：${chapter.chapter_outline}\n\n` : ''
      const paragraphs = splitParagraphs(content || '')

      if (paragraphs.length === 0) {
        return `第 ${index} 章：${chapter.title}\n\n${outline}（空章节）`
      }

      const numbered = paragraphs.map((p, i) => `[P${i + 1}] ${p}`).join('\n')
      return `第 ${index} 章：${chapter.title}\n\n${outline}段落数：${paragraphs.length}\n\n${numbered}`
    }

    if (type === 'character') {
      const name = (args.name as string)?.trim()
      if (!name) return '错误：name 不能为空'
      const cards: CharacterCard[] = await window.electronAPI.character.list(projectId)
      const card = cards.find((c) => c.name === name)
      if (!card) return `角色「${name}」不存在`
      const traits = parseArrayField(card.traits)
      const lines = [`名称：${card.name}`]
      if (card.alias) lines.push(`别名：${card.alias}`)
      if (card.role) lines.push(`定位：${card.role}`)
      if (card.gender) lines.push(`性别：${card.gender}`)
      if (card.age) lines.push(`年龄：${card.age}`)
      if (card.description) lines.push(`描述：${card.description}`)
      if (traits?.length) lines.push(`性格：${traits.join('、')}`)
      if (card.appearance) lines.push(`外貌：${card.appearance}`)
      if (card.background) lines.push(`背景：${card.background}`)
      if (card.relationships) lines.push(`关系：${card.relationships}`)
      if (card.notes) lines.push(`备注：${card.notes}`)
      return lines.join('\n')
    }

    if (type === 'world') {
      const name = (args.name as string)?.trim()
      if (!name) return '错误：name 不能为空'
      const cards: WorldCard[] = await window.electronAPI.world.list(projectId)
      const card = cards.find((c) => c.name === name)
      if (!card) return `世界观「${name}」不存在`
      const tags = parseArrayField(card.tags)
      const lines = [`名称：${card.name}`, `类型：${card.card_type}`]
      if (card.description) lines.push(`描述：${card.description}`)
      if (card.notes) lines.push(`备注：${card.notes}`)
      if (tags?.length) lines.push(`标签：${tags.join('、')}`)
      return lines.join('\n')
    }

    if (type === 'outline') {
      const volumes = await getVolumes(projectId)
      if (volumes.length === 0) return '全书大纲未设置'
      const lines = volumes.map((v, i) => {
        const range = v.chapter_start != null && v.chapter_end != null
          ? `（第${v.chapter_start}-${v.chapter_end}章）`
          : ''
        return `[${i + 1}] ${v.title}${range} ${v.status}`
      })
      return `卷目录（共 ${volumes.length} 卷）：\n${lines.join('\n')}\n\n如需某卷详情请 read(type=volume, volume_index=N)`
    }

    if (type === 'volume') {
      const index = args.volume_index as number
      if (!index) return '错误：volume_index 必填'
      const volumes = await getVolumes(projectId)
      const vol = volumes[index - 1]
      if (!vol) return `第 ${index} 卷不存在，请先用 list(type=volume) 或 create_volume`
      const range = vol.chapter_start != null && vol.chapter_end != null
        ? `第 ${vol.chapter_start}–${vol.chapter_end} 章`
        : '未绑定章节'
      const progress = vol.progress_notes ? `\n\n进度备注：\n${plainHtml(vol.progress_notes)}` : ''
      return `第 ${index} 卷：${vol.title}\n范围：${range}\n状态：${vol.status}\n\n卷级大纲：\n${plainHtml(vol.outline || '') || '（空）'}${progress}`
    }

    if (type === 'knowledge') {
      const name = (args.name as string)?.trim()
      if (!name) return '错误：name 不能为空'
      const chunkStart = args.start as number | undefined
      const chunkEnd = args.end as number | undefined
      if (chunkStart === undefined || chunkEnd === undefined) return '错误：knowledge 类型必须传 start 和 end 参数（chunkId 范围，闭区间）。请先用 search 工具定位相关内容的 chunkId'
      const item = await window.electronAPI.knowledge.getByName(name)
      if (!item) return `知识库条目「${name}」不存在`

      const text = stripHtml(item.content || '')
      const allChunks = splitChunks(text)
      const s = Math.max(0, chunkStart)
      const e = Math.min(chunkEnd, allChunks.length - 1)
      if (s > e || allChunks.length === 0) return `知识库「${name}」的 chunkId 范围无效（共 ${allChunks.length} 个 chunk）`
      const selected = allChunks.slice(s, e + 1)
      const merged = mergeChunks(selected)
      return `知识库「${name}」（共 ${allChunks.length} 个 chunk，显示 chunkId ${s}-${e}）\n\n${merged}`
    }

    return `错误：未知的 type "${type}"，可选 chapter_content/character/world/outline/volume/knowledge`
  },

  search: async (args, projectId) => {
    const keyword = args.keyword as string | undefined
    const semantic = args.semantic as string | undefined
    const scope = args.scope as string[]
    const topK = args.top_k as number[] | undefined

    if (!scope || scope.length === 0) return '错误：scope 必填，指定搜索范围'
    if (!keyword && !semantic) return '错误：keyword 和 semantic 至少传一个'

    const results: string[] = []

    if (keyword) {
      const keywordResult = await window.electronAPI.search.workspace({
        query: keyword,
        project_id: projectId,
        scope,
        top_k: topK,
      })

      if (keywordResult.error) {
        results.push(`关键词搜索失败：${keywordResult.error}`)
      } else {
        const s = keywordResult.summary || {}
        const settingsCount = (s.characters || 0) + (s.worlds || 0)
        const scopeSummary: string[] = []
        if (settingsCount) scopeSummary.push(`在设定中找到${settingsCount}处匹配`)
        if (s.outline) scopeSummary.push(`在大纲中找到${s.outline}处匹配`)
        if (s.knowledge) scopeSummary.push(`在知识库中找到${s.knowledge}处匹配`)
        if (s.chapters) scopeSummary.push(`在正文中找到${s.chapters}处匹配`)
        const parts: string[] = [scopeSummary.length > 0 ? scopeSummary.join('，') : '未找到匹配结果']

        const typeLabels: Record<string, string> = {
          character: '角色卡',
          world: '世界观设定',
          outline_volume: '卷级大纲',
          outline: '全书大纲',
          chapter_outline: '章节大纲',
          chapter_content: '章节正文',
          knowledge: '知识库资料',
        }
        const grouped = new Map<string, any[]>()
        for (const r of keywordResult.results) {
          const key = r.type
          if (!grouped.has(key)) grouped.set(key, [])
          grouped.get(key)!.push(r)
        }

        for (const [type, items] of grouped) {
          parts.push(`【${typeLabels[type] || type}】`)
          for (const r of items) {
            const isShortEntity = type === 'character' || type === 'world' || type === 'chapter_outline'
            if (isShortEntity) {
              parts.push(`  ${r.name}：${r.chunk_text}`)
            } else if (type === 'chapter_content') {
              parts.push(`  第 ${r.chapter_index} 章「${r.name}」(chunkId: ${r.chunkId})：${r.chunk_text}`)
            } else {
              parts.push(`  ${r.name} (chunkId: ${r.chunkId})：${r.chunk_text}`)
            }
          }
          parts.push('')
        }

        results.push(parts.join('\n'))
      }
    }

    if (semantic) {
      // 语义搜索:用 topK 中"知识库"那一项的值。
      // top_k 顺序按 scope 顺序(settings/outlines/knowledge/content) → 知识库是 index 2
      // fallback 5(避免默认 10 + 段落扩展把 prompt 撑到 30K)
      const knowledgeTopK = topK && topK.length >= 3 ? topK[2] : 5
      const semanticResult = await window.electronAPI.vector.search({
        query: semantic,
        projectId,
        topK: knowledgeTopK,
      })

      if (!semanticResult.success) {
        results.push(`语义搜索失败：${semanticResult.error}`)
      } else if (semanticResult.results.length === 0) {
        results.push('语义搜索：未找到相关知识库内容')
      } else {
        const grouped = new Map<string, any[]>()
        for (const r of semanticResult.results) {
          const key = r.knowledge_name || '未知知识库'
          if (!grouped.has(key)) grouped.set(key, [])
          grouped.get(key)!.push(r)
        }

        const parts: string[] = [`语义搜索找到 ${semanticResult.results.length} 条相关内容：`]
        for (const [name, items] of grouped) {
          const lines = items.map((r: any, idx: number) => {
            const score = (r.score * 100).toFixed(1)
            return `  ${name} (chunkId: ${r.chunkId})（相关度 ${score}）：\n  ${r.text}`
          })
          parts.push(`【知识库：${name}】\n${lines.join('\n\n')}`)
        }

        results.push(parts.join('\n\n'))
      }
    }

    return results.join('\n\n---\n\n')
  },

  write_chapter_outline: async (args, projectId) => {
    const plotErr = await volumePlotBeforeChaptersError(projectId)
    if (plotErr) return plotErr
    const chaptersArg = args.chapters as Array<{ chapter_index: number; outline: string }> | undefined
    const allChapters = await window.electronAPI.chapter.list(projectId)
    if (chaptersArg && Array.isArray(chaptersArg) && chaptersArg.length > 0) {
      const results: string[] = []
      for (const { chapter_index, outline } of chaptersArg) {
        const ch = allChapters[chapter_index - 1]
        if (!ch) { results.push(`第 ${chapter_index} 章不存在，已跳过`); continue }
        await window.electronAPI.chapter.updateMeta({ id: ch.id, title: ch.title, chapter_outline: outline, status: ch.status })
        results.push(`第 ${chapter_index} 章大纲已更新`)
      }
      useEditorStore.getState().setChapters(
        useEditorStore.getState().chapters.map((c) => {
          const item = chaptersArg.find(({ chapter_index }) => allChapters[chapter_index - 1]?.id === c.id)
          return item ? { ...c, chapter_outline: item.outline } : c
        })
      )
      return results.join('\n') || '没有章节被更新'
    }
    const chapterIdx = args.chapter_index as number
    const outline = (args.outline as string)?.trim()
    if (!outline) return '错误：outline 不能为空'
    const chapter = allChapters[chapterIdx - 1]
    if (!chapter) return `错误：未找到第 ${chapterIdx} 章`
    await window.electronAPI.chapter.updateMeta({ id: chapter.id, title: chapter.title, chapter_outline: outline, status: chapter.status })
    useEditorStore.getState().setChapters(
      useEditorStore.getState().chapters.map((c) => c.id === chapter.id ? { ...c, chapter_outline: outline } : c)
    )
    return `第 ${chapterIdx} 章大纲已更新`
  },

  write_chapter_title: async (args, projectId) => {
    const plotErr = await volumePlotBeforeChaptersError(projectId)
    if (plotErr) return plotErr
    const chaptersArg = args.chapters as Array<{ chapter_index: number; title: string }> | undefined
    const allChapters = await window.electronAPI.chapter.list(projectId)
    if (chaptersArg && Array.isArray(chaptersArg) && chaptersArg.length > 0) {
      const results: string[] = []
      for (const { chapter_index, title } of chaptersArg) {
        const ch = allChapters[chapter_index - 1]
        if (!ch) { results.push(`第 ${chapter_index} 章不存在，已跳过`); continue }
        const trimmed = (title || '').trim()
        await window.electronAPI.chapter.updateMeta({ id: ch.id, title: trimmed, chapter_outline: ch.chapter_outline, status: ch.status })
        results.push(trimmed ? `第 ${chapter_index} 章标题已更新为「${trimmed}」` : `第 ${chapter_index} 章标题已清除`)
      }
      useEditorStore.getState().setChapters(
        useEditorStore.getState().chapters.map((c) => {
          const item = chaptersArg.find(({ chapter_index }) => allChapters[chapter_index - 1]?.id === c.id)
          return item ? { ...c, title: (item.title || '').trim() } : c
        })
      )
      return results.join('\n') || '没有章节被更新'
    }
    const chapterIdx = args.chapter_index as number
    const title = (args.title as string)?.trim() ?? ''
    const chapter = allChapters[chapterIdx - 1]
    if (!chapter) return `错误：未找到第 ${chapterIdx} 章`
    await window.electronAPI.chapter.updateMeta({ id: chapter.id, title, chapter_outline: chapter.chapter_outline, status: chapter.status })
    useEditorStore.getState().setChapters(
      useEditorStore.getState().chapters.map((c) => c.id === chapter.id ? { ...c, title } : c)
    )
    return title ? `第 ${chapterIdx} 章标题已更新为「${title}」` : `第 ${chapterIdx} 章标题已清除`
  },

  write_character_card: async (args, projectId) => {
    const cards: CharacterCard[] = await window.electronAPI.character.list(projectId)

    const processOne = async (item: Record<string, unknown>) => {
      const name = (item.name as string)?.trim()
      if (!name) return '错误：角色名称不能为空'
      const newName = (item.new_name as string)?.trim()
      const card = cards.find((c) => c.name === name)
      if (card) {
        function has(k: string) { return k in item }
        const toArray = (v: string | undefined) => v ? v.split('、').map((s) => s.trim()).filter(Boolean) : []
        await window.electronAPI.character.update({
          ...card,
          name: newName || card.name,
          alias: has('alias') ? ((item.alias as string) === '无' ? '' : (item.alias as string)) : card.alias || '',
          description: has('description') ? (item.description as string) : card.description,
          role: has('role') ? (item.role as string) : card.role || '',
          traits: JSON.stringify(has('traits') ? toArray(item.traits as string) : parseArrayField(card.traits)),
          appearance: has('appearance') ? (item.appearance as string) : card.appearance,
          background: has('background') ? (item.background as string) : card.background,
          relationships: has('relationships') ? (item.relationships as string) : card.relationships || '',
          notes: has('notes') ? (item.notes as string) : card.notes,
          tags: JSON.stringify(has('tags') ? toArray(item.tags as string) : parseArrayField(card.tags)),
          card_group: card.card_group || '', sort_order: card.sort_order || 0,
          gender: has('gender') ? (item.gender as string) : (card.gender || ''),
          age: has('age') ? (item.age as string) : (card.age || ''),
        } as any as CharacterCard)
        return newName ? `已更新「${name}」→「${newName}」` : `已更新「${name}」`
      }
      await window.electronAPI.character.create({
        id: generateId(), project_id: projectId, name,
        alias: ((item.alias as string) === '无' ? '' : (item.alias as string)) || '',
        description: (item.description as string) || '',
        role: (item.role as string) || '',
        traits: JSON.stringify((item.traits as string)?.split('、').map((s) => s.trim()).filter(Boolean) || []),
        appearance: (item.appearance as string) || '',
        background: (item.background as string) || '',
        relationships: (item.relationships as string) || '',
        notes: (item.notes as string) || '',
        tags: '[]', card_group: '', sort_order: 0,
        gender: (item.gender as string) || '',
        age: (item.age as string) || '',
      })
      return `已创建「${name}」`
    }

    if (args.cards) {
      const items = parseArrayField(args.cards) as Record<string, unknown>[]
      if (items.length === 0) return '错误：cards 不能为空'
      const results: string[] = []
      for (const item of items) {
        results.push(await processOne(item))
      }
      return results.join('\n')
    }

    return processOne(args)
  },

  write_world_setting: async (args, projectId) => {
    const cards: WorldCard[] = await window.electronAPI.world.list(projectId)

    const processOne = async (item: Record<string, unknown>) => {
      const name = (item.name as string)?.trim()
      if (!name) return '错误：名称不能为空'
      const newName = (item.new_name as string)?.trim()
      const card = cards.find((c) => c.name === name)
      if (card) {
        function has(k: string) { return k in item }
        const toArray = (v: string | undefined) => v ? v.split('、').map((s) => s.trim()).filter(Boolean) : []
        await window.electronAPI.world.update({
          ...card,
          name: newName || card.name,
          description: has('description') && item.description ? (item.description as string) : card.description,
          card_type: has('type') && item.type ? (item.type as string) : card.card_type,
          tags: JSON.stringify(has('tags') ? toArray(item.tags as string) : parseArrayField(card.tags)),
          notes: has('notes') ? (item.notes as string || '') : (card.notes || ''),
          card_group: card.card_group || '', parent_id: card.parent_id || null, sort_order: card.sort_order || 0,
        } as any as WorldCard)
        return newName ? `已更新「${name}」→「${newName}」` : `已更新「${name}」`
      }
      const cardType = (item.type as string)?.trim()
      if (!cardType) return `错误：「${name}」的类型不能为空`
      if (cards.some((w) => w.name === name)) return `「${name}」已存在，跳过创建`
      await window.electronAPI.world.create({
        id: generateId(), project_id: projectId, name,
        card_type: cardType, description: (item.description as string) || '',
        tags: JSON.stringify((item.tags as string)?.split('、').map((s) => s.trim()).filter(Boolean) || []),
        card_group: '', parent_id: null, sort_order: 0,
        notes: (item.notes as string) || '',
      })
      return `已创建「${name}」`
    }

    if (args.cards) {
      const items = parseArrayField(args.cards) as Record<string, unknown>[]
      if (items.length === 0) return '错误：cards 不能为空'
      const results: string[] = []
      for (const item of items) {
        results.push(await processOne(item))
      }
      return results.join('\n')
    }

    return processOne(args)
  },

  create_volume: async (args, projectId) => {
    const title = (args.title as string)?.trim()
    if (!title) return '错误：title 必填'
    const vol: OutlineVolume = {
      id: generateId(),
      project_id: projectId,
      sort_order: (await getVolumes(projectId)).length,
      title,
      outline: '',
      chapter_start: (args.chapter_start as number) ?? null,
      chapter_end: (args.chapter_end as number) ?? null,
      status: (args.status as OutlineVolume['status']) || 'planned',
      progress_notes: '',
    }
    try {
      const saved = await window.electronAPI.volume.save(vol)
      const volumes = await getVolumes(projectId)
      useEditorStore.getState().setVolumes(volumes)
      const idx = volumes.findIndex((v) => v.id === saved.id) + 1
      return `已创建第 ${idx} 卷：${saved.title}`
    } catch (e: any) {
      return `错误：${e.message || e}`
    }
  },

  write_volume: async (args, projectId) => {
    const volumes = await getVolumes(projectId)
    if (volumes.length === 0) return '错误：请先 create_volume 创建卷'

    const hasOutline = args.outline !== undefined && args.outline !== null
    const hasProgress = args.progress_notes !== undefined
    const hasMeta = args.title !== undefined || args.chapter_start !== undefined || args.chapter_end !== undefined || args.status !== undefined
    if (!hasOutline && !hasProgress && !hasMeta) {
      return '错误：至少传一个可写字段'
    }

    let volumeIndex = args.volume_index as number | undefined
    const needsExplicitIndex = hasOutline || args.chapter_start !== undefined || args.chapter_end !== undefined || args.status !== undefined || args.title !== undefined
    if (needsExplicitIndex && !volumeIndex) {
      return '错误：修改 outline/范围/status/title 需要明确 volume_index'
    }
    if (!volumeIndex && hasProgress) {
      volumeIndex = (await resolveDefaultVolumeIndex(projectId)) ?? undefined
      if (!volumeIndex) return '错误：请先 create_volume'
    }
    if (!volumeIndex) return '错误：volume_index 必填'

    const vol = volumes[volumeIndex - 1]
    if (!vol) return `错误：第 ${volumeIndex} 卷不存在，请先 create_volume`

    const outline = hasOutline ? String(args.outline) : (vol.outline || '')
    const modifiedOutline = hasOutline && outline !== (vol.outline || '')

      if (modifiedOutline) {
        if (useEditorStore.getState().pendingVolumeEdit) {
          return '错误：上一卷的 outline 变更还在等用户审阅，请等用户采纳或拒绝后再写下一卷。**注意：一次响应里只能写一卷 outline**。'
        }
        volumeSummaryWritesThisBatch++
        if (volumeSummaryWritesThisBatch > 1) {
          volumeSummaryWritesThisBatch--
          return '错误：本轮已写过卷级大纲了。一次 AI 响应里只能写一卷 outline，请等本轮结束后、下一次用户回复时再写下一卷。'
        }
        const reason = (args.reason as string) || '更新卷级大纲'
      const pendingMeta: Partial<OutlineVolume> = {}
      if (hasProgress) pendingMeta.progress_notes = String(args.progress_notes)
      if (args.title !== undefined) pendingMeta.title = String(args.title)
      if (args.chapter_start !== undefined) pendingMeta.chapter_start = args.chapter_start as number | null
      if (args.chapter_end !== undefined) pendingMeta.chapter_end = args.chapter_end as number | null
      if (args.status !== undefined) pendingMeta.status = args.status as OutlineVolume['status']
      return JSON.stringify({
        _edit_volume: true,
        volumeId: vol.id,
        volume_index: volumeIndex,
        original: vol.outline || '',
        modified: outline,
        summary: reason,
        pendingMeta,
      })
    }

    const patch: Partial<OutlineVolume> & { id: string } = { id: vol.id }
    if (hasProgress) patch.progress_notes = String(args.progress_notes)
    if (args.title !== undefined) patch.title = String(args.title)
    if (args.chapter_start !== undefined) patch.chapter_start = args.chapter_start as number | null
    if (args.chapter_end !== undefined) patch.chapter_end = args.chapter_end as number | null
    if (args.status !== undefined) patch.status = args.status as OutlineVolume['status']

    try {
      const saved = await window.electronAPI.volume.updateMeta(patch)
      const next = await getVolumes(projectId)
      useEditorStore.getState().setVolumes(next)
      return `第 ${volumeIndex} 卷已更新`
    } catch (e: any) {
      return `错误：${e.message || e}`
    }
  },

  create_chapter: async (args, projectId) => {
    const plotErr = await volumePlotBeforeChaptersError(projectId)
    if (plotErr) return plotErr
    const count = args.count as number
    if (!count || count < 1) return '错误：count 必须大于 0'
    const existingChapters = await window.electronAPI.chapter.list(projectId)
    const startFrom = existingChapters.length + 1
    const created: string[] = []
    for (let i = 0; i < count; i++) {
      const newChapter = {
        id: generateId(), project_id: projectId,
        title: '', content: '', chapter_outline: '',
        sort_order: existingChapters.length + i, status: 'draft', word_count: 0,
      }
      await window.electronAPI.chapter.save(newChapter)
      created.push(newChapter.id)
    }
    const allChapters = await window.electronAPI.chapter.list(projectId)
    useEditorStore.getState().setChapters(allChapters)
    if (count === 1) return `已创建第 ${startFrom} 章（空白章节）`
    return `已创建第 ${startFrom}-${startFrom + count - 1} 章（共 ${count} 个空白章节）`
  },

  write_chapter_content: async (args, projectId) => {
    const chapterIndex = args.chapter_index as number
    const summary = (args.summary as string)?.trim()
    if (!chapterIndex || chapterIndex < 1) return '错误：chapter_index 必须是大于 0 的数字'
    if (!summary) return '错误：summary 必填'

    const chapters = await window.electronAPI.chapter.list(projectId)
    const chapter = chapters[chapterIndex - 1]
    if (!chapter) return `错误：未找到第 ${chapterIndex} 章`

    const storeChapter = useEditorStore.getState().chapters.find((c) => c.id === chapter.id)
    const content = storeChapter?.content ?? chapter.content ?? ''

    const edits = parseArrayField(args.edits) as Array<{ paragraph_index: number; text: string }>
    const inserts = parseArrayField(args.inserts) as Array<{ after_paragraph_index: number; text: string }>
    const result = applyChapterParagraphEdits(content, {
      content: args.content as string | undefined,
      edits,
      inserts,
    })

    if (!result.ok) return result.error

    return JSON.stringify({
      _edit_chapter: true,
      chapter_id: chapter.id,
      original: content,
      modified: result.modifiedHtml,
      summary,
    })
  },

  propose_action: async (args) => {
    const type = args.type as string
    const options = args.options as string[]
    if (!type || !options?.length) return '错误：参数不完整'
    return JSON.stringify({ _proposal: true, type, options, chapter_index: args.chapter_index, params: args.params })
  },

  delete: async (args, projectId) => {
    const reason = (args.reason as string)?.trim()
    if (!reason) return '错误：reason 必填'
    const type = args.type as DeleteEntityType
    if (!type) return '错误：type 必填'
    if (!DELETE_TYPE_LABELS[type]) return `错误：未知的 type "${type}"，可选 chapter/character/world/volume`

    const { targets, skipped, error } = await resolveDeleteTargets(type, args, projectId)
    if (error) return error

    const results: string[] = []
    const store = useEditorStore.getState()
    const deletedIds = new Set(targets.map((t) => t.id))

    if (type === 'chapter') {
      await flushChapterSave()
      if (store.pendingChapterEdit && deletedIds.has(store.pendingChapterEdit.chapterId)) {
        resolvePendingDiff('revert', '章节已删除')
        store.setPendingChapterEdit(null)
      }
      for (const target of targets) {
        await window.electronAPI.chapter.delete(target.id)
        results.push(`已删除${target.label}`)
      }
      const remaining = await window.electronAPI.chapter.list(projectId)
      store.setChapters(remaining)
      if (store.activeChapterId && deletedIds.has(store.activeChapterId)) {
        store.setActiveChapter(remaining[remaining.length - 1]?.id ?? null)
      }
    } else if (type === 'character') {
      for (const target of targets) {
        await window.electronAPI.character.delete(target.id)
        results.push(`已删除角色「${target.label}」`)
      }
    } else if (type === 'world') {
      for (const target of targets) {
        await window.electronAPI.world.delete(target.id)
        results.push(`已删除世界观「${target.label}」`)
      }
    } else {
      for (const target of targets) {
        if (store.pendingVolumeEdit?.volumeId === target.id) {
          store.setPendingVolumeEdit(null)
          resolvePendingOutline('revert', '卷已删除')
        }
        await window.electronAPI.volume.delete(target.id)
        results.push(`已删除卷「${target.label}」`)
      }
      const next = await window.electronAPI.volume.list(projectId)
      store.setVolumes(next)
      if (store.activeVolumeId && deletedIds.has(store.activeVolumeId)) {
        store.setActiveVolumeId(next[0]?.id ?? null)
      }
    }

    if (skipped.length > 0) {
      results.push(`以下目标不存在，已跳过：${skipped.join('、')}`)
    }
    return results.join('\n')
  },
}

export function toolUsageGuide(): string {
  return `你可以使用以下工具辅助写作。每个工具的用途、参数、调用约束详见其 schema 描述；本指南只补充跨工具的调用顺序、关键约束和反模式。

工具按用途分四类：
- 只读查询：list / read / search（注意查询结果仅返回给你，用户并非对等获取查询结果）
- 写入工具：write_chapter_content / write_chapter_outline / write_chapter_title / write_character_card / write_world_setting / create_volume / write_volume
- 创建章节：create_chapter（只创建空白占位）；创建卷：create_volume
- 删除工具：delete（删除章节/角色/世界观/卷，同类型可批量，须用户确认后执行）
- 询问意见：propose_action

跨工具调用顺序：
- 新书规划：create_volume → write_volume（**重要：一轮工具调用写一卷，禁止一轮调用写入多卷**）→ 角色/世界观 → 询问用户是否需要写章节大纲，如果用户说需要 → create_chapter → write_chapter_outline；卷级大纲未完成前不要建章或写章节大纲
- 用户要求创建章节：先 create_chapter。可询问用户是否需要创建标题/大纲，得到许可则用 write_chapter_title 设置标题、write_chapter_outline 设置大纲
- 用户要求正文写作时：先用 list 查章节大纲（至少查当前章与前一章），再read本章所在卷级大纲，再read本章强关联的角色卡、世界观设定，必要时 read 章节正文。再 write_chapter_content 写入正文。
- 出现明显写作进展：使用 write_volume 更新对应卷的 progress_notes

关键约束：
- write_chapter_content 是**唯一**写入正文的方式，调用后用户可以看到变动预览。除非用户要求，在对话中输出正文是毫无意义的
- 全文搜索时，content scope 会返回大量正文，**非必要不搜**；优先 settings/outlines/knowledge
- write_volume 的 outline / progress_notes 建议用 HTML，禁止 Markdown 语法

反模式：
- 禁止凭印象写章节正文，不确定就要查询大纲/角色卡/设定
- 修改已有正文时禁止传 content 整章覆盖，必须用 edits/inserts 按段写入
- 不要在 search 还没用过的场景下反复用 list 全量枚举`
}

const readOnlyTools = new Set(['list', 'read', 'search'])

export async function executeToolCall(name: string, args: Record<string, unknown>, projectId: string): Promise<string> {
  if (name === 'write_outline' || name === 'update_progress') {
    return `错误：工具 "${name}" 已废弃，请改用 create_volume / write_volume`
  }
  const handler = toolHandlers[name]
  if (!handler) return `错误：未知工具 "${name}"`
  try {
    const result = await handler(args, projectId)
    if (!readOnlyTools.has(name)) useEditorStore.getState().incrementDataVersion()
    return result
  } catch (err: any) {
    return `工具 "${name}" 执行失败：${err.message || err}`
  }
}
