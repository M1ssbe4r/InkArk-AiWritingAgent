# InkArk

一个开源的 AI 长篇小说写作桌面应用,基于 Electron + React 19 + TypeScript。

## AI Agent 化设计

**AI 不只是聊天框里的对话者,而是能直接动项目数据的 Agent。** InkArk 的核心架构是给 LLM 暴露 16 个结构化工具,让它在统一的规划下连续完成"查资料 → 改设定 → 写正文 → 调整大纲"这一整条链路,而不是拆成 N 轮"用户说一段、AI 写一段"的来回。

工具集覆盖写作全流程:

| 阶段 | 工具 | 用途 |
|---|---|---|
| 探索 | `list` / `read` / `search` | 让 AI 先了解现有项目结构、读章节内容、搜人物/设定/知识库 |
| 规划 | `create_volume` / `write_volume` / `create_chapter` | 一轮一卷地建立卷级大纲,再按需创建空章节占位 |
| 写作 | `write_chapter_content` / `write_chapter_outline` | 按段落 ID 增删改正文(强制分段落,避免整章覆盖) |
| 设定 | `write_character_card` / `write_world_setting` / `write_chapter_title` | 增改人物、世界观、章节标题 |
| 审核 | `propose_action` | 当 AI 不确定方案时(标题候选、剧情走向),先列选项让用户挑 |
| 风险 | `delete` | 删实体(角色/章节/卷),强制要求 `reason` 字段 + 用户确认 |

几个设计决策:

- **Diff 审核门控**:所有 `write_*` 工具调用产生"待审核"结果(在 `pendingOutlineEdit` / `pendingChapterEdit` / `pendingVolumeEdit` 等 store 中),用户在 UI 看到改动预览后才落盘,AI 不会"擅自改稿"。
- **强制序列化**:`write_volume` 限制一轮工具调用只能写一卷;`write_chapter_content` 禁止对非空章节直接传 `content` 覆盖(必须按 `edits` / `inserts` 按段修改),保护既有正文不被 AI 整章重写。
- **删除必须有理由 + 确认**:`delete` 工具强制 `reason` 字段,且前端在执行前弹窗二次确认,避免 AI 误删。
- **本地工具链**:`search` 走本地 FTS5 索引,`read` 直读 SQLite,工具执行不依赖任何外部服务,断网也能用。

## 功能特性

