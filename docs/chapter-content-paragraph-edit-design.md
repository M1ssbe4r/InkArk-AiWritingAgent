# 章节正文段落级写入 — 详细设计

> **状态**：设计稿，待评审后实施  
> **日期**：2026-07-07  
> **相关文档**：[volume-outline-design.md](./volume-outline-design.md)、[sync-architecture.md](./sync-architecture.md)、[tools.md](./tools.md)

---

## 一、背景与动机

### 现状

`write_chapter_content` 采用 **精确 substring 替换**（`original_snippet` + `modified_snippet`），与 coding agent 的 search-replace 同构：

```
AI 复制原文 → 工具在 HTML 中定位 → 替换 → 返回整章 original/modified → diff 审阅
```

审阅层已使用 **段落 LCS → 句子 LCS**（`src/lib/diffUtils.ts` + `Editor.tsx`），但写入层仍是字符级匹配。两层抽象不一致。

| 层 | 粒度 | 对 AI 的要求 |
|----|------|--------------|
| 工具 API | 精确文本块 | 复现原文（含空白/HTML 差异） |
| diff 展示 | 段落 → 句子 | 无（服务端计算） |
| `read(type=chapter_content)` | 连续纯文本 | 无段落编号 |
| 右键菜单 | 用户选区 | 仅传 `selectedText`，AI 自行当作 snippet |

主要失败模式：

1. **匹配失败**：`错误：未在正文中找到匹配的原文片段`（已有单测覆盖）
2. **选区与工具不一致**：UI 说「润色这段」，AI 需猜 `original_snippet` 边界
3. **分段规则分裂**：`read` 用 `stripHtml` 单 `\n` 分段语义，`diffUtils` 用 `\n\n+` 分段，坐标系不统一

### 目标

1. **取消精确匹配**：移除 `original_snippet` / `modified_snippet`，无兼容层、无 fallback。
2. **段落为最小写入单元**：AI 通过 **1-based 段落序号** 指定要改/删/插的段，传改写后的整段纯文本。
3. **单一分段真相源**：`read`、`write`、`diff`、右键选区解析共用同一套 `splitParagraphs`。
4. **审阅流程不变**：仍返回 `_edit_chapter`（整章 `original` / `modified` HTML），沿用现有 diff UI 与采纳/回退。

### 非目标（v1 不做）

| 项 | 原因 |
|----|------|
| 句子级工具参数 | diff 展示可到句子；写入只到段落，避免 API 过碎 |
| 保留 snippet 双轨 | 用户明确要求不考虑过渡 |
| 非空章节整章 replace | lost-in-the-middle 风险；空章首次写作除外 |
| 段落持久化 ID（hash） | 序号 + 校验足够；v1 不加 DB 字段 |
| 服务端 schema 变更 | 仅桌面端；`chapters.content` 仍为 HTML |

---

## 二、概念模型

### 段落定义（canonical）

