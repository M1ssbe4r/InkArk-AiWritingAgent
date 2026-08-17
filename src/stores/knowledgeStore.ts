import { create } from 'zustand'

export interface KnowledgeItem {
  id: string
  name: string
  category: string
  content: string
  file_name: string
  file_type: string
  chunk_count: number
  created_at: string
  updated_at: string
  enabled?: number
  binding_id?: string
}

export interface VectorSearchResult {
  id: string
  text: string
  score: number
  knowledge_item_id: string
  chunk_index: number
  knowledge_name: string
  knowledge_category: string
}

export interface WorkspaceSearchResult {
  source: 'chapter' | 'character' | 'world' | 'outline' | 'knowledge'
  name: string
  field: string
  snippet: string
  keyword_hits: number
}

interface KnowledgeState {
  items: KnowledgeItem[]
  projectItems: KnowledgeItem[]
  vectorStatus: {
    totalVectors: number
    indexedItems: number
    totalItems: number
  } | null
  isLoading: boolean
  searchResults: VectorSearchResult[]

  loadItems: () => Promise<void>
  loadProjectItems: (projectId: string) => Promise<void>
  createItem: (item: { name: string; category: string; content: string }) => Promise<string>
  updateItem: (item: { id: string; name?: string; category?: string; content?: string }) => Promise<void>
  deleteItem: (id: string) => Promise<void>
  importFiles: (options: { name: string; category: string; files: Array<{ name: string; path: string }> }) => Promise<{ imported: any[]; errors: any[] }>
  toggleProjectItem: (projectId: string, knowledgeItemId: string, enabled: boolean) => Promise<void>
  indexItem: (itemId: string) => Promise<{ success: boolean; chunks?: number; error?: string }>
  searchKnowledge: (query: string, projectId?: string, topK?: number) => Promise<VectorSearchResult[]>
  searchWorkspace: (query: string, projectId?: string, scope?: string[], topK?: number[]) => Promise<{ results: WorkspaceSearchResult[]; summary: any }>
  loadVectorStatus: () => Promise<void>
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  items: [],
  projectItems: [],
  vectorStatus: null,
  isLoading: false,
  searchResults: [],

  loadItems: async () => {
    set({ isLoading: true })
    try {
      const items = await window.electronAPI.knowledge.list()
      set({ items, isLoading: false })
    } catch (err) {
      console.error('Failed to load knowledge items:', err)
      set({ isLoading: false })
    }
  },

  loadProjectItems: async (projectId: string) => {
    try {
      const items = await window.electronAPI.knowledge.listByProject(projectId)
      set({ projectItems: items })
    } catch (err) {
      console.error('Failed to load project knowledge items:', err)
    }
  },

  createItem: async (item) => {
    const id = await window.electronAPI.knowledge.create(item)
    await get().loadItems()
    return id
  },

  updateItem: async (item) => {
    await window.electronAPI.knowledge.update(item)
    await get().loadItems()
  },

  deleteItem: async (id) => {
    await window.electronAPI.knowledge.delete(id)
    await get().loadItems()
  },

  importFiles: async (options) => {
    set({ isLoading: true })
    try {
      const result = await window.electronAPI.knowledge.importFiles(options)
      set({ isLoading: false })
      await get().loadItems()
      return { imported: result.imported || [], errors: result.errors || [] }
    } catch (err) {
      set({ isLoading: false })
      throw err
    }
  },

  toggleProjectItem: async (projectId, knowledgeItemId, enabled) => {
    await window.electronAPI.knowledge.toggleProject({ projectId, knowledgeItemId, enabled })
    await get().loadProjectItems(projectId)
  },

  indexItem: async (itemId) => {
    return await window.electronAPI.vector.indexItem(itemId)
  },

  searchKnowledge: async (query, projectId, topK) => {
    const result = await window.electronAPI.vector.search({ query, projectId, topK })
    if (result.success) {
      set({ searchResults: result.results })
      return result.results
    }
    return []
  },

  searchWorkspace: async (query, projectId, scope, topK) => {
    const result = await window.electronAPI.search.workspace({ query, project_id: projectId, scope, top_k: topK })
    return { results: result.results || [], summary: result.summary || {} }
  },

  loadVectorStatus: async () => {
    try {
      const status = await window.electronAPI.vector.getStatus()
      if (status.success) {
        set({
          vectorStatus: {
            totalVectors: status.totalVectors ?? 0,
            indexedItems: status.indexedItems ?? 0,
            totalItems: status.totalItems ?? 0
          }
        })
      }
    } catch (err) {
      console.error('Failed to load vector status:', err)
    }
  }
}))
