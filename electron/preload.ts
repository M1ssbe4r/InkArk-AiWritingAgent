import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  setFullscreen: (fullscreen: boolean) => ipcRenderer.invoke('window:setFullscreen', fullscreen),

  // API Configs
  apiConfig: {
    list: () => ipcRenderer.invoke('db:apiConfig:list'),
    create: (config: any) => ipcRenderer.invoke('db:apiConfig:create', config),
    update: (config: any) => ipcRenderer.invoke('db:apiConfig:update', config),
    delete: (id: string) => ipcRenderer.invoke('db:apiConfig:delete', id),
    test: (config: any) => ipcRenderer.invoke('db:apiConfig:test', config),
    getDefault: () => ipcRenderer.invoke('db:apiConfig:getDefault'),
  },

  // Presets
  preset: {
    list: () => ipcRenderer.invoke('db:preset:list'),
    create: (preset: any) => ipcRenderer.invoke('db:preset:create', preset),
    update: (preset: any) => ipcRenderer.invoke('db:preset:update', preset),
    delete: (id: string) => ipcRenderer.invoke('db:preset:delete', id),
    getByConfig: (configId: string) => ipcRenderer.invoke('db:preset:getByConfig', configId),
  },

  // Projects
  project: {
    list: () => ipcRenderer.invoke('db:project:list'),
    create: (project: any) => ipcRenderer.invoke('db:project:create', project),
    update: (project: any) => ipcRenderer.invoke('db:project:update', project),
    delete: (id: string) => ipcRenderer.invoke('db:project:delete', id),
    export: (projectId: string) => ipcRenderer.invoke('db:project:export', projectId),
    import: (backup: any) => ipcRenderer.invoke('db:project:import', backup),
    getStyleGuidance: (projectId: string) => ipcRenderer.invoke('db:project:getStyleGuidance', projectId),
    setStyleGuidance: (projectId: string, guidance: string) => ipcRenderer.invoke('db:project:setStyleGuidance', projectId, guidance),
    getStyle: (projectId: string) => ipcRenderer.invoke('db:project:getStyle', projectId),
    setStyle: (projectId: string, customStyleId: string | null) => ipcRenderer.invoke('db:project:setStyle', projectId, customStyleId),
    getWritingRestrictions: (projectId: string) => ipcRenderer.invoke('db:project:getWritingRestrictions', projectId),
    setWritingRestrictions: (projectId: string, restrictions: string) => ipcRenderer.invoke('db:project:setWritingRestrictions', projectId, restrictions),
    markOutlineMigrated: (projectId: string) => ipcRenderer.invoke('db:project:markOutlineMigrated', projectId),
  },

  // Custom styles
  customStyle: {
    list: () => ipcRenderer.invoke('db:customStyle:list'),
    create: (payload: any) => ipcRenderer.invoke('db:customStyle:create', payload),
    update: (payload: any) => ipcRenderer.invoke('db:customStyle:update', payload),
    delete: (id: string) => ipcRenderer.invoke('db:customStyle:delete', id),
  },

  // Style migration (one-shot)
  style: {
    migrateFromLocalStorage: (styles: any[]) => ipcRenderer.invoke('db:style:migrateFromLocalStorage', styles),
  },

  // Chapters
  chapter: {
    list: (projectId: string) => ipcRenderer.invoke('db:chapter:list', projectId),
    listMeta: (projectId: string) => ipcRenderer.invoke('db:chapter:listMeta', projectId),
    save: (chapter: any) => ipcRenderer.invoke('db:chapter:save', chapter),
    updateMeta: (chapter: any) => ipcRenderer.invoke('db:chapter:updateMeta', chapter),
    reorder: (items: any[]) => ipcRenderer.invoke('db:chapter:reorder', items),
    delete: (id: string) => ipcRenderer.invoke('db:chapter:delete', id),
  },

  // Volumes (outline)
  volume: {
    list: (projectId: string) => ipcRenderer.invoke('db:volume:list', projectId),
    save: (volume: any) => ipcRenderer.invoke('db:volume:save', volume),
    updateMeta: (volume: any) => ipcRenderer.invoke('db:volume:updateMeta', volume),
    delete: (id: string) => ipcRenderer.invoke('db:volume:delete', id),
    reorder: (payload: { projectId: string; orderedIds: string[] }) => ipcRenderer.invoke('db:volume:reorder', payload),
    forceRemigrate: (projectId: string) => ipcRenderer.invoke('db:volume:forceRemigrate', projectId),
    resetOutlinePlan: (projectId: string) => ipcRenderer.invoke('db:volume:resetOutlinePlan', projectId),
  },

  // Characters
  character: {
    list: (projectId: string) => ipcRenderer.invoke('db:character:list', projectId),
    create: (card: any) => ipcRenderer.invoke('db:character:create', card),
    update: (card: any) => ipcRenderer.invoke('db:character:update', card),
    delete: (id: string) => ipcRenderer.invoke('db:character:delete', id),
  },

  // World
  world: {
    list: (projectId: string) => ipcRenderer.invoke('db:world:list', projectId),
    create: (card: any) => ipcRenderer.invoke('db:world:create', card),
    update: (card: any) => ipcRenderer.invoke('db:world:update', card),
    delete: (id: string) => ipcRenderer.invoke('db:world:delete', id),
  },

  // Task bindings
  taskBinding: {
    list: (projectId: string) => ipcRenderer.invoke('db:taskBinding:list', projectId),
    set: (binding: any) => ipcRenderer.invoke('db:taskBinding:set', binding),
    delete: (id: string) => ipcRenderer.invoke('db:taskBinding:delete', id),
    getByTask: (projectId: string, taskType: string) => ipcRenderer.invoke('db:taskBinding:getByTask', projectId, taskType),
  },

  // Version management
  version: {
    commit: (projectId: string, message: string) => ipcRenderer.invoke('db:version:commit', projectId, message),
    list: (projectId: string) => ipcRenderer.invoke('db:version:list', projectId),
    restore: (projectId: string, commitId: string) => ipcRenderer.invoke('db:version:restore', projectId, commitId),
    deleteProjectCommits: (projectId: string) => ipcRenderer.invoke('db:version:deleteProjectCommits', projectId),
    autoCommitOnQuit: (projectId: string | null) => ipcRenderer.invoke('db:version:autoCommitOnQuit', projectId),
    setActiveProject: (projectId: string) => ipcRenderer.invoke('version:setActiveProject', projectId),
    stats: (projectId: string) => ipcRenderer.invoke('db:version:stats', projectId),
    deleteCommit: (projectId: string, commitId: string) => ipcRenderer.invoke('db:version:deleteCommit', projectId, commitId),
  },

  // File operations
  file: {
    save: (options: { defaultName: string; content?: string; base64?: string; filterName: string; extension: string }) =>
      ipcRenderer.invoke('file:save', options),
    open: (options: { filterName: string; extension: string }) =>
      ipcRenderer.invoke('file:open', options),
  },

  // Dialog
  dialog: {
    confirm: (message: string) => ipcRenderer.invoke('dialog:confirm', message),
  },

  // Sensitive words
  sensitive: {
    list: () => ipcRenderer.invoke('db:sensitive:list'),
    add: (word: any) => ipcRenderer.invoke('db:sensitive:add', word),
    remove: (id: string) => ipcRenderer.invoke('db:sensitive:remove', id),
  },

  // Knowledge base
  knowledge: {
    list: () => ipcRenderer.invoke('db:knowledge:list'),
    getByName: (name: string) => ipcRenderer.invoke('db:knowledge:getByName', name),
    create: (item: any) => ipcRenderer.invoke('db:knowledge:create', item),
    update: (item: any) => ipcRenderer.invoke('db:knowledge:update', item),
    delete: (id: string) => ipcRenderer.invoke('db:knowledge:delete', id),
    selectFiles: () => ipcRenderer.invoke('db:knowledge:selectFiles'),
    importFiles: (options: any) => ipcRenderer.invoke('db:knowledge:importFiles', options),
    listByProject: (projectId: string) => ipcRenderer.invoke('db:knowledge:listByProject', projectId),
    toggleProject: (params: { projectId: string; knowledgeItemId: string; enabled: boolean }) =>
      ipcRenderer.invoke('db:knowledge:toggleProject', params),
    getEnabled: (projectId: string) => ipcRenderer.invoke('db:knowledge:getEnabled', projectId),
  },

  // Vector index
  // 复用默认 API 配置(base_url + api_key + model),调上游 OpenAI 兼容 /v1/embeddings
  vector: {
    indexItem: (itemId: string) => ipcRenderer.invoke('db:vector:indexItem', itemId),
    onIndexProgress: (callback: (data: { itemId: string; current: number; total: number }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('vector:indexProgress', handler)
      // 只移除自己的 listener,不要 removeAllListeners —— 否则多个订阅者相互覆盖
      return () => { ipcRenderer.removeListener('vector:indexProgress', handler) }
    },
    search: (params: { query: string; projectId?: string; topK?: number; category?: string }) =>
      ipcRenderer.invoke('db:vector:search', params),
    deleteItem: (itemId: string) => ipcRenderer.invoke('db:vector:deleteItem', itemId),
    rebuildAll: () => ipcRenderer.invoke('db:vector:rebuildAll'),
    getStatus: () => ipcRenderer.invoke('db:vector:getStatus'),
  },

  // Workspace search
  search: {
    workspace: (params: { query: string; project_id?: string; scope?: string[]; top_k?: number[] }) =>
      ipcRenderer.invoke('db:search:workspace', params),
  },

  // Fonts
  font: {
    list: () => ipcRenderer.invoke('font:list'),
    getPath: (fileName: string) => ipcRenderer.invoke('font:getPath', fileName),
  },

  // API calls (proxied through main process to avoid CORS)
  api: {
    streamChat: (options: any) => ipcRenderer.invoke('api:streamChat', options),
    onStreamEvent: (streamId: string, callback: (data: any) => void) => {
      const channel = `api:stream:${streamId}`
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on(channel, handler)
      return () => { ipcRenderer.removeAllListeners(channel) }
    },
    abortStream: (streamId: string) => ipcRenderer.invoke('api:abortStream', streamId),
  },

  // Project import from txt / doc / docx
  importProject: {
    openFile: (options?: { filterName?: string }) =>
      ipcRenderer.invoke('import:openFile', options || {}),
    splitChapters: (options: {
      text: string
      fileName: string
      projectTitle?: string
      splitOptions: { mode: 'auto' | 'pattern' | 'blankline' | 'whole'; pattern?: string; minChapterLength?: number }
    }) => ipcRenderer.invoke('import:splitChapters', options),
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
    }) => ipcRenderer.invoke('import:commitProject', options),
    onProgress: (callback: (data: { phase: 'parse' | 'split' | 'commit' | 'done' | 'error'; current: number; total: number; message: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('import:progress', handler)
      return () => { ipcRenderer.removeAllListeners('import:progress') }
    },
  },

  // 日志上报 + 诊断包导出
  log: {
    send: (level: 'debug' | 'info' | 'warn' | 'error', scope: string, msg: string, data?: Record<string, unknown>) =>
      ipcRenderer.invoke('log:send', { level, scope, msg, data }),
    tail: (n: number) => ipcRenderer.invoke('log:tail', n),
    getLogDir: () => ipcRenderer.invoke('log:getLogDir'),
    openDir: () => ipcRenderer.invoke('log:openDir'),
    export: () => ipcRenderer.invoke('log:export'),
  },

  // 退出前 flush 握手:主进程 before-quit 发 'app:beforeQuit' 给 renderer,
  // renderer 把 isDirty 章节 + 大纲 + 标题 save 完后再 invoke 'app:flushed' 通知主进程。
  // 主进程收到后才进入 commit + flushDatabase 阶段,保证版本快照和落盘内容一致。
  onBeforeQuit: (callback: () => Promise<void> | void) => {
    const handler = async (_event: unknown) => {
      try {
        await callback()
      } catch (e) {
        // 渲染端 flush 失败也要通知主进程,否则窗口永远卡在退出阶段
        // eslint-disable-next-line no-console
        console.error('[inkark] beforeQuit handler failed:', e)
        ipcRenderer.send('app:flushed')
      }
    }
    ipcRenderer.on('app:beforeQuit', handler)
    return () => { ipcRenderer.removeListener('app:beforeQuit', handler) }
  },
  notifyFlushed: () => ipcRenderer.send('app:flushed'),
})
