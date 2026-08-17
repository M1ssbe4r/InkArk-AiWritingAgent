import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toolDefinitions, toolUsageGuide, executeToolCall, describeDeleteAction, resetVolumeSummaryBatchCounter } from './tools'
import { useEditorStore } from '@/stores/editorStore'

const mockChapterListMeta = vi.fn()
const mockChapterList = vi.fn()
const mockChapterSave = vi.fn()
const mockChapterUpdateMeta = vi.fn()
const mockChapterDelete = vi.fn()
const mockCharacterList = vi.fn()
const mockCharacterCreate = vi.fn()
const mockCharacterUpdate = vi.fn()
const mockCharacterDelete = vi.fn()
const mockWorldList = vi.fn()
const mockWorldCreate = vi.fn()
const mockWorldUpdate = vi.fn()
const mockWorldDelete = vi.fn()
const mockProjectList = vi.fn()
const mockProjectUpdate = vi.fn()
const mockVolumeList = vi.fn()
const mockVolumeSave = vi.fn()
const mockVolumeUpdateMeta = vi.fn()
const mockVolumeDelete = vi.fn()
const mockFlushChapterSave = vi.fn()
const mockResolvePendingDiff = vi.fn()
const mockResolvePendingOutline = vi.fn()

vi.mock('./editorRef', () => ({
  flushChapterSave: (...args: unknown[]) => mockFlushChapterSave(...args),
  resolvePendingDiff: (...args: unknown[]) => mockResolvePendingDiff(...args),
  resolvePendingOutline: (...args: unknown[]) => mockResolvePendingOutline(...args),
}))

beforeEach(() => {
  vi.stubGlobal('window', {
    electronAPI: {
      chapter: {
        listMeta: mockChapterListMeta,
        list: mockChapterList,
        save: mockChapterSave,
        updateMeta: mockChapterUpdateMeta,
        delete: mockChapterDelete,
      },
      character: {
        list: mockCharacterList,
        create: mockCharacterCreate,
        update: mockCharacterUpdate,
        delete: mockCharacterDelete,
      },
      world: {
        list: mockWorldList,
        create: mockWorldCreate,
        update: mockWorldUpdate,
        delete: mockWorldDelete,
      },
      project: {
        list: mockProjectList,
        update: mockProjectUpdate,
      },
      volume: {
        list: mockVolumeList,
        save: mockVolumeSave,
        updateMeta: mockVolumeUpdateMeta,
        delete: mockVolumeDelete,
      },
    },
  })

  mockChapterListMeta.mockReset()
  mockChapterList.mockReset()
  mockChapterSave.mockReset()
  mockChapterUpdateMeta.mockReset()
  mockChapterDelete.mockReset()
  mockCharacterList.mockReset()
  mockCharacterCreate.mockReset()
  mockCharacterUpdate.mockReset()
  mockCharacterDelete.mockReset()
  mockWorldList.mockReset()
  mockWorldCreate.mockReset()
  mockWorldUpdate.mockReset()
  mockWorldDelete.mockReset()
  mockProjectList.mockReset()
  mockProjectUpdate.mockReset()
  mockVolumeList.mockReset()
  mockVolumeSave.mockReset()
  mockVolumeUpdateMeta.mockReset()
  mockVolumeDelete.mockReset()
  mockFlushChapterSave.mockReset()
  mockResolvePendingDiff.mockReset()
  mockResolvePendingOutline.mockReset()
  mockFlushChapterSave.mockResolvedValue(undefined)
  mockVolumeList.mockResolvedValue([])
  resetVolumeSummaryBatchCounter()
  useEditorStore.getState().setPendingVolumeEdit(null)
})

describe('toolDefinitions', () => {
  it('包含所有必要的工具', () => {
    const names = toolDefinitions.map((d) => d.function.name)
    expect(names).toContain('list')
    expect(names).toContain('read')
    expect(names).toContain('search')
    expect(names).toContain('write_chapter_outline')
    expect(names).toContain('write_chapter_title')
    expect(names).toContain('write_character_card')
    expect(names).toContain('write_world_setting')
    expect(names).toContain('create_volume')
    expect(names).toContain('write_volume')
    expect(names).toContain('create_chapter')
    expect(names).not.toContain('write_outline')
    expect(names).not.toContain('update_progress')
    expect(names).toContain('write_chapter_content')
    expect(names).toContain('propose_action')
    expect(names).toContain('delete')
  })

  it('每个工具定义结构正确', () => {
    for (const def of toolDefinitions) {
      expect(def.type).toBe('function')
      expect(def.function.name).toBeTruthy()
      expect(def.function.description).toBeTruthy()
      expect(def.function.parameters).toBeDefined()
      expect(def.function.parameters.type).toBe('object')
    }
  })

  it('工具总数为 13', () => {
    expect(toolDefinitions).toHaveLength(13)
  })
})

describe('toolUsageGuide', () => {
  it('返回非空字符串', () => {
    const guide = toolUsageGuide()
    expect(guide.length).toBeGreaterThan(0)
  })

  it('包含核心工具名称', () => {
    const guide = toolUsageGuide()
    const coreTools = ['list', 'read', 'search', 'write_chapter_content', 'create_chapter', 'write_chapter_outline']
    for (const name of coreTools) {
      expect(guide).toContain(name)
    }
  })
})

