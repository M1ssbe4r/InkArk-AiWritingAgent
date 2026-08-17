# InkArk E2E 测试方案 —— AI 测试

## 一、现有 AI 测试的问题

| 问题 | 影响 |
|---|---|
| 工具调用完全依赖模型自主选择 | 模型可能不调工具或调错工具，断言不可靠，CI 不稳定 |
| 大量 `waitForTimeout` | 测试缓慢（累计等待数十秒），机器性能波动时仍可能不够 |
| 通过 UI 交互发送消息再等待回复 | 端到端链路太长，每一步都可能失败 |
| `window.evaluate` 操作 DOM 发消息 | 绕过了 Playwright 的可操作性检查 |
| 无 `data-testid` | 选择器绑定 CSS 类名，样式变更即断裂 |

## 二、核心改进思路

### 2.1 使用 `tool_choice` 强制调用工具

`api:streamChat` 已支持 `toolChoice` 参数透传。工具调用测试直接通过 IPC 调用 API，传入：

```json
"toolChoice": { "type": "function", "function": { "name": "create_chapter" } }
```

模型 100% 会调用指定工具，完全消除非确定性。

### 2.2 跳过 UI 交互，直接调 IPC

工具调用测试不再通过 AI 面板输入文本 → 等待模型回复 → 解析 tool_calls，而是：

1. 通过 `window.electronAPI.api.streamChat` 直接发请求
2. 传入 `toolChoice` 强制工具 + 精确的 `arguments`
3. 从 stream 事件中收集 `tool_calls` 结果
4. 断言工具被执行且结果正确

### 2.3 Chat/Write 模式保留 UI 交互

内容回复类测试（Chat 模式对话、Write 模式续写）保留通过 AI 面板 UI 操作的方式，因为测试目标是端到端的用户交互流程。但改进点：

- 用 `getByText`/`getByPlaceholder` 替代 CSS 类名选择器
- 用 Playwright 原生 `fill()` 替代 `window.evaluate` 赋值
- 用 `waitForFunction` 轮询替代 `waitForTimeout`

## 三、测试分类

### 3.1 命令配置

```typescript
// playwright.config.ts
projects: [
  {
    name: 'ui',
    testDir: './e2e',
    testMatch: /\.spec\.ts$/,
    testIgnore: /ai-.*\.spec\.ts$/,
    timeout: 30000,
  },
  {
    name: 'ai',
    testDir: './e2e',
    testMatch: /ai-.*\.spec\.ts$/,
    timeout: 120000,
  },
]
```

```json
// package.json
{
  "e2e": "npm run build && playwright test",
  "e2e:ui": "npm run build && playwright test --project=ui",
  "e2e:ai": "npm run build && playwright test --project=ai"
}
```

### 3.2 用例清单

#### `ai-models.spec.ts` —— 模型可用性（与现有逻辑一致）

| # | 用例 | 说明 | 优先级 |
|---|---|---|---|
| 1 | 配置有效 | test.config.json 存在且至少一个模型 | P0 |
| 2 | 非思考模式回复 | 发简单问题，断言回复长度 > 0 | P0 |
| 3 | 思考模式回复 | 开启思考 → 发问题 → 断言回复长度 > 0 | P0 |
| 4 | 多模型测试 | 遍历配置中所有 model1~modelN | P1 |

#### `ai-chat.spec.ts` —— Chat 模式（UI 交互）

| # | 用例 | 说明 | 优先级 |
|---|---|---|---|
| 1 | 发送消息并收到回复 | 输入文本 → Enter → 回复显示 | P0 |
| 2 | 多轮对话保持上下文 | "我叫小明" → "我叫什么？" → 回复含"小明" | P0 |
| 3 | 新建对话清除上下文 | 多轮后点"新对话" → 上下文提示出现 | P0 |
| 4 | Chat 模式拒绝写入工具 | 发送"创建新章节" → 检查 stream 事件，无 `tool_calls`，回复为文字说明 | P0 |

#### `ai-thinking.spec.ts` —— 思考模式（UI 交互）

| # | 用例 | 说明 | 优先级 |
|---|---|---|---|---|
| 1 | 开启思考后思考内容可见 | 开启思考 → 发问题 → 回复中 `reasoning_content` 非空 | P0 |
| 2 | 关闭思考后无思考内容 | 关闭思考 → 发问题 → 回复中无 `reasoning_content` | P0 |

#### `ai-tools.spec.ts` —— 工具调用（IPC 直调 + tool_choice）

这是本次改造的核心。所有用例均通过 `window.electronAPI.api.streamChat` 直接调用，不经过 AI 面板 UI。

采用**写读配对**策略：每个用例先调用写工具变更数据，再调用读/列工具验证变更结果。单个用例同时验证写入端和读取端。

