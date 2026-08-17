# InkArk 代码架构文档

## 一、项目概览

InkArk 是一款 AI 辅助长篇小说写作的桌面应用，基于 **Electron + React + TypeScript** 技术栈构建。项目名 `inkark`，当前版本 `0.1.0`。

### 核心定位

为小说作者提供集章节管理、AI 写作辅助、角色/世界观管理、版本控制于一体的本地写作环境。

### 技术栈总览

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 桌面框架 | Electron 33 | 无边框窗口，自定义标题栏 |
| UI 框架 | React 19 + TypeScript 5 | 函数式组件 + Hooks |
| 样式方案 | Tailwind CSS 3.4 + shadcn/ui | Zinc + Blue 配色，New-York 风格 |
| 富文本编辑器 | TipTap (ProseMirror) | 支持扩展、Markdown 快捷键 |
| 状态管理 | Zustand 5 | 轻量级，三个独立 Store |
| 数据库 | SQLite (sql.js / WASM) | 便携式存储，不写入 AppData |
| AI 接口 | OpenAI 兼容 API | 支持 DeepSeek 等提供商 |
| 构建工具 | Vite 6 + vite-plugin-electron | 双入口（主进程 + 渲染进程） |
| 文档导出 | docx (Word) + react-markdown | TXT / MD / DOCX 多格式 |
| 测试 | Vitest | 单元测试 |

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron 主进程                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ main.ts  │  │  db.ts   │  │version.ts│  │consistency │  │
│  │ 窗口管理  │  │ SQLite   │  │ 版本控制  │  │ 一致性检查  │  │
│  │ IPC 注册  │  │ CRUD     │  │ SHA256   │  │            │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
│         ↕ IPC (invoke/handle)                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  preload.ts                           │   │
│  │           contextBridge 安全桥接层                     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────────┐
│                    React 渲染进程                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    App.tsx                            │   │
│  │         布局编排 + 初始化 + 面板拖拽                    │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │ Stores  │ │   Libs   │ │   UI     │ │  Extensions  │   │
│  │ Zustand │ │ 核心逻辑  │ │ Components│ │  TipTap      │   │
│  └─────────┘ └──────────┘ └──────────┘ └──────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 架构特点

1. **双进程模型**：Electron 主进程负责数据持久化和系统 API，渲染进程负责 UI 和业务逻辑
2. **IPC 通信**：采用 `invoke/handle` 模式，所有数据库操作和文件操作通过主进程完成
3. **安全桥接**：`preload.ts` 通过 `contextBridge` 暴露受控 API，启用 `contextIsolation`
4. **便携式数据**：数据库文件存储在可执行文件同目录的 `data/` 下，不写入系统目录

---

## 三、目录结构详解

