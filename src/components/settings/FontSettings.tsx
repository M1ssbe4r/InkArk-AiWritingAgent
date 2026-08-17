import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'

const builtinFonts = [
  { value: 'MiSans', label: 'MiSans (内置)' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'NSimSun', label: 'NSimSun (新宋体)' },
  { value: 'monospace', label: 'monospace' },
]

const weights = [
  { value: 300, label: '细' },
  { value: 400, label: '标准' },
  { value: 500, label: '中等' },
  { value: 600, label: '半粗' },
  { value: 700, label: '粗' },
]

interface UserFont {
  name: string
  file: string
  path: string
}

function injectFontFace(font: UserFont) {
  const existing = document.getElementById(`font-face-${font.name}`)
  if (existing) return
  const ext = font.file.split('.').pop()?.toLowerCase()
  let format = 'truetype'
  if (ext === 'otf') format = 'opentype'
  else if (ext === 'woff2') format = 'woff2'
  else if (ext === 'woff') format = 'woff'
  const style = document.createElement('style')
  style.id = `font-face-${font.name}`
  style.textContent = `@font-face { font-family: '${font.name}'; src: url('file:///${font.path.replace(/\\/g, '/')}') format('${format}'); }`
  document.head.appendChild(style)
}

export function FontSettings() {
  const font = useSettingsStore((s) => s.font)
  const setEditorFont = useSettingsStore((s) => s.setEditorFont)
  const setEditorFontSize = useSettingsStore((s) => s.setEditorFontSize)
  const setEditorFontWeight = useSettingsStore((s) => s.setEditorFontWeight)
  const setEditorLineHeight = useSettingsStore((s) => s.setEditorLineHeight)
  const setUiFontSize = useSettingsStore((s) => s.setUiFontSize)
  const setChatFontSize = useSettingsStore((s) => s.setChatFontSize)

  const [userFonts, setUserFonts] = useState<UserFont[]>([])

  useEffect(() => {
    window.electronAPI.font.list().then((fonts: UserFont[]) => {
      fonts.forEach(injectFontFace)
      setUserFonts(fonts)
    })
  }, [])

  const allFonts = [
    ...builtinFonts,
    ...userFonts.map(f => ({ value: f.name, label: f.name })),
  ]

  return (
    <div className="space-y-5">
      <div>
        <h4 className="text-base font-medium mb-3">编辑器字体</h4>
        <div className="space-y-3">
          <div>
            <Label>字体</Label>
            <Select value={font.editorFont} onValueChange={setEditorFont}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {allFonts.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">
              {window.electronAPI?.platform === 'darwin'
                ? '将字体文件放入 ~/Library/Application Support/InkArk/fonts/ 可添加自定义字体'
                : '将字体文件放入安装目录下的 fonts 文件夹可添加自定义字体'}
            </p>
          </div>
          <div>
            <Label>字号: {font.editorFontSize}px</Label>
            <Slider value={[font.editorFontSize]} onValueChange={([v]) => setEditorFontSize(v)} min={10} max={28} step={1} />
          </div>
          <div>
            <Label>粗细: {font.editorFontWeight}</Label>
            <Slider value={[font.editorFontWeight]} onValueChange={([v]) => setEditorFontWeight(v)} min={300} max={700} step={100} />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
              {weights.map((w) => <span key={w.value}>{w.label}</span>)}
            </div>
          </div>
          <div>
            <Label>行距: {font.editorLineHeight.toFixed(1)}</Label>
            <Slider value={[font.editorLineHeight]} onValueChange={([v]) => setEditorLineHeight(v)} min={1.0} max={2.5} step={0.1} />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
              <span>紧凑</span>
              <span>宽松</span>
            </div>
          </div>
          <div className="rounded border p-3 mt-2 text-xs" style={{ fontFamily: font.editorFont, fontSize: font.editorFontSize, fontWeight: font.editorFontWeight, lineHeight: font.editorLineHeight }}>
            天地玄黄 宇宙洪荒 日月盈昃 辰宿列张
            <br />Hello World! 12345
          </div>
        </div>
      </div>
      <div>
        <h4 className="text-base font-medium mb-3">界面字体</h4>
        <div className="space-y-3">
          <div>
            <Label>界面字号: {font.uiFontSize}px</Label>
            <Slider value={[font.uiFontSize]} onValueChange={([v]) => setUiFontSize(v)} min={11} max={20} step={1} />
          </div>
        </div>
      </div>
      <div>
        <h4 className="text-base font-medium mb-3">对话区字体</h4>
        <div className="space-y-3">
          <div>
            <Label>对话字号: {font.chatFontSize}px</Label>
            <Slider value={[font.chatFontSize]} onValueChange={([v]) => setChatFontSize(v)} min={10} max={24} step={1} />
          </div>
          <div className="rounded border p-3 mt-2 text-xs leading-relaxed" style={{ fontFamily: font.uiFont, fontSize: font.chatFontSize }}>
            这是一段 AI 对话文字的预览效果。
            <br />可以在这里调整对话区字号。
          </div>
        </div>
      </div>
    </div>
  )
}