| # | 用例 | 写工具 | 验工具 | 验证方式 | 优先级 |
|---|---|---|---|---|---|
| 1 | 创建章节并验证 | `create_chapter` | `list_chapters` | 章节数 + 指定数量 | P0 |
| 2 | 写标题并验证 | `write_chapter_title` | `list_chapters` | 标题已更新 | P0 |
| 3 | 写大纲并验证 | `write_chapter_outline` | `list_chapters` | 大纲已更新 | P1 |
| 4 | 写正文并验证 | `write_chapter_content` | `read_chapter_content` | 正文匹配 | P0 |
| 5 | 创建角色卡并验证 | `write_character_card` | `list_character_card` + `read_character_card` | 角色在列表中，详情匹配 | P0 |
| 6 | 创建世界观并验证 | `write_world_setting` | `list_world_setting` + `read_world_setting` | 世界观在列表中，详情匹配 | P0 |
| 7 | 写全书大纲并验证 | `write_outline` | `read_outline` | 大纲内容匹配 | P0 |
| 8 | 更新进度并验证 | `update_progress` | `read_outline` | 进度出现在大纲中 | P1 |
| 9 | 链式调用 | `create_chapter` → `write_chapter_title` → `write_chapter_outline` | `list_chapters` | 三步全部完成，数据一致 | P1 |
| 10 | 提交选项 | `propose_action` | 解析返回的 `tool_calls` | 返回的选项中包含预期内容 | P2 |

用例 1-9 是标准配对/链式模式：写 -> IPC 读 -> DB 断言。用例 10 是特殊工具，只需断言 tool_calls 返回值。

#### `ai-panel-ui.spec.ts` —— AI 面板 UI + 历史对话

| # | 用例 | 说明 | 优先级 |
|---|---|---|---|
| 1 | Write/Chat 模式切换按钮可见 | - | P0 |
| 2 | 输入框可见 | placeholder 正确 | P0 |
| 3 | 快捷指令按钮存在 | 默认按钮可见 | P1 |
| 4 | 底部模型信息或未配置提示 | - | P1 |
| 5 | 思考模式开关可见 | toggle 存在 | P1 |
| 6 | 发送按钮状态 | 输入为空时禁用或不可点击 | P1 |
| 7 | 打开历史面板 | 点击"📋 历史" | 历史面板弹出，显示会话列表 | P0 |
| 8 | 空历史状态 | 无历史时 | "暂无历史对话"可见 | P0 |
| 9 | 新建对话自动保存历史 | 对话 → 新对话 → 打开历史 | 历史列表包含刚才的会话 | P0 |
| 10 | 加载历史会话 | 点击历史会话 | 消息恢复，可继续对话 | P0 |
| 11 | 加载历史后上下文连贯 | 加载历史 → 发"我刚才说了什么？" | AI 能引用历史内容 | P1 |
| 12 | 删除历史会话 | 悬停 → 点击 X | 会话从列表移除，再次打开不再显示 | P0 |
| 13 | 切换项目后历史隔离 | 项目 A 对话 → 切项目 B → 切回 A | 项目 A 的历史仍然存在 | P1 |
| 14 | 多轮对话后新建，历史列表有多条 | 多次新对话 | 历史列表显示多条会话记录 | P1 |

## 四、辅助函数设计

### 4.1 `toolCallWithChoice` —— 强制工具调用

```typescript
export async function toolCallWithChoice(
  window: Page,
  config: TestConfig,
  toolName: string,
  args: Record<string, unknown>,
  options?: { model?: string }
): Promise<{
  tool_calls: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  content: string
}>
```

内部流程：
1. 获取 API 配置（baseUrl、apiKey、model）
2. 构建 messages：一条 system prompt + 一条 user prompt（内容为工具调用指令）
3. 调用 `window.electronAPI.api.streamChat`，传入 `tools` + `toolChoice: { type: 'function', function: { name: toolName } }`
4. 监听 stream 事件，收集所有 `tool_call` 事件数据
5. 返回 `tool_calls` 数组和 content

### 4.2 现有辅助函数

`ai-helpers.ts` 中已有的函数保持不变：

- `injectApiConfig` —— 配置 API（支持直连和 InkArk 服务器双模式）
- `triggerConfigReload` —— 触发配置重载
- `waitForApiConfigLoaded` —— 等待模型加载
- `switchToChatMode` —— 切换到 Chat 模式
- `sendAiMessage` —— 通过 UI 发送消息
- `waitForAssistantReply` —— 等待 AI 回复
- `loginToServer` —— InkArk 服务器登录
- `getFirstProjectId` —— 获取首个项目 ID

## 五、Playwright 配置

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'ui',
      testDir: './e2e',
      testMatch: /\.spec\.ts$/,
      testIgnore: /ai-.*\.spec\.ts$/,
    },
    {
      name: 'ai',
      testDir: './e2e',
      testMatch: /ai-.*\.spec\.ts$/,
      timeout: 120000,
    },
  ],
})
```

## 六、实施顺序

| 步骤 | 内容 | 说明 |
|---|---|---|
| 1 | 实现 `toolCallWithChoice` 辅助函数 | 新增到 `ai-helpers.ts` |
| 2 | 重写 `ai-tools.spec.ts`（11 用例） | 全部使用 IPC 直调 + tool_choice，写读配对 |
| 3 | 重写 `ai-chat.spec.ts`（4 用例） | 保留 UI 交互，改用 data-testid |
| 4 | 重写 `ai-thinking.spec.ts`（2 用例） | 同上 |
| 5 | 迁移 `ai-models.spec.ts`（动态） | 基本保持现状 |
| 6 | 重写 `ai-panel-ui.spec.ts`（14 用例） | UI 交互 + 历史对话全流程 |
