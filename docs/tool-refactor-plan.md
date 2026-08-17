# 工具接口重构规划

## 背景

当前 AI 工具有 18 个，存在以下问题：
- 读/列操作按数据类型拆分为独立工具（list_chapters、read_character_card 等），AI 需要记住类型→工具名的映射关系
- 两个搜索工具（search_workspace 关键词、search_vectorDB 语义）功能重叠
- 知识库缺少读取完整内容的工具，AI 只能获取搜索片段

参考 Claude Code 等主流 Agent 的设计（Read/Write/Edit/Glob/Grep 五个通用工具覆盖一切），决定对读/列/搜索类工具做合并重构。

## 设计原则

- **读操作通用化**：list/read/search 各合并为 1 个工具，通过 type 参数路由
- **写操作保持独立**：各 write_* 工具参数结构差异大，合并反而增加 schema 复杂度
- **工具数从 18 降至 12**

## 合并方案

### 1. list（合并 list_chapters + list_character_card + list_world_setting）

```typescript
{
  name: 'list',
  description: '按类型列出实体概览。type 可选 chapter/character/world。chapter 不传 chapters 时返回当前章节附近的章节目录（含标题、字数、大纲摘要）；传 chapters 数组查指定章节。character/world 返回名称+核心字段摘要（角色：名称、定位、描述；世界观：名称、类型、描述）。如需查看完整信息请用 read(type=chapter_content 或 character 或 world)',
  parameters: {
    type: 'string',              // 必填，'chapter' | 'character' | 'world'
    chapters?: 'number[]'        // type=chapter 时可选，查指定章节（单个用 [5]，多个用 [1,3,5]）
  }
}
```

路由：
- type='chapter' → 原 list_chapters handler
- type='character' → 原 list_character_card handler（需精简返回字段）
- type='world' → 原 list_world_setting handler（需精简返回字段）
- chapters 仅 type=chapter 时有效，其它 type 下忽略

**list 返回信息量设计**：

当前 `list_character_card` 和 `list_world_setting` 返回完整详细信息（所有字段），token 开销大。重构后 list 只返回摘要：

| type | list 返回（摘要） | read 返回（完整） |
|------|-------------------|-------------------|
| chapter | 标题 + 字数 + 大纲 | 正文全文（type=chapter_content） |
| character | 名称 + 定位 + 一句话描述 | 所有字段（别名、性格、外貌、背景、关系等） |
| world | 名称 + 类型 + 一句话描述 | 所有字段（描述、标签、备注等） |

这样 list 的 token 开销可控，AI 需要详情时再调 read。

### 2. read（合并 read_chapter_content + read_character_card + read_world_setting + read_outline，新增知识库读取）

```typescript
{
  name: 'read',
  description: '读取指定实体的完整信息。type 可选 chapter_content/character/world/outline/knowledge。chapter_content 需传 chapter_index；character/world/knowledge 需传 name；outline 无需额外参数。knowledge 类型默认返回前 2000 字，可通过 position+offset 精准跳转',
  parameters: {
    type: 'string',              // 必填，'chapter_content' | 'character' | 'world' | 'outline' | 'knowledge'
    chapter_index?: 'number',    // type=chapter_content 时必填
    name?: 'string',             // type=character/world/knowledge 时必填
    position?: 'number',          // type=knowledge 可选，锚点位置（字符偏移），从该位置前后取内容
    offset?: 'number'             // type=knowledge 可选，取 position 前后各多少字符，默认 1000
  }
}
```

路由：
- type='chapter_content' → 原 read_chapter_content handler（保留从 editorStore 获取实时编辑内容的逻辑）
- type='character' → 原 read_character_card handler
- type='world' → 原 read_world_setting handler
- type='outline' → 原 read_outline handler
- type='knowledge' → 新 handler，按 name 查知识库条目，支持 position+offset 精准跳转

**参数校验**：handler 中需校验参数组合合法性：
- type=chapter_content 但未传 chapter_index → 返回错误提示
- type=character/world/knowledge 但未传 name → 返回错误提示
- type=outline 时忽略 chapter_index/name/offset/limit
- 传了无关参数时静默忽略（不报错，避免 AI 误传导致中断）

知识库 read 返回格式：
```
知识库「夏家三千金_角色资料」（共 12800 字，显示前 2000 字）

# 夏天美
夏天美是单纯善良又迷糊的夏家小女儿...
[... 内容 ...]
```

AI 阅读策略：
- 小文件：不传 position/offset，一次读完
- 大文件：不传 position/offset，读前 2000 字
- search 命中后：传 position=命中位置 + offset=1000，精准跳转并看上下文