```
inkark/
├── electron/                        # Electron 主进程
│   ├── main.ts                      # 窗口创建、IPC 注册、应用生命周期、流式 API 代理
│   ├── preload.ts                   # contextBridge — 导出安全 API 到渲染进程
│   └── ipc/
│       ├── db.ts                    # SQLite 初始化 (sql.js WASM)、表结构、CRUD 辅助
│       ├── version.ts               # 内容寻址版本控制 (SHA256 + manifest)
│       └── consistency.ts           # 数据一致性检查框架
│
├── src/                             # React 渲染进程
│   ├── App.tsx                      # 根组件：三栏布局、面板拖拽、初始化流程
│   ├── main.tsx                     # React 入口
│   ├── index.css                    # 全局样式 + Tailwind
│   ├── vite-env.d.ts                # Vite 类型声明
│   │
│   ├── types/
│   │   └── index.ts                 # TypeScript 接口定义（6 个核心类型）
│   │
│   ├── stores/                      # Zustand 状态管理
│   │   ├── appStore.ts              # 应用 UI 状态（侧栏视图、AI 面板开关）
│   │   ├── editorStore.ts           # 编辑器核心状态（项目/章节/脏标记/数据版本）
│   │   └── settingsStore.ts         # 字体设置（持久化到 localStorage）
│   │
│   ├── lib/                         # 核心业务逻辑
│   │   ├── api.ts                   # LLM 流式调用、prompt 构建、Tool Calling 循环
│   │   ├── context.ts               # AI 写作上下文组装
│   │   ├── tools.ts                 # 16 个 AI Tool 定义 + 执行器
│   │   ├── editorRef.ts             # 编辑器全局引用、变更通知队列、风格指导
│   │   └── utils.ts                 # 工具函数：cn()、generateId()、countWords()
│   │
│   ├── extensions/
│   │   └── StaticCursor.ts          # TipTap 扩展：失焦时保持光标/选区可见
│   │
│   └── components/                  # UI 组件
│       ├── layout/                  # 布局组件
│       │   ├── TitleBar.tsx         # 自定义标题栏：项目菜单、重命名、导入导出
│       │   ├── Sidebar.tsx          # 侧栏：目录/角色/世界观三个视图切换
│       │   ├── StatusBar.tsx        # 状态栏：保存状态、字数统计
│       │   └── ProjectCommits.tsx   # 版本历史对话框
│       │
│       ├── editor/                  # 编辑器相关
│       │   ├── Editor.tsx           # TipTap 编辑器（章节+大纲） + 章节标题/摘要 + 自动保存
│       │   ├── ContextMenu.tsx      # 右键菜单：润色/缩写/扩写/发送到聊天框
│       │   └── ExportDialog.tsx     # 导出对话框：TXT / Markdown / DOCX
│       │
│       ├── ai-panel/
│       │   └── AIPanel.tsx          # AI 对话面板：流式响应、Tool Calling、多候选
│       │
│       ├── outline/
│       │   └── BookIdeaDialog.tsx   # AI 创作规划：书名/章节数/故事创意
│       │
│       ├── character/
│       │   ├── CharacterPanel.tsx   # 角色卡列表/网格视图
│       │   └── CharacterCardEditor.tsx  # 角色卡编辑抽屉
│       │
│       ├── world/
│       │   ├── WorldPanel.tsx       # 世界观卡列表
│       │   └── WorldCardEditor.tsx  # 世界观卡编辑抽屉
│       │
│       ├── style/
│       │   └── StylePanel.tsx       # 写作风格：内置风格 + 自定义风格
│       │
│       ├── restrictions/
│       │   └── RestrictionsPanel.tsx # 风格限制 + 敏感词管理
│       │
│       ├── settings/
│       │   ├── ApiSettings.tsx      # API 配置管理 + Preset 参数
│       │   └── FontSettings.tsx     # 字体设置
│       │
│       └── ui/                      # shadcn/ui 基础组件（13 个）
│           ├── button.tsx
│           ├── dialog.tsx
│           ├── error-boundary.tsx
│           ├── input.tsx
│           ├── label.tsx
│           ├── scroll-area.tsx
│           ├── select.tsx
│           ├── separator.tsx
│           ├── slider.tsx
│           ├── switch.tsx
│           ├── tabs.tsx
│           ├── textarea.tsx
│           └── tooltip.tsx
│
├── public/fonts/                    # 字体文件
│   ├── SourceHanMono.ttc            # 思源等宽
│   └── xinghandengkuan.ttf         # 星汉等宽
│
├── samples/
│   └── outline-demo.txt             # 大纲格式示例
│
├── package.json
├── vite.config.ts                   # Vite + Electron 双入口配置
├── tsconfig.json
├── tsconfig.node.json
├── tailwind.config.js
├── postcss.config.mjs
└── vitest.config.ts
```

---

## 四、功能模块详解

### 4.1 主进程层（Electron Main）

#### 4.1.1 窗口管理 — `electron/main.ts`

- 创建无边框窗口，默认 1400×900，最小 1024×700
- 启动时最大化
- F12 切换开发者工具
- 退出前自动保存当前项目版本快照
- 便携式数据路径：`{安装目录}/data/`

#### 4.1.2 数据库层 — `electron/ipc/db.ts`

**数据库初始化**：使用 sql.js (WASM) 在主进程中运行 SQLite，数据库文件为 `inkark.db`。

**核心表结构**：

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `api_configs` | API 端点配置 | base_url, api_key, model, provider |
| `api_presets` | API 参数预设 | temperature, top_p, max_tokens, thinking_enabled |
| `projects` | 作品项目 | title, outline, word_count |
| `chapters` | 章节 | title, content, summary, sort_order, status |
| `character_cards` | 角色卡片 | name, alias, role, traits, appearance, background |
| `world_cards` | 世界观卡片 | name, card_type, description, parent_id |
| `task_bindings` | 任务-预设绑定 | task_type, preset_id |
| `sensitive_words` | 敏感词 | word, is_builtin |
| `version_blobs` | 版本内容块 | hash (SHA256), data, size |
| `version_commits` | 版本提交 | project_id, parent_id, manifest, message |