```typescript
// src/lib/chapterParagraph.ts（新建，纯 TS 无 Electron 依赖，前后端/e2e mock 共用）

import { stripHtml } from './html'

/** HTML 特殊字符转义，防止 AI 输出注入标签被 TipTap 渲染执行 */
export function escapeHtmlInline(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 块级边界归一化：在 stripHtml 之前把 <p>/<div>/<li>/<h1-6>/<blockquote>/<pre>
 *  等块级闭合与起始标签转成 \n\n，确保 TipTap 的 <p>a</p><p>b</p>（标签间无换行）
 *  能切成两段。不能直接依赖 html.ts 的 stripHtml：那里 </p> → \n（单换行），且该
 *  坐标系被 search/vector/FTS 的 offset 依赖，不能改。覆盖范围必须与 TipTap
 *  可能产生的顶层块标签一致，否则 splitParagraphs 段数 ≠ ProseMirror 顶层块节点数
 *  （见 §6.4 编号一致性）。 */
const BLOCK_TAGS = 'p|div|li|h[1-6]|blockquote|pre'

function normalizeBlockBoundaries(html: string): string {
  return html
    .replace(new RegExp(`</(${BLOCK_TAGS})>\\s*<(${BLOCK_TAGS})(?:\\s[^>]*)?>`, 'gi'), '\n\n')
    .replace(new RegExp(`</(${BLOCK_TAGS})>`, 'gi'), '\n\n')
    .replace(new RegExp(`<(${BLOCK_TAGS})(?:\\s[^>]*)?>`, 'gi'), '\n\n')
}

/** 与 diff 审阅、read 编号、write 定位共用 */
export function splitParagraphs(htmlOrPlain: string, alreadyPlain = false): string[] {
  const plain = alreadyPlain
    ? htmlOrPlain
    : stripHtml(normalizeBlockBoundaries(htmlOrPlain))
  return plain
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

export function joinParagraphsToHtml(paragraphs: string[]): string {
  if (paragraphs.length === 0) return ''
  // 先转义特殊字符，再把段内 \n（来自原 <br>）还原为 <br>；
  // 顺序很重要：若先替换 \n → <br>，转义会把 <br> 变成 &lt;br&gt;
  return paragraphs
    .map((p) => `<p>${escapeHtmlInline(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}
```

**分段规则（强制）**

1. 输入先经 `normalizeBlockBoundaries` 把块级标签（`<p>`/`<div>`/`<li>`/`<h1-6>`/`<blockquote>`/`<pre>` 等）转成 `\n\n`，再 `stripHtml`（来自 `html.ts`，负责实体解码与残余标签清理）。**不直接依赖 `html.ts` 的 `</p>`→`\n` 语义**——那里单换行会让 TipTap `<p>a</p><p>b</p>` 塌成一段，且该坐标系被 search/vector/FTS 的 offset 依赖，禁止修改。覆盖范围必须与 TipTap 顶层块标签一致（见 §6.4 编号一致性）。
2. 段落边界：连续空行 `\n\n+`。
3. 段内单 `\n`（如原 `<br>`）保留，不拆段；`joinParagraphsToHtml` 写回时还原为 `<br>`。
4. 段落编号 **1-based**，与 `read` 输出 `[P1]`、`[P2]` 一致。
5. **HTML 转义强制**：`joinParagraphsToHtml` 对 AI 输出做 `escapeHtmlInline`，防止 `<img onerror=...>` 之类被 TipTap 渲染执行（详见 §十）。

**与现有 `diffUtils` 的关系**

- `diffUtils` 内的 `stripHtml`/`splitParagraphs` 删除，改为从 `chapterParagraph` 导入共用实现；句子切分逻辑保留不变。
- 旧 `diffUtils.stripHtml` 的 `</p>`→`\n\n` 与新 `normalizeBlockBoundaries` + `html.ts.stripHtml` 行为等价，diff 输出不变；现有 `computeDiff` 测试应全绿。

### 写入语义

| 操作 | 工具参数 | 效果 |
|------|----------|------|
| 首次写作（空章） | `content: string` | 全文写入（多段用 `\n\n` 分隔） |
| 替换段落 | `edits: [{ paragraph_index, text }]` | 指定段整段替换 |
| 删除段落 | `edits: [{ paragraph_index, text: "" }]` | 移除该段 |
| 插入段落 | `inserts: [{ after_paragraph_index, text }]` | `after=0` 表示插在最前；`after=N` 表示在第 N 段之后 |

**一轮调用约束**

- `content` 与 `edits`/`inserts` **互斥**。
- 非空章节 **禁止** `content`（防止误整章覆盖）。
- 同一 `paragraph_index` 在 `edits` 中不可重复；`inserts` 按 `after_paragraph_index` 升序应用（见 §四）。

---

## 三、工具 API

### 3.1 `write_chapter_content`（新 schema）

```typescript
{
  chapter_index: number      // 必填，1-based
  summary: string            // 必填，变更说明

  // 空章节首次写作（正文 strip 后为空时）
  content?: string           // 纯文本，段间 \n\n

  // 非空章节修改
  edits?: Array<{
    paragraph_index: number  // 1-based，必须 ≤ 当前段数
    text: string             // 新段落纯文本；"" = 删除
  }>
  inserts?: Array<{
    after_paragraph_index: number  // 0..段数；0=文首，段数=文末
    text: string                   // 新段纯文本，不可 ""
  }>
}
```

**description 要点（写入 toolDefinitions）**

- 修改正文 **必须** 用 `edits`/`inserts`，**禁止** 复制原文做字符串替换。
- 先 `read(type=chapter_content)` 获取 `[Pn]` 编号，再按段改写。
- `text` / `content` 为纯文本，勿含章节标题；系统包装为 `<p>`。
- 空字符串 `text` 表示删除该段。

**移除字段（彻底删除）**

- `original_snippet`
- `modified_snippet`

### 3.2 `read(type=chapter_content)`（输出格式）

```
第 3 章：初入江湖

大纲：……

段落数：3

[P1] 张三走进房间。他看到桌上放着一封信。
[P2] 窗外下着雨。
[P3] ……
```

- 空章：输出 `（空章节）`，无 `段落数` 行、无 `[Pn]`。
- **固定**输出 `段落数：N` 行（位于大纲与 `[P1]` 之间），便于 AI 校验 `paragraph_index`/`after_paragraph_index` 范围。非可选。
- 段落由 `splitParagraphs(content)` 切分；**删除 `tools.ts` 中 `read(type=chapter_content)` 现有的内联 strip**（`content.replace(/<br\s*\/?>/gi, '\n')...`），统一走 `chapterParagraph`。

### 3.3 系统提示与 toolUsageGuide

更新 `buildCorePrompt`、`toolUsageGuide()` 中所有 `original_snippet` 表述，改为段落写入说明（`original_snippet`/`modified_snippet` 字段已移除，AI 无该选项可用）。

示例铁律补充：

> 修改已有正文时，先 `read(type=chapter_content)` 获取 `[Pn]` 编号，再用 `write_chapter_content.edits` 按段写入。

---

## 四、Handler 实现（`tools.ts`）

### 4.1 流程

```
1. 校验 chapter_index → 加载 content（store 优先）
2. paragraphs = splitParagraphs(content)
3. isEmpty = paragraphs.length === 0

4a. isEmpty:
    - 若无 content → 错误
    - modifiedHtml = joinParagraphsToHtml(splitParagraphs(content arg, plain=true))
    - return _edit_chapter

4b. 非空:
    - 若传 content → 错误（禁止整章覆盖）
    - 若无 edits 且无 inserts → 错误
    - 先应用 inserts（按 after_paragraph_index 升序；相同 after 按数组顺序）
      —— inserts 不改变已有段下标
    - 再应用 edits（按 paragraph_index 降序删除/替换，避免下标漂移）
    - modifiedHtml = joinParagraphsToHtml(nextParagraphs)
    - return _edit_chapter
```

**应用顺序说明（重要）**

`paragraph_index` 与 `after_paragraph_index` 一律指 **AI `read` 时看到的原始段落编号**。"先 inserts（升序）后 edits（降序）"的顺序保证：

- inserts 在已有段之间/之后插入，不移动已有段，下标不漂移；
- edits 降序应用，删除/替换仅影响 ≥ 当前 index 的段，已处理的更大 index 不受影响；
- 无需对 inserts 的 `after_paragraph_index` 做 rebase。

若反过来"先 edits 后 inserts"，删段后 `after_paragraph_index` 会指向错位的目标，必须额外维护 rebase 映射，复杂且易错。

### 4.2 校验与错误信息

| 条件 | 返回 |
|------|------|
| `paragraph_index` < 1 或 > 段数 | `错误：paragraph_index N 超出范围（共 M 段）` |
| `edits` 重复 index | `错误：edits 中 paragraph_index 重复` |
| `inserts[].text` trim 后为空 | `错误：inserts.text 不可为空` |
| `after_paragraph_index` < 0 或 > 段数 | `错误：after_paragraph_index N 须在 0..M（原始编号）` |
| `content` 与非空章同时使用 | `错误：非空章节请使用 edits/inserts，勿传 content` |
| `content` 与 `edits`/`inserts` 同时传 | `错误：content 与 edits/inserts 互斥` |

### 4.3 HTML 往返

- **读**：`normalizeBlockBoundaries` → `stripHtml` → 分段 → 编号展示。
- **写**：纯文本段 → `escapeHtmlInline` 转义 → 段内 `\n` 还原为 `<br>` → `<p>...</p>` 拼接。不保留段内旧 HTML 格式（粗体/斜体等，v1 接受；TipTap 加载后用户可再排版）。
- **转义强制**：`text`/`content` 来自 AI 输出，必须经 `escapeHtmlInline` 转义 `&` `<` `>` `"` `'`，防止 `<img onerror=...>` 之类注入被 TipTap 渲染执行。
- **diff**：对 `original`/`modified` HTML 走现有 `computeDiff`，无需改 UI 协议。diff 基于 `stripHtml` 文本，段内 `<b>` → 无标记的格式丢失在 diff 不可见（视为文本相同），符合预期。

### 4.4 删除现有逻辑

移除 `write_chapter_content` 内全部 snippet 匹配代码（`mapToHtml`、`normalize`、四级 match 等）。

---

## 五、审阅与 Store（不变更协议）

```typescript
// 返回值保持不变
JSON.stringify({
  _edit_chapter: true,
  chapter_id: string,
  original: string,   // 修改前 HTML
  modified: string,   // 修改后 HTML
  summary: string,
})
```

- `AIPanel`：`setPendingChapterEdit` → 用户采纳/回退（现有逻辑）。
- `Editor`：`computeDiff(original, modified)` 展示（现有逻辑）。
- `pendingChapterEdit` 存在时仍隐藏 TipTap、显示 diff（现有逻辑）。

---

## 六、编辑器交互

### 6.1 问题

当前只传 `selectedText`，prompt 写「对选中的这段文字…」，与段落 API 不一致。

### 6.2 行为（v1 定稿）

**选区解析（`Editor.tsx` + 新 util）**

1. 取当前章 `content`，`splitParagraphs` 得列表。
2. 取选区纯文本 `selectedText`（来自 `view.state.doc.textBetween(from, to)`）；**用同一套 `splitParagraphs` 切选区**，避免 ProseMirror 块分隔符与段落切分不一致导致 `includes` 永不命中。
3. **归一化到段**：找出 **包含选区** 的段落（选区 trim 后是某段子串，或跨段则取 **最小覆盖段集合**）。
4. **段内 partial 选区**：仍映射到 **整段**（菜单语义改为段级操作，见下）。

**组件职责（段号在哪里算）**

- `Editor.tsx` 的 `contextmenu` handler 负责算：`paragraphs = splitParagraphs(activeChapter.content)` → `paragraphIndices = resolveParagraphIndices(paragraphs, selectedText)` → `chapterIndex = chapters.findIndex(activeChapter) + 1`，把三者连同 `selectedText` 一起塞进 `ctxMenu` state 传给 `ContextMenu`。
- `ContextMenu` **不自己算段号**，只把 props 收到的 `chapterIndex`/`paragraphIndices` 塞进 `setPendingAction`。
- `AIPanel` 消费 `PendingAction` 时按 §6.2 prompt 模板拼段号。

**UX 回归显式承认**

旧 prompt（`AIPanel.tsx` 现状）是"对**选中的这段文字**进行润色"，AI 只改选区；新语义下"润色本段"会让 AI 重写整段。若用户在 500 字段内只选 1 句，diff 将显示整段改动，用户若想保留其他句子只能逐字回退或整单回滚——这是明显回归。

v1 接受该回归的理由：(a) 避免 AI 返回的句子与上下文衔接生硬；(b) 段落级是工具 API 的最小单元，段内 substring 替换会重新引入"精确匹配"的脆弱性（正是本次重构要消除的）。缓解措施：菜单文案明示"本段"、diff 审阅 + 整单回退、跨段选区显示 `已选 N 段（P2–P4）` 让用户感知范围。后续版本若用户反馈强烈，再考虑 prompt 层保留句子级语义（AI 只返回改写的句子，handler 在定位段内做 substring 替换）。

**PendingAction 扩展**

```typescript
export type PendingAction = {
  action: 'polish' | 'condense' | 'expand' | 'sendToChat' | ...
  text: string                    // 选区原文，供 AI 参考
  chapterIndex?: number           // 1-based
  paragraphIndices?: number[]     // 1-based，已归一化
} | null
```

**AIPanel prompt 模板（Write 模式）**

单段：

```
请对第 {chapterIndex} 章第 {paragraphIndex} 段进行{润色|缩写|扩写}。
使用 write_chapter_content，edits: [{ paragraph_index: N, text: "改写后的整段纯文本" }]。
不要修改其他段落。【选中文本】仅作改写参考。
```

多段（跨段选区）：

```
请对第 {chapterIndex} 章第 {indices.join('、')} 段分别{操作}。
一次 write_chapter_content 调用传多个 edits。
```

自定义指令（`customCommand`，单段）：

```
请对第 {chapterIndex} 章第 {paragraphIndex} 段执行用户指令：{customPrompt}。
使用 write_chapter_content，edits: [{ paragraph_index: N, text: "改写后的整段纯文本" }]。
不要修改其他段落。【选中文本】仅作改写参考。
```

多段时 `paragraphIndex` 改为 `indices.join('、')`，一次调用传多个 edits。

**菜单文案**

| 项 | 原文案 | 新文案（含段号提示） |
|----|--------|----------------------|
| 润色 | 润色 | 润色本段（P3） |
| 缩写 | 缩写 | 缩写本段（P3） |
| 扩写 | 扩写 | 扩写本段（P3） |
| 自定义说明 | 将与选中文本一起发送 | 按所选段落（P3）发送给 AI |

- 单段时菜单项后缀 `(P{N})`，让用户点击前就知道 AI 会改第几段。
- 跨多段时副标题显示 `已选 N 段（P{a}–P{b}）`，菜单项后缀 `(P{a}–P{b})`。
- 段号来自 `Editor.tsx` 在 contextmenu 时算好的 `paragraphIndices`（见"组件职责"）。

**sendToChat**

- 仍只填输入框；附带 `[Pn]` 前缀帮助用户手动描述。模板：`[P{chapterIndex}.{paragraphIndex}] {selectedText}`，多段时段号用 `、` 分隔（如 `[P5.2、3] ...`）。
- **前缀拼接由 `ContextMenu` 负责**：`handleClick('sendToChat')` 时把 `[P{chapterIndex}.{paragraphIndices.join('、')}] ` 拼到 `text` 前一起塞进 `PendingAction.text`，`AIPanel` 的 sendToChat 分支（当前 `AIPanel.tsx:836` 的 `setFreeInput(pending.text)`）无需改动，直接把带前缀的文本填入输入框。

**CommandPalette `chat-polish`**

- 与右键对齐：若有编辑器选区，走同一 `PendingAction` 路径，而非仅 `sendToChat`。

### 6.3 选区 → 段号算法（参考）

```typescript
function resolveParagraphIndices(
  paragraphs: string[],
  selectedText: string,
): number[] {
  const sel = selectedText.trim()
  if (!sel) return []
  const MIN_HIT_LEN = 6 // 短于此长度时"段被选区包含"判定不可靠，弃用
  const hits: number[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    // 主判定：选区是某段子串（段包含选区）
    if (paragraphs[i].includes(sel)) {
      hits.push(i + 1)
      continue
    }
    // 辅判定：选区包含整段——仅在段足够长时启用，避免中文短段误命中
    if (paragraphs[i].length >= MIN_HIT_LEN && sel.includes(paragraphs[i])) {
      hits.push(i + 1)
    }
  }
  if (hits.length === 0) {
    // fallback：取与选区最长公共子串（LCS-substring）最大的段，单段
    return [bestMatchParagraph(paragraphs, sel)]
  }
  if (hits.length === 1) return hits
  // 多段命中：取首末命中区间连续覆盖，而非仅取第一段
  // —— 用户跨段选 P2–P4 时即使 P7 有重复句，也应返回 [2,3,4]
  return rangeClosed(hits[0], hits[hits.length - 1])
}

/** 最长公共子串长度最大的段；平手取第一个 */
function bestMatchParagraph(paragraphs: string[], sel: string): number {
  let best = 1, bestLen = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const lcs = longestCommonSubstring(paragraphs[i], sel).length
    if (lcs > bestLen) { bestLen = lcs; best = i + 1 }
  }
  return best
}
```

实现要点：
- 选区与段落必须用**同一套** `splitParagraphs` 切分（见 §6.2 步骤 2），否则 `includes` 永不命中、全部走 fallback。
- `rangeClosed`/`longestCommonSubstring` 为标准工具函数，不展开。
- 单测覆盖：段内半句、整段、跨段连续、跨段非连续（重复句取区间）、选区含 `<br>` 转的 `\n`、纯空白选区。

### 6.4 段号显示（编辑器左侧 gutter）

**目的**：让用户在编辑器直接看到每段的 `[Pn]` 编号。用户跟 AI 说"修改第 3 段"时，AI `read` 看到的 `[P3]` 与用户所见完全一致，无需右键或 AI 模糊匹配——为路径 B（自由聊天指代"这行/这段"）提供确定性坐标。

**实现**

- 新建 TipTap extension `ParagraphNumberGutter`（基于 ProseMirror plugin + `DecorationSet`）：
  - 遍历 `doc.content` 顶层块节点（`paragraph`/`heading` 等），按 1-based 顺序给每个节点挂一个 widget 显示 `P1`/`P2`/...。
  - widget 用 CSS 定位到编辑区左侧 gutter（`position: absolute` + 编辑区 `padding-left` 留出约 2rem）。
  - `doc` 每次更新（`apply`）时重算 decorations。
- 涉及文件：`src/extensions/ParagraphNumberGutter.ts`（新建）、`src/components/editor/Editor.tsx`（注册 extension + gutter CSS + `padding-left`）。

**编号一致性（强制）**

- gutter 段号 = `splitParagraphs(content)` 顺序 = `read(type=chapter_content)` 的 `[Pn]` = `write_chapter_content.edits/inserts` 的 `paragraph_index`/`after_paragraph_index`。四者必须严格一致。
- 因此 `normalizeBlockBoundaries` 必须覆盖 TipTap 可能产生的所有顶层块标签（`p`/`div`/`li`/`h1-6`/`blockquote`/`pre`），保证 `splitParagraphs(HTML)` 段数 = ProseMirror 顶层块节点数。
- **heading 也算一段**：若章节含 `<h1>`，gutter 给 heading 编号（如 `P1=标题`、`P2=第一段`），`read` 输出同样 `[P1] 标题`、`[P2] ...`。用户说"第 2 段"时 AI 与用户理解一致。

**显示规则**

- 仅在章节编辑视图显示；`pendingChapterEdit` 的 diff 视图不显示 gutter（diff 有自己的 `para_break` 分隔）。
- 空章节、大纲视图（`editorView === 'outline'`）不显示。
- 样式：左侧窄列（约 2rem），灰底小字（`text-muted-foreground/50`），不占编辑区宽度，不参与光标定位、不可点击。

---

## 七、文件改动清单

| 文件 | 改动 |
|------|------|
| `src/lib/chapterParagraph.ts` | **新建** `normalizeBlockBoundaries`、`splitParagraphs`、`joinParagraphsToHtml`、`escapeHtmlInline`、`resolveParagraphIndices`；纯 TS 无 Electron 依赖 |
| `src/lib/diffUtils.ts` | 删除内部 `stripHtml`/`splitParagraphs`，改从 `chapterParagraph` 导入；句子切分逻辑保留 |
| `src/lib/html.ts` | **无行为变更**（search/vector/FTS 坐标系依赖，禁止改 `</p>`→`\n` 语义） |
| `src/lib/tools.ts` | 新 schema + handler；删 snippet 匹配（`mapToHtml`/`normalize`/四级 match）；`read(type=chapter_content)` 改用 `splitParagraphs` + `[Pn]` + `段落数：N`，**删除现有内联 strip 行** |
| `src/lib/api.ts` | `buildCorePrompt` 铁律 #2 删除 `original_snippet 传 ""` 表述，改为"先 read 获取 `[Pn]`，再用 `edits`/`inserts` 按段写入"；`toolUsageGuide()` 反模式与调用顺序补"修改正文前必须先 `read(type=chapter_content)`" |
| `src/lib/editorRef.ts` | 扩展 `PendingAction`（加 `chapterIndex?`/`paragraphIndices?`） |
| `src/components/editor/Editor.tsx` | 右键时调 `resolveParagraphIndices` 解析段号并传给 `ContextMenu`；注册 `ParagraphNumberGutter` extension + gutter CSS（`padding-left` ~2rem）；选区用 `splitParagraphs` 切分保持坐标系一致 |
| `src/extensions/ParagraphNumberGutter.ts` | **新建** TipTap extension：ProseMirror plugin + `DecorationSet`，按顶层块节点 1-based 渲染 `Pn` widget |
| `src/components/editor/ContextMenu.tsx` | 文案改为"润色本段/缩写本段/扩写本段"；跨段时副标题显示 `已选 N 段（P{a}–P{b}）` |
| `src/components/ai-panel/AIPanel.tsx` | polish/condense/expand/custom 的 prompt 模板改为段级（见 §6.2 模板）；消费 `paragraphIndices` |
| `src/components/ui/CommandPalette.tsx` | 润色命令对齐 `PendingAction` 路径 |
| `src/lib/tools.test.ts` | 删 snippet 用例；新增：空章 `content` 多段、单段 replace/delete、多段 `edits` 同调用、`inserts` 文首/段间/文末、**`edits`+`inserts` 同调用顺序**、非法/重复 index、非空传 `content`、`text` 含 HTML 注入串被转义 |
| `src/lib/diffUtils.test.ts` | 确保共用分段后仍通过；新增 TipTap `<p>a</p><p>b</p>` → 2 段断言 |
| `src/lib/chapterParagraph.test.ts` | **新建**：`splitParagraphs`（单/多 `<p>`、`<br>` 段内换行、实体、TipTap 无换行 `<p>` 序列）、`joinParagraphsToHtml`↔`splitParagraphs` 往返、`escapeHtmlInline`（`<img onerror=>` 被转义）、`resolveParagraphIndices` 全场景 |
| `src/lib/editorRef.test.ts` | `PendingAction` 新字段 |
| `e2e/ai-helpers.ts` | 更新 mock schema；**mock executor 直接 `import` `chapterParagraph.ts` 复用 `splitParagraphs`/`joinParagraphsToHtml`**，避免与真实 handler 漂移 |
| `e2e/ai-tools.spec.ts` | 更新 `write_chapter_content` 场景：`edits` 成功进 diff、采纳后持久化、右键"润色本段"断言 tool call args 含正确 `paragraph_index` |
| `docs/tools.md` | 更新工具说明 |
| `docs/sync-architecture.md` | 更新 §4.7 流程描述 |
| `docs/features.md` / `HelpDialog.tsx` | 用户可见说明 |

**不改动**

- `electron/ipc/*`（正文仍存 `chapters.content` HTML）
- diff UI 组件结构
- `_edit_chapter` IPC 审阅协议

---

## 八、测试计划

### 单元测试（Vitest）

**`chapterParagraph`**

- 单 `<p>`、多 `<p>`、`<br>` 段内换行、`stripHtml` 实体
- **TipTap `<p>a</p><p>b</p>`（标签间无换行）→ 2 段**（回归 §二 段落定义的核心断言）
- **含 heading/blockquote：`<h1>标题</h1><p>正文</p>` → 2 段；`<blockquote><p>a</p></blockquote>` → 1 段**（验证 `normalizeBlockBoundaries` 覆盖范围，保证与 ProseMirror 顶层块节点数一致）
- `joinParagraphsToHtml` ↔ `splitParagraphs` 往返（含段内 `\n` → `<br>`）
- `escapeHtmlInline`：`<img src=x onerror=alert(1)>` → 全转义，`joinParagraphsToHtml` 输出不含可执行标签
- `resolveParagraphIndices`：段内半句、整段、跨段连续、跨段非连续（重复句取区间）、选区含 `<br>` 转的 `\n`、纯空白选区

**`write_chapter_content`**

- 空章 + `content` 多段
- 单段 replace / delete
- 多段 `edits` 同次调用
- `inserts` 文首、段间、文末
- **`edits` + `inserts` 同调用**：删 P3 + 在 P4 后插段，断言插入基于原始编号、位置不漂移
- 非法 index、重复 index、非空传 `content`、`inserts[].text` 纯空白被拒
- `text` 含 `<img onerror=...>` → `modified` HTML 中该串被转义、TipTap 不会执行

**回归**

- `computeDiff` 全套现有用例（确认改用共用 `splitParagraphs` 后仍通过）

### E2E

- AI 调用 `write_chapter_content` 使用 `edits` 成功进入 diff 审阅
- 采纳后正文持久化
- 右键「润色本段」→ AI 使用正确 `paragraph_index`（可断言 tool call args）

---

## 九、AI 调用示例

### 首次写作（空章）

```json
{
  "chapter_index": 5,
  "summary": "首次写作第5章",
  "content": "第一段开头。\n\n第二段继续。\n\n第三段收尾。"
}
```

### 润色单段

```json
{
  "chapter_index": 5,
  "summary": "润色第3段对话",
  "edits": [
    {
      "paragraph_index": 3,
      "text": "他压低声音：\"你不该来这里。\"她别过脸，指尖却微微发抖。"
    }
  ]
}
```

### 删段 + 插段

```json
{
  "chapter_index": 5,
  "summary": "删除冗余描写并在第2段后补过渡",
  "edits": [{ "paragraph_index": 4, "text": "" }],
  "inserts": [{ "after_paragraph_index": 2, "text": "两人沿小径沉默前行，只听见足音。" }]
}
```

---

## 十、风险与缓解

| 风险 | 缓解 |
|------|------|
| 段内润色变成整段重写，改动面变大 | diff 审阅 + 用户回退；右键文案明示「本段」；跨段显示 `已选 N 段`（见 §6.2 UX 回归承认） |
| 段号随删插漂移 | 要求 AI 先 read；错误信息带当前段数；handler 顺序"先 inserts 升序、后 edits 降序"，引用原始编号无需 rebase（见 §4.1） |
| 丢失段内 HTML（粗体等） | v1 接受；后续可加 limited inline markup 白名单 |
| AI 输出含 HTML 标签被 TipTap 渲染执行（注入） | `joinParagraphsToHtml` 强制 `escapeHtmlInline` 转义 `&<>"'`；单测覆盖 `<img onerror=>` 场景 |
| AI 习惯旧 snippet API | 彻底移除字段，工具报错清晰；更新 e2e fixture |
| 工具 schema 硬断裂（删 `original_snippet`/`modified_snippet`） | 已确认无外部消费者引用旧字段（schema 由桌面端 `toolDefinitions` 动态生成，不持久化、不对外暴露）；属 AGENTS.md "schema 稳定性"原则下的有意破坏，记入变更日志 |
| 升级时用户有在途 `pendingChapterEdit`（旧 substring 法生成） | `_edit_chapter` 协议不变，采纳/回退仍可用；新版本首次启动不主动迁移在途 diff |
| AI 高频连发 `write_chapter_content` 覆盖未审阅的 `pendingChapterEdit` | v1 不加守卫（与现状一致）；记入后续 TODO：镜像 `write_volume` 的 `pendingVolumeEdit` 守卫（`tools.ts:694-696`） |

---

## 十一、实施顺序

1. **`chapterParagraph.ts` + 测试**，`diffUtils` 接入  
2. **`read` 输出 `[Pn]`**  
3. **`write_chapter_content` 新 handler**，删 snippet  
4. **系统提示 / toolUsageGuide / docs/tools.md**  
5. **PendingAction + Editor 选区 + AIPanel prompt**  
6. **ContextMenu / CommandPalette 文案**  
7. **e2e + 全量 vitest**

预估：**中等规模**（~800–1200 行净变更，无 DB 迁移）。

---

## 十二、与卷级大纲模式的对照

| 维度 | `write_volume.outline` | `write_chapter_content`（新） |
|------|------------------------|-------------------------------|
| 写入单元 | 整卷 outline HTML | 段落纯文本 |
| 定位方式 | 整篇替换 | 1-based 段序号 |
| 审阅 | diff | diff（同） |
| 空内容 | 直接写 | `content` 全文 |
| 精确匹配 | 无 | **取消**（原 snippet 亦取消） |

章节正文比卷大纲更长，故非空章 **不允许** 整篇 `content` replace，仅允许按段 `edits`/`inserts`。
