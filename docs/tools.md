# 工具说明文档

## 一、工具描述（toolDefinitions）

共 16 个工具：

### 1. list_chapters
> 查看章节的标题和大纲。可通过 chapter_index 查单个，chapters 批量查。不传参数时默认返回当前章节在内的前面10章及后5章（如有）。如需查看章节正文内容请使用 read_chapter_content

**参数：**
- `chapter_index` (number, 可选): 章节序号，1 表示第一章。与 chapters 二选一
- `chapters` (number[], 可选): 章节序号数组，如 [1,3,5] 表示查第1、3、5章。与 chapter_index 二选一

### 2. read_chapter_content
> 读取指定章节的完整正文内容。如果提示章节不存在，请先用 list_chapters 查看当前有哪些章节

**参数：**
- `chapter_index` (number, 必填): 章节序号，1 表示第一章

### 3. write_chapter_outline
> 更新章节大纲。可单章更新或批量更新。批量更新时传 chapters 数组，每项包含 chapter_index 和 outline；单章更新时传 chapter_index 和 outline。如需批量创建新章节请先调用 create_chapter

**参数：**
- `chapter_index` (number, 可选): 章节序号，1 表示第一章。单章模式必填
- `outline` (string, 可选): 章节大纲，建议200字内。单章模式必填
- `chapters` (array, 可选): 批量更新多个章节的大纲，每项包含 chapter_index 和 outline。与 chapter_index/outline 二选一

### 4. list_character_card
> 读取全部角色卡的完整详细信息（包含名称、别名、定位、描述、性格、外貌、背景、人际关系、备注等所有字段）

**参数：** 无

### 5. read_character_card
> 读取指定角色卡的完整详细信息。如果提示角色不存在，请先用 list_character_card 查看当前有哪些角色

**参数：**
- `name` (string, 必填): 角色名称

### 6. write_character_card
> 创建或更新角色卡。单张模式传 name + 其它字段；批量模式传 cards 数组（每项含 name + 其它字段），可一次处理多个角色。如果角色名不存在则直接创建；如果已存在则需用户确认后更新

**参数：**
- `name` (string, 可选): 角色名称（单张模式）
- `new_name` (string, 可选): 修改后的新名称（单张模式）
- `reason` (string, 可选): 修改原因，仅在单张模式下传
- `alias` (string, 可选): 别名/称号
- `description` (string, 可选): 角色描述
- `role` (string, 可选): 角色定位
- `traits` (string, 可选): 性格标签，顿号分隔
- `appearance` (string, 可选): 外貌描述
- `background` (string, 可选): 背景故事
- `relationships` (string, 可选): 人际关系
- `notes` (string, 可选): 备注
- `gender` (string, 可选): 性别
- `age` (string, 可选): 年龄
- `cards` (array, 可选): 批量模式。角色数组，每项结构同上（name 必填）。传此参数时忽略顶层的 name 等单字段

### 7. list_world_setting
> 读取全部世界观设定的完整详细信息（包含名称、类型、描述、标签等所有字段）

**参数：** 无

### 8. read_world_setting
> 读取指定世界观设定的完整详细信息。如果提示世界观不存在，请先用 list_world_setting 查看当前有哪些世界观设定

**参数：**
- `name` (string, 必填): 世界观元素名称

### 9. write_world_setting
> 创建或更新世界观设定。单张模式传 name + 其它字段；批量模式传 cards 数组（每项含 name + 其它字段），可一次处理多个设定。如果世界观名称不存在则直接创建；如果已存在则需用户确认后更新

**参数：**
- `name` (string, 可选): 世界观元素名称（单张模式）
- `new_name` (string, 可选): 修改后的新名称（单张模式）
- `reason` (string, 可选): 修改原因，仅在单张模式下传
- `description` (string, 可选): 描述
- `type` (string, 可选): 类型
- `tags` (string, 可选): 标签，顿号分隔
- `notes` (string, 可选): 备注
- `cards` (array, 可选): 批量模式。世界观数组，每项结构同上（name 必填）。传此参数时忽略顶层的 name 等单字段

### 10. read_outline
> 查看全书大纲的完整内容

**参数：** 无

### 11. write_outline
> 创建或更新全书大纲。如果大纲不存在则直接创建；如果已存在则需用户确认后覆盖更新。content 必须使用 HTML 格式，不要使用 Markdown 语法

**参数：**
- `content` (string, 必填): 全书大纲内容，必须使用 HTML 格式。示例：`<h1>《书名》全书大纲</h1><hr><h2>第一卷：卷名</h2><p><strong>核心主题：</strong>主题描述</p><h3>第1-4章：章节名</h3><p><strong>剧情脉络：</strong>剧情描述</p>`。禁止使用 `#`、`**`、`---` 等 Markdown 语法
- `reason` (string, 可选): 修改原因，帮助用户理解为什么需要替换大纲

