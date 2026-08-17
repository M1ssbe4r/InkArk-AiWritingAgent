# 全书大纲按卷维护 — 详细设计

> **状态**：设计稿，待评审后实施  
> **日期**：2026-07-01  
> **相关文档**：[fts5-search-design.md](./fts5-search-design.md)、[architecture.md](./architecture.md)、[tools.md](./tools.md)

---

## 一、背景与动机

### 现状

全书大纲存储在 `projects.outline` 单个 HTML 字段中，UI 用一个 TipTap 编辑器展示/编辑整篇文档。章节层已有独立字段 `chapters.chapter_outline`。

```
projects.outline          ← 全书 HTML 单文档（含卷、写作进度等）
chapters.chapter_outline  ← 单章大纲
chapters.content          ← 正文
```

AI 工具侧：

| 工具 | 行为 | 长篇问题 |
|------|------|----------|
| `read(type=outline)` | 返回全书大纲全文 | 上下文爆炸 |
| `write_outline` | 整篇替换（diff 审阅） | 误伤其他卷、diff 难读 |
| `update_progress` | 正则匹配 `<h2>写作进度</h2>` 段落 append/replace | 脆弱、与卷结构耦合 |
| `list(type=chapter)` | 按章列表 | 缺卷级概览 |

工具描述里 `write_outline` **已要求 AI「以卷为单位」写 HTML**，但底层仍是一整块文本——**概念分卷、存储不分卷**。

### 目标

1. **结构化存储**：每卷独立记录，含卷名、剧情概要、章节范围、完成状态。
2. **AI 友好**：按卷 list / read / write，避免每次操作全书 HTML。
3. **UI 友好**：大纲页按卷折叠/展开，长篇可导航。
4. **数据安全**：迁移可逆、版本快照/导入导出兼容、旧备份可导入。

### 非目标（v1 不做）

| 项 | 原因 |
|----|------|
| 卷内再分子篇/幕 | 粒度够用到卷即可，避免过度建模 |
| 拖拽卷排序的复杂动画 | 先支持上移/下移或 sort_order 编辑 |
| 卷与章节双向自动重分区 | v1 只做范围校验 + 警告，不自动改范围 |
| 废弃 `chapter_outline` | 章级大纲继续独立维护 |
| 服务端 schema 变更 | 仅桌面端 SQLite |
| **客户端降级**（装回旧版可执行文件继续用同一 `data/`） | 不在支持范围；只保证**新版应用内**版本历史可任意切换 |

---

## 二、概念模型

### 三层大纲体系（目标态）

```
全书梗概 (projects.synopsis)     — 可选，≤2000 字，全书一句话/卖点/主线
    │
    ├── 卷 1 (outline_volumes)   — 卷名、概要、第 1–30 章、状态
    ├── 卷 2                     — 第 31–60 章
    └── 卷 N
            │
            └── 章 (chapters.chapter_outline) — 单章要点
                    │
                    └── 正文 (chapters.content)
```

### 卷 (Volume) 字段语义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | TEXT | ✓ | 与现有 ID 生成规则一致 |
| `project_id` | TEXT | ✓ | 外键 |
| `sort_order` | INTEGER | ✓ | 0-based，卷顺序 |
| `title` | TEXT | ✓ | 卷名，如「第一卷：初入江湖」 |
| `summary` | TEXT | | 卷剧情概要，HTML，建议 ≤3000 字 |
| `chapter_start` | INTEGER | | 覆盖章节起始序号（**1-based，含**），可空 |
| `chapter_end` | INTEGER | | 覆盖章节结束序号（**1-based，含**），可空 |
| `status` | TEXT | ✓ | 见下文状态机 |
| `progress_notes` | TEXT | | 写作进度/备注，HTML 或纯文本 |
| `created_at` / `updated_at` | TEXT | | 与现有表一致 |

### 状态机

**存储状态** `status`（用户或 AI 可写）：

| 值 | 含义 | UI 展示 |
|----|------|---------|
| `planned` | 规划中，尚未动笔 | 灰 |
| `writing` | 写作中 | 蓝 |
| `done` | 已完成 | 绿 |
| `paused` | 暂停 | 黄 |

**推导状态** `derived_status`（只读，不存库）：

根据 `chapter_start`～`chapter_end` 范围内章节计算。**范围映射**：`[chapter_start, chapter_end]` 是 1-based 闭区间，对应 `chapters.sort_order ∈ [chapter_start-1, chapter_end-1]`（sort_order 是 0-based）。

```
若 chapter_start/end 任一为 NULL → derived = status（仅手动，跳过推导）
否则：
  范围内章节数 = 0 → derived = planned
  全部 word_count > 0 且 status 非 paused → derived = done
  部分有字 → derived = writing
  与 status 不一致时 UI 显示「手动: writing / 实际: 50%」提示
```

v1 **不自动覆盖** `status`，只在 UI 展示推导值供参考；Phase 2 可加「同步为实际进度」按钮。

### 短篇 / 无卷作品

- 新建项目：**默认创建 1 卷**，`title = '正文'`，`chapter_start/end` 空，随章节增多可再拆分。
- 不强制用户理解「卷」；单卷时 UI 可默认展开，体验接近现在。
- 单卷作品 `summary` 可留空，写作信息以 `chapter_outline` 为主；UI 对「单卷 + 空 summary」可隐藏卷头编辑区，直接展示 synopsis + 章节大纲，避免与 `chapter_outline` 职责重叠造成困惑。

---

## 三、数据库设计

### 新表

```sql
CREATE TABLE IF NOT EXISTS outline_volumes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  chapter_start INTEGER,          -- NULL = 未绑定
  chapter_end INTEGER,            -- NULL = 未绑定
  status TEXT NOT NULL DEFAULT 'planned',
  progress_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outline_volumes_project
  ON outline_volumes(project_id, sort_order);
```

### `projects` 表变更

```sql
-- 全书梗概（从原 outline 的 <h1> 前言部分迁移，或新建作品时为空）
ALTER TABLE projects ADD COLUMN synopsis TEXT NOT NULL DEFAULT '';
```

**`projects.outline` 保留策略（已拍板：存量用户优先，至少保留一个版本周期）**：

| 阶段 | 行为 |
|------|------|
| **迁移执行时** | 解析 `outline` → `synopsis` + `outline_volumes`；**`projects.outline` 原 HTML 保留不清空**，作为只读备份 |
| **迁移标记** | 项目级标记 `outline_migrated_at`（新列或 `consistency_checks` 按项目记录），表示 volumes 已是主数据源 |
| **运行时（本版）** | 读/写只走 `outline_volumes` + `synopsis`；**禁止**向 `outline` 写入新内容 |
| **回滚** | 若 volumes 数据异常，可从 `projects.outline` 重新跑解析（force migration） |
| **下一版本（v4 清理）** | 全量用户完成迁移且稳定后，`consistency` v4 将 `projects.outline` 置空；**再下一版本**才考虑 `ALTER` 删列 |
| **导出 v3** | 主数据 `volumes[]` + `synopsis`；**同时附带** `project.outline`（若仍有备份 HTML）供跨版本恢复 |
| **导入** | v1/v2 仍读 `outline` 并触发解析；v3 读 `volumes`，忽略 `outline` 除非 volumes 为空则 fallback 解析 |