describe('executeToolCall', () => {
  it('未知工具返回错误', async () => {
    const result = await executeToolCall('unknown_tool', {}, 'p1')
    expect(result).toContain('未知工具')
  })

  it('list 无章节时返回提示', async () => {
    mockChapterListMeta.mockResolvedValue([])
    const result = await executeToolCall('list', { type: 'chapter' }, 'p1')
    expect(result).toBe('当前没有章节')
  })

  it('list 查全部章节（无当前章节时回退为全部）', async () => {
    mockChapterListMeta.mockResolvedValue([
      { id: 'c1', title: '第一章', chapter_outline: '大纲1', word_count: 100 },
      { id: 'c2', title: '第二章', summary: '大纲2', word_count: 200 },
    ])
    const result = await executeToolCall('list', { type: 'chapter' }, 'p1')
    expect(result).toContain('共 2 个章节')
    expect(result).toContain('第一章')
    expect(result).toContain('第二章')
    expect(result).toContain('大纲：大纲1')
    expect(result).toContain('大纲：大纲2')
  })

  it('list 按序号查单个', async () => {
    mockChapterListMeta.mockResolvedValue([
      { id: 'c1', title: '第一章', word_count: 100 },
      { id: 'c2', title: '第二章', word_count: 200 },
    ])
    const result = await executeToolCall('list', { type: 'chapter', chapter_indices: [1] }, 'p1')
    expect(result).toContain('第一章')
    expect(result).not.toContain('第二章')
  })

  it('list 不存在的序号', async () => {
    mockChapterListMeta.mockResolvedValue([
      { id: 'c1', title: '第一章', word_count: 100 },
    ])
    const result = await executeToolCall('list', { type: 'chapter', chapter_indices: [5] }, 'p1')
    expect(result).toContain('不存在')
  })

  it('list 批量查询', async () => {
    mockChapterListMeta.mockResolvedValue([
      { id: 'c1', title: '第一章', word_count: 100 },
      { id: 'c2', title: '第二章', word_count: 200 },
      { id: 'c3', title: '第三章', word_count: 300 },
    ])
    const result = await executeToolCall('list', { type: 'chapter', chapter_indices: [1, 3] }, 'p1')
    expect(result).toContain('第一章')
    expect(result).toContain('第三章')
    expect(result).not.toContain('第二章')
  })

  it('list 批量查询全部不存在', async () => {
    mockChapterListMeta.mockResolvedValue([
      { id: 'c1', title: '第一章', word_count: 100 },
    ])
    const result = await executeToolCall('list', { type: 'chapter', chapter_indices: [10, 20] }, 'p1')
    expect(result).toContain('都不存在')
  })

  it('list 未命名章节显示占位', async () => {
    mockChapterListMeta.mockResolvedValue([
      { id: 'c1', title: '', word_count: 0 },
    ])
    const result = await executeToolCall('list', { type: 'chapter' }, 'p1')
    expect(result).toContain('未命名')
  })

  it('read 读取章节内容', async () => {
    mockChapterList.mockResolvedValue([
      { id: 'c1', title: '第一章', content: '<p>正文内容</p>', chapter_outline: '大纲' },
    ])
    const result = await executeToolCall('read', { type: 'chapter_content', chapter_index: 1 }, 'p1')
    expect(result).toContain('第一章')
    expect(result).toContain('正文内容')
    expect(result).toContain('大纲')
  })

  it('read 不存在的章节', async () => {
    mockChapterList.mockResolvedValue([])
    const result = await executeToolCall('read', { type: 'chapter_content', chapter_index: 1 }, 'p1')
    expect(result).toContain('尚未创建')
  })

  it('read 空章节显示提示', async () => {
    mockChapterList.mockResolvedValue([
      { id: 'c1', title: '第一章', content: '', summary: '' },
    ])
    const result = await executeToolCall('read', { type: 'chapter_content', chapter_index: 1 }, 'p1')
    expect(result).toContain('空章节')
  })

  it('read HTML 标签被清除并输出段落编号', async () => {
    mockChapterList.mockResolvedValue([
      { id: 'c1', title: '第一章', content: '<p>段落1</p><p>段落2</p>', summary: '' },
    ])
    const result = await executeToolCall('read', { type: 'chapter_content', chapter_index: 1 }, 'p1')
    expect(result).not.toContain('<p>')
    expect(result).toContain('[P1] 段落1')
    expect(result).toContain('[P2] 段落2')
    expect(result).toContain('段落数：2')
  })

  it('write_chapter_outline 单章更新', async () => {
    mockChapterList.mockResolvedValue([
      { id: 'c1', title: '第一章', summary: '旧大纲', status: 'draft' },
    ])
    mockChapterUpdateMeta.mockResolvedValue(undefined)
    const result = await executeToolCall('write_chapter_outline', { chapter_index: 1, outline: '新大纲' }, 'p1')
    expect(result).toContain('大纲已更新')
    expect(mockChapterUpdateMeta).toHaveBeenCalled()
  })

  it('write_chapter_outline outline 为空时报错', async () => {
    mockChapterList.mockResolvedValue([
      { id: 'c1', title: '第一章', summary: '', status: 'draft' },
    ])
    const result = await executeToolCall('write_chapter_outline', { chapter_index: 1, outline: '' }, 'p1')
    expect(result).toContain('不能为空')
  })

  it('write_chapter_outline 不存在的章节', async () => {
    mockChapterList.mockResolvedValue([])
    const result = await executeToolCall('write_chapter_outline', { chapter_index: 1, outline: '大纲' }, 'p1')
    expect(result).toContain('未找到')
  })

  it('write_chapter_outline 批量更新', async () => {
    mockChapterList.mockResolvedValue([
      { id: 'c1', title: '第一章', summary: '', status: 'draft' },
      { id: 'c2', title: '第二章', summary: '', status: 'draft' },
    ])
    mockChapterUpdateMeta.mockResolvedValue(undefined)
    const result = await executeToolCall('write_chapter_outline', {
      chapters: [
        { chapter_index: 1, outline: '大纲1' },
        { chapter_index: 2, outline: '大纲2' },
      ],
    }, 'p1')
    expect(result).toContain('大纲已更新')
    expect(mockChapterUpdateMeta).toHaveBeenCalledTimes(2)
  })

  it('write_chapter_outline 批量更新跳过不存在章节', async () => {
    mockChapterList.mockResolvedValue([
      { id: 'c1', title: '第一章', summary: '', status: 'draft' },
    ])
    mockChapterUpdateMeta.mockResolvedValue(undefined)
    const result = await executeToolCall('write_chapter_outline', {
      chapters: [
        { chapter_index: 1, outline: '大纲1' },
        { chapter_index: 99, outline: '大纲99' },
      ],
    }, 'p1')
    expect(result).toContain('已跳过')
  })

  it('write_chapter_title 单章更新', async () => {
    mockChapterList.mockResolvedValue([
      { id: 'c1', title: '旧标题', summary: '大纲', status: 'draft' },
    ])
    mockChapterUpdateMeta.mockResolvedValue(undefined)
    const result = await executeToolCall('write_chapter_title', { chapter_index: 1, title: '新标题' }, 'p1')
    expect(result).toContain('新标题')
  })

  it('write_chapter_title 清除标题', async () => {
    mockChapterList.mockResolvedValue([
      { id: 'c1', title: '旧标题', summary: '大纲', status: 'draft' },
    ])
    mockChapterUpdateMeta.mockResolvedValue(undefined)
    const result = await executeToolCall('write_chapter_title', { chapter_index: 1, title: '' }, 'p1')
    expect(result).toContain('标题已清除')
  })

  it('list 无角色', async () => {
    mockCharacterList.mockResolvedValue([])
    const result = await executeToolCall('list', { type: 'character' }, 'p1')
    expect(result).toBe('当前没有角色')
  })

  it('list 列出角色', async () => {
    mockCharacterList.mockResolvedValue([
      { id: 'ch1', name: '叶凡', alias: '叶黑', role: '主角', traits: ['勇敢'], description: '荒古圣体', appearance: '清秀', background: '被挖骨', relationships: '姬紫月', notes: '重要', gender: '男', age: '17岁' },
    ])
    const result = await executeToolCall('list', { type: 'character' }, 'p1')
    expect(result).toContain('叶凡')
    expect(result).toContain('主角')
  })

  it('list traits 为 JSON 字符串时正确解析', async () => {
    mockCharacterList.mockResolvedValue([
      { id: 'ch1', name: '叶凡', alias: '', role: '', traits: '["勇敢","坚韧"]', description: '', appearance: '', background: '', relationships: '', notes: '', gender: '', age: '' },
    ])
    const result = await executeToolCall('list', { type: 'character' }, 'p1')
    expect(result).toContain('叶凡')
  })

  it('read 按名称查找角色', async () => {
    mockCharacterList.mockResolvedValue([
      { id: 'ch1', name: '叶凡', alias: '', role: '主角', traits: [], description: '描述', appearance: '', background: '', relationships: '', notes: '', gender: '', age: '' },
    ])
    const result = await executeToolCall('read', { type: 'character', name: '叶凡' }, 'p1')
    expect(result).toContain('叶凡')
    expect(result).toContain('主角')
  })

  it('read 不存在的角色', async () => {
    mockCharacterList.mockResolvedValue([])
    const result = await executeToolCall('read', { type: 'character', name: '不存在' }, 'p1')
    expect(result).toContain('不存在')
  })

  it('read 角色名称为空时报错', async () => {
    const result = await executeToolCall('read', { type: 'character', name: '' }, 'p1')
    expect(result).toContain('不能为空')
  })

  it('write_character_card 更新已存在角色', async () => {
    mockCharacterList.mockResolvedValue([
      { id: 'ch1', name: '叶凡', alias: '', role: '主角', traits: [], description: '', appearance: '', background: '', relationships: '', notes: '', tags: [], card_group: '', sort_order: 0, gender: '', age: '' },
    ])
    mockCharacterUpdate.mockResolvedValue(undefined)
    const result = await executeToolCall('write_character_card', { name: '叶凡', description: '新描述' }, 'p1')
    expect(result).toContain('已更新「叶凡」')
  })

  it('write_character_card 别名为"无"时清空', async () => {
    mockCharacterList.mockResolvedValue([
      { id: 'ch1', name: '叶凡', alias: '叶黑', role: '主角', traits: [], description: '', appearance: '', background: '', relationships: '', notes: '', tags: [], card_group: '', sort_order: 0, gender: '', age: '' },
    ])
    mockCharacterUpdate.mockResolvedValue(undefined)
    await executeToolCall('write_character_card', { name: '叶凡', alias: '无' }, 'p1')
    const updateCall = mockCharacterUpdate.mock.calls[0][0]
    expect(updateCall.alias).toBe('')
  })

  it('write_character_card traits 用顿号分隔', async () => {
    mockCharacterList.mockResolvedValue([
      { id: 'ch1', name: '叶凡', alias: '', role: '', traits: [], description: '', appearance: '', background: '', relationships: '', notes: '', tags: [], card_group: '', sort_order: 0, gender: '', age: '' },
    ])
    mockCharacterUpdate.mockResolvedValue(undefined)
    await executeToolCall('write_character_card', { name: '叶凡', traits: '勇敢、机智、冲动' }, 'p1')
    const updateCall = mockCharacterUpdate.mock.calls[0][0]
    expect(JSON.parse(updateCall.traits)).toEqual(['勇敢', '机智', '冲动'])
  })

  it('write_character_card 创建新角色', async () => {
    mockCharacterList.mockResolvedValue([])
    mockCharacterCreate.mockResolvedValue(undefined)
    const result = await executeToolCall('write_character_card', { name: '新角色', role: '配角' }, 'p1')
    expect(result).toContain('已创建')
    expect(mockCharacterCreate).toHaveBeenCalled()
  })

  it('write_character_card 名称为空报错', async () => {
    const result = await executeToolCall('write_character_card', { name: '' }, 'p1')
    expect(result).toContain('不能为空')
  })

  it('write_character_card 创建时 traits 用顿号分隔', async () => {
    mockCharacterList.mockResolvedValue([])
    mockCharacterCreate.mockResolvedValue(undefined)
    await executeToolCall('write_character_card', { name: '新角色', traits: '勇敢、坚韧' }, 'p1')
    const createCall = mockCharacterCreate.mock.calls[0][0]
    expect(JSON.parse(createCall.traits)).toEqual(['勇敢', '坚韧'])
  })

  it('write_character_card 重命名角色', async () => {
    mockCharacterList.mockResolvedValue([
      { id: 'ch1', name: '叶凡', alias: '', role: '主角', traits: [], description: '', appearance: '', background: '', relationships: '', notes: '', tags: [], card_group: '', sort_order: 0, gender: '', age: '' },
    ])
    mockCharacterUpdate.mockResolvedValue(undefined)
    const result = await executeToolCall('write_character_card', { name: '叶凡', new_name: '叶黑' }, 'p1')
    expect(result).toContain('叶凡')
    expect(result).toContain('叶黑')
    const updateCall = mockCharacterUpdate.mock.calls[0][0]
    expect(updateCall.name).toBe('叶黑')
  })

  it('list 无世界观', async () => {
    mockWorldList.mockResolvedValue([])
    const result = await executeToolCall('list', { type: 'world' }, 'p1')
    expect(result).toBe('当前没有世界观设定')
  })

  it('list 列出世界观', async () => {
    mockWorldList.mockResolvedValue([
      { id: 'w1', name: '荒古禁地', card_type: 'location', description: '禁地', tags: ['神秘'], notes: '' },
    ])
    const result = await executeToolCall('list', { type: 'world' }, 'p1')
    expect(result).toContain('荒古禁地')
    expect(result).toContain('location')
  })

  it('list 无卷', async () => {
    mockVolumeList.mockResolvedValue([])
    const result = await executeToolCall('list', { type: 'volume' }, 'p1')
    expect(result).toContain('没有卷')
  })

  it('list 列出卷返回序号名称起止章节状态', async () => {
    mockVolumeList.mockResolvedValue([
      { id: 'v1', title: '凡人篇', chapter_start: 1, chapter_end: 10, status: 'writing', outline: '<p>大纲</p>' },
      { id: 'v2', title: '仙界篇', chapter_start: null, chapter_end: null, status: 'planned', outline: '' },
    ])
    const result = await executeToolCall('list', { type: 'volume' }, 'p1')
    expect(result).toContain('共 2 卷')
    expect(result).toContain('[1] 凡人篇 | 第 1–10 章 | writing')
    expect(result).toContain('[2] 仙界篇 | 未绑定章节 | planned')
    expect(result).not.toContain('大纲')
  })


  it('read 按名称查找世界观', async () => {
    mockWorldList.mockResolvedValue([
      { id: 'w1', name: '荒古禁地', card_type: 'location', description: '禁地', tags: [], notes: '' },
    ])
    const result = await executeToolCall('read', { type: 'world', name: '荒古禁地' }, 'p1')
    expect(result).toContain('荒古禁地')
  })

  it('read 世界观不存在', async () => {
    mockWorldList.mockResolvedValue([])
    const result = await executeToolCall('read', { type: 'world', name: '不存在' }, 'p1')
    expect(result).toContain('不存在')
  })

  it('read 世界观名称为空报错', async () => {
    const result = await executeToolCall('read', { type: 'world', name: '' }, 'p1')
    expect(result).toContain('不能为空')
  })

  it('write_world_setting 更新已存在世界观', async () => {
    mockWorldList.mockResolvedValue([
      { id: 'w1', name: '荒古禁地', card_type: 'location', description: '旧描述', tags: [], notes: '', card_group: '', parent_id: null, sort_order: 0 },
    ])
    mockWorldUpdate.mockResolvedValue(undefined)
    const result = await executeToolCall('write_world_setting', { name: '荒古禁地', description: '新描述' }, 'p1')
    expect(result).toContain('已更新「荒古禁地」')
  })

  it('write_world_setting 创建新世界观', async () => {
    mockWorldList.mockResolvedValue([])
    mockWorldCreate.mockResolvedValue(undefined)
    const result = await executeToolCall('write_world_setting', { name: '新地点', type: 'location' }, 'p1')
    expect(result).toContain('已创建')
  })

  it('write_world_setting 名称或类型为空报错', async () => {
    const result = await executeToolCall('write_world_setting', { name: '', type: '' }, 'p1')
    expect(result).toContain('不能为空')
  })

  it('write_world_setting 重命名世界观', async () => {
    mockWorldList.mockResolvedValue([
      { id: 'w1', name: '荒古禁地', card_type: 'location', description: '禁地', tags: [], notes: '', card_group: '', parent_id: null, sort_order: 0 },
    ])
    mockWorldUpdate.mockResolvedValue(undefined)
    const result = await executeToolCall('write_world_setting', { name: '荒古禁地', new_name: '太初古矿' }, 'p1')
    expect(result).toContain('荒古禁地')
    expect(result).toContain('太初古矿')
    const updateCall = mockWorldUpdate.mock.calls[0][0]
    expect(updateCall.name).toBe('太初古矿')
  })

  it('read 未设置大纲', async () => {
    mockProjectList.mockResolvedValue([
      { id: 'p1', title: '小说', synopsis: '' },
    ])
    mockVolumeList.mockResolvedValue([])
    const result = await executeToolCall('read', { type: 'outline' }, 'p1')
    expect(result).toContain('未设置')
  })

  it('read 读取大纲', async () => {
    mockVolumeList.mockResolvedValue([
      { id: 'v1', project_id: 'p1', sort_order: 0, title: '第一卷', outline: '', chapter_start: 1, chapter_end: 10, status: 'planned', progress_notes: '' },
    ])
    const result = await executeToolCall('read', { type: 'outline' }, 'p1')
    expect(result).toContain('第一卷')
    expect(result).toContain('卷目录')
  })

  it('read 项目不存在', async () => {
    mockProjectList.mockResolvedValue([])
    mockVolumeList.mockResolvedValue([])
    const result = await executeToolCall('read', { type: 'outline' }, 'p1')
    expect(result).toContain('未设置')
  })

  it('write_volume summary 变更返回审阅', async () => {
    mockVolumeList.mockResolvedValue([
      { id: 'v1', project_id: 'p1', sort_order: 0, title: '第一卷', outline: '旧概要', chapter_start: null, chapter_end: null, status: 'planned', progress_notes: '' },
    ])
    resetVolumeSummaryBatchCounter()
    const result = await executeToolCall('write_volume', { volume_index: 1, outline: '新概要' }, 'p1')
    const parsed = JSON.parse(result)
    expect(parsed._edit_volume).toBe(true)
    expect(parsed.original).toBe('旧概要')
    expect(parsed.modified).toBe('新概要')
  })

  it('write_volume 同一轮禁止连续提交多卷概要', async () => {
    mockVolumeList.mockResolvedValue([
      { id: 'v1', project_id: 'p1', sort_order: 0, title: '第一卷', outline: '', chapter_start: null, chapter_end: null, status: 'planned', progress_notes: '' },
      { id: 'v2', project_id: 'p1', sort_order: 1, title: '第二卷', outline: '', chapter_start: null, chapter_end: null, status: 'planned', progress_notes: '' },
    ])
    resetVolumeSummaryBatchCounter()
    await executeToolCall('write_volume', { volume_index: 1, outline: '卷一' }, 'p1')
    const second = await executeToolCall('write_volume', { volume_index: 2, outline: '卷二' }, 'p1')
    expect(second).toContain('本轮已写过卷级大纲')
  })

  it('write_volume 有待审阅概要时拒绝写其他卷', async () => {
    mockVolumeList.mockResolvedValue([
      { id: 'v1', project_id: 'p1', sort_order: 0, title: '第一卷', outline: '', chapter_start: null, chapter_end: null, status: 'planned', progress_notes: '' },
      { id: 'v2', project_id: 'p1', sort_order: 1, title: '第二卷', outline: '', chapter_start: null, chapter_end: null, status: 'planned', progress_notes: '' },
    ])
    resetVolumeSummaryBatchCounter()
    useEditorStore.getState().setPendingVolumeEdit({
      volumeId: 'v1',
      original: '',
      modified: '待审',
      summary: '测试',
    })
    const result = await executeToolCall('write_volume', { volume_index: 2, outline: '卷二' }, 'p1')
    expect(result).toContain('等用户采纳或拒绝')
  })

  it('write_volume 仅更新 progress_notes', async () => {
    mockVolumeList.mockResolvedValue([
      { id: 'v1', project_id: 'p1', sort_order: 0, title: '第一卷', outline: '', chapter_start: null, chapter_end: null, status: 'planned', progress_notes: '' },
    ])
    mockVolumeUpdateMeta.mockResolvedValue({ id: 'v1' })
    const result = await executeToolCall('write_volume', { volume_index: 1, progress_notes: '进度' }, 'p1')
    expect(result).toContain('已更新')
    expect(mockVolumeUpdateMeta).toHaveBeenCalled()
  })

  it('write_outline 已废弃', async () => {
    const result = await executeToolCall('write_outline', { content: '新大纲' }, 'p1')
    expect(result).toContain('已废弃')
  })

  it('update_progress 已废弃', async () => {
    const result = await executeToolCall('update_progress', { content: '<p>进度</p>' }, 'p1')
    expect(result).toContain('已废弃')
  })

  it('create_volume 创建卷', async () => {
    mockVolumeList.mockResolvedValue([])
    mockVolumeSave.mockImplementation(async (v) => v)
    const result = await executeToolCall('create_volume', { title: '第一卷' }, 'p1')
    expect(result).toContain('已创建')
    expect(mockVolumeSave).toHaveBeenCalled()
  })

  it('create_chapter 多卷未写分卷剧情时拒绝', async () => {
    mockVolumeList.mockResolvedValue([
      { id: 'v1', project_id: 'p1', sort_order: 0, title: '第一卷', outline: '', chapter_start: 1, chapter_end: 10, status: 'planned', progress_notes: '' },
      { id: 'v2', project_id: 'p1', sort_order: 1, title: '第二卷', outline: '', chapter_start: 11, chapter_end: 20, status: 'planned', progress_notes: '' },
    ])
    const result = await executeToolCall('create_chapter', { count: 3 }, 'p1')
    expect(result).toContain('未填写卷级大纲')
    expect(mockChapterSave).not.toHaveBeenCalled()
  })

  it('write_chapter_outline 多卷未写分卷剧情时拒绝', async () => {
    mockVolumeList.mockResolvedValue([
      { id: 'v1', project_id: 'p1', sort_order: 0, title: '第一卷', outline: '', chapter_start: null, chapter_end: null, status: 'planned', progress_notes: '' },
      { id: 'v2', project_id: 'p1', sort_order: 1, title: '第二卷', outline: '', chapter_start: null, chapter_end: null, status: 'planned', progress_notes: '' },
    ])
    mockChapterList.mockResolvedValue([
      { id: 'c1', title: '第一章', chapter_outline: '', status: 'draft' },
    ])
    const result = await executeToolCall('write_chapter_outline', { chapter_index: 1, outline: '大纲' }, 'p1')
    expect(result).toContain('未填写卷级大纲')
    expect(mockChapterUpdateMeta).not.toHaveBeenCalled()
  })

  it('create_chapter 单卷项目不受分卷剧情顺序限制', async () => {
    mockVolumeList.mockResolvedValue([
      { id: 'v1', project_id: 'p1', sort_order: 0, title: '', summary: '', chapter_start: null, chapter_end: null, status: 'planned', progress_notes: '' },
    ])
    mockChapterList.mockResolvedValue([])
    mockChapterSave.mockResolvedValue(undefined)
    const result = await executeToolCall('create_chapter', { count: 1 }, 'p1')
    expect(result).toContain('已创建')
    expect(mockChapterSave).toHaveBeenCalled()
  })

  it('create_chapter 创建章节', async () => {
    mockChapterList.mockResolvedValue([])
    mockChapterSave.mockResolvedValue(undefined)
    const result = await executeToolCall('create_chapter', { count: 3 }, 'p1')
    expect(result).toContain('已创建第 1-3 章')
    expect(mockChapterSave).toHaveBeenCalledTimes(3)
  })

  it('create_chapter count 无效报错', async () => {
    const result = await executeToolCall('create_chapter', { count: 0 }, 'p1')
    expect(result).toContain('必须大于 0')
  })

  it('propose_action 返回选项', async () => {
    const result = await executeToolCall('propose_action', { type: 'rename_chapter', options: ['标题1', '标题2'] }, 'p1')
    expect(result).toContain('_proposal')
    const parsed = JSON.parse(result)
    expect(parsed.type).toBe('rename_chapter')
    expect(parsed.options).toEqual(['标题1', '标题2'])
  })

  it('propose_action 参数不完整报错', async () => {
    const result = await executeToolCall('propose_action', { type: '', options: [] }, 'p1')
    expect(result).toContain('参数不完整')
  })

  it('write_chapter_content edits 可删除段落', async () => {
    mockChapterList.mockResolvedValue([{ id: 'ch1', content: '<p>要删除的内容</p><p>保留的内容</p>', summary: '' }])
    const result = await executeToolCall('write_chapter_content', {
      chapter_index: 1,
      edits: [{ paragraph_index: 1, text: '' }],
      summary: '删除段落',
    }, 'p1')
    const parsed = JSON.parse(result)
    expect(parsed._edit_chapter).toBe(true)
    expect(parsed.modified).not.toContain('要删除的内容')
    expect(parsed.modified).toContain('保留的内容')
  })

  it('工具执行异常时返回错误信息', async () => {
    mockChapterListMeta.mockRejectedValue(new Error('数据库错误'))
    const result = await executeToolCall('list', { type: 'chapter' }, 'p1')
    expect(result).toContain('执行失败')
  })

  it('write_chapter_content 空章节用 content 写入', async () => {
    mockChapterList.mockResolvedValue([{ id: 'ch1', content: '', summary: '' }])
    const result = await executeToolCall('write_chapter_content', {
      chapter_index: 1,
      content: '新内容',
      summary: '首次写入',
    }, 'p1')
    const parsed = JSON.parse(result)
    expect(parsed._edit_chapter).toBe(true)
    expect(parsed.modified).toBe('<p>新内容</p>')
  })

  it('write_chapter_content 空章节多段 content', async () => {
    mockChapterList.mockResolvedValue([{ id: 'ch1', content: '', summary: '' }])
    const result = await executeToolCall('write_chapter_content', {
      chapter_index: 1,
      content: '第一段\n\n第二段',
      summary: '首次写入',
    }, 'p1')
    const parsed = JSON.parse(result)
    expect(parsed.modified).toBe('<p>第一段</p><p>第二段</p>')
  })

  it('write_chapter_content chapter_index 无效报错', async () => {
    const result = await executeToolCall('write_chapter_content', {
      chapter_index: 0,
      content: '内容',
      summary: '写',
    }, 'p1')
    expect(result).toContain('必须是大于 0')
  })

  it('write_chapter_content 章节不存在报错', async () => {
    mockChapterList.mockResolvedValue([])
    const result = await executeToolCall('write_chapter_content', {
      chapter_index: 1,
      content: '内容',
      summary: '写',
    }, 'p1')
    expect(result).toContain('未找到')
  })

  it('write_chapter_content 非空章节禁止 content', async () => {
    mockChapterList.mockResolvedValue([{ id: 'ch1', content: '<p>已有内容</p>', summary: '' }])
    const result = await executeToolCall('write_chapter_content', {
      chapter_index: 1,
      content: '整章覆盖',
      summary: '写',
    }, 'p1')
    expect(result).toContain('非空章节')
  })

  it('write_chapter_content text 含 HTML 注入被转义', async () => {
    mockChapterList.mockResolvedValue([{ id: 'ch1', content: '<p>原段</p>', summary: '' }])
    const result = await executeToolCall('write_chapter_content', {
      chapter_index: 1,
      edits: [{ paragraph_index: 1, text: '<img src=x onerror=alert(1)>' }],
      summary: '注入测试',
    }, 'p1')
    const parsed = JSON.parse(result)
    expect(parsed.modified).not.toContain('<img')
    expect(parsed.modified).toContain('&lt;img')
  })

  it('write_chapter_content edits+inserts 同调用', async () => {
    mockChapterList.mockResolvedValue([
      { id: 'ch1', content: '<p>第一段</p><p>第二段</p><p>第三段</p>', summary: '' },
    ])
    const result = await executeToolCall('write_chapter_content', {
      chapter_index: 1,
      edits: [{ paragraph_index: 3, text: '' }],
      inserts: [{ after_paragraph_index: 2, text: '新过渡' }],
      summary: '删插',
    }, 'p1')
    const parsed = JSON.parse(result)
    expect(parsed.modified).toContain('新过渡')
    expect(parsed.modified).not.toContain('第三段')
  })

  it('update_progress 已废弃（空内容）', async () => {
    const result = await executeToolCall('update_progress', { content: '' }, 'p1')
    expect(result).toContain('已废弃')
  })
})

