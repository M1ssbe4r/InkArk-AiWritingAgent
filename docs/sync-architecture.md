# Store ↔ DB 同步架构设计

## 一、概述

InkArk 的数据持久化层使用 SQLite（sql.js/WASM），前端状态管理使用 Zustand。两种存储之间存在同步需求。本项目的同步策略并非一刀切，而是根据数据不同特性采用了三种截然不同的模式。

### 核心设计原则

1. **正文优先体验**：用户编辑的正文即时反映在 UI 上，持久化允许短暂延迟
2. **元数据即时一致**：标题、大纲等元数据在修改后立即写入 DB 并刷新 Store
3. **旁路数据无缓存**：角色卡、世界观设定不在 Store 中缓存副本，始终从 DB 读取

---

## 二、三种同步模式

### 模式 A：Store 优先 + 防抖持久化（章节正文）

**适用数据**：章节正文（content）

**读路径**：Store → DB（fallback）
**写路径**：Store（即时）→ DB（1 秒防抖）

```
┌─────────────┐    用户输入     ┌─────────────┐
│   TipTap     │ ──────────────→ │  Zustand     │
│   Editor     │ updateChapter- │  Store       │
│             │   Content()    │ chapters[n]  │
└─────────────┘                │  .content    │
                               │  .isDirty=T  │
                               └──────┬──────┘
                                      │ scheduleChapterSave()
                                      │ (debounce 1000ms)
                                      ▼
                               ┌─────────────┐
                               │  SQLite DB   │
                               │ UPDATE title,│
                               │ content,     │
                               │ word_count   │
                               └─────────────┘
```

**实现细节**：