> 结论：**列必须保留到迁移周期结束**，不能在本功能首版就删列或清空存量数据。

```sql
-- 可选：记录迁移完成时间，便于后续 v4 清理
ALTER TABLE projects ADD COLUMN outline_migrated_at TEXT;
```

### 约束与校验（应用层）

| 规则 | 处理 |
|------|------|
| `chapter_start > chapter_end` | **拒绝保存** |
| 范围超出当前章节数 | 允许（规划期），UI 显示「第 N 章尚未创建」 |
| 两卷范围重叠 | **硬拦截，拒绝保存**（见下） |
| 某章落在 0 卷 | 允许（未分区章节） |
| `summary` 长度 | ≤ 50_000 字符（与现 outline 上限同量级） |
| `synopsis` 长度 | ≤ 2_000 字符 |
| 每项目卷数 | ≤ 200 |

**章节范围重叠检测**（`validateVolumeRanges(volumes, editingId?)`）：

```
对同一 project_id 下所有卷，取 chapter_start/end 均非 NULL 的条目：
  区间 [start, end] 闭区间
  若任两区间 max(s1,s2) <= min(e1,e2) → 重叠 → 返回错误：
  「第 X 卷（A–B 章）与第 Y 卷（C–D 章）章节范围重叠」

保存/更新卷（save / updateMeta 改 chapter_start/end 时）→ 整单拒绝，DB 不变。
AI write_volume / create_volume 在 IPC 层同样校验；工具返回可读错误供模型重试。
仅 start 或仅 end 一方为 NULL 的卷不参与重叠计算。
```

> **注意**：`reorder` 只改 `sort_order`，不改 `chapter_start/end`，**不会产生新的范围重叠**，因此 reorder 不触发范围校验。范围校验只在可能改 start/end 的入口（save / updateMeta / write_volume / create_volume）跑。

---

## 四、数据迁移

### 迁移入口

在 `electron/ipc/consistency.ts` 新增 **v3：`outline_to_volumes`**。check 内部**遍历所有项目，按项目粒度跳过**：

对每个 project：
1. 若该项目 `outline_migrated_at` 非空 **且** `outline_volumes` 已有行 → 跳过（即使 `forceVersion=3` 也跳过，避免覆盖用户手动改过的卷）。
2. 读 `projects.outline` + `projects.synopsis`。
3. 解析 HTML → 卷列表（算法见下）。
4. 写入 `outline_volumes`；提取全书级内容到 `synopsis`。
5. 设置 `outline_migrated_at`；**保留** `projects.outline` 原 HTML 不修改（存量备份）。

**事务边界（重要）**：步骤 1–5 在**单个 `db.transaction()` 内**完成（纯 SQL，不碰 FTS）；步骤 6 在 transaction **之外**单独执行。`fts.ts` 的 `sync*ToFTS` 各自内部又开 `db.transaction()`，sql.js 的 transaction 是裸 `BEGIN/COMMIT`，嵌套行为依赖 fts5-sql-bundle 封装不可靠，必须避免。

6. 重建该项目 FTS 索引（`rebuildProjectFTSIndex(db, projectId)`，自带 transaction，在迁移 transaction 之外调用）。

**幂等**：`consistency_checks` 表记录 v3 已执行（全局标记，表示 check 跑过一轮）；**单项目跳过**靠 `outline_migrated_at` + volumes 行数判断。强制重迁单个项目应走单独的 `db:volume:forceRemigrate(projectId)` IPC（不在 consistency 跑），执行前对该项目 volumes 做一次自动 commit 留快照，不直接复用 `forceVersion`。

### HTML → 卷 解析算法

```
输入: projects.outline (HTML)

1. 剥离「写作进度」块：
   匹配 /<h[1-3]>写作进度<\/h[1-3]>[\s\S]*?(?=<h[1-2]>|$)/i
   → 最后卷的 progress_notes，或单独「进度」伪卷（见下）

2. 按 <h2> 切分卷：
   正则拆分，保留卷标题与后续 <p>/<ul> 直到下一 <h2>
   标题示例：「第一卷：xxx」「第二卷 xxx」「卷三·xxx」

3. 每个块 → outline_volumes 一行：
   title = h2 文本
   summary = 块内剩余 HTML
   chapter_start/end = 尝试从正文解析「第X-Y章」模式（可选，失败则 NULL）

4. 若无任何 <h2>：
   - 若 outline 非空 → 单卷 title='正文', summary=全文
   - 若 outline 空 → 单卷 title='正文', summary=''

5. <h1> 及 <hr> 之前内容 → projects.synopsis

6. 写作进度块：
   - 优先写入最后一卷的 progress_notes
   - 若无法归属任何卷 → 创建 sort_order 最大的虚拟进度（不单独建表，合并到最后卷）
```

解析失败时：**整篇放入单卷「正文」**，记录 `logger.warn`，不阻断启动。

### 默认卷创建

| 场景 | 行为 |
|------|------|
| `project.create` | 插入 1 条默认卷 |
| `project.import` v1/v2 无 volumes | 走 HTML 解析 |
| `project.import` v3 有 volumes | 直接插入 |

---

## 五、IPC 与 Preload 契约

### 新通道

| Channel | 说明 |
|---------|------|
| `db:volume:list` | `(projectId) => OutlineVolume[]` |
| `db:volume:save` | `(volume) => volume` upsert |
| `db:volume:delete` | `(id) => void` |
| `db:volume:reorder` | `({ projectId, orderedIds: string[] }) => void` |
| `db:volume:updateMeta` | 部分字段更新（title, chapter_start, chapter_end, status, progress_notes） |

`summary` 大字段走 `save`；meta 走 `updateMeta`（与 chapter 模式一致）。

### `db:project:*` 变更

| 接口 | 变更 |
|------|------|
| `create` | 创建默认卷；`synopsis` 默认空 |
| `update` | 接受 `synopsis`；**不再接受 `outline`**（或接受但打 deprecated 日志并忽略） |
| `list` / `get` | 返回 `synopsis`；`outline` 字段移除或恒为空 |
| `export` | 备份 `version: 3`，含 `volumes[]` |
| `import` | 支持 v1/v2/v3 |

### TypeScript 类型（`src/types/index.ts`）

```typescript
export type VolumeStatus = 'planned' | 'writing' | 'done' | 'paused'

export interface OutlineVolume {
  id: string
  project_id: string
  sort_order: number
  title: string
  summary: string
  chapter_start: number | null
  chapter_end: number | null
  status: VolumeStatus
  progress_notes: string
  created_at?: string
  updated_at?: string
}

export interface Project {
  // ...
  synopsis?: string
  outline?: string  // @deprecated 迁移后不再使用
}
```

### Preload / `vite-env.d.ts`

在 `window.electronAPI` 增加 `volume: { list, save, delete, reorder, updateMeta }`。

---

## 六、AI 工具体系

### 工具变更总览

