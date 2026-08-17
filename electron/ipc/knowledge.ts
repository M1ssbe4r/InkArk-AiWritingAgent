import { ipcMain, dialog, app } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import chardet from 'chardet'
import iconv from 'iconv-lite'
import { getDatabase } from './db'
import { syncKnowledgeToFTS, deleteEntityFromFTS } from './fts'

let mainWindow: Electron.BrowserWindow | null = null

export function setMainWindowForKnowledge(win: Electron.BrowserWindow) {
  mainWindow = win
}

const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.docx', '.pdf']

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

async function parseTxtMd(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath)
  const detected = chardet.detect(buffer) || 'UTF-8'
  const encoding = detected.toUpperCase().replace(/[^A-Z0-9-]/g, '')
  if (encoding === 'UTF-8' || encoding === 'ASCII') {
    return buffer.toString('utf-8')
  }
  if (iconv.encodingExists(encoding)) {
    return iconv.decode(buffer, encoding)
  }
  return buffer.toString('utf-8')
}

async function parseDocx(filePath: string): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ path: filePath })
  return result.value
}

async function parsePdf(filePath: string): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdfData = new Uint8Array(fs.readFileSync(filePath))
  const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise
  let text = ''
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i)
    const textContent = await page.getTextContent()
    text += textContent.items.map((item: any) => item.str).join('') + '\n'
  }
  return text
}

async function parseFile(filePath: string): Promise<{ content: string; type: string }> {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.txt':
    case '.md':
      return { content: await parseTxtMd(filePath), type: ext.slice(1) }
    case '.docx':
      return { content: await parseDocx(filePath), type: 'docx' }
    case '.pdf':
      return { content: await parsePdf(filePath), type: 'pdf' }
    default:
      throw new Error(`不支持的文件格式: ${ext}`)
  }
}

export function registerKnowledgeHandlers() {
  const db = getDatabase()

  ipcMain.handle('db:knowledge:list', () => {
    return db.queryAll('SELECT * FROM knowledge_items ORDER BY created_at DESC')
  })

  ipcMain.handle('db:knowledge:getByName', (_e, name: string) => {
    return db.queryOne('SELECT * FROM knowledge_items WHERE name = ?', [name])
  })

  ipcMain.handle('db:knowledge:create', (_e, item: { name: string; category: string; content: string; file_name?: string; file_type?: string }) => {
    const id = generateId()
    db.transaction(() => {
      db.run(
        `INSERT INTO knowledge_items (id, name, category, content, file_name, file_type) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, item.name, item.category, item.content, item.file_name || '', item.file_type || '']
      )
      syncKnowledgeToFTS(db, { id, name: item.name, content: item.content })
    })
    return id
  })

  ipcMain.handle('db:knowledge:update', (_e, item: { id: string; name?: string; category?: string; content?: string }) => {
    db.transaction(() => {
      const updates: string[] = []
      const params: any[] = []
      if (item.name !== undefined) { updates.push('name = ?'); params.push(item.name) }
      if (item.category !== undefined) { updates.push('category = ?'); params.push(item.category) }
      if (item.content !== undefined) { updates.push('content = ?'); params.push(item.content) }
      updates.push("updated_at = datetime('now')")
      params.push(item.id)
      db.run(`UPDATE knowledge_items SET ${updates.join(', ')} WHERE id = ?`, params)
      if (item.name !== undefined || item.content !== undefined) {
        const row = db.queryOne('SELECT * FROM knowledge_items WHERE id = ?', [item.id])
        if (row) syncKnowledgeToFTS(db, row)
      }
    })
  })

  ipcMain.handle('db:knowledge:delete', (_e, id: string) => {
    deleteEntityFromFTS(db, 'knowledge', id)
    db.run('DELETE FROM project_knowledge WHERE knowledge_item_id = ?', [id])
    db.run('DELETE FROM knowledge_items WHERE id = ?', [id])
  })

  ipcMain.handle('db:knowledge:selectFiles', async () => {
    if (!mainWindow) return []

    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [
        { name: '文档文件', extensions: ['txt', 'md', 'docx', 'pdf'] }
      ],
      properties: ['openFile', 'multiSelections']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return []
    }

    return result.filePaths.map(fp => ({
      name: path.basename(fp),
      path: fp
    }))
  })

  ipcMain.handle('db:knowledge:importFiles', async (_e, options: {
    name: string
    category: string
    files: Array<{ name: string; path: string }>
  }) => {
    const imported: Array<{ id: string; name: string; file_type: string }> = []
    const errors: Array<{ file: string; error: string }> = []

    // 解析所有文件并合并内容
    const contents: string[] = []
    const fileNames: string[] = []
    const fileTypes: Set<string> = new Set()

    for (const file of options.files) {
      try {
        const { content, type } = await parseFile(file.path)
        contents.push(content)
        fileNames.push(file.name)
        fileTypes.add(type)
      } catch (err: any) {
        errors.push({ file: file.name, error: err.message })
      }
    }

    if (contents.length === 0) {
      return { success: false, imported: [], errors }
    }

    // 合并所有内容为一个知识库条目
    const mergedContent = contents.join('\n\n---\n\n')
    const id = generateId()
    const fileTypeStr = Array.from(fileTypes).join('+')
    const fileNameStr = fileNames.join(', ')

    db.transaction(() => {
      db.run(
        `INSERT INTO knowledge_items (id, name, category, content, file_name, file_type) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, options.name, options.category, mergedContent, fileNameStr, fileTypeStr]
      )

      syncKnowledgeToFTS(db, { id, name: options.name, content: mergedContent })
    })

    imported.push({ id, name: options.name, file_type: fileTypeStr })

    return { success: true, imported, errors }
  })

  ipcMain.handle('db:knowledge:listByProject', (_e, projectId: string) => {
    return db.queryAll(`
      SELECT k.*, pk.enabled, pk.id as binding_id
      FROM knowledge_items k
      LEFT JOIN project_knowledge pk ON k.id = pk.knowledge_item_id AND pk.project_id = ?
      ORDER BY k.created_at DESC
    `, [projectId])
  })

  ipcMain.handle('db:knowledge:toggleProject', (_e, params: { projectId: string; knowledgeItemId: string; enabled: boolean }) => {
    const existing = db.queryOne(
      'SELECT id FROM project_knowledge WHERE project_id = ? AND knowledge_item_id = ?',
      [params.projectId, params.knowledgeItemId]
    )

    if (existing) {
      db.run('UPDATE project_knowledge SET enabled = ? WHERE id = ?', [params.enabled ? 1 : 0, existing.id])
    } else if (params.enabled) {
      db.run(
        'INSERT INTO project_knowledge (id, project_id, knowledge_item_id, enabled) VALUES (?, ?, ?, 1)',
        [generateId(), params.projectId, params.knowledgeItemId]
      )
    }
  })

  ipcMain.handle('db:knowledge:getEnabled', (_e, projectId: string) => {
    return db.queryAll(
      `SELECT k.id, k.name, k.chunk_count
       FROM project_knowledge pk
       JOIN knowledge_items k ON pk.knowledge_item_id = k.id
       WHERE pk.project_id = ? AND pk.enabled = 1`,
      [projectId]
    )
  })
}
