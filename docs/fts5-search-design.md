# FTS5 全文搜索方案设计

## 一、背景与动机

### 现状问题

当前关键词搜索（[search.ts](../electron/ipc/search.ts)）采用 JS 内存逐字段 `String.includes()` 匹配，存在以下问题：

1. **全表扫描**：每次搜索 `SELECT *` 拉全表到 JS 层逐字段匹配，知识库 >500 条直接报错拒绝搜索
2. **排序粗糙**：仅按 `keyword_hits`（命中关键词数）排序，无法区分关键词出现在标题和出现在备注角落的重要性差异
3. **无中文分词**：`split(/\s+/)` 按空格切词，对中文完全不友好
4. **snippet 提取简陋**：只取第一个匹配关键词的前后 N 字符，多关键词时可能丢失上下文

### 方案选择

| 方案 | 优势 | 劣势 |
|------|------|------|
| 现状（JS 内存匹配） | 简单 | 性能差、排序差、无分词 |
| **FTS5 + BM25** | 零配置、高性能、科学排序、内置 snippet/highlight | 中文分词需额外处理 |
| 向量搜索 | 语义理解 | 需要 API Key、仅覆盖知识库 |

**结论**：FTS5 + BM25 作为默认搜索引擎，与向量搜索互补。用户有 API 走语义搜索，没有 API 走 FTS5，体验降级但不缺失。

---

## 二、FTS 索引表设计

### 表结构

```sql
CREATE VIRTUAL TABLE search_index USING fts5(
  content,       -- 可搜索的纯文本（HTML 已剥离）
  type,          -- 'character' | 'world' | 'outline' | 'chapter_outline' | 'chapter_content' | 'knowledge'
  entity_id,     -- 原表 ID
  name,          -- 实体名称
  project_id,    -- 项目 ID（知识库的 reference 类型为空字符串）
  chunk_idx,     -- 切片序号（不切片的实体固定为 0）
  tokenize='unicode61'
);
```

### 切片策略

| type | 切片方式 | chunk_idx | 典型行数/实体 | 理由 |
|------|----------|-----------|---------------|------|
| `character` | 不切片，所有可搜索字段拼接为纯文本 | 0 | 1 | 几百~几千字，BM25 精度足够 |
| `world` | 不切片，所有可搜索字段拼接为纯文本 | 0 | 1 | 同上 |
| `chapter_outline` | 不切片 | 0 | 1/章 | ~150 字，无需切片 |
| `outline` | 按段落切片（`\n\n` 分段） | 0, 1, 2... | N | 全书大纲无字数限制，按卷/章分段 |
| `chapter_content` | 按段落切片（`\n\n` 分段） | 0, 1, 2... | 1~4/章 | 章节正文一般 2000~4000 字 |
| `knowledge` | 按段落切片（复用现有 `chunkText` 逻辑） | 0, 1, 2... | N/条 | 知识库条目可能很长 |

### 各实体 content 字段拼接规则

**character**：

```
名称：{name}
别名：{alias}
描述：{description}
定位：{role}
性别：{gender}
年龄：{age}
性格：{traits 数组 parse 后用顿号连接，如"沉稳、果断"}
外貌：{appearance}
背景：{background}
关系：{relationships}
备注：{notes}
```

注意：`traits` 和 `tags` 在数据库中存储为 JSON 数组字符串（如 `["沉稳","果断"]`），拼接时需 parse 后用顿号连接，否则方括号和引号会干扰 FTS 分词。

**world**：

```
名称：{name}
类型：{card_type}
描述：{description}
备注：{notes}
标签：{tags 数组 parse 后用顿号连接}
```

**chapter_outline**：

```
{chapter_outline}
```

**outline**：按 `\n\n` 分段，每段一行记录。

**chapter_content**：正文剥离 HTML 标签后按段落切片。一般 2000~4000 字，通常 1~4 个切片。

**knowledge**：content 剥离 HTML 标签后按段落切片。

---

## 三、搜索查询

### SQL 查询