### 12. create_chapter
> 批量创建空白章节。只负责创建空的章节占位，不涉及标题、大纲、正文。创建后请分别用 write_chapter_title 设置标题、write_chapter_outline 设置大纲

**参数：**
- `count` (number, 必填): 要创建的章节数量，追加到现有章节之后

### 13. update_progress
> 更新写作进度，追加到全书大纲末尾。写完若干章节后调用此工具，同步当前已完成章节的写作情况。content 必须使用 HTML 格式

**参数：**
- `content` (string, 必填): 写作进度描述，必须使用 HTML 格式。示例：`<p>已完成第1-3章，正在进行第4章</p>`。禁止使用 `#`、`**`、`---` 等 Markdown 语法

### 14. write_chapter_title
> 修改章节标题。可单章更新或批量更新。批量更新时传 chapters 数组，每项包含 chapter_index 和 title；单章更新时传 chapter_index 和 title

**参数：**
- `chapter_index` (number, 可选): 章节序号，1 表示第一章。单章模式必填
- `title` (string, 可选): 新的章节标题。单章模式必填
- `chapters` (array, 可选): 批量更新多个章节的标题，每项包含 chapter_index 和 title。与 chapter_index/title 二选一

### 15. write_chapter_content
> 写入或修改章节正文。空章节首次写作传 `content`（纯文本，段间 `\n\n`）；非空章节用 `edits`/`inserts` 按 1-based 段落序号写入。修改前须 `read(type=chapter_content)` 获取 `[Pn]` 编号。`text` 为空表示删除该段。

**参数：**
- `chapter_index` (number, 必填): 章节序号
- `summary` (string, 必填): 修改说明
- `content` (string, 可选): 空章节首次写作的全文纯文本
- `edits` (array, 可选): `[{ paragraph_index, text }]` 替换或删除段落
- `inserts` (array, 可选): `[{ after_paragraph_index, text }]` 插入新段（0=文首）

### 16. propose_action
> 向用户提交多个选项供选择。当用户要求提供多个方案（如多个标题建议、多个剧情走向等）时使用此工具提交选项让用户选择。用户选择后，AI 会收到用户的选择结果，然后根据用户选择调用对应的工具来执行操作

**参数：**
- `type` (string, 必填): 操作类型，如：rename_chapter 表示修改章节标题
- `options` (string[], 必填): 多个建议选项，通常 2-3 个，用户将从中选择
- `chapter_index` (number, 可选): 章节序号，1 表示第一章
- `params` (object, 可选): 其他参数，用户选择后执行操作时可能需要

---

## 二、toolUsageGuide（工具使用指南）

```
你可以使用以下工具辅助写作。当用户要求你执行某个操作时，请调用对应的工具来完成，不要仅回复文本。

- list_chapters：查看章节标题和大纲。指定 chapter_index 查单个，chapters 数组批量查，不传参默认查当前章节前10章和后5章。想看正文请用 read_chapter_content
- read_chapter_content：读取指定章节正文，查阅前文细节
- write_chapter_outline：保存章节大纲。可单章更新(chapter_index+outline)或批量更新(chapters数组)。用户要求生成章节大纲时调用此工具
- create_chapter：批量创建空白章节，只创建占位。创建后请用 write_chapter_title 和 write_chapter_outline 设置标题和大纲
- write_chapter_title：修改章节标题。可单章更新(chapter_index+title)或批量更新(chapters数组)
- list_character_card：读取全部角色卡的完整信息
- read_character_card：按名称读取指定角色卡的完整信息
- write_character_card：创建或更新角色卡信息，支持批量（cards 数组）。更新已有角色时需用户确认，创建新角色则直接执行
- list_world_setting：读取全部世界观设定的完整信息
- read_world_setting：按名称读取指定世界观设定的完整信息
- write_world_setting：创建或更新世界观设定信息，支持批量（cards 数组）。更新已有设定时需用户确认，创建新设定则直接执行
- read_outline：查看全书大纲的完整内容
- write_outline：创建或更新全书大纲（需使用 HTML 格式）
- update_progress：写完章节后更新写作进度（需使用 HTML 格式）
- write_chapter_content：写入章节正文。空章节用 content；修改已有正文前须 read(type=chapter_content) 获取 [Pn]，再用 edits/inserts 按段写入
- propose_action：向用户提交多个选项供选择。用户选择后将结果告知你，你再根据用户选择调用对应工具执行操作
```
