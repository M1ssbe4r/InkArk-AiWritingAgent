import { app, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'

const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff2', '.woff']

function getFontsDir(): string {
  return app.isPackaged
    ? process.platform === 'darwin'
      // Mac packaged: 跟 data 一起放 userData,避免被 .dmg 替换带走
      // 见 electron/main.ts 顶部 setPath + fontsDir 的注释
      ? path.join(app.getPath('userData'), 'fonts')
      // Windows packaged: portable,跟着 .exe 走,NSIS installer.nsh 备份恢复
      : path.join(path.dirname(process.execPath), 'fonts')
    : path.join(__dirname, '..', '..', 'fonts')
}

export function registerFontHandlers() {
  ipcMain.handle('font:list', async () => {
    const dir = getFontsDir()
    if (!fs.existsSync(dir)) return []
    const files = fs.readdirSync(dir)
    return files
      .filter(f => FONT_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .map(f => ({
        name: path.basename(f, path.extname(f)),
        file: f,
        path: path.join(dir, f),
      }))
  })

  ipcMain.handle('font:getPath', async (_e, fileName: string) => {
    const dir = getFontsDir()
    const fullPath = path.join(dir, fileName)
    if (fs.existsSync(fullPath)) return fullPath
    return null
  })
}