| 现有 | 目标 | 说明 |
|------|------|------|
| `list` types | 增加 `volume` | 保留 chapter/character/world |
| `read` types | 增加 `volume`；改 `outline` 语义 | `outline` 返回梗概+卷目录（非全文） |
| `write_outline` | **删除** | 由 `write_volume` 替代，**不提供兼容别名** |
| `update_progress` | **删除** | 进度写入并入 `write_volume.progress_notes`，**不单独设工具** |
| `create_volume` | **新增** | AI / 流程侧新建空卷（Phase 2 必做） |
| `delete_volume` | **不做** | 删除能力后续统一设计通用 `delete` 工具 |
| `search` scope `outlines` | 索引 `outline_volume` + `chapter_outline` + `synopsis` | FTS type 扩展 |

> **已拍板**：旧工具从 `toolDefinitions` 移除；`AIPanel` 删除 `_edit_outline` 分支；`e2e/ai-helpers.ts` 删除 mock。存量对话若模型仍输出旧工具名，执行层返回「工具已废弃，请使用 write_volume / create_volume」。

### `create_volume`（Phase 2 必做）

新建一卷占位，**不写 summary**，供后续 `write_volume` 填内容。

```json
{
  "title": "第四卷：京城风云",
  "chapter_start": 91,
  "chapter_end": 120,
  "status": "planned"
}
```

| 项 | 说明 |
|----|------|
| 必填 | `title` |
| 可选 | `chapter_start` / `chapter_end` / `status`（默认 `planned`） |
| 不接受 | `summary` —— schema 内不放该 property；若模型传入，handler 忽略并返回 warning「请用 write_volume 写 summary」 |
| 行为 | 插入 `outline_volumes`，`sort_order` 追加到末尾；**立即落库，不走 diff 审阅** |
| 返回 | `已创建第 N 卷：{title}`（N 为 volume_index） |
| 校验 | 章节范围重叠硬拦截；与 `write_volume` 共用 `validateVolumeRanges` |

UI「添加卷」与 `create_volume` 共用 `db:volume:save` IPC，只是 AI 工具多一层参数校验与文案。

### `write_volume`（含原 `update_progress` 能力）

```json
{
  "volume_index": 2,
  "title": "第二卷：京城风云",
  "summary": "<p>…HTML…</p>",
  "progress_notes": "<p>已完成第 31–45 章，第 46 章进行中</p>",
  "chapter_start": 31,
  "chapter_end": 60,
  "status": "writing",
  "reason": "根据用户要求扩写第二卷"
}
```

**字段语义**：至少传一个可写字段（`summary` / `progress_notes` / `title` / `chapter_start` / `chapter_end` / `status`）。`volume_index` 的必填性按场景分级：

| 场景 | `volume_index` | 说明 |
|------|----------------|------|
| 改 `summary` / `chapter_start` / `chapter_end` / `status` / `title` | **必填** | 缺失返回错误「该字段需要明确 volume_index」——diff 审阅与范围改写都需要确定的 target 卷，禁止默认卷兜底（否则可能误改当前章所在卷） |
| 仅改 `progress_notes` | 可选 | 走默认卷解析 |

| 变更类型 | 行为 |
|----------|------|
| 含 `summary` 且与现值不同 | 返回 `{ _edit_volume: true, … }`，**走 diff 审阅**（只 diff summary） |
| 仅 `progress_notes` / `status` / `title` / 章节范围 | **立即落库**，不走 diff（对应原 `update_progress`） |
| 同次调用既改 `summary` 又改 `progress_notes` | diff 审阅 summary；用户确认后**一并写入** progress 等其它字段 |
| `volume_index` 越界 | 拒绝，提示先 `create_volume` |

**默认卷 fallback 链**（仅「仅改 `progress_notes` 且未传 `volume_index`」场景）：

```
1. 当前章 sort_order 落在某卷 [chapter_start, chapter_end] 范围 → 该卷
2. 当前章不在任何卷范围 → sort_order 最大的卷（最后一卷）
3. 项目无卷 → 报错「请先 create_volume」
```

（仅在此工具内解析默认卷，不增加单独工具。）

章节范围重叠 / `start > end` 在落库前硬拦截。

### `list(type=volume)`

```
返回示例：
共 3 卷：
[1] 第一卷：初入江湖（第 1–30 章）— 写作中
    概要前 80 字…
[2] 第二卷：…
[3] 第三卷：…（未绑定章节）
```

默认不传 `volume_indices` 时返回**全部卷摘要**（卷数量少，全返回；与 `list(type=chapter)` 不传 indices 返回「当前章附近」的语义不同，tool description 需注明）；传 `[2]` 只展开第 2 卷详情头。

### `read(type=volume, volume_index=N)`

返回单卷完整 `summary` + `progress_notes` + 章节范围 + status。

### `read(type=outline)`（新语义）

```
全书梗概：（synopsis 纯文本）

卷目录：
[1] 第一卷：…（第1-30章）planned
[2] …

如需某卷详情请 read(type=volume, volume_index=N)
```

**不再返回所有卷 summary 全文**，避免重蹈覆辙。

### System prompt / `tools.ts` 内置说明

更新 `buildToolUsageHint()`：

- 长篇先 `list(volume)` 定位，再 `read(volume)` 读单卷。
- 新增卷用 `create_volume`；写概要 / 同步进度 / 改范围 / 改状态均用 `write_volume`（进度传 `progress_notes`，无需单独工具）。
- 单卷作品（`list(volume)` 返回 1 卷）可直接 `write_volume(volume_index=1)`，无需先 list 定位。
- `write_volume` 只操作单卷；跨卷改写应多次 `create_volume` / `write_volume`，不要尝试批量。

### Change queue（`editorRef.pushChange`）

新类型 `volume_summary` / `volume_meta`，供 AI 上下文增量同步。

---

## 七、渲染端与 UI

### 状态管理（`editorStore`）

```typescript
interface VolumeEdit {
  volumeId: string
  original: string      // summary HTML
  modified: string
  summary: string       // AI 修改说明
}

// 替换 pendingOutlineEdit → pendingVolumeEdit
pendingVolumeEdit: VolumeEdit | null
activeVolumeId: string | null   // 大纲页当前展开的卷
volumes: OutlineVolume[]        // 或独立 volumeStore，与 chapters 并列
```

项目切换时 `loadVolumes(projectId)`，与 `loadChapters` 并行。

### 大纲页重构（替换 `Editor.tsx` 中 `editorView === 'outline'` 分支）

**布局线框：**

```
┌─────────────────────────────────────────────────────────┐
│ [工具栏] 加粗/斜体…          [生成大纲] [添加卷]         │
├─────────────────────────────────────────────────────────┤
│ 全书梗概 (可折叠 textarea / 迷你 TipTap，≤2000字)        │
├─────────────────────────────────────────────────────────┤
│ ▼ 第一卷：初入江湖   第1-30章  [写作中]  [⋮]            │
│   ┌─────────────────────────────────────────────────┐   │
│   │ TipTap 编辑 summary                              │   │
│   │ 进度备注 (progress_notes) 小区域                  │   │
│   │ 章节范围: [1] - [30]  [自动建议]                │   │
│   └─────────────────────────────────────────────────┘   │
│ ▶ 第二卷：…                                              │
│ ▶ 第三卷：…                                              │
└─────────────────────────────────────────────────────────┘
```

**交互：**

