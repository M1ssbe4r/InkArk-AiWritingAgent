# 对话历史拼接重构方案

## 1. 现状与问题

### 1.1 当前架构

消息流经两层：

```
UI 层 (AIPanel.tsx)                    API 层 (lib/api.ts)
┌───────────────────────────┐         ┌──────────────────────────┐
│ ChatMsg[] (UI 消息列表)    │         │ ChatMessage[] (API 格式)  │
│ - reasoning: string[]     │         │ - reasoning_content       │
│ - isToolCall: boolean     │  ──转换──▶  │ - tool_calls              │
│ - isThinking: boolean     │  chatHistory│ - tool_call_id            │
│ - isInlineText: boolean   │  reduce()  │                          │
│ - toolCalls / toolResult  │         └──────────────────────────┘
│ - toolSummary             │
└───────────────────────────┘
```

核心矛盾：**API 层的消息结构是规范的 `assistant(reasoning_content, content, tool_calls)` ↔ `tool(tool_call_id, content)` 交替序列**，但 UI 层为了渲染需求将同一次 API response 拆成了多条 ChatMsg（thinking 消息、tool call 消息、inline text 消息、最终回答消息），然后用一个约 80 行的 `reduce` 函数反向拼回 API 格式。

**`chatHistory` reduce 的职责**：从 `ChatMsg[]` 重建 `ChatMessage[]`，用于下一轮请求的上下文。

### 1.2 场景覆盖矩阵

| 场景 | 同轮子请求 (streamChatWithTools) | 跨轮拼接 (chatHistory reduce) |
|------|------|------|
| 1. 不思考 + 单工具调用 | ✅ 正确 | ✅ 正确 |
| 2. 不思考 + 多工具调用 | ✅ 正确 | ✅ 正确 |
| 3. 思考 + 单工具调用 | ✅ 正确 | ✅ 基本正确（微小 code smell） |
| 4. 思考 + 多工具调用（多子轮） | ✅ 正确 | ❌ **Bug** |

### 1.3 Bug 详情（场景 4）

**问题**：`chatHistory` reduce 在遇到多个 `isToolCall` 消息时，会向前扫描寻找 "已有 `tool_calls` 的 assistant 消息" 并合并——最初此逻辑是为处理**同一 API response 返回多个 tool_calls**（场景 2）设计的。但当多子轮时，不同子轮的 tool call 消息也会被错误合并到同一个 assistant 消息上。

**后果**：
1. 中期子轮的 `reasoning_content` 丢失（只有第一个子轮的被保留）
2. 生成的 API messages 结构不符合规范（多个 `tool` 结果连在一起，中间缺少 `assistant(reasoning_content, tool_calls)` 分隔）
3. 可能导致 API 400 错误或模型行为异常（思考模式下有工具调用的 `reasoning_content` 必须完整回传）

**根因**：推断逻辑（"前面有没有带 tool_calls 的 assistant"）是启发式的，无法可靠区分同子轮多 tool call 和不同子轮的 tool call。

---

## 2. 核心洞察

