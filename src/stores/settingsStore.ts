import { create } from 'zustand'

export interface FontSettings {
  editorFont: string
  editorFontSize: number
  editorFontWeight: number
  editorLineHeight: number
  uiFont: string
  uiFontSize: number
  chatFontSize: number
}

function load(): FontSettings {
  const defaults = { editorFont: 'NSimSun', editorFontSize: 18, editorFontWeight: 400, editorLineHeight: 1.6, uiFont: 'MiSans', uiFontSize: 18, chatFontSize: 18 }
  try {
    const raw = localStorage.getItem('inkark-font')
    if (raw) {
      const saved = JSON.parse(raw)
      return { ...defaults, editorFont: saved.editorFont || defaults.editorFont, editorFontSize: saved.editorFontSize ?? defaults.editorFontSize, editorFontWeight: saved.editorFontWeight ?? defaults.editorFontWeight, editorLineHeight: saved.editorLineHeight ?? defaults.editorLineHeight, uiFont: saved.uiFont || defaults.uiFont, uiFontSize: saved.uiFontSize ?? defaults.uiFontSize, chatFontSize: saved.chatFontSize ?? defaults.chatFontSize }
    }
  } catch {}
  return defaults
}

function save(s: FontSettings) {
  localStorage.setItem('inkark-font', JSON.stringify(s))
  applyCSS(s)
}

function applyCSS(s: FontSettings) {
  const root = document.documentElement
  root.style.setProperty('--font-editor', `"${s.editorFont}"`)
  root.style.setProperty('--font-editor-size', s.editorFontSize + 'px')
  root.style.setProperty('--font-editor-weight', String(s.editorFontWeight))
  root.style.setProperty('--font-editor-line-height', String(s.editorLineHeight))
  root.style.setProperty('--font-ui', `"${s.uiFont}"`)
  root.style.setProperty('--font-ui-size', s.uiFontSize + 'px')
  root.style.setProperty('--font-chat-size', s.chatFontSize + 'px')
  root.style.fontSize = s.uiFontSize + 'px'
}

interface SettingsState {
  font: FontSettings
  setEditorFont: (font: string) => void
  setEditorFontSize: (size: number) => void
  setEditorFontWeight: (weight: number) => void
  setEditorLineHeight: (lineHeight: number) => void
  setUiFont: (font: string) => void
  setUiFontSize: (size: number) => void
  setChatFontSize: (size: number) => void
}

const initial = load()
applyCSS(initial)

export const useSettingsStore = create<SettingsState>((set, get) => ({
  font: initial,
  setEditorFont: (editorFont) => {
    const next = { ...get().font, editorFont }
    save(next)
    set({ font: next })
  },
  setEditorFontSize: (editorFontSize) => {
    const next = { ...get().font, editorFontSize }
    save(next)
    set({ font: next })
  },
  setEditorFontWeight: (editorFontWeight) => {
    const next = { ...get().font, editorFontWeight }
    save(next)
    set({ font: next })
  },
  setEditorLineHeight: (editorLineHeight) => {
    const next = { ...get().font, editorLineHeight }
    save(next)
    set({ font: next })
  },
  setUiFont: (uiFont) => {
    const next = { ...get().font, uiFont }
    save(next)
    set({ font: next })
  },
  setUiFontSize: (uiFontSize) => {
    const next = { ...get().font, uiFontSize }
    save(next)
    set({ font: next })
  },
  setChatFontSize: (chatFontSize) => {
    const next = { ...get().font, chatFontSize }
    save(next)
    set({ font: next })
  },
}))