const mockVectorSearch = vi.fn()
const mockSearchWorkspace = vi.fn()

describe('executeToolCall - search', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      electronAPI: {
        vector: { search: mockVectorSearch },
        search: { workspace: mockSearchWorkspace },
      },
    })
    mockVectorSearch.mockReset()
    mockSearchWorkspace.mockReset()
  })

  it('scope 为空时报错', async () => {
    const result = await executeToolCall('search', { keyword: 'test' }, 'p1')
    expect(result).toContain('scope 必填')
  })

  it('keyword 和 semantic 都为空时报错', async () => {
    const result = await executeToolCall('search', { scope: ['settings'] }, 'p1')
    expect(result).toContain('至少传一个')
  })

  it('keyword 搜索成功返回结果', async () => {
    mockSearchWorkspace.mockResolvedValue({
      results: [
        { type: 'chapter_content', entity_id: 'ch1', name: '第一章', chunk_idx: 0, chunk_text: '叶凡进入了荒古禁地', score: -1, start: 0, end: 10, chapter_index: 1 },
        { type: 'knowledge', entity_id: 'k1', name: '原著资料', chunk_idx: 0, chunk_text: '荒古禁地是', score: -2, start: 0, end: 5 },
      ],
      summary: { total: 2, chapters: 1, knowledge: 1 },
    })
    const result = await executeToolCall('search', { keyword: '叶凡 荒古禁地', scope: ['content', 'knowledge'] }, 'p1')
    expect(result).toContain('荒古禁地')
    expect(result).toContain('第一章')
  })

  it('keyword 搜索无结果', async () => {
    mockSearchWorkspace.mockResolvedValue({ results: [], summary: { total: 0 } })
    const result = await executeToolCall('search', { keyword: '不存在的内容', scope: ['settings'] }, 'p1')
    expect(result).toContain('未找到匹配结果')
  })

  it('semantic 搜索成功返回结果', async () => {
    mockVectorSearch.mockResolvedValue({
      success: true,
      results: [
        { knowledge_name: '原著', text: '叶凡进入荒古禁地', score: 0.95, knowledge_item_id: 'k1', chunk_index: 0, knowledge_category: 'plot' },
      ],
    })
    const result = await executeToolCall('search', { semantic: '荒古禁地', scope: ['knowledge'] }, 'p1')
    expect(result).toContain('荒古禁地')
    expect(result).toContain('原著')
  })

  it('semantic 搜索无结果', async () => {
    mockVectorSearch.mockResolvedValue({ success: true, results: [] })
    const result = await executeToolCall('search', { semantic: '不存在的内容', scope: ['knowledge'] }, 'p1')
    expect(result).toContain('未找到')
  })

  it('semantic 搜索失败返回错误', async () => {
    mockVectorSearch.mockResolvedValue({ success: false, error: '连接失败' })
    const result = await executeToolCall('search', { semantic: '测试', scope: ['knowledge'] }, 'p1')
    expect(result).toContain('搜索失败')
  })
})