`streamChatWithTools`（[api.ts:L238-L346](file:///d:/Project/写文助手/src/lib/api.ts#L238-L346)）内部维护的 `messages` 数组已经是**规范 API 格式**。它在每个子轮结束后正确地 append `assistant(reasoning_content, content, tool_calls)` 和 `tool(tool_call_id, content)`。

这意味着：**整个工具调用循环结束后，`messages` 数组就是一个可以直接用于下一轮请求的完整历史。**

问题在于，这个正确的结果被丢弃了——`streamChatWithTools` 返回 `''`（空字符串），AIPanel.tsx 不得不从 ChatMsg[] 反向重建。

---

## 3. 重构方案

### 3.1 核心思想

**让 API 层产生并返回规范消息，UI 层只做追加，不做反向重建。**

具体而言：
- `streamChatWithTools` 返回本轮工具调用产生的所有 `ChatMessage[]`（新的增量部分）
- AIPanel.tsx 维护一个 `apiConversationRef`，直接存储这些规范格式的消息
- 下一轮请求时直接用 `apiConversationRef.current`，不再需要 `chatHistory` reduce
- `chatHistory` reduce 函数 **删除**

### 3.2 数据流对比

**当前（有问题）：**
```
第一轮: ChatMsg[] ──reduce──▶ ChatMessage[] ──▶ API
                          ↓ (返回 ''，丢弃)
第二轮: ChatMsg[] ──reduce──▶ ChatMessage[] ──▶ API  ← 每次都要重建！
```

**重构后：**
```
第一轮: ChatMsg[] + (初始历史) ──▶ ChatMessage[] ──▶ API
                                        ↓ (streamChatWithTools 返回增量)
                    apiConversationRef ←── ChatMessage[] 增量
                                        ↓
第二轮: apiConversationRef + 新用户消息 ──▶ API  ← 直接用！
```

### 3.3 关键设计决策

#### 决策 1：`apiConversationRef` 存储什么？

存储**完整**的 API 格式对话历史（`ChatMessage[]`），不包含当前的 system prompt。

理由：
- 简单：下一轮请求直接 `[...apiConversationRef.current, { role: 'user', content: newPrompt }]`
- 与 `streamChatWithTools` 内部 `messages` 语义一致
- 方便调试（可以直接 inspect 完整的 API messages）

#### 决策 2：`streamChatWithTools` 返回什么？

返回本轮工具调用**新增**的 `ChatMessage[]`（包括最终的 assistant 回复和所有中间 tool call/tool result 对）。

当前签名：`Promise<string>`
新签名：`Promise<ChatMessage[]>`

#### 决策 3：历史持久化（localStorage）如何处理？

当前 `serializeMessages` / `deserializeMessages` 序列化的是 UI 层 `ChatMsg[]`。重构后：

- 继续序列化 ChatMsg[] 用于 UI 显示，额外序列化 `apiConversation` 用于 API 上下文恢复
- 由于当前只有开发和测试人员使用，**不需要兼容旧格式迁移**——加载时如果 `apiConversation` 不存在，直接清空历史（旧 localStorage 数据丢弃即可）

#### 决策 4：`chatHistory` reduce 是否完全删除？

**完全删除**。由于没有存量用户，不需要保留迁移工具函数。

---

## 4. 具体改动

### 4.1 `src/lib/api.ts` — 修改 `streamChatWithTools` 返回增量消息

**改动点**：
- 签名从 `Promise<string>` 改为 `Promise<ChatMessage[]>`，返回本轮新增的 messages
- 第一轮迭代前记录 `messages` 初始长度，结束后返回 `messages.slice(initialLen)`
- 不改变内部 `messages` 的追加逻辑（已经正确）

**伪代码**：
```typescript
export async function streamChatWithTools(...): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [...options.messages]
  const initialLen = messages.length
  // ... 循环逻辑不变 ...

  return messages.slice(initialLen)  // 返回本轮新增的消息
}
```

**注意**：`options.messages` 末尾是 `{ role: 'user', content: '...' }`（当前用户提问），所以 `messages.slice(initialLen)` 不包含用户消息（因为 `messages` 从 `options.messages` 复制，初始长度已包含它）。返回的增量只包含 assistant + tool 系列消息。

**⚠️ 时序前提**：`streamChatWithTools` 内部通过 `onDone` 回调向 `messages` 数组 push 消息。`onDone` 在 `streamChatCompletion` 的 Promise resolve 之前被调用（stream 结束时触发 `onDone`，然后 resolve Promise）。因此 `await streamChatCompletion(...)` 返回时，`messages.push(...)` 已经执行完毕，`messages.slice(initialLen)` 能正确捕获所有增量。如果未来修改 `streamChatCompletion` 的时序逻辑，需要重新验证此处。

### 4.2 `src/components/ai-panel/AIPanel.tsx` — 核心重构

#### 4.2.1 新增 `apiConversationRef`

```typescript
const apiConversationRef = useRef<ChatMessage[]>([])
```

其生命周期：
- 用户发送新消息时：`apiConversationRef.current` 末尾追加 `{ role: 'user', content: augmentedPrompt }`
- `streamChatWithTools` 返回后：`apiConversationRef.current` 末尾追加返回的增量
- 加载历史时：从 localStorage 恢复（或一次性迁移）
- 清空聊天时：重置为 `[]`

#### 4.2.2 修改 `runStream` 函数

当前结构（简化）：

```typescript
// 旧：构建 chatHistory（从 ChatMsg[] reduce）
const chatHistory = allMsgs.filter(...).slice(-40).reduce(...)

// 旧：构建 toolMessages
const toolMessages = [
  { role: 'system', ... },
  ...chatHistory,           // ← 在这里拼接
  { role: 'user', ... },
]

// 旧：调用
await streamChatWithTools({ messages: toolMessages, ... }, executeTool)
```

重构后：

```typescript
// 新：直接使用 apiConversationRef
apiConversationRef.current.push({ role: 'user', content: augmentedPrompt })

const toolMessages = [
  { role: 'system', content: systemPrompt + '\n\n' + toolUsageGuide() },
  ...apiConversationRef.current.slice(-40),  // ← 直接切片，无需 reduce
]

const newMessages = await streamChatWithTools({ messages: toolMessages, ... }, executeTool)

apiConversationRef.current.push(...newMessages)

trimConversation(apiConversationRef)
```

**⚠️ 截断安全性**：不能直接 `slice(-N)` 截断，因为截断位置可能落在 `assistant(tool_calls)` 和其对应的 `tool(tool_call_id)` 之间，产生无效的 API messages（`tool` 消息引用了不存在的 `tool_call_id`，导致 API 报错）。需要使用安全的截断函数：

```typescript
function trimConversation(ref: React.MutableRefObject<ChatMessage[]>, maxLen = 50) {
  if (ref.current.length <= maxLen) return
  let cutAt = ref.current.length - maxLen
  // 向前扫描，确保不在 assistant(tool_calls) 和 tool 之间截断
  while (cutAt > 0) {
    const msg = ref.current[cutAt]
    if (msg.role === 'tool') {
      // tool 消息必须跟在对应的 assistant(tool_calls) 后面，向前找到该 assistant
      cutAt--
      continue
    }
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // assistant 带 tool_calls，其前面的 tool 结果也必须保留
      cutAt--
      continue
    }
    break
  }
  // 如果整个对话都是一轮未完成的工具调用，不截断
  if (cutAt <= 0) return
  ref.current = ref.current.slice(cutAt)
}
```

同理，非工具路径（`streamChatCompletion` 单次调用）：

```typescript
apiConversationRef.current.push({ role: 'user', content: augmentedPrompt })

let nonToolReasoning = ''

await streamChatCompletion({
  messages: [
    { role: 'system', content: systemPrompt },
    ...apiConversationRef.current.slice(-40),
  ],
  onReasoning: (token) => {
    nonToolReasoning += token
    // ... 现有 UI 更新逻辑 ...
  },
  onDone: (text) => {
    const assistantMsg: ChatMessage = { role: 'assistant', content: text }
    // 保留 reasoning_content：虽然无工具调用时 API 会忽略它，但保留可避免
    // 后续轮次切换到工具路径时丢失思考链
    if (nonToolReasoning) {
      assistantMsg.reasoning_content = nonToolReasoning
    }
    apiConversationRef.current.push(assistantMsg)
  },
  // ...
})
```

#### 4.2.3 删除 `chatHistory` reduce

整个 [AIPanel.tsx:L765-L835](file:///d:/Project/写文助手/src/components/ai-panel/AIPanel.tsx#L765-L835) 约 70 行的 `reduce` 块 **完全删除**，不保留迁移工具函数。

#### 4.2.4 历史加载与保存

修改 `loadLatest` 函数（项目切换时加载历史）：

```typescript
const loadLatest = (pid: string) => {
  const saved = localStorage.getItem(getHistoryKey(pid))
  const history = saved ? JSON.parse(saved) : []
  if (history.length > 0) {
    const session = history[0]
    if (session.apiConversation) {
      // 新格式：同时恢复 UI 消息和 API 对话历史
      setMessages(deserializeMessages(session.messages))
      apiConversationRef.current = session.apiConversation
    } else {
      // 旧格式（无 apiConversation）：清空历史，从新开始
      setMessages([])
      apiConversationRef.current = []
    }
  } else {
    setMessages([])
    apiConversationRef.current = []
  }
}
```

修改 `serializeMessages` / 保存逻辑：

```typescript
const saveCurrent = (pid: string) => {
  const msgs = messagesRef.current
  if (!pid || msgs.length === 0) return
  const saved = localStorage.getItem(getHistoryKey(pid))
  const history = saved ? JSON.parse(saved) : []
  history.unshift({
    id: generateId(),
    time: new Date().toLocaleString('zh-CN'),
    messages: serializeMessages(msgs),
    apiConversation: apiConversationRef.current,  // ← 新增字段
  })
  localStorage.setItem(getHistoryKey(pid), JSON.stringify(history.slice(0, 50)))
}
```

修改 `loadHistory` 函数（从历史面板加载指定会话）：

> ⚠️ 当前代码中 `loadHistory` 只恢复了 UI 消息，未恢复 `apiConversationRef`，会导致从历史面板加载的会话在下一轮对话时丢失 API 格式历史。

```typescript
const loadHistory = (session: any) => {
  if (session.apiConversation) {
    // 新格式：同时恢复 UI 消息和 API 对话历史
    setMessages(deserializeMessages(session.messages))
    apiConversationRef.current = session.apiConversation
  } else {
    // 旧格式：清空历史，从新开始
    setMessages([])
    apiConversationRef.current = []
  }

  setHistoryOpen(false)
  setWarningShownAt(0)
  setWarningVisible(false)
}
```

#### 4.2.5 新建聊天 & 清空

```typescript
const handleNewChat = async () => {
  abortAndCleanup()
  if (messages.length === 0) return
  // ... 现有保存逻辑 ...
  setMessages([])
  apiConversationRef.current = []  // ← 新增
}
```

#### 4.2.6 `abortAndCleanup` — 回退 apiConversationRef

abort 时需要从 `apiConversationRef` 中移除当前轮次未完成的消息。

**关键理解**：`streamChatWithTools` 在执行过程中操作的是内部 `messages` 副本，这些增量消息只有在函数正常返回后才会通过 `apiConversationRef.current.push(...newMessages)` 写入 `apiConversationRef`。因此 abort 时，`apiConversationRef` 中唯一需要回退的是**在调用 `streamChatWithTools` 之前 push 的 user 消息**。

```typescript
// 在 runStream 开始时记录当前 apiConversationRef 的长度
// （此时 user 消息尚未 push，或刚 push 完毕）
const conversationLenBefore = apiConversationRef.current.length

// ... push user 消息，调用 streamChatWithTools ...

// 在 abortAndCleanup 中：
// 回退到本轮开始前的状态，移除本轮 push 的 user 消息
apiConversationRef.current = apiConversationRef.current.slice(0, conversationLenBefore)
```

**⚠️ 注意**：`conversationLenBefore` 需要在 push user 消息**之前**记录，这样 abort 时才能一并移除 user 消息。如果 `streamChatWithTools` 已经正常返回并 push 了增量消息，则 abort 不应回退（因为数据已经完整写入）。建议在 `streamChatWithTools` 返回后立即更新 `conversationLenBefore` 为新的长度。

### 4.3 影响范围总结

| 文件 | 改动类型 | 改动量 |
|------|------|------|
| `src/lib/api.ts` | `streamChatWithTools` 签名与返回 | ~3 行 |
| `src/components/ai-panel/AIPanel.tsx` | 新增 `apiConversationRef`、修改 `runStream`、删除 reduce、修改历史加载/保存/清空 | ~80 行删, ~40 行增 |

---

## 5. 测试策略

### 5.1 单元测试

需要新增/更新测试的场景：

1. **`streamChatWithTools` 返回增量**：mock `streamChatCompletion`，验证返回的增量不包含初始 messages 中的内容，只包含新增的 assistant + tool 消息
2. **`trimConversation` 截断安全性**：验证截断不会在 `assistant(tool_calls)` 和 `tool` 之间切断；验证纯工具调用对话不会被截断
3. **`loadHistory` 恢复 apiConversationRef**：验证从历史面板加载会话时 `apiConversationRef` 被正确恢复

### 5.2 E2E 测试

现有 10 个 e2e spec 文件。重构不改变 UI 行为，但需要验证：
1. 多轮对话能正常进行
2. 工具调用能正常串联
3. 项目切换后历史能正确加载
4. 思考模式下工具调用不报 400
5. 新建聊天后上下文正确清空

### 5.3 手动验证场景

| 场景 | 验证点 |
|------|------|
| 单轮单工具 | 回答正确，多轮上下文连贯 |
| 单轮多工具（同一子轮） | 多个 tool_calls 正确合并 |
| 思考 + 工具 + 多子轮 | 不再出现 400，中期 reasoning 不丢失 |
| 项目切换 | 历史恢复后对话连贯 |
| 历史面板加载 | 从历史面板加载会话后下一轮对话上下文正确 |
| 清除历史 | 新对话不受旧上下文影响 |
| 长对话截断 | 超过 50 条消息时截断不破坏 assistant-tool 配对 |
| 非工具路径思考模式 | reasoning_content 被保留到 apiConversationRef |

---

## 6. 风险与回滚

### 6.1 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| `apiConversationRef` 与 ChatMsg[] 不一致 | 中 | 对话出现幻觉、工具调用失败 | 每次工具调用返回更新时同步两个数据源；新增一致性校验 assertion（dev 模式） |
| abort 时 apiConversationRef 未正确回退 | 中 | 下一次对话携带未完成的上下文 | 用 `conversationLenBefore` 确保精确回退 |
| 截断破坏消息结构完整性 | 中 | API 报错（tool 引用不存在的 tool_call_id） | 使用 `trimConversation` 安全截断函数，确保不在 assistant(tool_calls) 和 tool 之间截断 |
| `loadHistory` 遗漏恢复 apiConversationRef | 高 | 从历史面板加载的会话下一轮对话丢失上下文 | 修改 `loadHistory` 与 `loadLatest` 使用相同的恢复逻辑 |

### 6.2 回滚策略

- 新增 `apiConversation` 字段与旧字段并存
- 如果出问题，将 `runStream` 改回使用 reduce 从 ChatMsg[] 重建 ChatMessage[] 即可回退
- 由于没有存量用户，回滚时直接清空 localStorage 即可，无需担心数据兼容

---

## 7. 后续优化方向（本次不做）

1. **`apiConversationRef` 持久化到 IndexedDB**：避免 localStorage 5MB 限制，支持更长对话
2. **增量序列化**：只序列化本轮新增的消息，减少序列化开销
3. **`reasoning_content` 裁剪策略**：超长对话时可以选择性丢弃无工具调用轮次的 reasoning_content（符合 DeepSeek 文档）
4. **统一非工具路径和工具路径**：目前 `skipContext` 分支和工具路径有重复的 messages 构建逻辑，可合并
5. **`thinking` 参数的跨提供商兼容性**：DeepSeek 要求 `thinking` 参数通过 `extra_body` 传递（OpenAI SDK），当前项目通过 Electron 主进程转发请求，直接在 options 中传递 `thinking` 字段。如果后续支持其他提供商（如 OpenAI o1/o3、Claude），需要抽象思考模式的参数传递方式，因为不同提供商的参数格式不同（DeepSeek 用 `thinking.type` + `reasoning_effort`，OpenAI 用 `reasoning_effort`，Anthropic 用 `output_config.effort`）