| 操作 | 行为 |
|------|------|
| 点击卷头 | 折叠/展开；展开时 `activeVolumeId` 更新 |
| 卷内编辑 summary | debounce `volume.save`（复用 outline 300ms/1000ms 策略） |
| AI diff 审阅 | 只 diff **当前卷** summary，接受后 `volume.save` |
| 「生成大纲」 | 打开 `BookIdeaDialog`，prompt 改为要求 AI 用 `write_volume` 分批 |
| 侧边栏「全书大纲」 | 不变，仍 `setEditorView('outline')` |

### 侧边栏联动（Phase 2，设计预留）

- 章节列表按卷分组显示（卷头 divider）。
- 点击卷 → 大纲页展开对应卷。
- 当前章高亮所属卷。

### 组件拆分建议

```
src/components/outline/
  BookIdeaDialog.tsx      — 改 prompt
  VolumeOutlineView.tsx   — 新，大纲页主容器
  VolumeAccordionItem.tsx — 单卷折叠项
  SynopsisEditor.tsx      — 全书梗概
```

`Editor.tsx` 大纲分支委托给 `VolumeOutlineView`。

---

## 八、全文搜索（FTS）

### 索引 type 扩展

| type | entity_id | name 字段 | content |
|------|-----------|-----------|---------|
| `synopsis` | project.id | 书名 | synopsis 纯文本 |
| `outline_volume` | volume.id | volume.title | summary + progress_notes 拼接 |
| `chapter_outline` | 不变 | 章标题 | 不变 |

**废弃** `outline` type（迁移时删除旧索引行）。

### `electron/ipc/fts.ts`

- `syncVolumeToFTS(db, volume)`（复用 `splitChunks` 对长 summary 切片，与现网 `syncOutlineToFTS` 同模式；卷 summary ≤ 50_000 字符，chunk_idx 可能 > 0）
- `syncSynopsisToFTS(db, project)`（synopsis ≤ 2_000 字符，单 chunk）
- `rebuildProjectFTSIndex` 增加 volumes + synopsis 遍历
- `deleteEntityFromFTS` 支持 `outline_volume`

### `search` scope `outlines`

```typescript
outlines: ['synopsis', 'outline_volume', 'chapter_outline']
```

`search.ts` 改动：

- `scopeTypeMap.outlines` 由 `['outline', 'chapter_outline']` 改为 `['synopsis', 'outline_volume', 'chapter_outline']`。
- `getOriginalContent` **新增** `outline_volume` / `synopsis` 分支；**保留**旧 `outline` 分支到 v4 置空 outline 列为止（过渡期 rebuild 前的旧索引行仍可能命中 `outline` type）。
- `summary.outline` 统计字段由 `r.type === 'outline' || r.type === 'chapter_outline'` 改为 `r.type === 'synopsis' || r.type === 'outline_volume' || r.type === 'chapter_outline'`（前端 UI 若依赖该数量需同步适配）。

---

## 九、版本快照（version control）

### Manifest 变更

```json
{
  "project_title": "<hash>",
  "synopsis": "<hash>",
  "outline": "<hash>",                       // 见下：迁移后仍继续写
  "volume:<volumeId>": "{\"h\":\"<hash>\",\"n\":\"第一卷：…\",\"s\":0}",
  "chapter:<chapterId>": "…",
  ...
}
```

> manifest 中 `volume:*` 值的 `s` 字段 = 该卷 `sort_order`，与 `chapter:*` 的 `{h, n, s}` 格式一致。

**`outline` hash 保留规则（重要）**：迁移后的新 commit**必须继续写 `outline` hash**，指向当前 `projects.outline` 列内容的快照（即使内容不再变化）。原因：现网 `version.ts` restore 逻辑在 `manifest['outline']` 缺失时会**清空 `outline` 列**，会破坏「保留 outline 列作只读备份」的策略。`outline` hash 一直写到 v4 置空 outline 列为止。

每卷 blob：

```json
{
  "id": "...",
  "project_id": "...",
  "sort_order": 0,
  "title": "...",
  "summary": "...",
  "chapter_start": 1,
  "chapter_end": 30,
  "status": "writing",
  "progress_notes": "..."
}
```

### 回滚兼容（应用内版本历史）

> **范围**：本节只覆盖新版客户端内的 `db:version:restore`（用户在版本历史里切换到任意 commit）。**不**考虑装回旧版可执行文件；降级后的数据一致性不在支持范围。

restore 前先自动 commit 当前状态（现网行为不变）。大纲恢复按 manifest 形态分两支，**与 consistency 迁移独立**——restore 是用户显式操作，即使 `outline_migrated_at` 已设也要按目标 commit 重建 volumes，不受「已迁移则跳过」约束。

| 快照形态 | restore 行为 |
|----------|--------------|
| manifest **无** `volume:*`（迁移前 commit） | 1) 从 blob 写回 `projects.outline`；2) **清空**该项目现有 `outline_volumes`；3) 对 outline HTML 跑 `parseLegacyOutlineToVolumes` → 重建 `synopsis` + `outline_volumes` |
| manifest **有** `volume:*`（迁移后 commit） | 1) 按 blob 精确恢复各卷（manifest 外卷 DELETE，manifest 内卷 UPSERT）；2) 恢复 `synopsis`；3) **不写** `projects.outline` 列（保留库内备份 HTML 不动） |
| manifest 有 `volume:*` 但缺 `outline` hash | 走「有 volume:*」分支；warn；**禁止**按现网逻辑清空 `outline` 列 |
| manifest 有 `volume:*` **且** 有 `outline` hash | 走「有 volume:*」分支；`outline` hash **不用于 restore**（只作 commit 元数据 / 过渡期备份引用） |

**任意切换的预期**（用户在新版内前后跳转 commit）：

| 从 → 到 | 大纲结果 |
|---------|----------|
| 新 commit → 旧 commit（仅 outline） | 卷表按该时点 HTML **重解析**；该 commit 之后的卷级编辑**丢失**（与章节正文回滚语义一致） |
| 旧 commit → 新 commit（含 volume:*） | 卷表按 blob **精确恢复**到该时点 |
| 旧 commit A → 旧 commit B | 两次均走 outline 解析，以目标 commit 的 outline 为准 |
| 新 commit A → 新 commit B | 两次均走 volume blob 恢复 |

restore 事务结束后：`rebuildProjectFTSIndex(projectId)`（与现网一致）。

> 实现要点：`version.ts` restore 需识别 manifest 是否含 `volume:*` 键，分支处理；**废弃**现网「manifest 缺 `outline` 则 `UPDATE outline=''`」在「含 volume:*」场景下的行为。

`commitProjectState` 在 commit 前对 volumes 做与 chapters 相同的增删同步（manifest 内 volume id 保留，库里有但 manifest 没有的删除，manifest 里有但库没有的插入）。

---

## 十、导入导出与备份

### 备份格式 v3

```typescript
interface ImportBackup {
  version: 1 | 2 | 3
  exportedAt?: string
  project: {
    id: string
    title: string
    synopsis?: string
    outline?: string      // v1/v2 only; v3 可省略
    // ...
  }
  volumes?: OutlineVolume[]  // v3+
  chapters: [...]
  // ...
}
```

| 导入版本 | 处理 |
|----------|------|
| v1/v2 | `validateImportBackup` 不变；`runProjectImport` 末尾跑迁移解析 `outline` → volumes |
| v3 | 直接写 `outline_volumes` + `synopsis` |

