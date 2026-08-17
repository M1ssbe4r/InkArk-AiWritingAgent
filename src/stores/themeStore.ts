import { create } from 'zustand'

export interface Theme {
  id: string
  name: string
  description?: string
  // CSS variables to apply on :root
  tokens: {
    '--canvas-bg-from': string
    '--canvas-bg-via': string
    '--canvas-bg-to': string
    '--surface-floating': string
    '--glass-border': string
    '--glass-border-strong': string
  }
}

// Each theme is a complete set of tokens that match the current `index.css` defaults.
// Switching themes just rewrites these variables on :root — no other changes required.
export const themes: Theme[] = [
  {
    id: 'classic-gray',
    name: '经典灰白',
    description: '中性灰背景配纯白卡片，常规办公软件风格',
    tokens: {
      '--canvas-bg-from': '220 14% 90%',
      '--canvas-bg-via': '220 14% 92%',
      '--canvas-bg-to': '220 14% 88%',
      '--surface-floating': '0 0% 100%',
      '--glass-border': '0 0% 100%',
      '--glass-border-strong': '220 13% 85%',
    },
  },
  {
    id: 'blue-violet',
    name: '蓝紫渐变',
    description: '冷色蓝紫主调，配合淡青过渡，玻璃卡片更立体',
    tokens: {
      '--canvas-bg-from': '220 35% 78%',
      '--canvas-bg-via': '250 30% 84%',
      '--canvas-bg-to': '200 40% 76%',
      '--surface-floating': '0 0% 100%',
      '--glass-border': '0 0% 100%',
      '--glass-border-strong': '220 13% 91%',
    },
  },
]

const STORAGE_KEY = 'inkark-theme-id'

interface ThemeStore {
  currentThemeId: string
  setTheme: (id: string) => void
  apply: (id: string) => void
}

function loadInitial(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && themes.some((t) => t.id === v)) return v
  } catch {}
  return themes[0].id
}

function applyThemeToRoot(id: string) {
  const theme = themes.find((t) => t.id === id) || themes[0]
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme.tokens)) {
    root.style.setProperty(k, v)
  }
}

export const useThemeStore = create<ThemeStore>((set) => ({
  currentThemeId: typeof window !== 'undefined' ? loadInitial() : themes[0].id,
  setTheme: (id: string) => {
    applyThemeToRoot(id)
    try { localStorage.setItem(STORAGE_KEY, id) } catch {}
    set({ currentThemeId: id })
  },
  apply: (id: string) => applyThemeToRoot(id),
}))

// Apply current theme on module load (handles refresh / cold start)
if (typeof window !== 'undefined') {
  applyThemeToRoot(loadInitial())
}