### 3. search（合并 search_workspace + search_vectorDB）

```typescript
{
  name: 'search',
  description: '搜索工作区。keyword 按关键词精确匹配（多个关键词用空格分隔，按命中数量排序）；semantic 按语义相似度搜索知识库资料。至少传一个，可同时传。scope 必填，指定搜索范围（可多选）：settings（角色+世界观）、outlines（全书大纲+章节大纲）、knowledge（知识库）、content（章节正文，非必要不搜索，会导致返回大量无用结果）。注意：严禁在正文中搜索宽泛关键词（如主角名、常见动词）',
  parameters: {
    keyword?: 'string',          // 关键词搜索，与 semantic 至少传一个
    semantic?: 'string',         // 语义搜索，与 keyword 至少传一个
    scope: 'string[]',           // 必填：['settings', 'outlines', 'knowledge', 'content']，可多选，非必要不使用 content
    top_k?: 'number'             // 返回数量
  }
}
```

路由：
- 只传 keyword → 原 search_workspace handler（排除章节正文），scope 必填，指定搜索范围
- 只传 semantic → 原 search_vectorDB handler（覆盖知识库，可扩展到正文），scope 必填，指定搜索范围
- 同时传 → 并行执行两者，合并返回 `{ keyword_results, semantic_results }`
- 都不传 → 返回错误提示

#### keyword 搜索的返回策略（按数据类型差异化）

| 数据类型 | 返回内容 | 原因 |
|---------|---------|------|
| 角色 | 该角色的完整内容 | 数据量小（几百~几千字），全量返回减少二次调用 |
| 世界观 | 该世界观的完整内容 | 同上 |
| 全书大纲 | 匹配句 + 前后共 5 句 | 大纲是结构化叙事，多给上下文帮助理解前后脉络 |
| 章节大纲 | 匹配句 + 前后共 3 句 | 章节大纲较短，3 句够看上下文 |
| 知识库 | 匹配句 + 前后共 3 句 + position | 平衡上下文和 token 控制，position 用于 read 精准跳转 |
| 章节正文 | 匹配句 + 前后共 3 句 + position | **必须显式指定 scope=content**，受分级限制策略约束 |

数量限制：
- 角色/世界观：匹配到多个实体时，最多返回 3 个完整内容，按 keyword_hits 排序
- 章节大纲/知识库：分级限制（见下方）

**句子切分方案**：

按中文标点切分句子，分隔符：`。？！；\n`。切分后找到包含关键词的句子，取前后 N 句返回。

```
原文：第一章。夏天美是夏家小女儿。她性格单纯善良。在层峰公司工作时遇到了严格。两人从欢喜冤家变成了恋人。最终走到了一起。
关键词：严格
全书大纲返回（前后 5 句）：夏天美是夏家小女儿。她性格单纯善良。在层峰公司工作时遇到了严格。两人从欢喜冤家变成了恋人。最终走到了一起。
```

章节大纲/知识库/正文搜索的分级限制（全书大纲不受此限制）：

| 匹配结果数 | 返回策略 |
|-----------|---------|
| ≤ 50 | 匹配句 + 前后共 N 句（大纲 5 句，知识库/正文 3 句） |
| 51 ~ 500 | 只返回匹配的那一句话（压缩模式），提示 "结果过多，已精简显示" |
| > 500 | 返回错误 "搜索结果过多，请使用更精确的关键词或改用语义搜索" |

单个条目匹配句组数超过 5 组时，截断并提示 AI 用 `read(type=knowledge, position=...)` 精确阅读。

#### search 返回格式

**只传 keyword 时**：
```json
{
  "results": [
    { "source": "character", "name": "夏天美", "content": "夏天美是单纯善良又迷糊的夏家小女儿..." },
    { "source": "world", "name": "层峰公司", "content": "层峰公司是一家大型建设企业..." },
    { "source": "outline", "name": "全书大纲", "snippet": "...夏天美与严格的关系逐渐升温...", "position": 567 },
    { "source": "chapter_outline", "name": "第3章 重逢", "chapter_index": 3 },
    { "source": "knowledge", "name": "夏家三千金_角色资料", "snippet": "...夏天美...", "position": 1234 }
  ],
  "summary": { "total": 5, "settings": 2, "outlines": 2, "knowledge": 1 }
}
```

**只传 semantic 时**（保持原格式）：
```json
{
  "results": [
    { "knowledge_name": "夏家三千金_角色资料", "text": "夏天美是...", "score": 0.95, "knowledge_item_id": "k1", "chunk_index": 0, "position": 0 }
  ]
}
```