`src/lib/backupValidator.ts` 增加 `volumes[]` 校验（可选数组，每项字段上限）。

### 导出

`db:project:export` 升 `version: 3`，附带 `volumes` 查询结果。

---

## 十一、受影响文件清单

### 必须改

| 路径 | 改动要点 |
|------|----------|
| `electron/ipc/db.ts` | 建表、`synopsis` 列 |
| `electron/ipc/consistency.ts` | v3 迁移 |
| `electron/main.ts` | volume IPC；project create/update/export |
| `electron/preload.ts` | volume API |
| `electron/ipc/fts.ts` | 新 type |
| `electron/ipc/search.ts` | resolve + scope + summary 统计 |
| `electron/ipc/version.ts` | manifest volumes + outline hash 保留 + restore 三档 |
| `electron/ipc/projectImport.ts` | v3 导入 |
| `src/types/index.ts` | 类型 |
| `src/vite-env.d.ts` | API 类型 |
| `src/stores/editorStore.ts` | volumes 状态、pendingVolumeEdit |
| `src/lib/tools.ts` | 工具定义与 handler |
| `src/lib/tools.test.ts` | 工具测试 |
| `src/components/editor/Editor.tsx` | 大纲分支抽出 |
| `src/components/outline/*` | 新 UI |
| `src/components/ai-panel/AIPanel.tsx` | `_edit_volume` 审阅流 |
| `src/components/outline/BookIdeaDialog.tsx` | prompt |
| `src/lib/backupValidator.ts` | v3 校验 |
| `vitest.config.ts` | coverage.include 扩到 `electron/ipc/**/*.ts`；确认 `test.include` 能扫到 `electron/ipc/__tests__/*.test.ts`（electron 端代码用相对路径而非 `@/`，测试 helper 同步） |
| `e2e/ai-helpers.ts` | mock 工具 |
| `e2e/*.spec.ts` | 大纲相关选择器 |

### 前置检查（开工前先做）

- 全仓搜索 `project.update` / `project.save` 调用点，确认除 `tools.ts` 的 `update_progress` handler 与 `AIPanel.tsx` 的 `replace_outline` 分支外，**无第三处向 `outline` 字段写入**（含导出/导入回写、TitleBar 保存逻辑）。删除这两个分支前先列清单。
- 确认 `fts5-sql-bundle` 内嵌的 SQLite 版本（影响 v4 DROP COLUMN 可行性，见第十二章 Phase 5）。

### 可能改

| 路径 | 改动要点 |
|------|----------|
| `src/components/layout/Sidebar.tsx` | Phase 2 卷分组 |
| `src/lib/context.ts` | location 显示「第 N 卷」 |
| `src/lib/editorRef.ts` | pushChange 类型 |
| `docs/tools.md` | 工具文档 |

### 不改

| 路径 | 原因 |
|------|------|
| `server/` | 桌面本地功能 |
| `chapters` 表结构 | 章级大纲独立 |

---

## 十二、实施阶段

### Phase 1 — 数据层 + 迁移（可独立验证）

- [ ] 建表 + `synopsis` 列
- [ ] consistency v3 迁移 + 单元测试（HTML 样例集）
- [ ] volume IPC CRUD
- [ ] project create 默认卷
- [ ] export/import v3
- [ ] FTS + search 适配

**验收**：旧库启动后 volumes 正确；FTS 能搜到卷内容；导出 v3 再导入一致。

### Phase 2 — AI 工具

- [ ] `create_volume`
- [ ] `list(volume)` / `read(volume)` / `read(outline)` 新语义
- [ ] `write_volume`（含 progress_notes 直写 + summary diff 审阅）
- [ ] **移除** `write_outline` / `update_progress` 及 `pendingOutlineEdit` / AIPanel 旧分支
- [ ] `tools.test.ts` + e2e ai mock 更新

**验收**：AI 只读单卷时不拉全文；改一卷 diff 审阅正常。

### Phase 3 — UI

- [ ] `VolumeOutlineView` 折叠列表
- [ ] synopsis 编辑
- [ ] 卷范围、状态编辑
- [ ] `BookIdeaDialog` prompt 更新
- [ ] 移除对 `projects.outline` 的 UI 写入

**验收**：手动编辑、AI 审阅、切换项目无丢数据。

### Phase 4 — 增强（可延后）

- [ ] 侧边栏按卷分组
- [ ] 当前章 → 自动展开所属卷

### Phase 5 — outline 列清理（独立版本，破坏性，单独评估）

> 与 Phase 4 解耦：删列是破坏性 schema 变更，回滚策略与 NSIS 升级路径与「侧边栏分组」这类增强完全不同，必须独立版本发布。

- [ ] v4：`consistency` 将 `projects.outline` 内容置空（列保留），同步清 `outline_migrated_at`
- [ ] 再下一版本：物理删除 `projects.outline` 列 + 清 `outline_migrated_at`

**sql.js DROP COLUMN 风险（开工前确认）**：`ALTER TABLE ... DROP COLUMN` 需 SQLite ≥ 3.35.0。`fts5-sql-bundle` 内嵌的 SQLite 版本未必支持。若不支持，走「新建 `projects_new` → 复制列 → `DROP TABLE projects` → `RENAME`」路径，并同步重建所有索引/外键（含 `idx_projects_style_custom_id`）。此风险直接影响 NSIS 升级路径，不可临到做才发现。

---

## 十三、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| HTML 迁移解析不准 | 卷界错乱 | 样例测试 + **保留 outline 原 HTML 可 force 重迁** |
| 版本快照含旧 `outline` | restore 到迁移前 commit 丢卷级编辑 | restore 双路径；UI 提示「恢复较早版本将按当时大纲重算卷结构」；测试 E5/E6 |
| restore 含 `volume:*` 但缺 `outline` hash | 误清空 outline 备份列 | 有 `volume:*` 时禁止写 outline 列；warn 即可 |
| restore 后 volumes 与 FTS 不一致 | 搜索命中旧索引 | restore 末尾 `rebuildProjectFTSIndex`（与章节 restore 同） |
| 模型仍调用已删工具 | 工具执行失败 | 明确错误文案；system prompt 只列新工具 |
| 卷范围与章节数脱节 | 显示「第 50 章」但未创建 | 允许 NULL/超范围，UI 灰色提示 |
| 卷范围重叠 | 数据不一致 | **保存硬拦截** + 单测 B13 |
| diff 审阅从全书变单卷 | AI 跨卷改写需多次工具 | 文档说明；`write_volume` 只操作单卷，跨卷改写多次 `create_volume` / `write_volume`；批量数组工具不在本版设计 |
| E2E 选择器过期 | CI 红 | Phase 3 同步改 `e2e/sidebar-navigation.spec.ts` 等 |
| 200 卷上限 | 超长篇网文 | 200 足够；极限用户可拆项目 |

---

## 十四、测试计划

> **原则**：每个改动点必须有对应测试；Phase 未通过门禁不得进入下一阶段。  
> **环境**：单元测试 Vitest（`node`）；E2E Playwright（真实 Electron，`INKARK_E2E_USER_DATA` 隔离）。  
> **命名**：`describe` 用模块名，`it` 用「条件 → 期望」。

### 14.1 改动 → 测试追溯矩阵