- [editorStore.ts](file:///d:/Project/写文助手/src/stores/editorStore.ts#L59-L63) `updateChapterContent`：立即更新 Store 中的 content 和 word_count
- [editorRef.ts](file:///d:/Project/写文助手/src/lib/editorRef.ts#L11-L23) `scheduleChapterSave`：1 秒防抖后读取 Store 中的完整 chapter 对象写入 DB
- [editorRef.ts](file:///d:/Project/写文助手/src/lib/editorRef.ts#L25-L47) `flushChapterSave`：取消定时器并立即保存，用于切换项目/删除章节等场景
- [main.ts](file:///d:/Project/写文助手/electron/main.ts#L292-L300) `db:chapter:save` SQL：`UPDATE chapters SET title=?, content=?, word_count=?, updated_at=datetime('now')`

**工具调用读取时**：优先取 Store（可能比 DB 新几秒），fallback 到 DB。

```typescript
// tools.ts: read_chapter_content
const storeChapter = useEditorStore.getState().chapters.find((c) => c.id === chapter.id)
const content = storeChapter?.content ?? chapter.content
```

---

### 模式 B：DB 直接写入 + Store 即时 Patch/刷新（元数据）

**适用数据**：章节标题（title）、章节大纲（summary）、全文大纲（project.outline）

**写路径**（两种触发方式产生两种子模式）：

#### B1：UI onBlur 触发 → DB 写入 → Store 全量刷新

```
┌─────────────┐    onBlur      ┌─────────────┐    loadChapters    ┌─────────────┐
│   Editor     │ ────────────→ │  SQLite DB   │ ────────────────→ │  Zustand     │
│   标题/大纲   │ updateMeta() │ 标题/大纲更新  │ 全量重新查询      │  Store       │
└─────────────┘               └─────────────┘                   └─────────────┘
```

[Editor.tsx](file:///d:/Project/写文助手/src/components/editor/Editor.tsx#L292-L295) 标题 onBlur：
```typescript
onBlur={async () => {
  await window.electronAPI.chapter.updateMeta({ id: activeChapter.id, title: titleDraft, summary: summaryDraft.trim(), status: activeChapter.status })
  if (activeProjectId) loadChapters(activeProjectId)  // ← 全量刷新
}}
```

[Editor.tsx](file:///d:/Project/写文助手/src/components/editor/Editor.tsx#L163-L169) 大纲保存按钮 `handleUpdateSummary`：
```typescript
await window.electronAPI.chapter.updateMeta({ ... })
if (activeProjectId) loadChapters(activeProjectId)  // ← 全量刷新
```

#### B2：工具调用触发 → DB 写入 → Store 局部 Patch

```
┌─────────────┐  executeToolCall  ┌─────────────┐   setChapters(map)   ┌─────────────┐
│  AI Tool     │ ───────────────→ │  SQLite DB   │ ───────────────────→ │  Zustand     │
│  调用        │   updateMeta()   │ 元数据更新    │  局部 patch 而非全量  │  Store       │
└─────────────┘                  └─────────────┘                      └─────────────┘
```

[tools.ts:write_chapter_outline](file:///d:/Project/写文助手/src/lib/tools.ts#L92-L112)：
```typescript
// 写入 DB
await window.electronAPI.chapter.updateMeta({ id: chapter.id, title: chapter.title, summary: outline, status: chapter.status })
// 局部 Patch Store
useEditorStore.getState().setChapters(
  useEditorStore.getState().chapters.map((c) => c.id === chapter.id ? { ...c, summary: outline } : c)
)
```

[OutlineEditor.tsx](file:///d:/Project/写文助手/src/components/outline/OutlineEditor.tsx#L41-L46) 全文大纲保存：
```typescript
await window.electronAPI.project.update(updated)
setProjects(projects.map((p) => (p.id === updated.id ? updated : p)))
```

**为什么 B1 用全量刷新而 B2 用局部 patch？**

- B1（UI 侧）：用户可能同时修改了标题和大纲，`loadChapters` 一次性刷新全部字段最安全
- B2（工具调用）：AI 一次只改一个字段（outline 或 title），局部 patch 即可，且不影响正在编辑中的 content

---

### 模式 C：纯 DB（无 Store 缓存）

**适用数据**：角色卡（character_cards）、世界观设定（world_cards）

**读写路径**：始终直接从 DB 读写，不经过 Zustand Store

```
┌──────────────────┐    直接读取      ┌─────────────┐
│ CharacterPanel   │ ───────────────→ │  SQLite DB   │
│ WorldPanel       │ ←─────────────── │              │
│ CharacterEditor  │    返回数据      │              │
│ WorldEditor      │                  │              │
└──────────────────┘                  └──────┬──────┘
                                            │ create/update/delete
                                            │ (直接写入)
```

[CharacterCardEditor.tsx](file:///d:/Project/写文助手/src/components/character/CharacterCardEditor.tsx#L83-L89) 保存：
```typescript
if (card) {
  await window.electronAPI.character.update(data)
} else {
  await window.electronAPI.character.create(data)
}
onSaved()  // ← 回调触发父组件重新 load
```

**特点**：
- ✅ 无 Store/DB 不一致风险
- ✅ 写入后通过 `onSaved()` → `load()` 刷新 UI
- ✅ 每次访问都需要 IPC 调用，但数据量小、频率低

---

## 三、`chapter.save` 与 `updateMeta` 的互补设计

这是架构中一个重要但不够明显的设计决策。

### SQL 对比

| IPC Handler | SQL 写入字段 | 不写入的字段 |
|-------------|-------------|-------------|
| [db:chapter:save](file:///d:/Project/写文助手/electron/main.ts#L292-L300) | `title, content, word_count` | `summary, status` |
| [db:chapter:updateMeta](file:///d:/Project/写文助手/electron/main.ts#L303-L306) | `title, summary, status` | `content, word_count` |

### 为什么这样设计？

这两个 IPC handler 负责不同的职责：

- `save`：管理**正文内容**（content + word_count），由防抖自动保存或 `flushChapterSave` 触发
- `updateMeta`：管理**结构元数据**（title + summary + status），由 UI onBlur 或工具调用触发

因为两者写入的列是**互补的**，所以即使并发执行也不会互相覆盖数据：

```
时间线：
  1. AI 调用 write_chapter_outline → updateMeta（只写 summary）→ summary 在 DB 中更新
  2. 1 秒后防抖触发 → chapter.save（只写 content）→ content 在 DB 中更新
结果：DB 中 summary 和 content 都是最新的 ✅
```

**唯一的重叠字段是 `title`**。但 title 同时出现在两个 SQL 中，意味着如果用户在编辑 body 的同时修改了 title（防抖保存尚未触发），然后 AI 调用了 `write_chapter_outline`（也会写 title），可能存在轻微竞态。但实际场景中，title 几乎不会同时被用户和 AI 修改，且 UI onBlur 的 `updateMeta` 会立即刷新 Store，所以竞态窗口极小。

---

## 四、各实体同步流程序列图

### 4.1 章节正文编辑流程

```
用户输入
  │
  ▼
Store.updateChapterContent()   ← 即时（content, word_count, isDirty=true）
  │
  ▼
scheduleChapterSave(id)        ← 启动 1s 防抖定时器
  │
  ▼ (1 秒后无新输入)
读取 Store 中的 chapter        ← 此刻 content 是最新的
  │
  ▼
window.electronAPI.chapter.save(chapter)
  │
  ▼
DB: UPDATE title, content, word_count
  │
  ▼
Store.setDirty(false)
```

### 4.2 章节标题/大纲 UI 编辑流程

```
用户在 Editor 中修改标题 onBlur
  │
  ▼
window.electronAPI.chapter.updateMeta({ title, summary, status })
  │
  ▼
DB: UPDATE title, summary, status
  │
  ▼
loadChapters(projectId)        ← 全量从 DB 刷新到 Store
```

### 4.3 章节创建流程

```
Sidebar: handleAddChapter()
  │
  ▼
生成新 chapter 对象（id, project_id, sort_order, etc.）
  │
  ▼
window.electronAPI.chapter.save(newChapter)
  │
  ▼
DB: INSERT INTO chapters
  │
  ▼
Store.setChapters([...currentChapters, newChapter])
  │
  ▼
setActiveChapter(newChapter.id)
  │
  ▼
pushChange()                    ← 通知变更
```

### 4.4 章节删除流程

```
Sidebar: handleDeleteChapter(chapterId)
  │
  ▼
清除 pendingChapterEdit（如有）
  │
  ▼
flushChapterSave()              ← 先保存未持久化的编辑
  │
  ▼
window.electronAPI.chapter.delete(chapterId)
  │
  ▼
DB: DELETE FROM chapters
  │
  ▼
loadChapters(projectId)         ← 全量从 DB 刷新到 Store
  │
  ▼
pushChange()                    ← 通知变更
```

### 4.5 角色卡/世界观设定编辑流程

```
CharacterCardEditor: handleSave()
  │
  ▼
判断新建还是编辑：
  ├── 新建: window.electronAPI.character.create(data)
  └── 编辑: window.electronAPI.character.update(data)
  │
  ▼
DB: INSERT / UPDATE character_cards
  │
  ▼
pushChange()                    ← 通知变更
  │
  ▼
onSaved()                       ← 回调通知父组件
  │
  ▼
CharacterPanel.load()           ← 父组件重新从 DB 加载列表
```

### 4.6 全文大纲编辑流程

```
OutlineEditor: handleSave()
  │
  ▼
window.electronAPI.project.update({ ...project, outline: content })
  │
  ▼
DB: UPDATE projects SET outline=?
  │
  ▼
Store.setProjects(projects.map(...))  ← 局部 patch
  │
  ▼
pushChange()                    ← 通知变更
```

### 4.7 工具调用修改正文流程（write_chapter_content）

```
AI 调用 write_chapter_content（空章 content / 非空 edits+inserts，段落 1-based）
  │
  ▼
tools.ts: splitParagraphs 定位 → applyChapterParagraphEdits → joinParagraphsToHtml
  │
  ▼
返回 { _edit_chapter: true, original, modified, summary, chapter_id }
  │
  ▼
AIPanel: 设置 pendingChapterEdit，显示 diff 待用户审阅
  │
  ▼
用户接受：
  │
  ├── Store.setActiveChapter(chapter.id)
  ├── Store.updateChapterContent(chapter.id, modified)     ← 更新 Store
  ├── window.electronAPI.chapter.save({ ...chapter, content: modified })  ← 写入 DB
  ├── Store.setDirty(false)
  ├── ed.commands.setContent(modified)                      ← 更新编辑器
  └── Store.setPendingChapterEdit(null)                     ← 清除待审阅状态

用户拒绝：
  │
  └── Store.setPendingChapterEdit(null)                     ← 清除待审阅状态
```

---

## 五、关键工具函数同步契约

### `scheduleChapterSave(chapterId)`
- **调用时机**：每次 `updateChapterContent` 后
- **契约**：1 秒内无新调用则写入 DB，写入后清除 `isDirty`
- **边界**：找不到章节则静默跳过（章节可能在防抖期间被删除）

### `flushChapterSave()`
- **调用时机**：切换项目、删除章节、应用退出前
- **契约**：取消防抖定时器，立即将活跃章节写入 DB
- **fallback**：无活跃定时器时，用 `activeChapterId` 查找并保存

### `pushChange(projectId, type, targetId, summary)`
- **调用时机**：任何数据修改操作完成后（创建/修改/删除）
- **作用**：通知 AI 对话上下文"数据已变更"，避免 AI 使用过时数据

### `incrementDataVersion()`
- **调用时机**：`executeToolCall` 内部自动调用
- **作用**：版本号递增，配合 `consumeChanges` 机制通知 AI 重新获取上下文

---

## 六、切换到其他项目时的同步保障

[editorStore.ts](file:///d:/Project/写文助手/src/stores/editorStore.ts#L39-L50) `setActiveProject` 中：

```typescript
// 1. 如果当前有脏数据，先保存
if (state.isDirty) {
  const dirtyChapter = state.chapters.find((c) => c.id === state.activeChapterId)
  if (dirtyChapter) {
    await window.electronAPI.chapter.save(dirtyChapter)
    set({ isDirty: false })
  }
}

// 2. 清空旧数据
set({ activeProjectId: id, activeChapterId: null, chapters: [] })

// 3. 从 DB 加载新项目数据
if (id) {
  const chapters = await window.electronAPI.chapter.list(id)
  const lastId = chapters.length > 0 ? chapters[chapters.length - 1].id : null
  set({ chapters, activeChapterId: lastId })
}
```

关键点：切换项目时 Store 被完全清空并重新从 DB 加载，确保不会残留上一个项目的数据。

---

## 七、已知的同步边界情况

以下是在设计评审中识别出的边界情况，均已评估为**低风险**或**不会影响数据正确性**：

| 场景 | 描述 | 风险评估 |
|------|------|----------|
| 防抖保存时章节已被删除 | `scheduleChapterSave` 找不到章节，静默跳过 | 极低 — 删除前已调 `flushChapterSave` |
| 切换项目时 isDirty=true 但找不到章节 | `setActiveProject` 中 `dirtyChapter` 为 null | 极低 — isDirty 残留但不影响数据 |
| 工具批量更新时某次 DB 写入失败 | 已完成的写入在 DB 中，后续 Store 更新不执行 | 极低 — `updateMeta` 几乎不可能失败 |
| chapter.save 和 updateMeta 并发 | 两者 SQL 写入列互补，不互相覆盖 | 安全 — 设计如此 |

---

## 八、总结

| 数据 | 读路径 | 写路径 | Store 缓存 | 同步延迟 |
|------|--------|--------|:----------:|:--------:|
| 章节正文 | Store → DB fallback | Store 即时 + DB 防抖 | 是 | ~1 秒 |
| 章节标题 | DB（通过 Store 代理） | DB 即时 + Store 刷新/patch | 是 | 无 |
| 章节大纲 | DB（通过 Store 代理） | DB 即时 + Store 刷新/patch | 是 | 无 |
| 全文大纲 | DB（通过 Store 代理） | DB 即时 + Store patch | 是 | 无 |
| 角色卡 | DB 直接 | DB 直接 | 否 | 无 |
| 世界观设定 | DB 直接 | DB 直接 | 否 | 无 |

三层策略（防抖持久化 / 即时元数据 / 纯 DB）各司其职，互不冲突。`chapter.save` 和 `updateMeta` 的 SQL 列互补设计是保证并发安全的关键。