- 章节编辑器(TipTap 富文本 + 自动保存)
- AI 写作助手:续写 / 扩写 / 缩写 / 润色,多候选结果
- 16 个 AI 工具,详见 [AI Agent 化设计](#ai-agent-化设计)
- 思考模式:支持 reasoning / thinking 输出(DeepSeek 等)
- 全书大纲:分剧情段规划结构
- 角色卡 / 世界观卡:分类管理
- 版本快照:内容寻址的版本控制,支持 diff 对比与回退
- 完整项目备份:`.inkark` 文件,跨设备导入
- 格式导出:TXT / Markdown(YAML frontmatter)/ DOCX
- 样式预设 + 敏感词 + 写作限制
- 多 API 配置:每个任务可绑定不同参数预设
- 专注模式:隐藏侧栏全屏写作
- 自定义字体:支持 TTF / OTF / WOFF2
- 全文搜索(FTS5)+ 知识库管理

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 33 |
| UI | React 19 + TypeScript + Tailwind CSS 3.4 |
| 编辑器 | TipTap (ProseMirror) |
| 状态管理 | Zustand 5 |
| 数据库 | SQLite (sql.js, WASM) |
| AI | OpenAI 兼容 API (DeepSeek / OpenAI / 任何兼容服务) |
| 构建 | Vite 6 + vite-plugin-electron |
| 测试 | Vitest + Playwright (E2E) |

## 开始使用

### 环境要求

- Node.js ≥ 20
- npm ≥ 10
- Windows 10+ / macOS 12+ / Linux(主流发行版)

### 安装与开发

```bash
# 安装依赖
npm install

# 浏览器 Vite 热重载开发模式(无 Electron)
npm run dev

# 构建并启动 Electron
npm run electron:dev

# 打包分发版本
npm run electron:build
```

### 配置 LLM API

应用首次启动时,在 **设置 → API 配置** 中添加你的 OpenAI 兼容端点:

- **DeepSeek**: base URL `https://api.deepseek.com`,模型 `deepseek-v4-flash` / `deepseek-v4-pro`
- **OpenAI**: base URL `https://api.openai.com/v1`,模型 `gpt-4o` / `gpt-4o-mini`
- **其它兼容服务**:任何支持 `/v1/chat/completions` 的服务(自部署 Ollama / vLLM / 第三方网关)

支持 thinking / reasoning_effort / temperature / top_p / max_tokens 等参数预设,不同任务(续写/大纲/润色)可绑定不同预设。

## 项目结构

```
inkark-opensource/
├── electron/                # Electron 主进程
│   ├── main.ts              # 窗口 / IPC 注册 / 应用生命周期
│   ├── preload.ts           # contextBridge — 暴露 API 到渲染进程
│   ├── logger/              # 本地日志(纯本地,不外发)
│   └── ipc/                 # SQLite / 版本控制 / 一致性 / 字体 / 知识库
├── src/                     # React 渲染进程
│   ├── App.tsx
│   ├── components/
│   │   ├── editor/          # TipTap 编辑器
│   │   ├── ai-panel/        # AI 对话面板
│   │   ├── outline/         # 全书大纲
│   │   ├── character/       # 角色卡
│   │   ├── world/           # 世界观卡
│   │   ├── knowledge/       # 知识库管理
│   │   ├── layout/          # 标题栏 / 侧栏 / 状态栏
│   │   └── settings/        # API / 字体 / 主题 / 关于
│   ├── stores/              # Zustand 状态管理
│   ├── lib/                 # API / 工具调用 / 工具函数
│   ├── extensions/          # TipTap 自定义扩展
│   └── assets/              # 图片等资源
├── e2e/                     # Playwright E2E 测试
├── docs/                    # 技术设计文档
├── samples/                 # 示例文件
├── fonts/                   # 自定义字体
├── package.json
└── README.md
```

## 数据存储

- 数据库文件:`{安装目录}/data/inkark.db`(便携模式,跟着应用走,可在多台设备间迁移)
- 用户数据目录:`{userData}`(Windows `%APPDATA%/InkArk/`,macOS `~/Library/Application Support/InkArk/`)
- 日志目录:同 userData 下的 `logs/`

NSIS 安装包更新时会自动备份并恢复 `data/` 与 `fonts/`,见 `build/installer.nsh`。

## 测试

```bash
# 单元测试
npm test

# 单测覆盖率
npm run test:coverage

# 类型检查
npx tsc --noEmit

# 生产构建
npm run build

# E2E 测试(需先 build)
npm run e2e
```

E2E 测试需要 `e2e/test.config.json` 配置 API key,模板见 `e2e/test.config.example.json`。未配置 API key 时,依赖 AI 的测试会被自动跳过。

## 项目备份格式 `.inkark`

完整项目导出为 `.inkark` 文件,包含:
- 所有章节(正文 / 大纲 / 标题 / 状态)
- 角色卡 / 世界观卡
- 知识库(本地 FTS 索引)
- AI 任务绑定

跨设备导入:点击左上角作品名 → 导入作品 → 选择 `.inkark` 文件。每次导入生成新项目 ID,不覆盖现有项目。

## 贡献

欢迎 PR!主要方向:
- 新 LLM provider / 模型适配
- 编辑器功能增强(大纲、批注、协作)
- 知识库检索改进
- 多语言(i18n)
- 跨平台打包与发布

提交前请跑 `npm test` 和 `npx tsc --noEmit` 确保通过。

## 许可证

[MIT](./LICENSE) — 你可以自由使用、修改、分发本项目,只要保留版权声明。