| 改动域 | 单元测试文件 | 集成测试 | E2E |
|--------|-------------|----------|-----|
| HTML 迁移解析 | `electron/ipc/__tests__/outlineMigration.test.ts` | `outlineMigration.integration.test.ts` | `e2e/volume-migration.spec.ts` |
| `outline_volumes` CRUD IPC | `electron/ipc/__tests__/volumeIpc.test.ts` | 同上 integration | `e2e/volume-outline.spec.ts` |
| `projects.synopsis` | `volumeIpc.test.ts` | integration | `volume-outline.spec.ts` |
| project create 默认卷 | `volumeIpc.test.ts` | integration | `app.spec.ts`（首次启动） |
| FTS `synopsis` / `outline_volume` | `electron/ipc/__tests__/volumeFts.test.ts` | `fts-integration.test.ts` 扩展 | `knowledge-search.spec.ts` 或新 spec |
| search scope `outlines` | `electron/ipc/__tests__/volumeSearch.test.ts` | — | — |
| version manifest `volume:*` | `electron/ipc/__tests__/volumeVersion.test.ts` | integration | `e2e/volume-version.spec.ts` |
| 旧 manifest 仅 `outline` 回滚 | `volumeVersion.test.ts` | integration | `volume-version.spec.ts` |
| 备份 v3 校验 | `src/lib/backupValidator.test.ts` | — | — |
| 导入 v1/v2/v3 | `electron/ipc/__tests__/volumeImport.test.ts` | integration | `project.spec.ts` |
| 导出 v3 round-trip | `volumeImport.test.ts` | integration | `project.spec.ts` |
| AI `list(volume)` | `src/lib/tools.test.ts` | — | `ai-tools.spec.ts` |
| AI `read(volume/outline)` | `tools.test.ts` | — | `ai-tools.spec.ts` |
| AI `write_volume` + diff | `tools.test.ts` | — | `ai-tools.spec.ts` |
| AI `create_volume` | `tools.test.ts` | — | `ai-tools.spec.ts` |
| **删除** `write_outline` / `update_progress` | `tools.test.ts` 断言工具列表不含旧名 | — | `ai-helpers.ts` 删 mock |
| `editorStore` volumes 状态 | `src/stores/editorStore.test.ts` | — | — |
| `pendingVolumeEdit` 审阅 | `src/lib/diffUtils.test.ts`（已有） | — | `ai-tools.spec.ts` |
| UI 卷折叠/编辑 | — | — | `e2e/volume-outline.spec.ts` |
| `BookIdeaDialog` | — | — | `volume-outline.spec.ts` |
| consistency v3 幂等 | `outlineMigration.test.ts` | integration | migration spec |

---

### 14.2 测试夹具（Fixtures）

新建目录 `electron/ipc/__tests__/fixtures/outline/`：

| 文件 | 用途 |
|------|------|
| `three-volumes-with-progress.html` | 标准三卷 + `<h2>写作进度</h2>` |
| `single-block-no-h2.html` | 无 h2，整篇单块 |
| `h1-only.html` | 仅书名/前言 |
| `empty.html` | 空字符串 |
| `malformed-unclosed.html` | 未闭合标签 |
| `chapter-range-in-text.html` | 正文含「第1-30章」供范围解析 |
| `expected-three-volumes.json` | 上述 HTML 的期望迁移结果（snapshot） |

内存 DB 工厂（复用 fts-integration 模式）：

```typescript
// electron/ipc/__tests__/helpers/testDb.ts
export function createTestDb(): Database
export function seedProjectWithLegacyOutline(db, outlineHtml: string): string
export function seedProjectWithVolumes(db, volumes: OutlineVolume[]): string
```

---

### 14.3 单元测试用例明细

#### A. `electron/ipc/__tests__/outlineMigration.test.ts`

纯函数测试 `parseLegacyOutlineToVolumes(html) → { synopsis, volumes, progress }`：

| # | 用例名 | 输入 | 断言 |
|---|--------|------|------|
| A1 | 三卷标准 HTML | `three-volumes-with-progress.html` | volumes.length===3；title 含「第一卷」；最后一卷 progress_notes 非空 |
| A2 | 写作进度剥离 | 含写作进度块 | synopsis 不含「写作进度」；progress 不在 summary 重复 |
| A3 | 无 h2 单块 | `single-block-no-h2.html` | volumes.length===1；title==='正文'；summary 含原文 |
| A4 | 空 outline | `''` | volumes.length===1；summary==='' |
| A5 | 仅 h1 | `h1-only.html` | synopsis 非空；volumes[0].summary 可为空 |
| A6 | 畸形 HTML | malformed | 不抛错；至少 1 卷；logger.warn（mock） |
| A7 | 章节范围解析 | `chapter-range-in-text.html` | chapter_start/end 解析为 1/30（若实现了解析） |
| A8 | 幂等标记 | 对已迁移项目再跑 | 不重复插入卷 |

#### B. `electron/ipc/__tests__/volumeIpc.test.ts`

内存 sql.js + 直接调 handler 逻辑（或抽 `volumeRepository`）：

| # | 用例名 | 断言 |
|---|--------|------|
| B1 | list 空项目 | `[]` |
| B2 | save 新卷 | 返回带 id；sort_order 递增 |
| B3 | save 更新 summary | updated_at 变化；字段持久化 |
| B4 | updateMeta 改 status | 仅 meta 变，summary 不变 |
| B5 | delete 卷 | 行消失；FTS 行删除（mock sync） |
| B6 | reorder | orderedIds 后 sort_order 0,1,2… |
| B7 | chapter_start > chapter_end | 抛错或返回 `{ error }` |
| B8 | summary 超 50_000 字 | 拒绝 |
| B9 | 超 200 卷 | 拒绝 |
| B10 | project.create | 自动 1 条默认卷「正文」 |
| B11 | project.update 拒绝写 outline | 传 outline 忽略或报错；synopsis 可写 |
| B12 | CASCADE 删项目 | volumes 一并删除 |
| B13 | 两卷范围重叠 | 第二卷保存失败；错误信息含卷序号 |
| B14 | 编辑卷不与自己重叠 | 更新自身范围合法 |
| B15 | 仅一端 NULL 不参与重叠 | 两卷各只有 start → 不判重叠 |

#### C. `electron/ipc/__tests__/volumeFts.test.ts`

| # | 用例名 | 断言 |
|---|--------|------|
| C1 | syncVolumeToFTS | search_index 含 type=outline_volume |
| C2 | syncSynopsisToFTS | type=synopsis |
| C3 | 删除卷清 FTS | deleteEntityFromFTS 后搜不到 |
| C4 | 长 summary 切片 | chunk_idx > 0 的多行 |
| C5 | rebuildProjectFTSIndex | 含 volumes + synopsis；无旧 type=outline |
| C6 | 迁移后旧 outline 索引清除 | type=outline 行数为 0 |

#### D. `electron/ipc/__tests__/volumeSearch.test.ts`

| # | 用例名 | 断言 |
|---|--------|------|
| D1 | scope=outlines 命中卷 | 返回 type=outline_volume |
| D2 | scope=outlines 命中 synopsis | type=synopsis |
| D3 | scope=outlines 仍命中 chapter_outline | 回归 |
| D4 | resolveEntity outline_volume | 返回卷 title + summary 片段 |

