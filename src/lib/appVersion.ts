export const APP_VERSION = '0.9.5'

const LAST_SEEN_KEY = 'inkark-last-seen-version'

export type ReleaseNoteSection = {
  title: string
  items: string[]
}

export const RELEASE_NOTES: Record<string, ReleaseNoteSection[]> = {
  '0.9.5': [
    {
      title: '新功能',
      items: [
        'AI 审稿：工具栏一键审稿，对照卷纲、角色卡与世界观检查逻辑一致性，可一键发送 AI 按意见修改',
        '段落级 AI 写作：正文按段落编号读写，编辑器左侧显示段号，润色/扩写更精准',
        '变更审阅优化：按段落对比改动，采纳或回退更清晰',
        '规则与限制改为每个作品独立设置，切换作品互不影响',
        '标题栏新增「反馈问题」，可在线提交反馈并导出诊断日志',
        '自动更新：启动后后台检查新版本，支持增量下载安装',
      ],
    },
    {
      title: '问题修复',
      items: [
        '修复导出 Word/TXT/Markdown 时未包含未保存编辑内容、段落格式错乱的问题',
        '修复导入 .inkark 备份时写作规则与限制丢失的问题',
        '修复导入 Markdown、TXT 文件失败的问题',
        '修复 AI 面板自定义快捷按钮无法编辑的问题',
        '修复 AI 修改正文时原文片段匹配失败导致无法写入的问题',
      ],
    },
  ],
}

export function getReleaseNotes(version = APP_VERSION): ReleaseNoteSection[] {
  return RELEASE_NOTES[version] ?? []
}

export function shouldShowReleaseNotes(): boolean {
  return localStorage.getItem(LAST_SEEN_KEY) !== APP_VERSION
}

export function markReleaseNotesSeen(): void {
  localStorage.setItem(LAST_SEEN_KEY, APP_VERSION)
}
