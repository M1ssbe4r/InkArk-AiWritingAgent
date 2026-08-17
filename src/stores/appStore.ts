import { create } from 'zustand'

type SidebarView = 'outline' | 'characters' | 'world' | 'bookoutline' | 'style' | 'restrictions' | 'knowledge' | 'none'
type EditorView = 'chapter' | 'outline'

interface PendingLegacyOutline {
  projectId: string
  outlineHtml: string
}

interface AppState {
  sidebarView: SidebarView
  setSidebarView: (view: SidebarView) => void
  editorView: EditorView
  setEditorView: (view: EditorView) => void
  isAIPanelOpen: boolean
  setAIPanelOpen: (open: boolean) => void
  debugMode: boolean
  setDebugMode: (v: boolean | ((prev: boolean) => boolean)) => void
  exportOpen: boolean
  setExportOpen: (open: boolean) => void
  pendingLegacyOutline: PendingLegacyOutline | null
  setPendingLegacyOutline: (p: PendingLegacyOutline | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarView: 'outline',
  setSidebarView: (view) => set({ sidebarView: view }),
  editorView: 'chapter',
  setEditorView: (view) => set({ editorView: view }),
  isAIPanelOpen: true,
  setAIPanelOpen: (open) => set({ isAIPanelOpen: open }),
  debugMode: false,
  setDebugMode: (v) => set((state) => ({ debugMode: typeof v === 'function' ? v(state.debugMode) : v })),
  exportOpen: false,
  setExportOpen: (open) => set({ exportOpen: open }),
  pendingLegacyOutline: null,
  setPendingLegacyOutline: (p) => set({ pendingLegacyOutline: p }),
}))