#### E. `electron/ipc/__tests__/volumeVersion.test.ts`

| # | 用例名 | 断言 |
|---|--------|------|
| E1 | commit 写入 volume:* | manifest 含各卷 hash |
| E2 | commit 写入 synopsis | manifest.synopsis 存在 |
| E3 | restore 新 manifest（含 volume:*） | volumes 表与 blob 一致；**`projects.outline` 列不变** |
| E4 | restore 删掉的卷 | manifest 外卷被 DELETE |
| E5 | restore 旧 manifest 仅 outline | 先写回 outline → 清空该项目 volumes → HTML 解析重建；`outline_migrated_at` 已设也仍执行 |
| E6 | 新 commit → 旧 commit → 新 commit | 旧：卷按 outline 重解析；新：卷按 blob 精确恢复 |
| E7 | restore 含 volume:* 缺 outline hash | 卷恢复成功；`projects.outline` **不被清空** |
| E8 | restore 后 FTS | `rebuildProjectFTSIndex` 已调用；卷关键词可搜 |

#### F. `electron/ipc/__tests__/volumeImport.test.ts`

| # | 用例名 | 断言 |
|---|--------|------|
| F1 | 导入 v1 含 outline | volumes 从 HTML 解析 |
| F2 | 导入 v2 含 outline | 同 F1 |
| F3 | 导入 v3 含 volumes[] | 直接落库；条数一致 |
| F4 | v3 round-trip export→import | 字段完全一致 |
| F5 | v3 volumes 缺必填字段 | validate 失败 |
| F6 | 导入后 FTS 就绪 | rebuild 可搜到卷关键词 |

#### G. `src/lib/backupValidator.test.ts`（扩展）

| # | 用例名 | 断言 |
|---|--------|------|
| G1 | v3 合法 volumes | valid |
| G2 | volumes 非数组 | error |
| G3 | volume.summary 超长 | error |
| G4 | volume.status 非法枚举 | error |
| G5 | v1/v2 无 volumes | 仍 valid（兼容） |

#### H. `src/lib/tools.test.ts`（扩展 / 替换 outline 段）

Mock `window.electronAPI.volume.*` + `project.list`：

| # | 用例名 | 断言 |
|---|--------|------|
| H1 | list(type=volume) 空 | 「没有」或 0 卷 |
| H2 | list(type=volume) 多卷 | 含卷名、范围、状态摘要 |
| H3 | read(type=volume) 指定 index | 返回该卷 summary 全文 |
| H4 | read(type=volume) index 越界 | 错误提示 |
| H5 | read(type=outline) 新语义 | 含 synopsis + 目录；**不含**各卷 summary 全文 |
| H6 | read(type=outline) 无卷 | 提示未设置 |
| H7 | write_volume 改 summary | `_edit_volume: true` + original/modified |
| H8 | write_volume 仅 progress_notes | 立即 save，无 `_edit_volume` |
| H9 | write_volume 同次 summary+progress | diff；accept 后两者皆写入 |
| H10 | write_volume 默认卷（仅 progress） | 未传 index 时落当前章卷或最后一卷 |
| H11 | write_volume 范围重叠 | 返回错误，不调 save |
| H12 | create_volume | 新卷 sort_order 正确；返回卷序号 |
| H13 | toolDefinitions 不含旧工具 | 无 write_outline/update_progress/update_volume_progress |
| H14 | search scope outlines | mock search 含 outline_volume |

**删除**现有用例：`write_outline` / `update_progress` 全部移除；`read outline` 改为新语义断言。

#### I. `src/stores/editorStore.test.ts`（扩展）

| # | 用例名 | 断言 |
|---|--------|------|
| I1 | 初始 volumes=[] | — |
| I2 | setVolumes | 状态更新 |
| I3 | setActiveVolumeId | 切换 |
| I4 | setPendingVolumeEdit | 与 pendingChapterEdit 对称 |
| I5 | loadVolumes(projectId) | mock volume.list 调用 |
| I6 | setActiveProject 切换 | volumes 重新加载 |

#### J. `src/lib/diffUtils.test.ts`（回归）

| # | 用例名 | 断言 |
|---|--------|------|
| J1 | 卷 summary HTML diff | 与现 outline diff 同样正确 |
| J2 | 空 → 有内容 | ins 段正确 |

---

### 14.4 集成测试

**文件**：`electron/ipc/__tests__/outlineMigration.integration.test.ts`  
**方式**：真实 `initDatabase` 内存库 → `runConsistencyChecks` v3 → 查表。

| # | 场景 | 步骤 | 断言 |
|---|------|------|------|
| INT1 | 冷启动迁移 | seed legacy outline → consistency v3 | volumes 有数据；**outline 原 HTML 仍在** |
| INT2 | 幂等 | 再跑 consistency v3 | 卷数不变 |
| INT3 | 迁移 + FTS | 迁移后 search | 关键词命中卷 |
| INT4 | 迁移 + export | 迁移 → export | version===3；volumes 数组存在 |
| INT5 | export → import 新库 | 全字段相等 |
| INT6 | commit → restore 卷 | 修改 summary → commit → restore | 内容回滚 |

---

### 14.5 E2E 测试

#### 新文件 `e2e/volume-outline.spec.ts`

| # | 用例名 | 步骤 | 断言 |
|---|--------|------|------|
| E2E1 | 大纲页展示默认卷 | 点侧边栏「全书大纲」 | 见「正文」卷；可展开 |
| E2E2 | 折叠/展开 | 点击卷头 | 第二次点击折叠 |
| E2E3 | 编辑卷 summary 持久化 | 改文字 → 切章 → 回来 | 内容保留 |
| E2E4 | 编辑 synopsis 持久化 | 改全书梗概 | DB synopsis 更新 |
| E2E5 | 修改卷范围 | 改 chapter_start/end | IPC 持久化 |
| E2E5b | 重叠范围拒绝 | 两卷设为重叠区间 | UI/IPC 报错，数据不变 |
| E2E6 | 添加卷 | 点「添加卷」 | 列表 +1 |

#### 新文件 `e2e/volume-migration.spec.ts`

| # | 用例名 | 步骤 | 断言 |
|---|--------|------|------|
| E2E7 | 遗留 outline 迁移 | 启动前注入 fixture db（含 projects.outline） | UI 显示多卷 |

> 实现方式：在 `e2e/fixtures.ts` 增加 `seedLegacyOutlineDb()`，或复制预置 `inkark.db` 到 `INKARK_E2E_USER_DATA`。

#### 新文件 `e2e/volume-version.spec.ts`

| # | 用例名 | 步骤 | 断言 |
|---|--------|------|------|
| E2E8 | 版本历史含卷变更 | 改卷 → 打开版本历史 → 回滚 | 卷内容恢复 |

#### 扩展 `e2e/ai-tools.spec.ts`

| # | 用例名 | 步骤 | 断言 |
|---|--------|------|------|
| E2E9 | write_volume IPC 直调 | `executeToolOnRenderer('write_volume', …)` | volume.save 被调用 |
| E2E10 | read(volume) 不拉全书 | read 后结果长度 < 全书拼接 | — |
| E2E11 | diff 审阅接受 | write_volume → UI 接受 | DB 更新；pending 清空 |

