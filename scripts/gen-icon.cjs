const fs = require('fs')
const path = require('path')
const png2icons = require('png2icons')

const inputPath = path.resolve(__dirname, '..', 'logo.png')
const buf = fs.readFileSync(inputPath)

fs.mkdirSync(path.resolve(__dirname, '..', 'build'), { recursive: true })

// Windows .ico
const ico = png2icons.createICO(buf, png2icons.BICUBIC, 0, false, 1, 0)
if (!ico) { console.error('生成 icon.ico 失败'); process.exit(1) }
const icoPath = path.resolve(__dirname, '..', 'build', 'icon.ico')
fs.writeFileSync(icoPath, ico)
console.log(`已生成 ${icoPath} (${ico.length} bytes)`)

// macOS .icns
const icns = png2icons.createICNS(buf, png2icons.BICUBIC, 0, false)
if (!icns) { console.error('生成 icon.icns 失败'); process.exit(1) }
const icnsPath = path.resolve(__dirname, '..', 'build', 'icon.icns')
fs.writeFileSync(icnsPath, icns)
console.log(`已生成 ${icnsPath} (${icns.length} bytes)`)
