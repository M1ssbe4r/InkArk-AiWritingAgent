import { buildSystemPrompt } from './api'

interface ContextInput {
  projectId: string
  chapterId: string
  editorView?: 'chapter' | 'outline'
  styleGuidance?: string
  styleRestrictions?: string
  outlineOverride?: string
  currentContent?: string
}

export interface ContextSections {
  project?: string
  location?: string
  knowledgeHint?: string
}

export async function assembleContext(input: ContextInput): Promise<{
  systemPrompt: string
  sections: ContextSections
}> {
  const projectList = await window.electronAPI.project.list()
  const project = projectList.find((p: any) => p.id === input.projectId)
  const projectTitle = project?.title || ''

  const allChapters = await window.electronAPI.chapter.list(input.projectId)
  const currentChapter = allChapters.find((c: any) => c.id === input.chapterId)
  const chIdx = currentChapter ? allChapters.indexOf(currentChapter) + 1 : 0
  const currentChapterTitle = currentChapter ? `第${chIdx}章 ${currentChapter.title}` : ''

  const sensitiveWordsList = await window.electronAPI.sensitive.list()
  const sensitiveWords = sensitiveWordsList.map((w: any) => w.word).filter(Boolean)

  const systemPrompt = buildSystemPrompt(input.styleGuidance, input.styleRestrictions, sensitiveWords.length > 0 ? sensitiveWords : undefined)

  const sections: ContextSections = {}
  const location = input.editorView === 'outline' ? '全书大纲' : currentChapterTitle
  if (location) sections.location = buildSection('当前位置', location)
  if (projectTitle) sections.project = `书名：《${projectTitle}》`

  try {
    const enabledItems = await window.electronAPI.knowledge.getEnabled(input.projectId)
    if (enabledItems.length > 0) {
      const names = enabledItems.map((item) => {
        const vectorStatus = item.chunk_count > 0 ? '（已向量化）' : '（未向量化）'
        return `《${item.name}》${vectorStatus}`
      }).join('、')
      sections.knowledgeHint = `【知识库】本项目已启用知识库资料${names}，涉及原著内容、人物设定、世界观等已有信息时，可根据情况使用 search 工具检索。`
    } else {
      sections.knowledgeHint = `【知识库】用户暂未附加知识库资料。`
    }
  } catch (err) {
    console.error('Failed to get knowledge context:', err)
  }

  return { systemPrompt, sections }
}

export function buildContextPrefix(sections: ContextSections): string {
  const parts: string[] = []
  if (sections.project) parts.push(sections.project)
  if (sections.location) parts.push(sections.location)
  return parts.join('\n\n')
}

function buildSection(title: string, ...lines: string[]): string {
  return `【${title}】\n${lines.join('\n')}`
}