```sql
SELECT
  type,
  entity_id,
  name,
  chunk_idx,
  snippet(search_index, 0, '>>>', '<<<', '...', 30) AS snippet,
  bm25(search_index) AS score
FROM search_index
WHERE search_index MATCH ?
  AND (project_id = ? OR project_id = '')
ORDER BY bm25(search_index)
LIMIT ?;
```

- `MATCH ?`：查询表达式，由关键词构造
- `bm25()`：越小越相关
- `snippet()`：自动提取匹配片段，`>>>` `<<<` 标记高亮位置（用于调试，返回给 AI 时用切片全文替代）
- `project_id` 过滤：项目级实体精确匹配，知识库条目通过应用层过滤

### 知识库搜索的过滤逻辑

知识库条目统一存储在 `knowledge_items` 表中，通过 `project_knowledge` 表关联项目（`enabled` 字段控制可见性）。所有条目都需要手动勾选才会关联到项目，不再区分 `item_type`。

过滤逻辑：

1. 从 `project_knowledge` 表获取当前项目 `enabled = 1` 的 knowledge_item_id 列表
2. FTS 结果中 `type = 'knowledge'` 的行，只保留 `entity_id IN (启用 ID)` 的结果
3. 其他类型（character/world/...）按 `project_id` 过滤

FTS 索引中知识库行的 `project_id` 统一存为空字符串，因为知识库条目不属于单一项目。

### 关键词构造

AI 调用 `search(keyword="魔法学院 战斗", scope=[...])` → 将 keyword 按空格拆分后构造 MATCH 表达式：

```
"魔法学院" OR "战斗"
```

用引号包裹保证短语匹配，OR 连接多个关键词。

### scope 过滤

scope 在应用层过滤，不进入 FTS 查询（FTS5 不支持 WHERE 条件内过滤 type 列的索引优化）：

```typescript
const scopeTypeMap: Record<string, string[]> = {
  settings: ['character', 'world'],
  outlines: ['outline', 'chapter_outline'],
  knowledge: ['knowledge'],
  content: ['chapter_content'],
}
```

从 FTS 结果中按 type 过滤即可。注意 `outlines` scope 包含 `style_guidance`，与现有行为一致。

---

## 四、返回给 AI 的格式

### 核心原则

- **短实体（角色、世界观、章节大纲）搜索即读取**：直接返回全文，省一次 read 调用
- **长实体（大纲、章节正文、知识库）返回切片全文**：切片本身已经是按段落切分的小单元（通常 100~1000 字），直接返回整切片，不再用 FTS5 snippet 截断。AI 拿到完整切片后判断更准确，需要更多上下文时再 read

### 格式规范

```
搜索"魔法学院"（共 6 条结果，BM25 排序）：

[1] 角色·张三  score: -1.82
    名称：张三
    别名：学院之星
    描述：魔法学院最优秀的毕业生，擅长火系魔法
    定位：主角
    性格：沉稳、果断
    外貌：黑发碧眼，常穿深蓝色长袍
    背景：自幼被魔法学院收养...
    关系：与李四是同窗挚友

[2] 世界观·魔法体系  score: -2.15
    名称：魔法体系
    类型：力量体系
    描述：基于元素之力的魔法系统，分为火、水、风、土四大派系...
    备注：高级法师可获得学院认证...

[3] 章节大纲·第5章·暗夜追击  score: -2.34
    张三在魔法学院遭遇袭击，被迫使用禁忌魔法逃脱

[4] 大纲·全书大纲（第2卷片段）  score: -2.51
    第二卷：魔法学院篇。核心主题：成长与背叛。张三进入魔法学院后，
    逐渐发现学院背后隐藏的秘密，同时与李四的关系也面临考验。
    → start=1200, end=2000

[5] 章节·第5章·暗夜追击  score: -3.01
    他在魔法学院的走廊上奔跑，身后传来急促的脚步声。转角处，
    一道黑影突然闪出，张三来不及躲闪，被一掌击中肩膀。
    → start=3200, end=4000

[6] 知识库·元素魔法详解  score: -3.45
    魔法学院的火系课程分为初级引燃、中级火球术和高级炎爆术三个阶段。
    每个阶段需要通过相应的考核才能晋升。
    → start=580, end=1024
```

### 各类型返回规则