describe('delete tool', () => {
  it('describeDeleteAction 返回章节删除预览', async () => {
    mockChapterList.mockResolvedValue([
      { id: 'ch1', title: '开端', sort_order: 0 },
      { id: 'ch2', title: '发展', sort_order: 1 },
    ])
    const preview = await describeDeleteAction({ type: 'chapter', chapter_indices: [1, 2], reason: '合并章节' }, 'p1')
    expect(preview.error).toBeUndefined()
    expect(preview.label).toContain('2 个章节')
  })

  it('delete 批量删除章节', async () => {
    mockChapterList
      .mockResolvedValueOnce([
        { id: 'ch1', title: '开端', sort_order: 0 },
        { id: 'ch2', title: '发展', sort_order: 1 },
      ])
      .mockResolvedValueOnce([{ id: 'ch2', title: '发展', sort_order: 0 }])
    useEditorStore.getState().setChapters([
      { id: 'ch1', project_id: 'p1', title: '开端', content: '', chapter_outline: '', sort_order: 0, status: 'draft', word_count: 0 },
      { id: 'ch2', project_id: 'p1', title: '发展', content: '', chapter_outline: '', sort_order: 1, status: 'draft', word_count: 0 },
    ])
    const result = await executeToolCall('delete', { type: 'chapter', chapter_indices: [1, 2], reason: '测试清理' }, 'p1')
    expect(result).toContain('已删除第1章')
    expect(result).toContain('已删除第2章')
    expect(mockChapterDelete).toHaveBeenCalledTimes(2)
    expect(mockFlushChapterSave).toHaveBeenCalled()
  })

  it('delete 批量删除角色', async () => {
    mockCharacterList.mockResolvedValue([
      { id: 'c1', name: '张三' },
      { id: 'c2', name: '李四' },
    ])
    const result = await executeToolCall('delete', { type: 'character', names: ['张三', '李四'], reason: '角色合并' }, 'p1')
    expect(result).toContain('已删除角色「张三」')
    expect(result).toContain('已删除角色「李四」')
    expect(mockCharacterDelete).toHaveBeenCalledTimes(2)
  })

  it('delete 删除卷', async () => {
    mockVolumeList
      .mockResolvedValueOnce([{ id: 'v1', title: '第一卷', sort_order: 0, outline: '', status: 'planned' }])
      .mockResolvedValueOnce([])
    useEditorStore.getState().setVolumes([{ id: 'v1', project_id: 'p1', sort_order: 0, title: '第一卷', outline: '', chapter_start: null, chapter_end: null, status: 'planned', progress_notes: '' }])
    const result = await executeToolCall('delete', { type: 'volume', volume_indices: [1], reason: '卷结构调整' }, 'p1')
    expect(result).toContain('已删除卷「第一卷」')
    expect(mockVolumeDelete).toHaveBeenCalledWith('v1')
  })

  it('delete 目标不存在时报错', async () => {
    mockChapterList.mockResolvedValue([])
    const result = await executeToolCall('delete', { type: 'chapter', chapter_indices: [99], reason: '清理' }, 'p1')
    expect(result).toContain('都不存在')
  })

  it('delete 缺少 type 报错', async () => {
    const result = await executeToolCall('delete', { chapter_indices: [1], reason: '清理' }, 'p1')
    expect(result).toContain('type 必填')
  })

  it('delete 缺少 reason 报错', async () => {
    const result = await executeToolCall('delete', { type: 'chapter', chapter_indices: [1] }, 'p1')
    expect(result).toContain('reason 必填')
  })

  it('describeDeleteAction 缺少 reason 报错', async () => {
    const preview = await describeDeleteAction({ type: 'chapter', chapter_indices: [1] }, 'p1')
    expect(preview.error).toContain('reason 必填')
  })
})
