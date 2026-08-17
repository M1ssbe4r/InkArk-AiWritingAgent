import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const page1 = `## API 配置

标题栏右上角 → 设置 → API 配置

InkArk 不内置任何 API — 你需要自备 OpenAI 兼容服务(DeepSeek / OpenAI / 智源 / 硅基流动 / 自部署 Ollama 等),在「设置 → API 配置」里添加。知识库的语义搜索复用同一组配置(需要上游支持 /v1/embeddings 端点)。

你也可以自备 API，目前支持 DeepSeek 和 OpenAI 兼容格式。可以在 AI 面板底部点击当前 API 名称切换配置。

---

## 作品管理

点击标题栏中央的作品名称，弹出管理菜单：

- **新建作品**：创建新作品
- **切换作品**：在下拉列表中选择其他作品
- **重命名**：修改当前作品名称
- **导出作品**：支持四种格式——InkArk 项目备份（\`.inkark\`）、TXT、Markdown、Word。TXT/Markdown/Word 导出时可设置书名、作者和章节范围
- **导入作品**：选择文件后按格式自动分支。① \`.inkark\` 备份文件 — 完整恢复整个项目 ② \`.txt\` / \`.md\` / \`.doc\` / \`.docx\` — 自动识别章节并生成新项目,可选预设规则或自定义分隔符
- **删除当前作品**：不可恢复，需确认

---

## 章节编辑器

- **章节标题**：编辑器顶部直接编辑
- **章节大纲**：标题下方文本框，可手动编写或 AI 生成。工具栏右侧有「总结大纲」按钮，AI 可自动提炼章节剧情
- **字数统计**：底部状态栏实时显示当前章节字数和保存状态`

const page2 = `## AI 写作助手

### 基本使用

点击右侧 AI 面板图标打开对话界面，支持两种模式：

- **Write 模式**：AI 可以修改章节内容、创建角色/世界观等
- **Chat 模式**：AI 只能查看项目信息，不能修改

具备如下功能：

- 查看、创建、修改章节（标题、大纲、正文）
- 查看、创建、修改角色卡
- 查看、创建、修改世界观设定
- 查看、更新全书大纲和写作进度

### 预设功能

选中文本右键，可以看到预设的：润色、缩写、扩写、发送到聊天框功能。

### 自定义按钮

AI 面板底部有可自定义的快捷命令按钮：

- 右键可编辑或删除按钮
- 点击「+」可添加新按钮
- 每个按钮支持「直接发送」和「生成三份」选项

### 对话历史

每个作品独立保存对话历史（最多 50 条），切换作品时自动保存/加载。

---

## 全书大纲

点击左侧栏「目录」→「全书大纲」即可查看/编辑：

- **富文本编辑器**：支持标题、加粗、斜体、下划线等格式，所见即所得
- **AI 生成**：点击「重新生成」，输入书名、章节数量、故事创意，AI 生成完整大纲

---

## 角色管理

点击左侧栏「角色」按钮查看角色列表：

- 支持按名称搜索、按标签筛选
- 每个角色卡包含：名称、别名、定位、性别、年龄、特质、外貌、描述、背景、人际关系、备注、标签、分组等字段
- AI 支持批量创建或更新多个角色卡

---

## 世界观管理

点击左侧栏「世界观」按钮查看设定列表：

- 支持按名称搜索、按类型筛选（地点、组织、规则、物品、其他）
- AI 支持批量创建或更新多个世界观设定

---

## 写作风格

点击左侧栏「写作风格」按钮：

- **内置风格**：默认、古风、热血、轻松、悬疑、细腻
- **自定义风格**：支持添加、编辑、删除自定义风格，每个风格可设置名称和写作指导语

## 规则

点击左侧栏「规则」按钮：

- **规则与限制**：自定义规则与限制，AI 将遵守这些规则与限制
- **敏感词管理**：添加自定义敏感词，内置敏感词不可删除`

const page3 = `## 版本控制

点击标题栏右侧的「版本历史」按钮查看历史版本：

- 每次关闭应用时自动提交版本
- 支持查看版本详情（变更的章节、角色、世界观等）
- 支持回退到历史版本（回退前会自动保存当前状态）
- 支持手动提交版本
- 支持删除单个版本或清除全部历史

---

## 知识库

点击左侧栏「知识库」按钮，可管理项目相关的参考资料和知识条目，AI 在对话时可引用知识库内容。

---

## 字体设置

在设置 → 字体设置中可配置：

- **编辑器字体**：支持内置字体和自定义字体（TTF/OTF/WOFF2）
- **编辑器字号**：10-28px
- **编辑器字重**：细体到粗体
- **编辑器行间距**：1.0-2.5
- **界面字号**：影响整体 UI
- **对话字号**：影响 AI 聊天面板

---

## 数据存储

- 数据库位置按平台区分：
  - **Windows**：\`{安装目录}\\data\\inkark.db\`（便携式，升级时自动备份恢复）
  - **macOS**：\`~/Library/Application Support/InkArk/inkark.db\`
- 建议定期使用「导出作品」备份为 \`.inkark\` 文件`

const pages = [
  { id: 'quickstart', label: '快速开始', content: page1 },
  { id: 'aiwriting', label: 'AI 写作', content: page2 },
  { id: 'other', label: '其他功能', content: page3 },
]

export function HelpDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>使用指南</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="quickstart" className="flex-1 flex flex-col min-h-0">
          <TabsList className="shrink-0">
            {pages.map((p) => (
              <TabsTrigger key={p.id} value={p.id}>{p.label}</TabsTrigger>
            ))}
          </TabsList>
          {pages.map((p) => (
            <TabsContent key={p.id} value={p.id} className="flex-1 min-h-0">
              <ScrollArea className="h-full">
                <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-table:text-xs prose-th:border prose-th:border-border prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1 prose-th:bg-muted/50 prose-code:text-foreground prose-code:bg-muted/70 prose-code:px-1 prose-code:rounded [&_table]:w-full [&_table]:table-fixed [&_h2]:text-base [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:pb-1 [&_h2]:border-b [&_h3]:text-sm [&_h3]:mt-4 [&_h3]:mb-1">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.content}</ReactMarkdown>
                </div>
              </ScrollArea>
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
