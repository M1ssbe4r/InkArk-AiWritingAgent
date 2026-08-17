import { app, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { format } from 'util'
import iconv from 'iconv-lite'

// Windows 终端默认 codepage 936 (GBK) 会把 UTF-8 字节解读成乱码。
// Node 写 stdout 的字节流始终是 UTF-8,我们自己在应用层把字符串转成
// 控制台期望的 codepage 再写出去,这样中文日志在 GBK / UTF-8 控制台下
// 都能正常显示。chcp 在子进程里跑改不了父进程,这条路已验证无效。
if (process.platform === 'win32' && process.stdout.isTTY) {
  let codepage = 'cp936' // 中文 Windows 默认
  try {
    const out = execSync('chcp', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    const m = out.match(/:\s*(\d+)/)
    if (m) {
      const cp = parseInt(m[1], 10)
      if (cp === 65001) codepage = 'utf8'
      else if (cp === 936) codepage = 'cp936'
    }
  } catch {}
  if (codepage !== 'utf8') {
    const wrap = (write: (buf: Buffer) => boolean) => (...args: unknown[]) => {
      const str = format(...args as [])
      write(Buffer.concat([iconv.encode(str, codepage), Buffer.from('\n')]))
    }
    process.stdout.write(Buffer.concat([
      iconv.encode(`[console] Windows codepage=${codepage}, console output will be transcoded\n`, codepage)
    ]))
    console.log = wrap((b) => { process.stdout.write(b); return true }) as typeof console.log
    console.error = wrap((b) => { process.stderr.write(b); return true }) as typeof console.error
    console.warn = console.error
  }
}

import { initDatabase, getDatabase, initFTSIndex } from './ipc/db'
import { registerVersionHandlers, commitProjectState } from './ipc/version'
import { runConsistencyChecks } from './ipc/consistency'
import { registerFontHandlers } from './ipc/font'
import { registerKnowledgeHandlers, setMainWindowForKnowledge } from './ipc/knowledge'
import { registerSearchHandlers } from './ipc/search'
import { rebuildAllFTSIndex, syncCharacterToFTS, syncWorldToFTS, syncChapterToFTS, syncOutlineToFTS, syncVolumeToFTS, syncKnowledgeToFTS, deleteEntityFromFTS, deleteProjectFromFTS, rebuildProjectFTSIndex } from './ipc/fts'
import { registerVolumeHandlers, createDefaultVolume } from './ipc/volume'
import { registerVectorHandlers } from './ipc/vector'
import { initTokenizer, loadCustomDict, isJiebaAvailable } from './ipc/tokenizer'
import { runProjectImport } from './ipc/projectImport'
import { registerImportHandlers } from './ipc/importParser'
import { initLogger, getLogger } from './logger/core'
import { installMainCrashHandlers, installChildCrashHandlers } from './logger/crash'
import { registerLogIpc } from './logger/ipc'
import { audit } from './logger/audit'

// 数据存储位置:
// - macOS (packaged): 用平台标准路径 ~/Library/Application Support/InkArk/
//   不再放 app bundle(InkArk.app/Contents/MacOS/data/),否则会被 .dmg 替换或
//   手动拖拽安装时整个 .app 一起覆盖掉。从老 portable 路径自动迁移见
//   migratePortableMacData。
// - Windows (packaged): portable,放在 $INSTDIR\data\。NSIS update install
//   会通过 build/installer.nsh 的 customInstall hook 备份恢复,
//   详见 installer.nsh 顶部注释。
// - dev / E2E: 沿用旧约定(__dirname/../data 或 env 注入)。
if (process.env.INKARK_E2E_USER_DATA) {
  app.setPath('userData', process.env.INKARK_E2E_USER_DATA)
} else if (!app.isPackaged) {
  app.setPath('userData', path.join(__dirname, '..', 'data'))
} else if (process.platform !== 'darwin') {
  // Windows portable
  app.setPath('userData', path.join(path.dirname(process.execPath), 'data'))
}
// Mac packaged: 不调 setPath,沿用 Electron 默认 userData = ~/Library/Application Support/InkArk/

// Ensure fonts directory exists.
// - macOS (packaged): 跟 data 一起放 ~/Library/Application Support/InkArk/fonts/
//   理由同 data —— 不放 app bundle 内,避免被 .dmg 替换时带走用户自定义字体
// - Windows (packaged): portable,放在 $INSTDIR\fonts\ —— NSIS installer.nsh
//   同样 backup/recover,见 installer.nsh 顶部注释
// - dev: 沿用旧约定。
const fontsDir = app.isPackaged
  ? process.platform === 'darwin'
    ? path.join(app.getPath('userData'), 'fonts')
    : path.join(path.dirname(process.execPath), 'fonts')
  : path.join(__dirname, '..', 'fonts')
if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true })

// 初始化 logger - 必须在任何业务逻辑之前;之后的 console.* 都会被重定向到 logger。
// logs/ 目录与 data/ fonts/ 同一层(portable 模式),NSIS 更新会通过 installer.nsh 恢复。
// 注意:必须在 crash handler 之前 initLogger,否则 crash 钩子里的 getLogger() 会抛错。
// logger 的 writeCrash 路径独立,即使 logger 没初始化也能落盘,但提前 init 更稳妥。
{
  const logDir = path.join(app.getPath('userData'), 'logs')
  const pkg = require(path.join(app.getAppPath(), 'package.json')) as { version?: string }
  initLogger({
    logDir,
    app: {
      ver: pkg.version || '0.0.0',
      plat: process.platform,
      electron: process.versions.electron || '',
      node: process.version,
    },
    dev: !app.isPackaged,
  })
  // 把主进程 console.* 重定向到 logger。这样现有 39 处 console.error/console.log 不动
  // 也自动进 inkark-*.log。
  // dev/packaged 都重定向 - dev 模式 console sink 会同步打到 stdout,不冲突。
  {
    const l = getLogger()
    const origLog = console.log.bind(console)
    const origWarn = console.warn.bind(console)
    const origError = console.error.bind(console)
    console.log = (...args: unknown[]) => { try { l.info('console', String(args[0] ?? ''), { args: args.slice(1) }) } catch {} origLog(...args) }
    console.warn = (...args: unknown[]) => { try { l.warn('console', String(args[0] ?? ''), { args: args.slice(1) }) } catch {} origWarn(...args) }
    console.error = (...args: unknown[]) => { try { l.error('console', String(args[0] ?? ''), { args: args.slice(1) }) } catch {} origError(...args) }
  }
  // crash 兜底 - 必须绑在 logger 初始化之后(虽然 writeCrash 路径独立)
  installMainCrashHandlers()
  installChildCrashHandlers(app)
}

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

