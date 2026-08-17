/// <reference types="vite/client" />

interface ElectronAPI {
  platform: NodeJS.Platform
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  setFullscreen: (fullscreen: boolean) => Promise<void>
  apiConfig: {
    list: () => Promise<any[]>
    create: (config: any) => Promise<any>
    update: (config: any) => Promise<any>
    delete: (id: string) => Promise<any>
    test: (config: any) => Promise<{ success: boolean; error?: string }>
    getDefault: () => Promise<any>
  }
  preset: {
    list: () => Promise<any[]>
    create: (preset: any) => Promise<any>
    update: (preset: any) => Promise<any>
    delete: (id: string) => Promise<any>
    getByConfig: (configId: string) => Promise<any>
  }
  project: {
    list: () => Promise<any[]>
    create: (project: any) => Promise<any>
    update: (project: any) => Promise<any>
    delete: (id: string) => Promise<any>
    export: (projectId: string) => Promise<any>
    import: (backup: any) => Promise<{ success: boolean; projectId: string }>
    getStyleGuidance: (projectId: string) => Promise<string>
    setStyleGuidance: (projectId: string, guidance: string) => Promise<{ success: boolean }>
    getStyle: (projectId: string) => Promise<{ guidance: string; customStyleId: string | null }>
    setStyle: (projectId: string, customStyleId: string | null) => Promise<{ success: boolean; error?: string }>
    getWritingRestrictions: (projectId: string) => Promise<string>
    setWritingRestrictions: (projectId: string, restrictions: string) => Promise<{ success: boolean }>
    markOutlineMigrated: (projectId: string) => Promise<{ success: boolean }>
  }
  customStyle: {
    list: () => Promise<any[]>
    create: (payload: { id: string; name: string; guidance: string; sort_order?: number }) => Promise<{ success: boolean; error?: string }>
    update: (payload: { id: string; name?: string; guidance?: string; sort_order?: number }) => Promise<{ success: boolean; error?: string }>
    delete: (id: string) => Promise<{ success: boolean }>
  }
  style: {
    migrateFromLocalStorage: (styles: any[]) => Promise<{ success: boolean; inserted?: number; skipped?: number; error?: string }>
  }
  chapter: {
    list: (projectId: string) => Promise<any[]>
    listMeta: (projectId: string) => Promise<any[]>
    save: (chapter: any) => Promise<any>
    updateMeta: (chapter: any) => Promise<any>
    reorder: (items: any[]) => Promise<any>
    delete: (id: string) => Promise<any>
  }
  volume: {
    list: (projectId: string) => Promise<import('@/types').OutlineVolume[]>
    save: (volume: import('@/types').OutlineVolume) => Promise<import('@/types').OutlineVolume>
    updateMeta: (volume: Partial<import('@/types').OutlineVolume> & { id: string }) => Promise<import('@/types').OutlineVolume>
    delete: (id: string) => Promise<{ success: boolean }>
    reorder: (payload: { projectId: string; orderedIds: string[] }) => Promise<{ success: boolean }>
    forceRemigrate: (projectId: string) => Promise<{ success: boolean }>
    resetOutlinePlan: (projectId: string) => Promise<import('@/types').OutlineVolume[]>
  }
  version: {
    commit: (projectId: string, message: string) => Promise<{ id: string; message: string; created_at: string }>
    list: (projectId: string) => Promise<Array<{ id: string; parent_id: string | null; message: string; manifest: string; created_at: string }>>
    restore: (projectId: string, commitId: string) => Promise<{ success: boolean }>
    deleteProjectCommits: (projectId: string) => Promise<{ success: boolean }>
    autoCommitOnQuit: (projectId: string | null) => Promise<{ success: boolean }>
    setActiveProject: (projectId: string) => Promise<void>
    stats: (projectId: string) => Promise<{ count: number; totalSize: number }>
    deleteCommit: (projectId: string, commitId: string) => Promise<{ success: boolean }>
  }
  character: {
    list: (projectId: string) => Promise<any[]>
    create: (card: any) => Promise<any>
    update: (card: any) => Promise<any>
    delete: (id: string) => Promise<any>
  }
  world: {
    list: (projectId: string) => Promise<any[]>
    create: (card: any) => Promise<any>
    update: (card: any) => Promise<any>
    delete: (id: string) => Promise<any>
  }
  taskBinding: {
    list: (projectId: string) => Promise<any[]>
    set: (binding: any) => Promise<any>
    delete: (id: string) => Promise<any>
    getByTask: (projectId: string, taskType: string) => Promise<any>
  }
  file: {
    save: (options: { defaultName: string; content?: string; base64?: string; filterName: string; extension: string }) => Promise<{ success: boolean; path?: string }>
    open: (options: { filterName: string; extension: string }) => Promise<{ success: boolean; path?: string; content?: string }>
  }
  dialog: {
    confirm: (message: string) => Promise<boolean>
  }
  sensitive: {
    list: () => Promise<any[]>
    add: (word: any) => Promise<any>
    remove: (id: string) => Promise<any>
  }
  knowledge: {
    list: () => Promise<any[]>
    getByName: (name: string) => Promise<any>
    create: (item: any) => Promise<string>
    update: (item: any) => Promise<void>
    delete: (id: string) => Promise<void>
    selectFiles: () => Promise<Array<{ name: string; path: string }>>
    importFiles: (options: { name: string; category: string; files: Array<{ name: string; path: string }> }) => Promise<{ success: boolean; imported: any[]; errors: any[] }>
    listByProject: (projectId: string) => Promise<any[]>
    toggleProject: (params: { projectId: string; knowledgeItemId: string; enabled: boolean }) => Promise<void>
    getEnabled: (projectId: string) => Promise<Array<{id: string; name: string; chunk_count: number}>>
  }
  vector: {
    // API key 统一在服务端 .env 配置,客户端无 getConfig/setConfig/testConnection
    indexItem: (itemId: string) => Promise<{ success: boolean; chunks?: number; error?: string }>
    onIndexProgress: (callback: (data: { itemId: string; current: number; total: number }) => void) => () => void
    search: (params: { query: string; projectId?: string; topK?: number; category?: string }) => Promise<{ success: boolean; results: any[]; error?: string }>
    deleteItem: (itemId: string) => Promise<{ success: boolean; error?: string }>
    rebuildAll: () => Promise<{ success: boolean; indexed?: number; errors?: number; error?: string }>
    getStatus: () => Promise<{ success: boolean; totalVectors?: number; indexedItems?: number; totalItems?: number; error?: string }>
  }
  search: {
    workspace: (params: { query: string; project_id?: string; scope?: string[]; top_k?: number[] }) => Promise<{ results: any[]; summary: any; error?: string }>
  }
  font: {
    list: () => Promise<Array<{ name: string; file: string; path: string }>>
    getPath: (fileName: string) => Promise<string | null>
  }
  api: {
    streamChat: (options: any) => Promise<string>
    onStreamEvent: (streamId: string, callback: (data: any) => void) => () => void
    abortStream: (streamId: string) => Promise<void>
  }
  importProject: {
    openFile: (options?: { filterName?: string }) => Promise<{
      success: boolean
      path?: string
      fileName?: string
      text?: string
      totalChars?: number
      error?: string
    }>
    splitChapters: (options: {
      text: string
      fileName: string
      projectTitle?: string
      splitOptions: { mode: 'auto' | 'pattern' | 'blankline' | 'whole'; pattern?: string; minChapterLength?: number }
    }) => Promise<{
      success: boolean
      chapters: Array<{
        id: string
        title: string
        content: string
        chapter_outline: string
        sort_order: number
        status: string
        word_count: number
        created_at: string
        updated_at: string
      }>
      matchedRule: string
      totalChars: number
    }>
    commitProject: (options: {
      fileName: string
      projectTitle?: string
      chapters: Array<{
        id: string
        title: string
        content: string
        chapter_outline: string
        sort_order: number
        status: string
        word_count: number
        created_at: string
        updated_at: string
      }>
    }) => Promise<{ success: boolean; projectId?: string; error?: string }>
    onProgress: (callback: (data: { phase: 'parse' | 'split' | 'commit' | 'committed' | 'fts-background' | 'fts-background-prepare' | 'fts-background-write' | 'fts-background-done' | 'fts-background-error' | 'done' | 'error'; current: number; total: number; message: string }) => void) => () => void
  }
  update?: {
    check: () => Promise<any>
    download: () => Promise<any>
    quitAndInstall: () => void
    onStatus: (callback: (status: { type: string; version?: string; percent?: number; transferred?: number; total?: number; bytesPerSecond?: number; message?: string }) => void) => () => void
  }
  log: {
    send: (level: 'debug' | 'info' | 'warn' | 'error', scope: string, msg: string, data?: Record<string, unknown>) => Promise<{ ok: boolean }>
    tail: (n: number) => Promise<any[]>
    getLogDir: () => Promise<string>
    openDir: () => Promise<{ ok: boolean; error?: string }>
    export: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
  }
  onBeforeQuit: (callback: () => Promise<void> | void) => () => void
  notifyFlushed: () => void
}

export {}
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
