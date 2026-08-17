import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 渲染进程 console.* 重定向到主进程 logger。
// 这样 src/ 下 37 处 console.log/error/warn 零修改自动进 inkark-*.log。
// 主进程 logger 会自动脱敏(API key / token / 章节正文)。
//
// 安全:
//   - 永远不抛错(preload 没就绪 / IPC 失败都吞)
//   - dev 也启用:本地开发也能看到这些 console 进 inkark-*.log,便于排查
//   - dev 模式下原 console 仍会打 stdout(便于实时调试),不冲突
if (typeof window !== 'undefined' && (window as any).electronAPI?.log?.send) {
  const api = (typeof window !== 'undefined' ? (window as any).electronAPI : undefined)
  if (api?.log?.send) {
    const origLog = console.log.bind(console)
    const origWarn = console.warn.bind(console)
    const origError = console.error.bind(console)
    console.log = (...args: unknown[]) => {
      try { api.log.send('info', 'renderer.console', String(args[0] ?? ''), { args: args.slice(1) }) } catch {}
      origLog(...args)
    }
    console.warn = (...args: unknown[]) => {
      try { api.log.send('warn', 'renderer.console', String(args[0] ?? ''), { args: args.slice(1) }) } catch {}
      origWarn(...args)
    }
    console.error = (...args: unknown[]) => {
      try { api.log.send('error', 'renderer.console', String(args[0] ?? ''), { args: args.slice(1) }) } catch {}
      origError(...args)
    }
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