let mainWindow: BrowserWindow | null = null
let activeProjectIdForQuit: string | null = null

const activeStreams = new Map<string, AbortController>()
let _streamIdCounter = 0
function nextStreamId() { return `s${++_streamIdCounter}` }

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

/**
 * Mac 老 portable 布局 → 标准 userData 的一次性迁移。
 *
 * 旧版在 macOS 上把 data/ 和 fonts/ 都放在 InkArk.app/Contents/MacOS/ 同级
 * —— 这种 layout 会被 .dmg 替换整个 .app 时全部带走。新版全部迁到
 * ~/Library/Application Support/InkArk/ (见上方 setPath + fontsDir 注释)。
 *
 * 路径对应(关键):
 *   旧 {exeDir}/data/inkark.db          → 新 {userData}/inkark.db
 *   旧 {exeDir}/data/vector-store.json  → 新 {userData}/vector-store.json  (知识库向量化索引)
 *   旧 {exeDir}/data/logs/              → 新 {userData}/logs/
 *   旧 {exeDir}/fonts/                  → 新 {userData}/fonts/
 * 注意:旧 portable 的 userData 本身就是 data/ 目录,所以迁移是把 data/ 的
 * *内容* 摊到 userData 根,不是再套一层 userData/data/。
 *
 * 触发:Mac 用户升级到当前版本后第一次启动,并且老目录还在。
 * 典型场景是覆盖安装(走 ditto / drag-replace,保留 zip 里没有的文件);
 * 手动拖 .dmg 替换 InkArk.app 的用户老数据已经被吃了,这里救不了,
 * 让用户走废纸篓 / Time Machine。
 *
 * 幂等 + 安全(每个目录各自判断):
 *   - Mac 且 packaged
 *   - 老目录存在
 *   - 新位置没有内容,避免覆盖已有数据 (data 看 inkark.db 是否存在;fonts 看目录是否非空)
 *
 * 成功也不删老数据 —— 留作 backup,用户可手动清理。
 * 失败不阻塞启动,下次启动还会再试。
 */
function migratePortableMacData() {
  if (process.platform !== 'darwin' || !app.isPackaged) return

  const oldBase = path.dirname(process.execPath)
  const newBase = app.getPath('userData')

  // 先救「曾错误迁到 userData/data/」的用户,再跑正常 portable → userData
  recoverMisnestedMacData(newBase)

  // data —— 旧 portable userData 目录的内容摊到新 userData 根;sentinel 是 inkark.db
  migrateOnePortableDir(
    'data',
    path.join(oldBase, 'data'),
    newBase,
    (newDir) => fs.existsSync(path.join(newDir, 'inkark.db')),
  )

  // fonts —— 任何文件都算用户内容
  migrateOnePortableDir(
    'fonts',
    path.join(oldBase, 'fonts'),
    path.join(newBase, 'fonts'),
    (newDir) => fs.existsSync(newDir) && fs.readdirSync(newDir).length > 0,
  )
}

/**
 * 回收曾错误迁移到 {userData}/data/ 的数据。
 *
 * 早期实现把旧 data/ 整目录复制成 userData/data/,而 db.ts 读的是
 * userData/inkark.db,导致升级后空库、真数据落在错误子目录。
 * 若发现该错位布局,把内容提升到 userData 根(不删错位目录作 backup)。
 */
function recoverMisnestedMacData(userData: string) {
  const nestedDir = path.join(userData, 'data')
  const nestedDb = path.join(nestedDir, 'inkark.db')
  const correctDb = path.join(userData, 'inkark.db')
  if (!fs.existsSync(nestedDb)) return

  try {
    if (!fs.existsSync(correctDb)) {
      copyDirRecursiveSync(nestedDir, userData)
      getLogger().info('app.startup', 'mac misnested data promoted to userData', {
        from: nestedDir, to: userData,
      })
      return
    }

    // 两边都有:错位迁移后又被 initDatabase 建了空库。嵌套侧更大 → 真数据在嵌套侧。
    const nestedSize = fs.statSync(nestedDb).size
    const correctSize = fs.statSync(correctDb).size
    if (nestedSize <= correctSize) {
      getLogger().info('app.startup', 'mac misnested data left in place (top-level db larger or equal)', {
        nestedDb, nestedSize, correctDb, correctSize,
      })
      return
    }

    const bak = `${correctDb}.pre-recover-bak`
    fs.renameSync(correctDb, bak)
    copyDirRecursiveSync(nestedDir, userData)
    getLogger().info('app.startup', 'mac misnested data promoted over empty top-level db', {
      from: nestedDir, to: userData, backedUp: bak, nestedSize, correctSize,
    })
  } catch (err: any) {
    getLogger().warn('app.startup', 'mac misnested data recovery failed', {
      err: String(err), nestedDir, userData,
    })
  }
}

/** 迁移单个目录:存在性检查 → skip 判断 → 复制。所有失败 swallowed,不让它阻塞启动。 */
function migrateOnePortableDir(
  label: string,
  oldDir: string,
  newDir: string,
  shouldSkip: (newDir: string) => boolean,
) {
  if (oldDir === newDir) return  // 防呆
  if (!fs.existsSync(oldDir)) return  // 没老数据,no-op
  if (shouldSkip(newDir)) {
    getLogger().info('app.startup', `mac portable ${label} migration: target has content, skip`, {
      oldDir, newDir,
    })
    return
  }
  try {
    fs.mkdirSync(newDir, { recursive: true })
    copyDirRecursiveSync(oldDir, newDir)
    getLogger().info('app.startup', `mac portable ${label} migrated to userData`, {
      from: oldDir, to: newDir,
    })
  } catch (err: any) {
    getLogger().warn('app.startup', `mac portable ${label} migration failed`, {
      err: String(err), from: oldDir, to: newDir,
    })
  }
}