**同时传时**（合并返回）：
```json
{
  "keyword_results": { "results": [...], "summary": {...} },
  "semantic_results": { "results": [...] }
}
```

**handler 层逻辑**：根据传入参数调用对应后端，返回格式各自保持不变。同时传时两个结果独立包装在 `keyword_results` 和 `semantic_results` 中，AI 可分别理解两种结果。

**toolResult vs toolSummary 的区分**：

AIPanel 中工具调用有两个数据字段：
- `toolResult`：executeToolCall 返回的完整结果，作为 tool message 发回给 AI（多轮对话拼接用）
- `toolSummary`：前端 UI 显示给用户的摘要文案（通过 `getToolSummary()` 生成）

重构时需注意：
- search 的 `toolResult` 保持完整的结构化 JSON（AI 需要 position 等字段来调用 read）
- search 的 `toolSummary` 只显示简短摘要（如 "搜索了「夏天美」，找到 10 处匹配"）
- read(type=knowledge) 的 `toolResult` 是完整文本（AI 需要内容来理解），`toolSummary` 只显示 "阅读了知识库「xxx」"

#### position 实现方案

**keyword 模式**：
- 改造 `searchField` 函数，额外返回 `position`（第一个匹配关键词在原文中的字符位置）
- 仅对 knowledge 类型的搜索结果计算 position（其它类型无消费方）
- `extractSnippet` 函数返回 `{ hits, snippet, position }` 结构
- 多关键词时取第一个命中的关键词位置

**semantic 模式**：
- 向量搜索返回的 chunk 已有 `chunk_index`，需转换为 position
- 改造 `chunkText` 函数，记录每个 chunk 的起始字符偏移
- 在 vector index 时，将 `position` 存入 chunk metadata
- semantic 搜索结果直接返回 `position = chunk 的起始字符位置`

**position 消费方**：仅 `read(type=knowledge, position=position)` 有意义。对于 chapter/character/world/outline 的搜索结果，position 字段不返回（或返回 -1 表示不适用）。

#### keyword 搜索的知识库项目范围限制

当前 `search.ts` 中知识库搜索查询所有条目（`SELECT * FROM knowledge_items`），未限制项目范围。语义搜索会过滤 `project_knowledge` 表。这是一个已有的不一致。

重构时统一处理：keyword 搜索知识库时也过滤当前项目启用的条目（JOIN `project_knowledge` 表），与语义搜索保持一致。

### 4. 保持不变的 9 个工具

| 工具 | 保留原因 |
|------|----------|
| write_chapter_outline | 参数结构独特（单章/批量双模式） |
| write_chapter_title | 参数结构独特（单章/批量双模式） |
| write_chapter_content | 参数结构独特（original_snippet + modified_snippet） |
| write_character_card | 参数复杂（十几种角色字段 + 批量模式） |
| write_world_setting | 参数复杂（类型、标签、备注 + 批量模式） |
| write_outline | 特殊（HTML 格式 + 原文对比） |
| create_chapter | 独立操作（批量创建空白章节） |
| update_progress | 独立操作（追加到大纲末尾） |
| propose_action | 独立操作（用户选择交互） |

## 前置任务

### chapter.summary 重命名

当前章节大纲字段在代码中叫 `summary`，语义不清晰（容易与搜索结果的 summary 混淆）。需统一重命名为 `chapter_outline`。

涉及范围（约 80 处）：
- 数据库：`chapters` 表 `summary` 列 → `chapter_outline`（需 ALTER TABLE 迁移）
- 类型定义：`editorStore.ts`、`types/index.ts`、`backupValidator.ts`
- IPC handlers：`main.ts`（INSERT/UPDATE）、`version.ts`（序列化/反序列化）、`search.ts`（查询）
- 工具层：`tools.ts`（read/write_chapter_outline handler）
- UI 组件：`Editor.tsx`、`Sidebar.tsx`、`TitleBar.tsx`
- 测试文件：`tools.test.ts`、`editorStore.test.ts`、`backupValidator.test.ts`

迁移方式：使用 `ALTER TABLE chapters RENAME COLUMN summary TO chapter_outline`（SQLite 3.25.0+ 支持）。

## 变更清单

### src/lib/tools.ts
- toolDefinitions：删除 9 个旧定义（list_chapters、list_character_card、list_world_setting、read_chapter_content、read_character_card、read_world_setting、read_outline、search_workspace、search_vectorDB），新增 3 个（list、read、search）
- toolHandlers：删除 9 个旧 handler，新增 3 个路由 handler
- readToolNames：更新为 `new Set(['list', 'read', 'search'])`
- toolUsageGuide + toolUsageGuideReadonly：更新工具描述