**数据库辅助方法**：`queryAll()`、`queryOne()`、`run()`、`transaction()`，每次写操作后自动持久化到磁盘。

**迁移机制**：通过 `ALTER TABLE ... ADD COLUMN` + try/catch 实现增量迁移，已添加字段包括 thinking_enabled、reasoning_effort、outline、gender、age、notes。

#### 4.1.3 版本控制系统 — `electron/ipc/version.ts`

采用 **内容寻址** 方案（类似 Git）：

- **Blob 存储**：每个数据片段（章节、角色卡等）的 JSON 序列化后计算 SHA256 哈希，去重存储
- **Manifest**：每次提交记录一个 manifest（key → hash 映射），描述项目完整状态
- **Commit**：线性提交链，记录 parent_id、message、created_at

**核心操作**：
- `commitProjectState()`：快照当前项目所有数据
- `restore()`：恢复到指定版本（先自动保存当前状态，再覆盖数据）
- `deleteCommit()`：删除单个提交，自动清理无引用的 blob
- `stats()`：统计提交数和 blob 总大小

#### 4.1.4 一致性检查 — `electron/ipc/consistency.ts`

框架式设计，每个检查项有 `version` 和 `name`，运行后记录到 `consistency_checks` 表防止重复执行。当前已实现：
- `word_count`（v1）：修正章节字数统计与实际内容不一致

#### 4.1.5 流式 API 代理 — `electron/main.ts`

主进程代理所有 LLM API 请求，避免渲染进程的 CORS 限制：

- `api:streamChat`：流式调用，通过 IPC 事件逐 token 推送到渲染进程，支持 `toolChoice` 参数透传
- `api:abortStream`：支持中断正在进行的流式请求
- 使用 `AbortController` 管理活跃流

---

### 4.2 桥接层（Preload）

`electron/preload.ts` 通过 `contextBridge.exposeInMainWorld` 暴露结构化 API：

```
window.electronAPI
├── minimize / maximize / close          # 窗口控制
├── apiConfig                            # API 配置 CRUD
├── preset                               # 预设 CRUD
├── project                              # 项目 CRUD + 导入导出
├── chapter                              # 章节 CRUD + 排序
├── character                            # 角色卡 CRUD
├── world                                # 世界观卡 CRUD
├── taskBinding                          # 任务绑定
├── version                              # 版本控制操作
├── file                                 # 文件保存/打开对话框
├── dialog                               # 原生确认对话框
├── sensitive                            # 敏感词管理
└── api                                  # LLM 调用（含流式事件监听）
```

---

### 4.3 状态管理层（Stores）

#### 4.3.1 `appStore` — 应用 UI 状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `sidebarView` | `'outline' \| 'characters' \| 'world' \| 'bookoutline' \| 'style' \| 'restrictions' \| 'none'` | 当前侧栏视图 |
| `editorView` | `'chapter' \| 'outline'` | 当前编辑器视图 |
| `isAIPanelOpen` | `boolean` | AI 面板是否展开 |
| `exportOpen` | `boolean` | 导出对话框是否打开 |

#### 4.3.2 `editorStore` — 编辑器核心状态

| 状态 | 类型 | 说明 |
|------|------|------|
| `projects` | `Project[]` | 项目列表 |
| `activeProjectId` | `string \| null` | 当前项目 ID |
| `chapters` | `Chapter[]` | 当前项目的章节列表 |
| `activeChapterId` | `string \| null` | 当前编辑的章节 ID |
| `isDirty` | `boolean` | 是否有未保存的修改 |
| `dataVersion` | `number` | 数据版本号（用于触发 UI 刷新） |
| `pendingChapterEdit` | `ChapterEdit \| null` | 待确认的章节编辑差异 |
| `pendingOutlineEdit` | `OutlineEdit \| null` | 待确认的大纲编辑差异 |

关键方法：
- `setActiveProject()`：切换项目时自动加载章节，选中最后一章
- `updateChapterContent()`：更新章节内容并重算字数
- `loadChapters()`：从数据库重新加载章节列表

#### 4.3.3 `settingsStore` — 字体设置

| 状态 | 默认值 | 说明 |
|------|--------|------|
| `editorFont` | `'XingHan DengKuan'` | 编辑器字体 |
| `editorFontSize` | `18` | 编辑器字号 |
| `editorFontWeight` | `400` | 编辑器字重 |
| `uiFont` | `'MiSans'` | UI 字体 |
| `uiFontSize` | `18` | UI 字号 |