function copyDirRecursiveSync(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursiveSync(srcPath, destPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath)
    }
    // symbolic link / 其他类型跳过,portable dir 里通常没有
  }
}

function createWindow() {
  const isE2E = !!process.env.INKARK_E2E_USER_DATA

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    show: false,
    icon: nativeImage.createFromPath(
      app.isPackaged
        ? path.join(process.resourcesPath, 'icon.ico')
        : path.join(__dirname, '../build/icon.ico')
    ),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 12 } }
      : {}),
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  /**
   * macOS 上点红 X / Cmd+W 不会触发 app.quit() (window-all-closed 在 darwin 上不 quit),
   * 渲染端会直接卸载, isDirty 章节的 chapter.save IPC 来不及发出就丢了。
   * 这里拦截 'close' 事件, 把红 X 关窗也走 app.quit() → before-quit 路径,
   * before-quit 里再发 IPC 等 renderer flush 完毕再 commit。
   *
   * Win/Linux 上 window-all-closed 会调 app.quit(), 走同一条 before-quit 路径,
   * 不需要在这里拦截, 但拦截了也无害 (rendererFlushStage 标志位会让第二次拦截失效)。
   */
  mainWindow.on('close', (e) => {
    // 已经走到 before-quit 阶段 (renderer 已 flush 过) → 放行, 让窗口正常销毁
    if (rendererFlushStage >= 2) return
    // 渲染端已崩溃 / webContents 销毁 → 没有 flush 路径, 直接放行
    if (mainWindow.webContents.isDestroyed()) return

    e.preventDefault()
    // 走真正的 quit 流程, before-quit 会再次被触发
    app.quit()
  })

  setMainWindowForKnowledge(mainWindow)

  if (isE2E) {
    mainWindow.once('ready-to-show', () => {
      mainWindow.show()
    })
  } else {
    mainWindow.center()
    mainWindow.once('ready-to-show', () => {
      mainWindow.show()
    })
  }

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'))
  }

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
    }
  })
}

app.whenReady().then(async () => {
  const startupLog = getLogger()
  try {
    // 必须在 initDatabase 之前:这样新 db 路径直接读到迁移完的 inkark.db,
    // 不会先建一个空 db 占位,迁移覆盖失败的情况。
    migratePortableMacData()
    await initDatabase()
    startupLog.info('app.startup', 'database ready', { dbPath: path.join(app.getPath('userData'), 'inkark.db') })
  } catch (err: any) {
    startupLog.errorObj('app.startup', 'initDatabase failed', err, {
      dbPath: path.join(app.getPath('userData'), 'inkark.db'),
    })
    throw err // 让 uncaughtException 兜底,日志里有完整栈
  }
  const db = getDatabase()
  const fixes = runConsistencyChecks(db)
  if (fixes.length > 0) {
    startupLog.warn('app.startup', 'consistency fixes applied', { count: fixes.length, fixes })
  }

  initTokenizer()
  if (isJiebaAvailable()) {
    loadCustomDict()
  }

  const needsFTSRebuild = initFTSIndex()

  const tokenizerVersion = db.queryOne("SELECT value FROM settings WHERE key = 'fts_tokenizer_version'")
  const needsTokenizerRebuild = tokenizerVersion?.value !== 'jieba-v2'

  if (needsFTSRebuild || needsTokenizerRebuild) {
    startupLog.info('app.startup', 'fts index rebuilding', { needsFTSRebuild, needsTokenizerRebuild })
    db.transaction(() => {
      rebuildAllFTSIndex(db)
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fts_tokenizer_version', 'jieba-v2')")
    })
    startupLog.info('app.startup', 'fts index rebuild complete')
  }

  registerIpcHandlers()
  createWindow()
})

// 关窗握手状态:0 = 还没 flush;1 = renderer 已 flush 完毕;2 = 已进入 commit 阶段不再拦截。
// 用模块级 ref 避免 mainWindow 重建后丢失状态。
let rendererFlushStage = 0
let rendererFlushTimer: NodeJS.Timeout | null = null
// close 拦截的超时 (毫秒)。超时后强制放行, 防止 renderer 卡死导致窗口关不掉。
const FLUSH_TIMEOUT_MS = 1500

app.on('before-quit', (e) => {
  // 阶段 >=1 = renderer 已经 flush 过 (收到 app:flushed), 直接 commit + 落盘
  if (rendererFlushStage >= 1) {
    performCommitAndFlush()
    return
  }
  // 阶段 0 = 还没 flush。需要先让 renderer 把 isDirty 章节 + 大纲 + 标题
  // 通过 chapter.save / chapter.updateMeta IPC 写进 db, 否则 commitProjectState
  // 会读到 stale 数据,版本快照里缺最后一段。渲染端崩溃 / 不存在就直接走 commit。
  e.preventDefault()

  const wcAlive = mainWindow && !mainWindow.webContents.isDestroyed()
  if (!wcAlive) {
    // 没有活的 renderer, 没东西可 flush, 直接 commit
    rendererFlushStage = 1
    app.quit()
    return
  }

  // 设置超时兜底: 1.5s 内 renderer 没回 app:flushed 也强制 commit, 防止窗口卡死
  rendererFlushTimer = setTimeout(() => {
    rendererFlushTimer = null
    rendererFlushStage = 1
    app.quit()
  }, FLUSH_TIMEOUT_MS)

  // renderer flush 完毕后通过 ipcRenderer.send('app:flushed') 通知主进程。
  // 用 ipcMain.once 保证一次 quit 流程只接一次, 不会重复进入 commit。
  ipcMain.once('app:flushed', () => {
    if (rendererFlushTimer) { clearTimeout(rendererFlushTimer); rendererFlushTimer = null }
    rendererFlushStage = 1
    app.quit()
  })

  mainWindow.webContents.send('app:beforeQuit')
})