**executeToolCall 的 dataVersion 逻辑更新**：

当前逻辑：`if (name !== 'read_chapter_content') incrementDataVersion()`

重构后需改为只读工具不触发 dataVersion：
```typescript
const readonlyTools = new Set(['list', 'read', 'search'])
if (!readonlyTools.has(name)) useEditorStore.getState().incrementDataVersion()
```

### src/lib/tools.test.ts
- 更新工具名引用（list_chapters → list(type=chapter) 等）
- 新增 list/read/search 通用工具测试（各 type 路由、参数校验、边界情况）
- 更新工具总数断言（18 → 12）

### electron/ipc/knowledge.ts
- 新增 getByName handler：按名称精确查找知识库条目

**getByName 边界情况处理**：

| 情况 | 处理方式 |
|------|----------|
| name 无 UNIQUE 约束，可能存在同名条目 | 返回第一条匹配（`LIMIT 1`），同名条目极少出现 |
| 知识库条目是全局的，通过 project_knowledge 关联项目 | getByName 不限制项目范围（知识库内容本身是全局的，项目只是启用/禁用关系） |
| 条目未被当前项目启用 | 仍然允许 read（AI 可能需要参考未启用的资料），但返回时提示 "此资料未在当前项目启用" |
| name 不存在 | 返回 null，handler 层转为 "知识库条目「xxx」不存在" |

```typescript
ipcMain.handle('db:knowledge:getByName', (_e, name: string) => {
  return db.queryOne('SELECT * FROM knowledge_items WHERE name = ?', [name])
})
```

- preload.ts 同步新增 knowledge.getByName 接口

### electron/ipc/search.ts
- scope 参数必填，支持多选：`settings`（角色+世界观）、`outlines`（全书大纲+章节大纲）、`knowledge`（知识库）、`content`（章节正文，非必要不搜索）
- keyword 搜索默认排除章节正文（需显式指定 scope=content 才搜索）
- 按数据类型差异化返回策略（角色/世界观返回完整内容，大纲/知识库返回匹配句+前后N句，章节大纲返回匹配句+前后3句）
- 新增句子切分函数（按 `。？！；\n` 分割，返回包含关键词的句子及前后句）
- 知识库搜索分级限制：≤50 返回前后句，51~500 只返回匹配句，>500 报错
- 角色/世界观匹配多个实体时限制最多返回 3 个
- keyword 搜索知识库时限制项目范围（JOIN project_knowledge 表）
- 改造 searchField / extractSnippet 函数返回 position

### electron/ipc/vector.ts
- chunkText 函数记录每个 chunk 的起始 position
- indexItem 时将 position 存入 chunk metadata
- vector search 返回结果包含 position

### src/lib/context.ts
- knowledgeHint 中 `search_workspace 或 search_vectorDB` → `search(keyword) 或 search(semantic)`

### src/components/ai-panel/AIPanel.tsx

AIPanel.tsx 影响范围远大于 "工具名→显示文案映射"，以下是详细分析：

#### a) getToolSummary 函数（约第 88-187 行）

switch-case 中有 9 个旧工具名的摘要生成逻辑，全部需要改为新工具名 + args.type 路由：

```typescript
function getToolSummary(name: string, result: string, args?: Record<string, unknown>): string {
  const type = args?.type as string
  switch (name) {
    case 'list': {
      if (type === 'chapter') { /* 原 list_chapters 逻辑 */ }
      if (type === 'character') { /* 原 list_character_card 逻辑 */ }
      if (type === 'world') { /* 原 list_world_setting 逻辑 */ }
      break
    }
    case 'read': {
      if (type === 'chapter_content') { const idx = args?.chapter_index; return `读取了第${idx}章正文` }
      if (type === 'character') { return `查看了角色「${args?.name}」的设定` }
      if (type === 'world') { return `查看了世界观「${args?.name}」的设定` }
      if (type === 'outline') { return '查看了全文大纲' }
      if (type === 'knowledge') { return `阅读了知识库「${args?.name}」` }
      break
    }
    case 'search': { return `搜索了「${args?.keyword || args?.semantic}」` }
    // ... 保持不变的写入工具
  }
}
```

#### b) 工具执行结果的 display 逻辑（约第 1170 行）