设置变更时同步写入 `localStorage` 并通过 CSS 变量 (`--font-editor` 等) 实时生效。

---

### 4.4 核心业务逻辑层（Libs）

#### 4.4.1 LLM 调用封装 — `src/lib/api.ts`

**流式调用** `streamChatCompletion()`：
- 通过 `electronAPI.api.streamChat` 发起主进程代理请求
- 监听 `api:stream:{streamId}` 事件接收 token
- 支持 `onToken`、`onReasoning`（思考过程）、`onDone`、`onError` 回调
- 支持 `AbortSignal` 中断

**多候选调用** `streamChatCompletionN()`：
- 使用 `n` 参数一次返回多个候选版本
- 逐候选流式输出

**Prompt 构建**：
- `buildSystemPrompt()`：组装系统提示（书名、当前章节、大纲、风格要求、风格限制）
- `buildUserPrompt()`：组装用户提示（指令、选中文本、前文上下文）

**Tool Calling 循环**：
- `chatWithTools()`：非流式 Tool Calling 循环（最多 50 轮）
- `streamChatWithTools()`：流式 Tool Calling 循环（首轮流式，后续非流式）
- 工具调用超过 40 次时追加提醒

#### 4.4.2 上下文组装 — `src/lib/context.ts`

`assembleContext()` 函数负责在 AI 写作请求时组装完整上下文：
1. 获取项目信息（书名）
2. 获取章节列表，定位当前章节
3. 构建系统提示（含风格指导和限制）
4. 返回 `systemPrompt` 和分节 `sections`

#### 4.4.3 AI Tool Calling — `src/lib/tools.ts`

定义了 **16 个 AI 可调用工具**，分为以下类别：

| 类别 | 工具名 | 功能 |
|------|--------|------|
| **章节读取** | `list_chapters` | 查看章节标题和大纲 |
| | `read_chapter` | 读取章节完整正文 |
| **章节修改** | `update_chapter_outline` | 更新章节大纲（单章/批量） |
| | `update_chapter_title` | 修改章节标题（单章/批量） |
| | `create_chapter` | 批量创建空白章节 |
| | `edit_chapter` | 修改章节正文段落（差异替换） |
| **角色管理** | `list_characters` | 读取全部角色卡详情 |
| | `read_character` | 按名称读取指定角色卡 |
| | `update_character` | 更新角色卡信息 |
| | `create_character` | 创建新角色卡 |
| **世界观管理** | `list_worlds` | 读取全部世界观卡详情 |
| | `read_world` | 按名称读取指定世界观卡 |
| | `update_world` | 更新世界观卡信息 |
| | `create_world` | 创建新世界观卡 |
| **大纲管理** | `read_outline` | 查看全书大纲 |
| | `write_outline` | 创建或更新全书大纲（HTML 格式，需用户确认） |
| | `update_progress` | 更新写作进度（HTML 格式） |
| **交互** | `propose_action` | 向用户提交多个选项 |

**`edit_chapter` 的差异替换机制**：
1. AI 提供 `original_snippet`（原文片段）和 `modified_snippet`（修改后文本）
2. 系统在正文中定位原文，支持 4 种匹配策略：
   - HTML 直接匹配
   - 去标签纯文本匹配
   - 归一化空白后匹配
   - 前 40 字符前缀匹配
3. 返回 JSON 包含 original/modified 供前端展示差异确认

**`toolUsageGuide()`**：生成工具使用指南，注入到 AI 的 system prompt 中。

#### 4.4.4 编辑器引用 — `src/lib/editorRef.ts`

全局单例模块，管理编辑器实例和跨组件通信：

| 功能 | 说明 |
|------|------|
| `editor` 引用 | 全局 TipTap Editor 实例 |
| `styleGuidance` | 当前写作风格指导文本 |
| `styleRestrictions` | 写作限制（持久化到 localStorage） |
| `pendingAction` | 待执行的快捷操作（润色/缩写/扩写/发送到聊天框） |
| `pendingDiffResolve` | 章节差异确认回调（采纳/回退） |
| `pendingOutlineResolve` | 大纲差异确认回调（采纳/回退） |
| **变更通知队列** | `pushChange()` / `consumeChanges()` / `clearChanges()` — 记录 Tool Calling 导致的数据变更，在下轮对话中通知 AI |

---

### 4.5 UI 组件层

#### 4.5.1 根布局 — `App.tsx`

三栏可拖拽布局：

