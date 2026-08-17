import { useState, useEffect } from 'react'
import { useEditorStore } from '@/stores/editorStore'
import { getEditor, getOutlineEditor } from '@/lib/editorRef'
import { countChars } from '@/lib/utils'
import { useAppStore } from '@/stores/appStore'

import { APP_VERSION } from '@/lib/appVersion'

export function StatusBar() {
  const isDirty = useEditorStore((s) => s.isDirty)
  const chapters = useEditorStore((s) => s.chapters)
  const activeChapterId = useEditorStore((s) => s.activeChapterId)
  const editorView = useAppStore((s) => s.editorView)
  const [wordCount, setWordCount] = useState(0)

  // 全书总字数 = 全部章节 word_count 之和 (导入时已写入 db)
  const totalWordCount = chapters.reduce((sum, ch) => sum + (ch.word_count || 0), 0)

  // 把大数字格式化成"X万Y"的形式: 3464203 → 346万4203; 不满 1 万则不加"万"前缀
  const formatWan = (n: number) => {
    if (n < 10000) return String(n)
    const wan = Math.floor(n / 10000)
    const rest = n % 10000
    return `${wan}万${rest}`
  }

  useEffect(() => {
    const tick = () => {
      // 优先用当前激活章节/大纲编辑器,未挂载时回退到 db 字段
      if (editorView === 'outline') {
        const ed = getOutlineEditor()
        if (ed) {
          // 与 db 里 word_count 口径完全一致: HTML 剥标签后的纯文本长度
          // (Tiptap getText() 会在块级元素间插入额外换行, 与 db 算法不一致)
          setWordCount(countChars(ed.getHTML()))
          return
        }
        setWordCount(0)
        return
      }
      const ed = getEditor()
      if (ed) {
        setWordCount(countChars(ed.getHTML()))
        return
      }
      const ch = chapters.find((c) => c.id === activeChapterId)
      setWordCount(ch?.word_count || 0)
    }
    tick()
    const interval = setInterval(tick, 500)
    return () => clearInterval(interval)
  }, [editorView, chapters, activeChapterId])

  return (
    <div className="flex h-5 items-center justify-between border-t border-white/30 px-3">
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span>{isDirty ? '未保存' : '已保存'}</span>
        <span>{wordCount} 字</span>
        <span>共 {formatWan(totalWordCount)} 字</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        InkArk v{APP_VERSION}
      </div>
    </div>
  )
}