| type | 返回内容 | read 提示 |
|------|----------|-----------|
| `character` | 全文 | 无 |
| `world` | 全文 | 无 |
| `chapter_outline` | 全文 | 无 |
| `outline` | 切片全文 | `→ start=N, end=M` |
| `chapter_content` | 切片全文 | `→ start=N, end=M` |
| `knowledge` | 切片全文 | `→ start=N, end=M` |

### 行为变更说明

现有搜索对角色/世界观按字段返回多条结果（一个角色 name 和 description 都命中会返回两条），FTS5 方案改为一个角色一行全文。这是有意的行为变更，简化了结果结构。

### start/end 的含义

搜索结果返回的 `start` 和 `end` 是**该切片在原文中的字符范围**（从 0 开始，左闭右开）。

例如章节正文共 5000 字，按段落切成 3 片：

```
切片 0: 原文第 0~1800 字     → start=0, end=1800
切片 1: 原文第 1800~3200 字  → start=1800, end=3200
切片 2: 原文第 3200~5000 字  → start=3200, end=5000
```

搜索命中切片 1 时返回 `start=1800, end=3200`，AI 已看到该切片全文。需要上下文时：

- 想看切片前：`read(chapter_index=5, start=800, end=1800)`
- 想看切片后：`read(chapter_index=5, start=3200, end=4200)`
- 想看前后：`read(chapter_index=5, start=800, end=4200)`

AI 完全掌控读取范围，零歧义零浪费。

### IPC 层数据结构

```typescript
interface FTSResult {
  type: 'character' | 'world' | 'outline' | 'chapter_outline' | 'chapter_content' | 'knowledge'
  entity_id: string
  name: string
  chunk_idx: number
  chunk_text: string          // 切片全文（短实体为完整内容）
  score: number
  start: number               // 切片在原文中的起始字符位置
  end: number                 // 切片在原文中的结束字符位置（左闭右开）
  full_content?: string       // 短实体的全文（character/world/chapter_outline）
  chapter_index?: number      // type=chapter_content/chapter_outline 时的章节序号（由 sort_order + 1 推算）
}
```

注意：`chapters` 表没有 `chapter_index` 列，只有 `sort_order`。章节序号 = `sort_order + 1`，在构建 FTS 索引时计算并存储。

---

## 五、search → read 交互链路

### read 工具参数增强

现有 `read(type=chapter_content)` 返回整章正文，无法定位到具体位置。将 `position` + `offset` 改为 `start` + `end`：

```typescript
// 现有
read(type=knowledge, name, position?, offset?)
// position: 锚点位置，offset: 前后各取多少字符（默认 1000）

// 改为
read(type=chapter_content, chapter_index, start?, end?)
read(type=outline, start?, end?)
read(type=knowledge, name, start?, end?)
// start: 起始字符位置（默认 0）
// end: 结束字符位置（默认全文末尾）
```

优势：
- AI 完全掌控读取范围，零歧义
- 搜索结果返回 `start=1800, end=3200`，AI 可自由调整范围获取上下文
- 无 offset 方向问题（向前？向后？前后？），start/end 直观明确

### 交互流程

```
用户：帮我查一下关于魔法学院的设定

AI 调用 search(keyword="魔法学院", scope=["settings", "outlines", "knowledge"])
   ↓
返回 [1]~[6] 结果（见上方格式）
   ↓
AI 判断：[1][2] 已有全文，直接使用
         [5] 需要更多上下文
   ↓
AI 调用 read(type=chapter_content, chapter_index=5, start=800, end=4200)
   ↓
返回：第 5 章：暗夜追击（共 5000 字，显示 800-4200）
     ...他在魔法学院的走廊上奔跑...
   ↓
AI 综合信息回答用户
```

---

## 六、索引维护

### 核心原则

FTS 索引是派生数据，永远可以从原表重建。不进入备份/导出。

### 增量同步

在每次原表 CRUD 操作后同步更新 FTS 索引：