```
┌──────────────────────────────────────────────────────────┐
│  TitleBar                                                 │
├──────────┬──────────────────────┬────────────────────────┤
│  Sidebar │       Editor         │      AIPanel           │
│  (可拖拽) │                      │      (可拖拽)           │
├──────────┴──────────────────────┴────────────────────────┤
│  StatusBar                                                │
└──────────────────────────────────────────────────────────┘
```

- 侧栏默认宽度：1920px 以下 280px，以上 320px
- AI 面板默认宽度：1920px 以下 480px，以上 640px
- 拖拽手柄支持鼠标拖拽调整面板宽度，松手后持久化到 localStorage
- 初始化流程：加载项目列表 → 无项目则创建默认项目 → 无章节则创建第一章 → 无 API 配置则打开设置面板

#### 4.5.2 编辑器 — `Editor.tsx`

基于 TipTap 的富文本编辑器，支持章节编辑和大纲编辑两种视图：

**章节编辑视图**：
- **扩展配置**：StarterKit（仅 h1 标题）、Underline、Placeholder、StaticCursor
- **自动保存**：3 秒 debounce 检测变更 → 通过 IPC 写入 SQLite
- **章节标题编辑**：独立的标题输入框
- **章节摘要**：底部可展开的摘要区域，支持 AI 自动生成摘要
- **右键菜单**：选中文本后弹出润色/缩写/扩写/发送到聊天框
- **差异确认**：AI 通过 `edit_chapter` 工具修改正文后，展示 diff 供用户确认/回退
- **导出**：通过 ExportDialog 导出为 TXT/MD/DOCX

**大纲编辑视图**：
- **富文本编辑**：TipTap 编辑器，支持 H1/H2/H3 标题、加粗、斜体、下划线
- **AI 生成大纲**：通过 BookIdeaDialog 输入书名/章节数/创意，AI 生成 HTML 格式大纲
- **变更审阅**：AI 修改大纲时显示 diff 视图，支持接受或拒绝
- **大纲重新生成**：可重新生成整个大纲

#### 4.5.3 AI 面板 — `AIPanel.tsx`

AI 对话面板是项目最复杂的组件，核心功能：

- **双模式**：写作模式（Tool Calling）和聊天模式
- **流式响应**：逐 token 显示 AI 输出
- **DeepSeek 思考模式**：显示推理过程（reasoning_content）
- **Tool Calling**：AI 可调用 16 种工具操作项目数据
- **差异确认**：`edit_chapter` 工具的修改需用户确认后才应用
- **多候选**：快捷指令支持生成多个候选版本
- **快捷指令**：用户可自定义快捷按钮（持久化到 localStorage）
- **选项提案**：`propose_action` 工具展示选项供用户选择
- **变更通知**：Tool Calling 产生的数据变更在下一轮对话中通知 AI

#### 4.5.4 侧栏 — `Sidebar.tsx`

六个视图切换：
- **目录视图**：章节列表，支持新增/删除/点击切换
- **角色视图**：嵌入 `CharacterPanel`
- **世界观视图**：嵌入 `WorldPanel`
- **全书大纲**：切换到大纲编辑视图
- **写作风格**：嵌入 `StylePanel`，内置风格 + 自定义风格
- **限制管理**：嵌入 `RestrictionsPanel`，风格限制 + 敏感词管理

#### 4.5.5 标题栏 — `TitleBar.tsx`

自定义无边框标题栏，功能包括：
- 窗口控制（最小化/最大化/关闭）
- 项目下拉菜单：新建/重命名/删除/导入/导出
- 版本历史入口
- AI 创作规划入口（`BookIdeaDialog`）
- 设置入口

#### 4.5.6 其他组件

| 组件 | 功能 |
|------|------|
| `ExportDialog` | 导出为 TXT / Markdown / DOCX，支持设置书名和作者 |
| `StylePanel` | 内置风格选择 + 自定义写作风格 |
| `RestrictionsPanel` | 风格限制 + 敏感词管理 |
| `ContextMenu` | 编辑器右键菜单（润色/缩写/扩写/发送到聊天框） |
| `BookIdeaDialog` | AI 创作规划：输入书名、章节数、创意描述 |
| `CharacterPanel` | 角色卡网格列表 + 搜索/标签筛选 + 右键菜单 |
| `CharacterCardEditor` | 角色卡编辑抽屉（name/alias/role/traits/appearance 等） |
| `WorldPanel` | 世界观卡列表 + 类型筛选 + 搜索 |
| `WorldCardEditor` | 世界观卡编辑抽屉 |
| `ApiSettings` | API 配置 + Preset 参数管理 + 连接测试 |
| `FontSettings` | 编辑器/UI 字体和字号设置 |
| `RestrictionsPanel` | 敏感词管理 + 规则与限制编辑 |
| `ProjectCommits` | 版本历史列表 + 恢复/删除 + 变更摘要 |
| `StatusBar` | 保存状态 + 字数统计 + 版本号 |

