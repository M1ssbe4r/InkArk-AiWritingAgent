# jieba-wasm 中文分词方案设计

## 一、背景与动机

### 现状问题

当前 FTS5 索引使用逐字分词（[fts.ts](../electron/ipc/fts.ts#L5-L8)）：

```typescript
export function tokenizeChinese(text: string): string {
  return text.replace(/([\u4e00-\u9fff])/g, ' $1 ').replace(/\s+/g, ' ').trim()
}
```

"张三在魔法学院学习火系魔法" → `张 三 在 魔 法 学 院 学 习 火 系 魔 法`

问题：

1. **无词边界**：每个字都是独立 token，丢失了词语级别的语义
2. **误匹配**：搜索"法学"会命中"魔法学院"中的"法"+"学"连续出现
3. **无法模糊搜索**：搜"魔法"无法命中"魔法学院"（因为"魔"和"法"各自独立，短语匹配要求连续两字）
4. **BM25 失真**：单字 token 频率极高，TF-IDF 权重被高频单字稀释

### 方案选择

| 方案 | 分词质量 | 依赖 | 包体积 | 自定义词典 |
|------|---------|------|--------|-----------|
| 现状（逐字） | ⭐ | 零 | 零 | N/A |
| Intl.Segmenter | ⭐⭐⭐ | 零 | 零 | ❌ |
| **jieba-wasm** | ⭐⭐⭐⭐⭐ | 0 依赖 | ~3MB WASM | ✅ |
| 自定义 FTS5 Tokenizer | ⭐⭐⭐⭐ | 需编译 sql.js | N/A | ✅ |

**结论**：引入 `jieba-wasm`。纯 WASM 实现，与项目现有的 sql.js (WASM) 技术栈一致，无需 native 编译。支持自定义词典，可针对写作场景优化。

---

## 二、jieba-wasm 概览

### 包信息

- npm: `jieba-wasm` v2.4.0
- 底层: [jieba-rs](https://github.com/messense/jieba-rs) (Rust 实现编译为 WASM)
- 依赖: 0
- 体积: ~3MB（WASM 二进制 + 内置词典）
- Node.js 入口: `pkg/nodejs/jieba_rs_wasm.js`（wasm-bindgen `--target nodejs` 生成，同步加载）

### API

```typescript
import { cut, cut_for_search, add_word, with_dict } from 'jieba-wasm'

// 精确模式（默认）：最常用的分词模式
cut("中华人民共和国武汉市长江大桥", true)
// → ['中华人民共和国', '武汉市', '长江大桥']

// 搜索模式：在精确模式基础上，对长词再切分
cut_for_search("中华人民共和国武汉市长江大桥", true)
// → ['中华', '华人', '人民', '共和', '共和国', '中华人民共和国', '武汉', '武汉市', '长江', '大桥', '长江大桥']

// 添加自定义词
add_word("魔法学院")

// 加载自定义词典（格式：词语 词频 词性，每行一条）
with_dict("魔法学院 100 n\n火系魔法 100 n")
```

### 两种分词模式对比

```
原文：张三在魔法学院学习火系魔法

精确模式 cut：张三 / 在 / 魔法学院 / 学习 / 火系 / 魔法
搜索模式 cut_for_search：张三 / 在 / 魔法 / 学院 / 魔法学院 / 学习 / 火系 / 魔法
```

---

## 三、分词策略

### 索引侧：使用精确模式 `cut`

将 `cut` 的分词结果用空格拼接后存入 FTS5：

```
原文："张三在魔法学院学习火系魔法"
存入 FTS5 的 content："张三 在 魔法学院 学习 火系 魔法"
```

理由：
- 精确模式分词结果稳定、可预测
- "魔法学院" 作为整体 token，不会被误匹配为 "法学" 等无关词
- 每个 token 都是有意义的词语，BM25 权重更准确
- token 数量比逐字分词少得多（约 1/2~1/3），索引体积下降

### 查询侧：使用精确模式 `cut`

搜索关键词同样用 `cut` 分词，保持与索引一致：

```
用户搜索："魔法学院 战斗"
cut("魔法学院 战斗") → ["魔法学院", "战斗"]
MATCH 表达式："魔法学院" OR "战斗"
```

#### 查询模式对比（决策过程）

| 策略 | 搜"魔法"命中"魔法学院"？ | 实现复杂度 | 推荐 |
|------|------------------------|-----------|------|
| 索引 `cut` + 查询 `cut` | ❌ 不命中 | 最简单 | ✅ 采用 |
| 索引 `cut` + 查询 `cut_for_search` | ✅ 命中 | 中等 | ❌ |
| 索引 `cut_for_search` + 查询 `cut_for_search` | ✅ 命中 | 简单但噪音多 | ❌ |

**为什么选择"精确 + 精确"**：

1. jieba 分词后"魔法"本身就是一个独立词。用户搜"魔法"时，`cut("魔法")` = `["魔法"]`，而索引中"火系魔法"会被切为 `["火系", "魔法"]`，"魔法"作为独立 token 存在于索引中 → **可以命中**。

2. "魔法学院"被切为一个整体 token。用户搜"魔法"时不会命中"魔法学院"。**这是正确行为**——如果用户想找"魔法"相关内容，直接搜"魔法"即可；想找"魔法学院"就应该搜完整词。

3. 如果确实需要前缀/子串匹配，可以用 FTS5 原生的 `*` 通配符：搜 `"魔法*"` 可以命中 "魔法学院"。这个能力作为后续优化，不在本方案范围内。

### 效果对比

```
原文：张三在魔法学院学习火系魔法，他是学院最优秀的学生

逐字分词索引：张 三 在 魔 法 学 院 学 习 火 系 魔 法 他 是 学 院 最 优 秀 的 学 生
jieba 分词索引：张三 在 魔法学院 学习 火系 魔法 他 是 学院 最 优秀 的 学生
```

| 搜索词 | 逐字分词 | jieba 分词 |
|--------|---------|-----------|
| "法学" | ❌ 命中（误匹配"魔**法学**院"中的连续两字） | ❌ 不命中（正确排除） |
| "魔法" | ❌ 不命中（"魔"和"法"被"学""院"隔开） | ✅ 命中"火系**魔法**" |
| "魔法学院" | ✅ 命中（逐字短语匹配） | ✅ 命中（词级短语匹配） |
| "优秀学生" | ❌ 不命中（"优""秀""的""学""生"中间有"的"） | ❌ 不命中（"优秀"和"学生"中间有"的"） |

---

## 四、改动范围

### 4.1 新增依赖

```bash
npm install jieba-wasm
```

同时需要在 [vite.config.ts](../vite.config.ts) 中将 `jieba-wasm` 加入 Electron main 的 externals，避免 Vite 打包时破坏 WASM 文件的加载路径：

```typescript
// vite.config.ts → electron[0].vite.build.rollupOptions
external: ['fts5-sql-bundle', 'jieba-wasm'],
```

### 4.2 新增模块：`electron/ipc/tokenizer.ts`

封装 jieba-wasm 的初始化和分词逻辑，供 `fts.ts` 和 `search.ts` 调用。

jieba-wasm 的 Node.js 入口通过 `wasm-bindgen --target nodejs` 生成，使用 `fs.readFileSync` 同步加载 WASM，因此 `require('jieba-wasm')` 是同步操作，不需要 async 初始化。

```typescript
// electron/ipc/tokenizer.ts（示意）

let jiebaAvailable = false
const fallbackTokenize = (text: string) =>
  text.replace(/([\u4e00-\u9fff])/g, ' $1 ').replace(/\s+/g, ' ').trim()

export function initTokenizer(): void {
  try {
    const jieba = require('jieba-wasm')
    jieba.cut('预热', true)
    jiebaAvailable = true
  } catch (err) {
    console.error('[tokenizer] jieba-wasm 加载失败，降级为逐字分词:', err)
    jiebaAvailable = false
  }
}

export function isJiebaAvailable(): boolean {
  return jiebaAvailable
}

export function tokenizeChinese(text: string): string {
  if (jiebaAvailable) {
    return require('jieba-wasm').cut(text, true).join(' ')
  }
  return fallbackTokenize(text)
}

export function addCustomWord(word: string, freq?: number): void {
  if (jiebaAvailable) {
    require('jieba-wasm').add_word(word, freq)
  }
}

export function loadCustomDict(dict: string): void {
  if (jiebaAvailable) {
    require('jieba-wasm').with_dict(dict)
  }
}
```

关键设计：
- 只导出一个 `tokenizeChinese` 函数，索引侧和查询侧共用，不存在重复函数
- `initTokenizer` 是同步的，返回时 jieba 已可用或已标记降级
- `tokenizeChinese` 内部根据 `jiebaAvailable` 自动选择分词器，调用方无需感知

### 4.3 修改 `electron/ipc/fts.ts`

将 `tokenizeChinese` 函数替换为从 tokenizer 模块导入：

```typescript
// 改动前（第 5-8 行）
export function tokenizeChinese(text: string): string {
  return text.replace(/([\u4e00-\u9fff])/g, ' $1 ').replace(/\s+/g, ' ').trim()
}

// 改动后：删除本地定义，改为导入
import { tokenizeChinese } from './tokenizer'
```

fts.ts 内部 7 处 `tokenizeChinese(...)` 调用无需改动，函数签名不变。

### 4.4 修改 `electron/ipc/search.ts`

将 `tokenizeChinese` 的导入来源从 `./fts` 改为 `./tokenizer`：

```typescript
// 改动前（第 3 行）
import { tokenizeChinese, stripHtml, parseArrayField, buildCharacterContent, buildWorldContent, chunkByParagraphs } from './fts'

// 改动后
import { stripHtml, parseArrayField, buildCharacterContent, buildWorldContent, chunkByParagraphs } from './fts'
import { tokenizeChinese } from './tokenizer'
```

`buildMatchExpr` 函数内部调用的 `tokenizeChinese(kw)` 无需改动，因为函数名和签名一致。search.ts 中共 1 处调用（第 28 行）。

### 4.5 修改 `electron/main.ts`

在 app ready 时初始化 tokenizer。由于 `initTokenizer` 是同步的，且必须在 `rebuildAllFTSIndex` 之前完成（否则重建索引用的是旧分词器），插入位置在 `initFTSIndex` 之前：

```typescript
import { initTokenizer, loadCustomDict, isJiebaAvailable } from './ipc/tokenizer'
import { loadCustomDict as loadDictFile } from './ipc/tokenizer-dict'

app.whenReady().then(async () => {
  await initDatabase()
  const db = getDatabase()

  const fixes = runConsistencyChecks(db)
  if (fixes.length > 0) {
    console.log('[consistency]', fixes.join('; '))
  }

  // 初始化 jieba 分词器（同步，必须在 FTS 索引操作之前）
  initTokenizer()
  if (isJiebaAvailable()) {
    loadCustomDict(loadDictFile())  // 自定义词典必须在 rebuildAllFTSIndex 之前加载
  }

  const needsFTSRebuild = initFTSIndex()

  // 检查分词器版本，变更时触发全量重建
  const tokenizerVersion = db.queryOne("SELECT value FROM settings WHERE key = 'fts_tokenizer_version'")
  const needsTokenizerRebuild = tokenizerVersion?.value !== 'jieba-v1'
  if (needsTokenizerRebuild) {
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fts_tokenizer_version', 'jieba-v1')")
  }

  if (needsFTSRebuild || needsTokenizerRebuild) {
    console.log('[fts] Rebuilding FTS index...')
    rebuildAllFTSIndex(db)
    console.log('[fts] FTS index rebuild complete')
  }

  registerIpcHandlers()
  createWindow()
})
```

### 4.6 自定义词典

新增 `electron/data/jieba-custom-dict.txt`，收录写作场景常用词：

```
卡塞尔学院 100 n
言灵 100 n
混血种 100 n
蛇岐八家 100 n
源氏重工 100 n
高天原 100 n
藏骸之井 100 n
七宗罪 100 n
爆血 100 n
死侍 100 n
龙王 100 n
```

格式：`词语 词频 词性`，每行一条。词频越高越优先被识别为完整词。

**打包方式**：参考项目中字体文件的处理方式（[font.ts](../electron/ipc/font.ts)），开发模式从项目根目录读取，打包后从 `process.resourcesPath` 读取。在 `electron-builder` 配置中将 `electron/data/` 目录加入 `extraResources`。

用户也可以在应用设置中动态添加自定义词（通过 `add_word` API），解决特定作品的专有名词问题。

---

## 五、FTS5 索引兼容性

### 索引格式无变化

FTS5 虚拟表的 schema 不变，仍然是 `tokenize=unicode61`：

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  content,
  type UNINDEXED,
  entity_id UNINDEXED,
  ...
  tokenize=unicode61
)
```

变化的是写入 `content` 列的**文本内容**——从逐字空格分隔改为空格分隔的词语。`unicode61` tokenizer 按空格切分 token，所以它会正确地将每个 jieba 分词结果识别为独立 token。

### 索引迁移

由于 FTS5 的 `content` 列内容格式变化，**已有索引必须全量重建**。

触发方式：在 `main.ts` 启动逻辑中检查 `fts_tokenizer_version` 设置项，不存在或不匹配时触发全量重建（见 4.5 节）。对用户透明，首次启动新版本时自动完成。

---

## 六、降级策略

如果 jieba-wasm 加载失败（WASM 文件损坏、环境不兼容等），`initTokenizer` 会 catch 异常并设置 `jiebaAvailable = false`，后续所有 `tokenizeChinese` 调用自动使用逐字分词。

**关键约束**：降级时必须保证索引一致性。两种场景：

1. **启动时 jieba 就不可用**：`initTokenizer` 失败 → `jiebaAvailable = false` → 后续 `rebuildAllFTSIndex` 中所有 `tokenizeChinese` 调用都走逐字分词 → 索引一致 ✅
2. **运行中 jieba 出问题**：不会发生，因为 WASM 模块加载后常驻内存，不会中途卸载

由于 `initTokenizer` 在 `rebuildAllFTSIndex` 之前执行，且分词器状态在一次启动周期内不会改变，不存在"部分条目用 jieba、部分用逐字"的混合状态。

---

## 七、初始化时序

```
app.whenReady()
  │
  ├── initDatabase()              ← 现有：建表、迁移
  ├── runConsistencyChecks()      ← 现有
  ├── initTokenizer()             ← 新增：加载 jieba WASM（同步，成功或降级）
  ├── loadCustomDict()            ← 新增：加载自定义词典（前提：jieba 可用）
  ├── initFTSIndex()              ← 现有：建 FTS 虚拟表
  ├── 检查 fts_tokenizer_version  ← 新增：决定是否需要重建索引
  ├── rebuildAllFTSIndex()        ← 条件触发（首次建表 或 分词器升级）
  ├── registerIpcHandlers()       ← 现有
  └── createWindow()              ← 现有
```

`app.whenReady()` 的回调已经是 `async`，无需修改。`initTokenizer` 是同步的，不需要 await。

---

## 八、性能预估

### 分词速度

jieba-rs (Rust) 的分词速度在 WASM 环境下预估 **10~50MB/s**（受 WASM 运行时开销影响）。10MB 文本的全量分词耗时预估 **200ms~1s**，在可接受范围内。实际数据需在 E2E 测试中测量。

### 索引体积

| 指标 | 逐字分词 | jieba 分词 |
|------|---------|-----------|
| 10MB 文本的 token 数 | ~500 万 | ~150~200 万 |
| FTS5 索引体积估算 | ~20~30MB | ~8~15MB |

jieba 分词后 token 数量减少（因为词比字长），索引体积反而**下降**。

### 搜索速度

token 数量减少 → 倒排索引更紧凑 → 搜索更快。FTS5 搜索仍然是毫秒级。

---

## 九、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| jieba 分词不准（人名误切） | 中 | 搜不到特定人名 | 自定义词典 + `add_word` 动态添加 |
| WASM 加载失败 | 低 | 搜索不可用 | 自动降级回逐字分词，索引一致性由初始化时序保证 |
| 首次启动重建索引耗时长 | 低 | 启动变慢 | 数据量 10MB 内重建 < 3s，可接受 |
| Vite 打包破坏 WASM 路径 | 中 | jieba 无法加载 | vite.config.ts 中 externalize jieba-wasm |
| 自定义词典打包路径问题 | 中 | 自定义词不生效 | 参考 font.ts 的路径处理方式 |

---

## 十、测试计划

### 测试数据

使用项目根目录下的 `《龙族》.txt`（龙族 1~3 全文，约 1.8MB / 184 万字）作为知识库导入测试数据。

### 分词准确性测试

在 `electron/ipc/tokenizer.test.ts` 中验证 jieba 对龙族原文的分词效果：

```typescript
import { tokenizeChinese, initTokenizer } from './tokenizer'

beforeAll(() => initTokenizer())

test('人名词组不被拆散', () => {
  const result = tokenizeChinese('路明非在卡塞尔学院学习言灵')
  expect(result).toContain('路明非')
  expect(result).toContain('卡塞尔学院')
  expect(result).toContain('言灵')
})

test('普通词汇正确切分', () => {
  const result = tokenizeChinese('他在图书馆里看书')
  expect(result).toContain('图书馆')
  expect(result).toContain('看书')
})
```

### 搜索准确性测试：10 个龙族查询用例

将 `《龙族》.txt` 导入知识库后，对以下查询验证 FTS5 搜索结果：

| # | 查询输入 | 期望命中 | 期望不命中 | 验证要点 |
|---|---------|---------|-----------|---------|
| 1 | `路明非` | 含"路明非"的段落 | — | 人名作为完整词被 jieba 识别，不被拆成"路""明""非" |
| 2 | `卡塞尔学院` | 含"卡塞尔学院"的段落 | — | 机构名作为自定义词被完整识别 |
| 3 | `楚子航 爆血` | 同时涉及楚子航和爆血的段落 | — | 多关键词 OR 搜索，两个专有名词各自被正确分词 |
| 4 | `言灵` | 含"言灵"的段落 | — | 小说专有概念，jieba 内置词典可能不含，需自定义词典支持 |
| 5 | `龙王` | 含"龙王"的段落 | — | 常见词，jieba 应能识别 |
| 6 | `路` | 含"路明非"等"路"开头词语的段落 | — | 单字搜索，验证 jieba 对单字查询的处理（`cut("路")` = `["路"]`，匹配索引中独立的"路" token） |
| 7 | `明非` | 不应命中"路明非"（如果 jieba 将"路明非"切为整体） | "路明非"相关段落 | 验证精确分词的边界：jieba 对"路明非"的切法决定此查询是否命中。若"路明非"是整体 token，则"明非"不应命中 |
| 8 | `源稚生 源稚女` | 同时涉及源稚生和源稚女的段落 | — | 日本人名，验证 jieba 对三字人名的处理 |
| 9 | `绘梨衣` | 含"绘梨衣"的段落 | — | 日文人名，jieba 内置词典大概率不含，需通过自定义词典支持 |
| 10 | `黑月之潮` | 含"黑月之潮"的段落 | — | 小说卷名，验证四字专有名词的分词 |

**用例 7 的补充说明**：

jieba 对"路明非"的分词结果取决于其内置词典。如果"路明非"不在词典中，jieba 可能切为 `["路", "明非"]` 或 `["路明", "非"]`。这种情况下：
- 查询"明非"可能命中（如果索引中存在"明非" token）
- 解决方案：将主要角色名加入自定义词典（`add_word("路明非")`），确保被切为整体

**自定义词典中应预置的角色名**：

```
路明非 100 nr
楚子航 100 nr
恺撒 100 nr
绘梨衣 100 nr
源稚生 100 nr
源稚女 100 nr
酒德麻衣 100 nr
昂热 100 nr
康斯坦丁 100 nr
夏弥 100 nr
路鸣泽 100 nr
```

### E2E 测试

扩展现有 `e2e/knowledge-search.spec.ts`：

1. **精确词搜索**：搜索 jieba 能正确分词的词语，验证命中
2. **误匹配排除**：搜索子串（如"法学"），验证不命中"魔法学院"
3. **自定义词搜索**：添加自定义词后验证分词和搜索正确
4. **索引迁移**：升级后首次启动验证索引自动重建

### 手动验证

导入 `《龙族》.txt` 到知识库后，对比搜索效果：

```bash
# 预览 jieba 对龙族原文的分词效果
node -e "
  const j = require('jieba-wasm');
  j.add_word('路明非', 100);
  j.add_word('卡塞尔学院', 100);
  j.add_word('楚子航', 100);
  j.add_word('言灵', 100);
  console.log(j.cut('路明非在卡塞尔学院和楚子航一起修炼言灵', true));
"
# 期望：['路明非', '在', '卡塞尔学院', '和', '楚子航', '一起', '修炼', '言灵']
```

---

## 十一、实施步骤

1. 安装依赖：`npm install jieba-wasm`
2. 修改 `vite.config.ts`：将 `jieba-wasm` 加入 `external`
3. 新建 `electron/ipc/tokenizer.ts`：封装 `initTokenizer`、`tokenizeChinese`、自定义词典加载
4. 修改 `electron/ipc/fts.ts`：删除本地 `tokenizeChinese`，改为从 `./tokenizer` 导入
5. 修改 `electron/ipc/search.ts`：`tokenizeChinese` 导入来源改为 `./tokenizer`
6. 修改 `electron/main.ts`：启动时调用 `initTokenizer` + `loadCustomDict`，插入分词器版本检查
7. 新建 `electron/data/jieba-custom-dict.txt`：龙族角色名 + 写作场景自定义词
8. 编写单元测试（`tokenizer.test.ts`）
9. 扩展 E2E 测试（`knowledge-search.spec.ts`）
10. 导入 `《龙族》.txt` 手动验证 10 个查询用例
