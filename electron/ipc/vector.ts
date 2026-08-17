/**
 * 向量 IPC —— 知识库语义搜索。
 *
 * 关键点(开源版):
 * - 复用用户在"设置 → API 配置"里配置的默认 api_config:
 *   base_url + api_key + model 全部从该配置读,客户端直接调上游 OpenAI 兼容 /v1/embeddings
 * - 不再依赖外部服务端,无鉴权 / 无会员拦截
 * - 向量本地存储(vector-store.json)保留,余弦相似度检索仍在客户端做(无状态原则)
 * - embedding_model 沿用默认 api_config 的 model 字段
 *   (用户配 OpenAI 时填 text-embedding-3-small,配硅基流动/智源等填对应 embedding 模型)
 */
import { ipcMain, app, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { getDatabase } from './db'
import { getLogger } from '../logger/core'
import { stripHtml } from '../../src/lib/html'
import { splitChunks } from '../../src/lib/chunkSplitter'

const EMBED_BATCH_SIZE = 25  // 单次 input 上限 25,够所有主流 embedding 服务的 batch 上限

interface VectorEntry {
  id: string
  vector: number[]
  metadata: {
    knowledge_item_id: string
    chunk_index: number
    text: string
    chunkStart: number
    chunkEnd: number
  }
}

let vectorStore: VectorEntry[] = []
let vectorStorePath: string = ''

export function clearVectorsForItem(itemId: string) {
  const before = vectorStore.length
  vectorStore = vectorStore.filter(v => v.metadata.knowledge_item_id !== itemId)
  if (vectorStore.length !== before) saveVectorStore()
}

function getVectorStorePath(): string {
  return path.join(app.getPath('userData'), 'vector-store.json')
}

function loadVectorStore() {
  vectorStorePath = getVectorStorePath()
  try {
    if (fs.existsSync(vectorStorePath)) {
      const data = fs.readFileSync(vectorStorePath, 'utf-8')
      vectorStore = JSON.parse(data)
    }
  } catch (err) {
    getLogger().errorObj('vector.load', 'failed to load vector store', err, { path: vectorStorePath })
    vectorStore = []
  }
}

function saveVectorStore() {
  try {
    fs.writeFileSync(vectorStorePath, JSON.stringify(vectorStore), 'utf-8')
  } catch (err) {
    getLogger().errorObj('vector.save', 'failed to save vector store', err, {
      path: vectorStorePath,
      itemCount: vectorStore.length,
    })
  }
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function getDefaultEmbeddingConfig(): { baseUrl: string; apiKey: string; model: string } {
  const db = getDatabase()
  const cfg = db.queryOne(
    "SELECT base_url, api_key, model FROM api_configs WHERE is_default = 1 ORDER BY updated_at DESC LIMIT 1"
  ) as { base_url: string; api_key: string; model: string } | undefined
  const fallback = cfg ?? db.queryOne(
    "SELECT base_url, api_key, model FROM api_configs ORDER BY updated_at DESC LIMIT 1"
  ) as { base_url: string; api_key: string; model: string } | undefined
  if (!fallback) {
    throw new Error('未配置默认 API:请先在 设置 → API 配置 中添加并设为默认')
  }
  return {
    baseUrl: fallback.base_url.replace(/\/+$/, ''),
    apiKey: fallback.api_key,
    model: fallback.model,
  }
}

async function fetchEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const { baseUrl, apiKey, model } = getDefaultEmbeddingConfig()

  const res = await fetch(`${baseUrl}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: texts, model }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Embedding 调用失败: ${res.status} ${errText.slice(0, 200)}`)
  }
  const data = (await res.json()) as { data?: Array<{ embedding?: number[]; index?: number }> }
  if (!Array.isArray(data.data) || data.data.length !== texts.length) {
    throw new Error('Embedding 响应格式错误')
  }
  return data.data.map(d => d.embedding || [])
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function registerVectorHandlers() {
  const db = getDatabase()

  loadVectorStore()

  async function indexItem(itemId: string) {
    const vlog = getLogger()
    try {
      const item = db.queryOne('SELECT * FROM knowledge_items WHERE id = ?', [itemId])
      if (!item) return { success: false, error: '知识条目不存在' }

      vlog.info('vector.indexItem', 'start', { itemId, contentLen: item.content?.length })

      const plainContent = stripHtml(item.content || '').trim()
      const contentHash = hashContent(plainContent)
      if (item.content_hash === contentHash) {
        vlog.info('vector.indexItem', 'skipped (content unchanged)', { itemId })
        return { success: true, message: '内容未变更,跳过索引', chunks: item.chunk_count }
      }

      const chunks = splitChunks(plainContent)

      if (chunks.length === 0) {
        return { success: false, error: '内容为空,无法索引' }
      }

      vectorStore = vectorStore.filter(v => v.metadata.knowledge_item_id !== itemId)

      const wc = BrowserWindow.getFocusedWindow()?.webContents
        || BrowserWindow.getAllWindows()[0]?.webContents
      const sendProgress = (current: number, total: number, errMsg?: string) => {
        if (wc && !wc.isDestroyed()) {
          wc.send('vector:indexProgress', { itemId, current, total, ...(errMsg ? { error: errMsg } : {}) })
        }
      }

      const totalBatches = Math.ceil(chunks.length / EMBED_BATCH_SIZE)
      let processedBatches = 0
      sendProgress(0, totalBatches)
      try {
        for (let batchStart = 0; batchStart < chunks.length; batchStart += EMBED_BATCH_SIZE) {
          const batchTexts = chunks.slice(batchStart, batchStart + EMBED_BATCH_SIZE).map(c => c.text)
          const batchEmbeddings = await fetchEmbeddings(batchTexts)
          if (batchEmbeddings.length !== batchTexts.length) {
            throw new Error(`Embedding 返回数量 (${batchEmbeddings.length}) 与批次 chunk 数量 (${batchTexts.length}) 不一致`)
          }
          for (let i = 0; i < batchTexts.length; i++) {
            const chunkIdx = batchStart + i
            vectorStore.push({
              id: `${itemId}_chunk_${chunkIdx}`,
              vector: batchEmbeddings[i],
              metadata: {
                knowledge_item_id: itemId,
                chunk_index: chunkIdx,
                text: chunks[chunkIdx].text,
                chunkStart: chunks[chunkIdx].start,
                chunkEnd: chunks[chunkIdx].end
              }
            })
          }
          saveVectorStore()
          processedBatches++
          sendProgress(processedBatches, totalBatches)
        }
      } catch (chunkErr: any) {
        vectorStore = vectorStore.filter(v => v.metadata.knowledge_item_id !== itemId)
        saveVectorStore()
        sendProgress(processedBatches, totalBatches, chunkErr.message)
        vlog.errorObj('vector.indexItem', 'batch embedding failed', chunkErr, {
          itemId,
          chunkCount: chunks.length,
          processedBatches,
        })
        throw chunkErr
      }

      const dims = chunks.length > 0 && vectorStore[vectorStore.length - chunks.length]?.vector.length || 0
      const { model: embedModel } = getDefaultEmbeddingConfig()
      db.run(
        `UPDATE knowledge_items SET content_hash = ?, chunk_count = ?, embedding_model = ?, indexed_at = datetime('now') WHERE id = ?`,
        [contentHash, chunks.length, `${embedModel}:${dims}d`, itemId]
      )

      vlog.info('vector.indexItem', 'success', { itemId, chunkCount: chunks.length, dims })
      return { success: true, chunks: chunks.length }
    } catch (err: any) {
      vlog.errorObj('vector.indexItem', 'failed', err, { itemId })
      return { success: false, error: err.message }
    }
  }

  ipcMain.handle('db:vector:indexItem', async (_e, itemId: string) => {
    return indexItem(itemId)
  })

  ipcMain.handle('db:vector:search', async (_e, params: { query: string; projectId?: string; topK?: number; category?: string }) => {
    try {
      const queryEmbeddings = await fetchEmbeddings([params.query])
      const queryVec = queryEmbeddings[0]

      let enabledItemIds: string[] | null = null
      if (params.projectId) {
        enabledItemIds = db.queryAll(
          'SELECT knowledge_item_id FROM project_knowledge WHERE project_id = ? AND enabled = 1',
          [params.projectId]
        ).map((r: any) => r.knowledge_item_id)

        if (enabledItemIds.length === 0) {
          return { success: true, results: [] }
        }
      }

      let categoryItemIds: string[] | null = null
      if (params.category && params.category !== 'all') {
        categoryItemIds = db.queryAll(
          'SELECT id FROM knowledge_items WHERE category = ?',
          [params.category]
        ).map((r: any) => r.id)
      }

      const topK = params.topK || 5
      const candidates = vectorStore
        .filter(v => {
          if (enabledItemIds && !enabledItemIds.includes(v.metadata.knowledge_item_id)) return false
          if (categoryItemIds && !categoryItemIds.includes(v.metadata.knowledge_item_id)) return false
          return true
        })
        .map(v => {
          return {
            id: v.id,
            text: v.metadata.text,
            score: cosineSimilarity(queryVec, v.vector),
            knowledge_item_id: v.metadata.knowledge_item_id,
            chunk_index: v.metadata.chunk_index,
            chunkId: v.metadata.chunk_index
          }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)

      const results = candidates.map(r => {
        const knowledgeItem = db.queryOne('SELECT name, category FROM knowledge_items WHERE id = ?', [r.knowledge_item_id])
        return {
          ...r,
          knowledge_name: knowledgeItem?.name || '',
          knowledge_category: knowledgeItem?.category || ''
        }
      })

      return { success: true, results }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('db:vector:deleteItem', async (_e, itemId: string) => {
    try {
      vectorStore = vectorStore.filter(v => v.metadata.knowledge_item_id !== itemId)
      saveVectorStore()
      db.run("UPDATE knowledge_items SET content_hash = NULL, chunk_count = 0, embedding_model = '', indexed_at = NULL WHERE id = ?", [itemId])
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('db:vector:rebuildAll', async () => {
    try {
      vectorStore = []
      saveVectorStore()
      db.run("UPDATE knowledge_items SET content_hash = NULL, chunk_count = 0, embedding_model = '', indexed_at = NULL")

      const knowledgeItems = db.queryAll('SELECT id FROM knowledge_items')
      let indexed = 0
      let errors = 0

      for (const item of knowledgeItems) {
        try {
          const result = await indexItem(item.id)
          if (result.success) indexed++
          else errors++
        } catch {
          errors++
        }
      }

      return { success: true, indexed, errors }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('db:vector:getStatus', () => {
    try {
      const knowledgeItems = db.queryAll('SELECT id, name, chunk_count, content_hash FROM knowledge_items')
      const indexedItems = knowledgeItems.filter((item: any) => item.content_hash !== null)

      return {
        success: true,
        totalVectors: vectorStore.length,
        indexedItems: indexedItems.length,
        totalItems: knowledgeItems.length,
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