function performCommitAndFlush() {
  rendererFlushStage = 2
  if (activeProjectIdForQuit) {
    const db = getDatabase()
    commitProjectState(db, activeProjectIdForQuit, '自动保存 — 退出前')
  }
  // 退出前同步落盘, 防止 setImmediate 调度中的最后一次写入被丢弃
  // flushDatabase 是同步原子写, 进程退出前一定完成
  getDatabase().flushDatabase()

  // logger 同步冲盘,防止 setImmediate 调度中的最后一次写入被丢弃
  try { getLogger().flushSync() } catch {}

  // 主动让 helper 子进程 (Renderer/GPU/Network/Storage) 走完 graceful 退出,
  // 否则它们可能"挂着"持锁 $INSTDIR\resources\app.asar,导致 NSIS 卸载器
  // un.atomicRMDir 在 Rename app.asar 时失败,弹出"InkArk无法关闭"。
  // 1) flushStorageData 触发 Chromium 把 IndexedDB/Cache 落盘
  // 2) 2 秒宽限让 helper 自己退
  // 3) 2 秒后还没退的,硬杀 (只杀 InkArk 自己的进程树,不影响其他程序)
  for (const win of BrowserWindow.getAllWindows()) {
    try { win.webContents.session.flushStorageData?.() } catch {}
  }
  setTimeout(() => {
    for (const proc of app.getAppMetrics()) {
      if (proc.pid !== process.pid) {
        try { process.kill(proc.pid) } catch {}
      }
    }
  }, 2000)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

function registerIpcHandlers() {
  const db = getDatabase()
  registerVersionHandlers(ipcMain, db)
  registerFontHandlers()
  registerKnowledgeHandlers()
  registerSearchHandlers()
  registerVolumeHandlers(db)
  registerVectorHandlers()
  registerImportHandlers(mainWindow!)

  // 日志 IPC:send / tail / openDir / export 等
  registerLogIpc({
    getActiveProjectId: () => activeProjectIdForQuit,
    dbStats: () => {
      const d = getDatabase()
      const safe = (sql: string) => {
        try { return d.queryOne(sql)?.cnt ?? 0 } catch { return 0 }
      }
      const dbBytes = (() => { try { return fs.statSync(path.join(app.getPath('userData'), 'inkark.db')).size } catch { return 0 } })()
      return {
        projects: safe('SELECT COUNT(*) AS cnt FROM projects'),
        chapters: safe('SELECT COUNT(*) AS cnt FROM chapters'),
        characterCards: safe('SELECT COUNT(*) AS cnt FROM character_cards'),
        worldCards: safe('SELECT COUNT(*) AS cnt FROM world_cards'),
        knowledgeItems: safe('SELECT COUNT(*) AS cnt FROM knowledge_items'),
        customStyles: safe('SELECT COUNT(*) AS cnt FROM custom_styles'),
        ftsEnabled: true,
        dbBytes,
      }
    },
  })

  ipcMain.handle('version:setActiveProject', (_e, projectId) => {
    activeProjectIdForQuit = projectId
  })

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:setFullscreen', (_e, fullscreen: boolean) => {
    if (mainWindow) {
      if (fullscreen) {
        mainWindow.maximize()
      } else {
        mainWindow.unmaximize()
        mainWindow.center()
      }
    }
  })

  ipcMain.handle('db:apiConfig:list', () => {
    return db.queryAll('SELECT * FROM api_configs ORDER BY created_at DESC')
  })
  ipcMain.handle('db:apiConfig:create', (_e, config) => {
    db.run('INSERT INTO api_configs (id, name, base_url, api_key, model, provider, context_length) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [config.id, config.name, config.base_url, config.api_key, config.model, config.provider, config.context_length ?? 200])
    return config
  })
  ipcMain.handle('db:apiConfig:update', (_e, config) => {
    db.run("UPDATE api_configs SET name=?, base_url=?, api_key=?, model=?, provider=?, context_length=?, updated_at=datetime('now') WHERE id=?",
      [config.name, config.base_url, config.api_key, config.model, config.provider, config.context_length ?? 200, config.id])
    return config
  })
  ipcMain.handle('db:apiConfig:delete', (_e, id) => {
    db.run('DELETE FROM api_presets WHERE api_config_id=?', [id])
    db.run('DELETE FROM api_configs WHERE id=?', [id])
    return { success: true }
  })
  ipcMain.handle('db:apiConfig:getDefault', () => {
    return db.queryOne('SELECT * FROM api_configs ORDER BY updated_at DESC LIMIT 1')
  })
  ipcMain.handle('db:preset:getByConfig', (_e, configId) => {
    return db.queryOne('SELECT * FROM api_presets WHERE api_config_id=? LIMIT 1', [configId]) ||
           db.queryOne('SELECT * FROM api_presets LIMIT 1')
  })
  ipcMain.handle('db:apiConfig:test', async (_e, config) => {
    try {
      const response = await fetch(`${config.base_url}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.api_key}`,
        },
        body: JSON.stringify({
          model: config.model?.trim(),
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 5,
        }),
      })
      if (!response.ok) {
        const text = await response.text()
        return { success: false, error: text }
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('db:preset:list', () => {
    return db.queryAll('SELECT * FROM api_presets ORDER BY created_at DESC')
  })
  ipcMain.handle('db:preset:create', (_e, preset) => {
    db.run('INSERT INTO api_presets (id, name, api_config_id, temperature, top_p, max_tokens, frequency_penalty, presence_penalty, thinking_enabled, reasoning_effort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [preset.id, preset.name, preset.api_config_id, preset.temperature, preset.top_p, preset.max_tokens, preset.frequency_penalty, preset.presence_penalty, preset.thinking_enabled ?? 1, preset.reasoning_effort ?? 'high'])
    return preset
  })
  ipcMain.handle('db:preset:update', (_e, preset) => {
    db.run('UPDATE api_presets SET name=?, api_config_id=?, temperature=?, top_p=?, max_tokens=?, frequency_penalty=?, presence_penalty=?, thinking_enabled=?, reasoning_effort=? WHERE id=?',
      [preset.name, preset.api_config_id, preset.temperature, preset.top_p, preset.max_tokens, preset.frequency_penalty, preset.presence_penalty, preset.thinking_enabled ?? 1, preset.reasoning_effort ?? 'high', preset.id])
    return preset
  })
  ipcMain.handle('db:preset:delete', (_e, id) => {
    db.run('DELETE FROM api_presets WHERE id=?', [id])
    return { success: true }
  })

  ipcMain.handle('db:project:list', () => {
    return db.queryAll('SELECT * FROM projects ORDER BY updated_at DESC')
  })
  ipcMain.handle('db:project:create', (_e, project) => {
    db.run(
      'INSERT INTO projects (id, title, outline, synopsis) VALUES (?, ?, ?, ?)',
      [project.id, project.title, project.outline || '', project.synopsis || ''],
    )
    createDefaultVolume(db, project.id)
    db.run("UPDATE projects SET outline_migrated_at=datetime('now') WHERE id=?", [project.id])
    return project
  })
  ipcMain.handle('db:project:update', (_e, project) => {
    if (project.outline !== undefined) {
      getLogger().warn('project.update', 'outline field ignored; use volumes', { projectId: project.id })
    }
    if (project.synopsis !== undefined) {
      getLogger().warn('project.update', 'synopsis field ignored; use volumes', { projectId: project.id })
    }
    db.run("UPDATE projects SET title=?, updated_at=datetime('now') WHERE id=?", [project.title, project.id])
    return project
  })
  ipcMain.handle('db:project:markOutlineMigrated', (_e, projectId: string) => {
    // 用户手动看过旧版大纲后,标记为已迁移,避免再弹迁移窗
    db.run("UPDATE projects SET outline_migrated_at=COALESCE(outline_migrated_at, datetime('now')), updated_at=datetime('now') WHERE id=?", [projectId])
    return { success: true }
  })
  ipcMain.handle('db:project:export', (_e, projectId) => {
    const project = db.queryOne('SELECT * FROM projects WHERE id=?', [projectId])
    if (!project) return { success: false, error: '项目不存在' }
    const chapters = db.queryAll('SELECT * FROM chapters WHERE project_id=? ORDER BY sort_order ASC', [projectId])
    const characterCards = db.queryAll('SELECT * FROM character_cards WHERE project_id=? ORDER BY sort_order ASC', [projectId])
    const worldCards = db.queryAll('SELECT * FROM world_cards WHERE project_id=? ORDER BY sort_order ASC', [projectId])
    const volumes = db.queryAll('SELECT * FROM outline_volumes WHERE project_id=? ORDER BY sort_order ASC', [projectId])
    const customStyles = db.queryAll('SELECT * FROM custom_styles ORDER BY sort_order ASC, created_at ASC')
    audit('project.export', { projectId, title: project.title, chapters: chapters.length, characters: characterCards.length, world: worldCards.length, volumes: volumes.length })
    return {
      version: 3,
      exportedAt: new Date().toISOString(),
      project,
      volumes,
      chapters,
      characterCards,
      worldCards,
      customStyles,
    }
  })

  ipcMain.handle('db:project:import', (_e, backup) => {
    try {
      const result = runProjectImport(db, backup)
      if (result?.success) {
        audit('project.import', {
          newProjectId: result.projectId,
          chapters: backup?.chapters?.length || 0,
          characters: backup?.characterCards?.length || 0,
          world: backup?.worldCards?.length || 0,
        })
      } else {
        getLogger().warn('projectImport.runProjectImport', 'returned failure', {
          error: result?.error,
          chapters: backup?.chapters?.length || 0,
        })
      }
      return result
    } catch (err: any) {
      getLogger().errorObj('projectImport.runProjectImport', 'threw', err, {
        chapters: backup?.chapters?.length || 0,
        characters: backup?.characterCards?.length || 0,
      })
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('db:project:getStyleGuidance', (_e, projectId) => {
    const row = db.queryOne('SELECT style_guidance FROM projects WHERE id=?', [projectId])
    return row?.style_guidance || ''
  })

  ipcMain.handle('db:project:setStyleGuidance', (_e, projectId, guidance) => {
    db.run('UPDATE projects SET style_guidance=?, style_custom_id=NULL, updated_at=datetime(\'now\') WHERE id=?', [guidance, projectId])
    return { success: true }
  })

  ipcMain.handle('db:project:getStyle', (_e, projectId) => {
    const row = db.queryOne('SELECT style_guidance, style_custom_id FROM projects WHERE id=?', [projectId])
    return {
      guidance: row?.style_guidance || '',
      customStyleId: row?.style_custom_id ?? null,
    }
  })

  ipcMain.handle('db:project:setStyle', (_e, projectId, customStyleId) => {
    if (customStyleId) {
      const row = db.queryOne('SELECT guidance FROM custom_styles WHERE id=?', [customStyleId])
      if (!row) return { success: false, error: 'custom style 不存在' }
      db.run('UPDATE projects SET style_custom_id=?, style_guidance=?, updated_at=datetime(\'now\') WHERE id=?',
        [customStyleId, row.guidance, projectId])
    } else {
      db.run('UPDATE projects SET style_custom_id=NULL, style_guidance=\'\', updated_at=datetime(\'now\') WHERE id=?', [projectId])
    }
    return { success: true }
  })

  ipcMain.handle('db:project:getWritingRestrictions', (_e, projectId) => {
    const row = db.queryOne('SELECT writing_restrictions FROM projects WHERE id=?', [projectId])
    return row?.writing_restrictions || ''
  })

  ipcMain.handle('db:project:setWritingRestrictions', (_e, projectId, restrictions) => {
    db.run('UPDATE projects SET writing_restrictions=?, updated_at=datetime(\'now\') WHERE id=?', [restrictions, projectId])
    return { success: true }
  })

  // Custom styles CRUD
  ipcMain.handle('db:customStyle:list', () => {
    return db.queryAll('SELECT * FROM custom_styles ORDER BY sort_order ASC, created_at ASC')
  })

  ipcMain.handle('db:customStyle:create', (_e, payload) => {
    if (!payload?.id || !payload?.name) return { success: false, error: 'id 和 name 必填' }
    db.run('INSERT INTO custom_styles (id, name, guidance, sort_order) VALUES (?, ?, ?, ?)',
      [payload.id, payload.name, payload.guidance || '', payload.sort_order ?? 0])
    return { success: true }
  })

  ipcMain.handle('db:customStyle:update', (_e, payload) => {
    if (!payload?.id) return { success: false, error: 'id 必填' }
    const fields: string[] = []
    const args: any[] = []
    if (payload.name !== undefined) { fields.push('name=?'); args.push(payload.name) }
    if (payload.guidance !== undefined) { fields.push('guidance=?'); args.push(payload.guidance) }
    if (payload.sort_order !== undefined) { fields.push('sort_order=?'); args.push(payload.sort_order) }
    if (fields.length === 0) return { success: true }
    fields.push('updated_at=datetime(\'now\')')
    args.push(payload.id)
    db.run(`UPDATE custom_styles SET ${fields.join(', ')} WHERE id=?`, args)
    return { success: true }
  })

  ipcMain.handle('db:customStyle:delete', (_e, id) => {
    // 同一个事务:删 custom_style,并把所有引用它的 project 的风格清空。
    // 否则会出现"项目显示默认风格,但 style_guidance 里其实还残留被删风格的内容"——
    // 前端用 guidance 当真值(参见 db:project:getStyle),customStyleId 只作辅助引用。
    // 注意:SQLite 的 ON DELETE SET NULL 只能清 style_custom_id,无法清 style_guidance。
    try {
      db.transaction(() => {
        db.run('UPDATE projects SET style_custom_id=NULL, style_guidance=\'\', updated_at=datetime(\'now\') WHERE style_custom_id=?', [id])
        db.run('DELETE FROM custom_styles WHERE id=?', [id])
      })
    } catch (e) {
      console.error('[customStyle.delete] 事务失败', e)
      return { success: false, error: String(e) }
    }
    return { success: true }
  })

  // One-shot migration from localStorage 'custom-styles' to DB
  ipcMain.handle('db:style:migrateFromLocalStorage', (_e, styles) => {
    if (!Array.isArray(styles)) return { success: false, error: 'styles 必须是数组' }
    let inserted = 0
    let skipped = 0
    db.transaction(() => {
      for (const s of styles) {
        if (!s?.id || !s?.name) { skipped++; continue }
        const existing = db.queryOne('SELECT id FROM custom_styles WHERE name=? AND guidance=?',
          [s.name, s.guidance || ''])
        if (existing) { skipped++; continue }
        db.run('INSERT INTO custom_styles (id, name, guidance, sort_order) VALUES (?, ?, ?, ?)',
          [s.id, s.name, s.guidance || '', 0])
        inserted++
      }
    })
    return { success: true, inserted, skipped }
  })

  ipcMain.handle('db:project:delete', (_e, id) => {
    const proj = db.queryOne('SELECT title FROM projects WHERE id=?', [id])
    try {
      const commits = db.queryAll('SELECT manifest FROM version_commits WHERE project_id=?', [id])
      const allHashes = new Set<string>()
      for (const c of commits) {
        const manifest: Record<string, string> = JSON.parse(c.manifest)
        for (const v of Object.values(manifest)) {
          let h = v
          try { const p = JSON.parse(v); if (p && typeof p === 'object' && p.h) h = p.h } catch {}
          allHashes.add(h)
        }
      }
      db.run('DELETE FROM version_commits WHERE project_id=?', [id])
      for (const hash of allHashes) {
        const refCount = db.queryOne('SELECT COUNT(*) as cnt FROM version_commits WHERE manifest LIKE ?', [`%${hash}%`])
        if (!refCount || refCount.cnt === 0) {
          db.run('DELETE FROM version_blobs WHERE hash=?', [hash])
        }
      }
      db.run('DELETE FROM chapters WHERE project_id=?', [id])
      db.run('DELETE FROM character_cards WHERE project_id=?', [id])
      db.run('DELETE FROM world_cards WHERE project_id=?', [id])
      db.run('DELETE FROM task_bindings WHERE project_id=?', [id])
      db.run('DELETE FROM projects WHERE id=?', [id])
      deleteProjectFromFTS(db, id)
      audit('project.delete', { projectId: id, title: proj?.title, commitsRemoved: commits.length })
      return { success: true }
    } catch (err: any) {
      getLogger().errorObj('db.project.delete', 'failed', err, { projectId: id, title: proj?.title })
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('db:chapter:list', (_e, projectId) => {
    return db.queryAll('SELECT * FROM chapters WHERE project_id=? ORDER BY sort_order ASC', [projectId])
  })
  ipcMain.handle('db:chapter:listMeta', (_e, projectId) => {
    return db.queryAll('SELECT id, project_id, title, chapter_outline, sort_order, status, word_count, created_at, updated_at FROM chapters WHERE project_id=? ORDER BY sort_order ASC', [projectId])
  })
  ipcMain.handle('db:chapter:save', (_e, chapter) => {
    try {
      const existing = db.queryOne('SELECT id FROM chapters WHERE id=?', [chapter.id])
      if (existing) {
        db.run("UPDATE chapters SET title=?, content=?, chapter_outline=?, word_count=?, updated_at=datetime('now') WHERE id=?",
          [chapter.title, chapter.content, chapter.chapter_outline || '', chapter.word_count, chapter.id])
      } else {
        db.run('INSERT INTO chapters (id, project_id, title, content, chapter_outline, sort_order, word_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [chapter.id, chapter.project_id, chapter.title, chapter.content, chapter.chapter_outline || '', chapter.sort_order, chapter.word_count])
      }
      syncChapterToFTS(db, chapter)
      return chapter
    } catch (err: any) {
      getLogger().errorObj('db.chapter.save', 'failed', err, {
        chapterId: chapter.id,
        projectId: chapter.project_id,
        title: chapter.title,
        wordCount: chapter.word_count,
      })
      throw err
    }
  })
  ipcMain.handle('db:chapter:updateMeta', (_e, chapter) => {
    db.run("UPDATE chapters SET title=?, chapter_outline=?, status=?, updated_at=datetime('now') WHERE id=?",
      [chapter.title, chapter.chapter_outline, chapter.status, chapter.id])
    const full = db.queryOne('SELECT * FROM chapters WHERE id=?', [chapter.id])
    if (full) syncChapterToFTS(db, full)
    return chapter
  })
  ipcMain.handle('db:chapter:reorder', (_e, items) => {
    db.transaction(() => {
      for (const item of items) {
        db.run('UPDATE chapters SET sort_order=? WHERE id=?', [item.sort_order, item.id])
      }
    })
    return { success: true }
  })
  ipcMain.handle('db:chapter:delete', (_e, id) => {
    const chapter = db.queryOne('SELECT project_id, title FROM chapters WHERE id=?', [id])
    try {
      deleteEntityFromFTS(db, 'chapter_outline', id)
      deleteEntityFromFTS(db, 'chapter_content', id)
      db.run('DELETE FROM chapters WHERE id=?', [id])
      audit('chapter.delete', { chapterId: id, projectId: chapter?.project_id, title: chapter?.title })
      return { success: true }
    } catch (err: any) {
      getLogger().errorObj('db.chapter.delete', 'failed', err, { chapterId: id, title: chapter?.title })
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('db:character:list', (_e, projectId) => {
    return db.queryAll('SELECT * FROM character_cards WHERE project_id=? ORDER BY sort_order ASC', [projectId])
  })
  const toJson = (v: any) => typeof v === 'string' ? v : JSON.stringify(v)

  ipcMain.handle('db:character:create', (_e, card) => {
    db.run('INSERT INTO character_cards (id, project_id, name, alias, description, role, traits, appearance, background, relationships, notes, tags, card_group, sort_order, gender, age) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [card.id, card.project_id, card.name, card.alias, card.description, card.role, toJson(card.traits), card.appearance, card.background, card.relationships, card.notes, toJson(card.tags), card.card_group, card.sort_order, card.gender || '', card.age || ''])
    syncCharacterToFTS(db, card)
    return card
  })
  ipcMain.handle('db:character:update', (_e, card) => {
    db.run("UPDATE character_cards SET name=?, alias=?, description=?, role=?, traits=?, appearance=?, background=?, relationships=?, notes=?, tags=?, card_group=?, gender=?, age=?, updated_at=datetime('now') WHERE id=?",
      [card.name, card.alias, card.description, card.role, toJson(card.traits), card.appearance, card.background, card.relationships, card.notes, toJson(card.tags), card.card_group, card.gender || '', card.age || '', card.id])
    syncCharacterToFTS(db, card)
    return card
  })
  ipcMain.handle('db:character:delete', (_e, id) => {
    const card = db.queryOne('SELECT project_id, name FROM character_cards WHERE id=?', [id])
    try {
      deleteEntityFromFTS(db, 'character', id)
      db.run('DELETE FROM character_cards WHERE id=?', [id])
      audit('character.delete', { characterId: id, projectId: card?.project_id, name: card?.name })
      return { success: true }
    } catch (err: any) {
      getLogger().errorObj('db.character.delete', 'failed', err, { characterId: id, name: card?.name })
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('db:world:list', (_e, projectId) => {
    return db.queryAll('SELECT * FROM world_cards WHERE project_id=? ORDER BY sort_order ASC', [projectId])
  })
  ipcMain.handle('db:world:create', (_e, card) => {
    db.run('INSERT INTO world_cards (id, project_id, name, card_type, description, tags, card_group, parent_id, sort_order, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [card.id, card.project_id, card.name, card.card_type, card.description, toJson(card.tags), card.card_group, card.parent_id, card.sort_order, card.notes || ''])
    syncWorldToFTS(db, card)
    return card
  })
  ipcMain.handle('db:world:update', (_e, card) => {
    db.run("UPDATE world_cards SET name=?, card_type=?, description=?, tags=?, card_group=?, parent_id=?, notes=?, updated_at=datetime('now') WHERE id=?",
      [card.name, card.card_type, card.description, toJson(card.tags), card.card_group, card.parent_id, card.notes || '', card.id])
    syncWorldToFTS(db, card)
    return card
  })
  ipcMain.handle('db:world:delete', (_e, id) => {
    const card = db.queryOne('SELECT project_id, name FROM world_cards WHERE id=?', [id])
    try {
      deleteEntityFromFTS(db, 'world', id)
      db.run('DELETE FROM world_cards WHERE id=?', [id])
      audit('world.delete', { worldId: id, projectId: card?.project_id, name: card?.name })
      return { success: true }
    } catch (err: any) {
      getLogger().errorObj('db.world.delete', 'failed', err, { worldId: id, name: card?.name })
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('db:taskBinding:list', (_e, projectId) => {
    return db.queryAll('SELECT * FROM task_bindings WHERE project_id=?', [projectId])
  })
  ipcMain.handle('db:taskBinding:set', (_e, binding) => {
    const existing = db.queryOne('SELECT id FROM task_bindings WHERE task_type=? AND project_id=?', [binding.task_type, binding.project_id])
    if (existing) {
      db.run('UPDATE task_bindings SET preset_id=? WHERE id=?', [binding.preset_id, existing.id])
    } else {
      db.run('INSERT INTO task_bindings (id, task_type, project_id, preset_id) VALUES (?, ?, ?, ?)',
        [binding.id, binding.task_type, binding.project_id, binding.preset_id])
    }
    return binding
  })
  ipcMain.handle('db:taskBinding:delete', (_e, id) => {
    db.run('DELETE FROM task_bindings WHERE id=?', [id])
    return { success: true }
  })
  ipcMain.handle('db:taskBinding:getByTask', (_e, projectId, taskType) => {
    const binding = db.queryOne('SELECT * FROM task_bindings WHERE project_id=? AND task_type=?', [projectId, taskType])
    if (binding && binding.preset_id) {
      return db.queryOne('SELECT * FROM api_presets WHERE id=?', [binding.preset_id])
    }
    return null
  })

  ipcMain.handle('dialog:confirm', async (_e, message: string) => {
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['取消', '确定'],
      defaultId: 0,
      cancelId: 0,
      title: '确认',
      message,
    })
    return result.response === 1
  })

  ipcMain.handle('file:save', async (_e, options: { defaultName: string; content?: string; base64?: string; filterName: string; extension: string }) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: options.defaultName,
      filters: [{ name: options.filterName, extensions: [options.extension] }],
    })
    if (!result.canceled && result.filePath) {
      if (options.base64) {
        const buffer = Buffer.from(options.base64, 'base64')
        fs.writeFileSync(result.filePath, buffer)
      } else if (options.content !== undefined) {
        fs.writeFileSync(result.filePath, options.content, 'utf-8')
      }
      return { success: true, path: result.filePath }
    }
    return { success: false }
  })

  ipcMain.handle('file:open', async (_e, options: { filterName: string; extension: string }) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      filters: [{ name: options.filterName, extensions: [options.extension] }],
      properties: ['openFile'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0]
      const MAX_FILE_SIZE = 200 * 1024 * 1024
      const stat = fs.statSync(filePath)
      if (stat.size > MAX_FILE_SIZE) {
        return { success: false, error: `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，上限 ${MAX_FILE_SIZE / 1024 / 1024}MB` }
      }
      const content = fs.readFileSync(filePath, 'utf-8')
      return { success: true, path: filePath, content }
    }
    return { success: false }
  })

  ipcMain.handle('db:sensitive:list', () => {
    return db.queryAll('SELECT * FROM sensitive_words ORDER BY word ASC')
  })
  ipcMain.handle('db:sensitive:add', (_e, word) => {
    db.run('INSERT OR IGNORE INTO sensitive_words (id, word) VALUES (?, ?)', [word.id, word.word])
    return word
  })
  ipcMain.handle('db:sensitive:remove', (_e, id) => {
    db.run('DELETE FROM sensitive_words WHERE id=? AND is_builtin=0', [id])
    return { success: true }
  })

  function resolveApiOptions(options: any) {
    return {
      url: `${options.baseUrl}/chat/completions`,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${options.apiKey}` },
    }
  }

  ipcMain.handle('api:streamChat', async (_e, options: any) => {
    const streamId = nextStreamId()
    const abortController = new AbortController()
    activeStreams.set(streamId, abortController)
    const apiSource = 'custom'

    const send = (type: string, data: any) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.send(`api:stream:${streamId}`, { type, data })
    }

    setTimeout(async () => {
      try {
        let url: string
        let headers: Record<string, string>
        try {
          const resolved = resolveApiOptions(options)
          url = resolved.url
          headers = resolved.headers
        } catch (err: any) {
          l.errorObj('api.streamChat', 'resolveApiOptions failed', err, { apiSource })
          send('error', { message: err.message })
          activeStreams.delete(streamId)
          return
        }

        const body: Record<string, any> = {
          model: options.model?.trim(),
          messages: options.messages,
          stream: true,
        }
        if (options.temperature !== undefined) body.temperature = options.temperature
        if (options.topP !== undefined) body.top_p = options.topP
        if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
        if (options.frequencyPenalty !== undefined) body.frequency_penalty = options.frequencyPenalty
        if (options.presencePenalty !== undefined) body.presence_penalty = options.presencePenalty
        if (options.thinking) body.thinking = options.thinking
        if (options.reasoningEffort) body.reasoning_effort = options.reasoningEffort
        if (options.tools) { body.tools = options.tools; body.tool_choice = options.toolChoice || 'auto' }
        if (options.n !== undefined) body.n = options.n

        let response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: abortController.signal,
        })


        if (!response.ok) {
          const text = await response.text()
          l.warn('api.streamChat', 'non-OK response', {
            apiSource,
            model: options.model,
            status: response.status,
            // body 截前 200 字,避免冲爆日志
            bodyPreview: text.slice(0, 200),
          })
          send('error', { message: `API error ${response.status}: ${text}` })
          return
        }

        const reader = response.body?.getReader()
        if (!reader) {
          l.warn('api.streamChat', 'no response body', { apiSource, model: options.model })
          send('error', { message: 'No response body' })
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''
        const toolCallsMap: Record<number, any> = {}
        let finishReason = ''
        const multiMode = options.n && options.n > 1

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)

              if (multiMode) {
                for (const choice of (parsed.choices || [])) {
                  const idx = choice.index
                  const content = choice.delta?.content || ''
                  if (content) send('token', { index: idx, content })
                }
              } else {
                const choice = parsed.choices?.[0]
                if (!choice) continue
                const delta = choice.delta || {}
                if (delta.content) send('token', delta.content)
                if (delta.reasoning_content) send('reasoning', delta.reasoning_content)
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0
                    if (!toolCallsMap[idx]) {
                      toolCallsMap[idx] = { ...tc, function: { name: '', arguments: '' } }
                      if (tc.id) toolCallsMap[idx].id = tc.id
                      if (tc.type) toolCallsMap[idx].type = tc.type
                    }
                    if (tc.function) {
                      if (tc.function.name) toolCallsMap[idx].function.name += tc.function.name
                      if (tc.function.arguments) toolCallsMap[idx].function.arguments += tc.function.arguments
                    }
                  }
                }
                if (choice.finish_reason) finishReason = choice.finish_reason
              }
            } catch { /* skip parse errors */ }
          }
        }

        const toolCalls = Object.keys(toolCallsMap).length > 0
          ? Object.values(toolCallsMap).map((tc: any) => ({
              id: tc.id || '', type: tc.type || 'function',
              function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
            }))
          : undefined

        send('done', { toolCalls })
      } catch (err: any) {
        if (err.name === 'AbortError') {
          l.info('api.streamChat', 'aborted by user', { apiSource, model: options.model })
          send('done', {})
          return
        }
        l.errorObj('api.streamChat', 'stream error', err, { apiSource, model: options.model })
        send('error', { message: err.message })
      } finally {
        activeStreams.delete(streamId)
      }
    })

    return streamId
  })

  ipcMain.handle('api:abortStream', (_e, streamId: string) => {
    const controller = activeStreams.get(streamId)
    if (controller) { controller.abort(); activeStreams.delete(streamId) }
  })
}