---

## 五、数据流

### 5.1 写作流程

```
用户输入 → TipTap Editor → onUpdate → editorStore.updateChapterContent()
                                              ↓
                                    3s debounce 自动保存
                                              ↓
                              electronAPI.chapter.save() → IPC → SQLite
```

### 5.2 AI 写作流程

```
用户发送指令 → AIPanel
    ↓
assembleContext() → 构建 systemPrompt
    ↓
streamChatWithTools() → 主进程代理 → LLM API
    ↓
流式 token → onToken → UI 实时显示
    ↓
Tool Call → executeToolCall() → 操作数据库 → pushChange()
    ↓
Tool Result → 继续对话循环
    ↓
最终文本 → 用户确认/回退
```

### 5.3 版本控制流程

```
用户手动/自动触发 → electronAPI.version.commit()
    ↓
commitProjectState() → 收集项目所有数据
    ↓
每条数据 → SHA256 哈希 → INSERT OR IGNORE version_blobs
    ↓
构建 manifest → INSERT version_commits
    ↓
恢复时 → 先自动保存当前状态 → 读取目标 manifest → 逐条恢复数据
```

---

## 六、IPC 通信接口一览

| 通道 | 方向 | 功能 |
|------|------|------|
| `db:apiConfig:*` | 双向 | API 配置 CRUD + 测试连接 |
| `db:preset:*` | 双向 | 预设 CRUD |
| `db:project:*` | 双向 | 项目 CRUD + 导入导出 |
| `db:chapter:*` | 双向 | 章节 CRUD + 排序 |
| `db:character:*` | 双向 | 角色卡 CRUD |
| `db:world:*` | 双向 | 世界观卡 CRUD |
| `db:taskBinding:*` | 双向 | 任务绑定 CRUD |
| `db:sensitive:*` | 双向 | 敏感词管理 |
| `db:version:*` | 双向 | 版本控制操作 |
| `api:streamChat` | 渲染→主 | 流式 LLM 调用（支持 toolChoice） |
| `api:stream:{id}` | 主→渲染 | 流式 token 推送 |
| `api:abortStream` | 渲染→主 | 中断流式请求 |
| `window:*` | 渲染→主 | 窗口控制 |
| `file:*` | 双向 | 文件保存/打开 |
| `dialog:*` | 双向 | 原生对话框 |

---

## 七、构建与部署

### 开发模式

```bash
npm run dev              # Vite 热重载（浏览器预览）
npm run electron:dev     # 构建后启动 Electron
```

### 生产构建

```bash
npm run electron:build   # Vite 构建 + electron-builder 打包
```

打包配置：
- 目标平台：Windows NSIS 安装包
- AppId：`com.inkark.app`
- 输出目录：`release/`
- ASAR 打包（smartUnpack）

### 测试

```bash
npm test                 # Vitest 单次运行
npm run test:watch       # Vitest 监听模式
```

测试文件位于 `src/lib/` 下：`api.test.ts`、`ipc.test.ts`、`utils.test.ts`。

---

## 八、设计亮点与模式

1. **内容寻址版本控制**：类似 Git 的 blob + manifest 设计，自动去重，节省存储空间
2. **Tool Calling 双向交互**：AI 可主动操作项目数据（创建章节/角色/世界观、修改正文），用户通过差异确认机制保持控制权
3. **变更通知队列**：Tool Calling 产生的数据变更在下一轮 AI 对话中自动通知，确保 AI 感知自己的操作结果
4. **流式 + 非流式混合 Tool Calling**：首轮流式输出提升体验，后续工具回复使用非流式减少延迟
5. **便携式数据存储**：数据库文件存储在可执行文件同目录，便于 U 盘携带
6. **多策略文本匹配**：`edit_chapter` 工具使用 4 层匹配策略（HTML 直匹配 → 纯文本 → 归一化 → 前缀），提高 AI 修改正文的成功率
7. **一致性检查框架**：可扩展的数据库一致性检查，应用启动时自动修复