当前按工具名判断展示策略：
```typescript
if (name === 'list_chapters') displayResult = ''
else if (name === 'list_character_card' || ...) displayResult = ''
else if (name === 'read_chapter_content' || ...) displayResult = result.split('\n')[0]
```

重构后改为：
```typescript
if (name === 'list') displayResult = ''
else if (name === 'read' && type !== 'knowledge') displayResult = result.split('\n')[0]
else if (name === 'read' && type === 'knowledge') displayResult = result.split('\n').slice(0, 3).join('\n')
else if (name === 'search') displayResult = result.split('\n')[0]
else displayResult = result
```

#### c) 写入确认逻辑（约第 1030-1100 行）

`write_character_card` 和 `write_world_setting` 的用户确认流程不受影响（工具名不变）。但确认后的 executeToolCall 调用路径需确认新工具名正确传递。

#### d) 搜索结果展示

当前 search_workspace 和 search_vectorDB 各有独立的结果展示逻辑，合并后需统一到 search 工具名下，根据 args.mode 区分展示格式。

### src/lib/editorRef.ts
- toolHint 映射更新：
```typescript
const toolHint: Record<string, string> = {
  chapter_title: '',
  chapter_outline: '',
  chapter_content: '',
  chapter_create: '，请使用 list(type=chapter) 查看',
  chapter_delete: '，请使用 list(type=chapter) 查看',
  character: '，请使用 read(type=character) 查看',
  world: '，请使用 read(type=world) 查看',
  outline: '，请使用 read(type=outline) 查看',
  style: '',
}
```

### src/stores/knowledgeStore.ts
- VectorSearchResult / WorkspaceSearchResult 类型定义可能需要更新（如果 search 返回格式有变化）
- searchKnowledge / searchWorkspace 方法的返回类型保持不变（store 层不感知工具重构）

### e2e/ai-helpers.ts
- TOOL_SCHEMAS 合并为 list/read/search
- executeToolOnRenderer 路由更新：根据 name + args.type 分发到对应的 IPC 调用
- readViaRenderer 路由更新

### e2e/knowledge-search.spec.ts
- AI 调用测试中的工具名更新

### e2e/ai-tools.spec.ts
- 所有工具名引用更新（如 list_chapters → list）
- executeToolOnRenderer 调用参数更新

### docs/tools.md
- 更新工具列表文档

## Description 设计注意事项

合并后的工具 description 承载更多信息，对 AI 理解工具至关重要：

1. **参数组合约束无法在 JSON Schema 中表达**：type=chapter_content 时 chapter_index 必填，type=character 时 name 必填。JSON Schema 的 `required` 字段无法按条件约束。解决方案：在 description 中明确说明各 type 的必填参数，handler 中校验并返回清晰的错误提示。

2. **keyword/semantic 的互斥性**：至少传一个，可同时传。同时传时并行执行两种搜索，返回结构化结果。都不传时返回错误提示。

3. **list vs read 的语义区分**：需在 description 中明确 list 返回摘要、read 返回完整信息，引导 AI 在不同场景选择正确工具。

## 向后兼容策略

如果用户正在使用旧版本，升级后可能出现兼容性问题：

1. **对话历史中的旧工具名**：存储在 localStorage 中的对话历史可能包含旧工具名的 tool_calls。AI 尝试调用已删除的工具时，executeToolCall 会返回 "未知工具" 错误。影响较小（AI 会自动重试新工具），但体验不佳。

2. **临时兼容层**（可选）：在 executeToolCall 中对旧工具名添加映射：
```typescript
const legacyToolMap: Record<string, string> = {
  list_chapters: 'list', list_character_card: 'list', list_world_setting: 'list',
  read_chapter_content: 'read', read_character_card: 'read', read_world_setting: 'read', read_outline: 'read',
  search_workspace: 'search', search_vectorDB: 'search',
}
```
旧工具名调用时返回提示："工具已更名为 {newName}，请使用新工具名"。

3. **system prompt 自动更新**：toolUsageGuide / toolUsageGuideReadonly 在每次对话时动态生成，不受历史影响。AI 会根据最新的 system prompt 使用新工具名。

## 工作流示例

### Before（18 个工具）
```
想看角色 → read_character_card
想看世界观 → read_world_setting
想看大纲 → read_outline
想看章节 → read_chapter_content
搜索关键词 → search_workspace
语义搜索 → search_vectorDB
```

### After（12 个工具）
```
想列任何东西 → list(type=...)
想看任何东西 → read(type=...)
想搜任何东西 → search(keyword=... 或 semantic=...)
search 结果 → read(type=knowledge, position=命中位置) 精准跳转
```