| 写入点 | FTS 同步操作 |
|--------|-------------|
| chapter.save（创建/更新正文） | `DELETE FROM search_index WHERE type IN ('chapter_content', 'chapter_outline') AND entity_id=?` + 重新插入切片 |
| chapter.updateMeta（更新大纲/标题） | `DELETE FROM search_index WHERE type='chapter_outline' AND entity_id=?` + 重新插入 |
| chapter 删除 | `DELETE FROM search_index WHERE type IN ('chapter_content', 'chapter_outline') AND entity_id=?` |
| character 创建/更新 | `DELETE + INSERT`（单行，无切片） |
| character 删除 | `DELETE` |
| world 创建/更新 | `DELETE + INSERT`（单行，无切片） |
| world 删除 | `DELETE` |
| knowledge 创建/更新 | `DELETE + INSERT`（段落切片） |
| knowledge 删除 | `DELETE` |
| project.outline 更新 | `DELETE FROM search_index WHERE type='outline' AND entity_id=?` + 重新插入切片 |

注意：chapter 的正文和大纲是分开索引的（type 分别为 `chapter_content` 和 `chapter_outline`），`chapter.save` 更新正文时需同步两者，`chapter.updateMeta` 只更新大纲。

### 批量重建

导入和版本恢复涉及批量操作，在事务结束后按项目级全量重建：

```typescript
function rebuildProjectFTSIndex(db: any, projectId: string) {
  db.run("DELETE FROM search_index WHERE project_id = ?", [projectId])
  rebuildFromChapters(db, projectId)
  rebuildFromCharacters(db, projectId)
  rebuildFromWorlds(db, projectId)
  rebuildFromOutline(db, projectId)
  // 知识库不按项目重建，因为它是全局的
}
```

注意：知识库是全局资源，不属于单一项目，不参与项目级重建。版本恢复也不涉及知识库数据。

### 触发点

| 场景 | 操作 |
|------|------|
| `db:project:import` | 导入完成后 `rebuildProjectFTSIndex(db, newProjectId)` |
| `db:version:restore` | 恢复完成后 `rebuildProjectFTSIndex(db, projectId)` |
| `db:project:delete` | `DELETE FROM search_index WHERE project_id = ?` |
| 首次启动（FTS 表不存在） | 建表 + 全量重建 |

---

## 七、对现有功能的影响

### 导出/备份

**零影响**。导出只读原表，FTS 索引不进入备份 JSON。

### 导入

需补一步：导入完成后重建 FTS 索引。

### 版本恢复

需补一步：恢复完成后重建 FTS 索引。

### 向量搜索

**无影响**。FTS5 和向量搜索独立运行，search 工具中 `keyword` 走 FTS5，`semantic` 走向量搜索，可同时使用。

---

## 八、中文分词

### 当前方案

使用 FTS5 内置 `unicode61` tokenizer。对中文按单字分词（"魔法学院" → "魔""法""学""院"），配合短语查询 `"魔法学院"` 可实现精确匹配。

### 后续优化方向

1. **JS 侧预分词**：写入 FTS 表前用 JS 分词（如按 2-gram），以空格拼接存入。搜索时同样分词后构造 MATCH 表达式
2. **自定义 tokenizer**：sql.js 支持加载 WASM 模块，可集成 jieba 分词器
3. **simple tokenizer**：按字分词 + 支持前缀匹配，对中文场景够用

---

## 九、实施步骤

1. 验证 sql.js 是否支持 FTS5（建表测试）
2. 创建 `search_index` FTS 表，编写建表 + 全量重建逻辑
3. 重写 `registerSearchHandlers()`，用 FTS5 SQL 替换 JS 内存匹配
4. 在各 CRUD 操作中添加 FTS 索引同步
5. 增强 `read` 工具，将 `position` + `offset` 改为 `start` + `end`，`chapter_content` 和 `outline` 类型支持范围读取
6. 更新 `tools.ts` 中 search handler 的返回格式
7. 在导入/版本恢复中添加 FTS 重建
8. 清理 `item_type` 相关代码：删除 search.ts 中 reference 加载逻辑，删除 knowledge.ts 中 `item_type` 参数（create/update/importFiles），删除 `listByType` handler，删除 db.ts 中 `item_type` 列和 migration。数据库列保留（SQLite 不支持 DROP COLUMN），只是不再使用
9. 测试：搜索准确性、索引同步正确性、导入/恢复后搜索可用性