#### 扩展 `e2e/project.spec.ts`

| # | 用例名 | 断言 |
|---|--------|------|
| E2E12 | 导出 v3 含 volumes | JSON.volumes.length >= 1 |
| E2E13 | 导入 v3 round-trip | 卷 title 一致 |

#### 回归更新（必改选择器）

| 文件 | 现状问题 | 改法 |
|------|----------|------|
| `e2e/app.spec.ts` | `.flex.h-10…border-b` 已过期 | 改为 `.floating-glass-topbar` |
| `e2e/sidebar-navigation.spec.ts` | 「全书大纲」按钮 | 仍用 title；加卷列表断言 |
| `e2e/ai-helpers.ts` | mock `write_outline` | **删除**；改为 `create_volume` / `write_volume` |

---

### 14.6 Phase 测试门禁

实施阶段（第十二章）各 Phase **必须**满足的测试集合：

| Phase | 必绿测试 | 新增用例编号 |
|-------|----------|--------------|
| **Phase 1** 数据层 | `outlineMigration.*` 全部；`volumeIpc` B1–B15；`volumeFts` C1–C6；`volumeImport` F1–F6；`backupValidator` G1–G5；INT1–INT6 | A*, B*, C*, F*, G*, INT* |
| **Phase 2** AI | `tools.test.ts` H1–H14；`volumeSearch` D1–D4；E2E9–E2E11 | H*, D*, E2E9–11 |
| **Phase 3** UI | `editorStore` I1–I6；E2E1–E2E8；`app.spec` 选择器修复；E2E12–13 | I*, E2E1–8,12–13 |
| **Phase 4** 增强 | 侧边栏卷分组等 | 实施时补表 |
| **Phase 5** outline 列清理 | v4 置空后 FTS/search 旧 `outline` 分支不再命中；删列后全量回归 | 扩展 `outlineMigration.*` + `volumeFts` C6 |

**全量回归**（每 Phase 结束跑）：

```bash
npm test
npm run e2e          # 全量回归；重点 volume-*.spec / project / ai-tools / app
npx tsc --noEmit
```

---

### 14.7 CI 与覆盖率建议

| 项 | 建议 |
|----|------|
| 新增文件覆盖率 | `electron/ipc/__tests__/volume*.ts` 行覆盖 ≥ 85% |
| 迁移解析 | 分支覆盖 100%（fixture 穷举） |
| E2E | `volume-outline.spec` 进默认 e2e job，不依赖 DeepSeek key |
| AI E2E | E2E9–11 可 `test.skip(!dsConfig)` 与现 ai-tools 一致 |
| 回归 guard | `tools.test.ts` 保留「read outline 不返回全文」快照长度上限断言 |

---

### 14.8 暂不测 / 人工验收

| 项 | 原因 |
|----|------|
| TipTap 富文本工具栏每个按钮 | 与现大纲页同级，无回归则不改 |
| 卷拖拽排序动画 | Phase 4 |
| 200 卷性能 | 人工抽样；单测只测上限拒绝 |
| macOS / Windows UI 像素级 | E2E 只测功能不断言布局 |

---

### 14.9 实施顺序（测试先行）

与功能开发并行，推荐：

1. **先写** `outlineMigration.test.ts` + fixtures（TDD，解析函数可先 stub）
2. **再写** `volumeIpc.test.ts`（表未建时测试应红）
3. Phase 1 功能完成后跑 INT*
4. Phase 2 前扩展 `tools.test.ts` H*（先红后绿）
5. Phase 3 前写 E2E1–6（UI 未完成时 skip）
6. 全 Phase 完成后删 `pendingOutlineEdit`、`_edit_outline` 相关代码与测试

---

## 十五、评审结论（2026-07-01）

| # | 问题 | **结论** |
|---|------|----------|
| 1 | `projects.outline` 是否保留 | **保留列 + 保留存量 HTML 至少一个版本周期**；迁移写入 volumes 后 outline 作只读备份；v4 置空，再下一版才删列 |
| 2 | `write_outline` 是否兼容 | **不兼容**；删除 `write_outline` / `update_progress`；卷侧仅 `create_volume` + `write_volume` |
| 3 | 卷章节范围重叠 | **硬拦截**，保存/API/AI 工具统一校验 |
| 4 | 卷 summary 格式 | **HTML**（与 chapter_outline、TipTap 一致） |
| 5 | 状态存放 | **editorStore**（与 chapters 对称） |
| 6 | 全书梗概进默认上下文 | `read(outline)` 可读；**不**在 assembleContext 自动注入全文 |
| 7 | `create_volume` | **Phase 2 必做** |
| 8 | `delete_volume` | **不做**；删除后续统一 `delete` 工具设计 |
| 9 | `update_volume_progress` | **不单独做**；并入 `write_volume.progress_notes`（非 summary 字段直写） |
| 10 | 新 manifest 是否写 `outline` hash | **继续写**，直到 v4 置空 outline 列；否则 restore 会误清备份列 |
| 11 | consistency v3 幂等粒度 | **按项目跳过**（`outline_migrated_at` + volumes 行数）；force 不覆盖已迁移项目；强制重迁走单独 IPC |
| 12 | 迁移事务边界 | volumes/synopsis 写入在 transaction 内；FTS 重建在 transaction 外，避免嵌套 |
| 13 | `write_volume` 的 `volume_index` | 改 summary/范围/status/title **必填**；仅改 progress_notes 可选走默认卷 |
| 14 | vitest 覆盖 `electron/` | **必须改 `vitest.config.ts`** coverage.include；electron 端测试用相对路径 |
| 15 | outline 列清理 | **拆为独立 Phase 5 / 独立版本**；v4 置空 + 清 `outline_migrated_at`，再下一版物理删列（需先确认 sql.js SQLite 版本） |
| 16 | 客户端降级 | **不支持**；不保证装回旧版可执行文件后的数据一致性 |
| 17 | 应用内版本切换 | **必须支持**任意 commit 间 restore；按 manifest 有无 `volume:*` 双路径；不受 consistency「已迁移跳过」约束 |

### 待后续评审

- v4 清理 `outline` 列的具体版本号（随首个含迁移的版本 tag 再定）
- 通用 `delete` 工具是否覆盖卷 / 章 / 角色等（独立设计）

---

## 十六、附录：与现网数据字段对照

```
【现在】
projects.outline = <h1>书名</h1><h2>第一卷</h2><p>…</p><h2>写作进度</h2><p>…</p>

【迁移后（首版）】
projects.synopsis         = "书名/前言纯文本"
outline_volumes[0..n]     = 结构化卷数据
projects.outline          = 原 HTML **保留**（只读备份，供回滚/重迁）
projects.outline_migrated_at = "2026-…"

【v4 清理后】
projects.outline          = ""  （列仍在，内容清空）

【再下一版本】
projects.outline 列        = 物理删除（需 NSIS / 迁移说明）
```

---

## 十七、时间线

| 日期 | 事项 |
|------|------|
| 2026-07-01 | 初稿 |
| 2026-07-01 | 评审：create_volume 必做；delete_volume 不做；progress 并入 write_volume |
| 2026-07-01 | 评审：不支持客户端降级；应用内版本历史任意切换须双路径 restore |
| | Phase 1 开工：________ |
