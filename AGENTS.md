# InkArk — Agent Guide

## Product Context

**InkArk is a commercial product preparing for market launch, not a personal project.** This shapes every recommendation:

- **Data safety > convenience.** A user losing their writing is unrecoverable and damages the product. Prefer defensive defaults (atomic writes, backups, NSIS data preservation hooks) over clever shortcuts.
- **API and schema stability > refactoring speed.** Renderer, preload, and IPC contracts are public surfaces once users are running this. Breaking changes need migration paths, not just "rename the field".
- **No experimental dependencies in shipped code.** Pin versions, audit new deps, prefer mature libraries. A crash in production hits paying users.
- **Compliance-adjacent items are not optional:** user agreement, privacy policy, telemetry opt-in, API key encryption at rest, error reporting. Surface these when missing rather than waiting to be asked.
- **Portability is a first-class design goal** — user data lives at `$INSTDIR/data/` (and `$INSTDIR/fonts/`), intentionally not in `%APPDATA%`. NSIS update install preserves these via the `customInstall` hook in `build/installer.nsh`. If you add a new user-owned directory at the install root, mirror the recovery in that hook.

## Quick Reference

```bash
npm install              # install deps (root only; server/ has its own)
npm run dev              # Vite dev server (browser HMR, no Electron)
npm run electron:dev     # build then launch Electron
npm test                 # Vitest unit tests
npm run test:watch       # Vitest watch mode
npm run e2e              # build + Playwright e2e (Electron)
npm run build            # tsc + vite build
```

**No lint, format, or typecheck scripts are defined.** Run `npx tsc --noEmit` manually for type checking. There is no ESLint or Prettier config.

## Architecture

Two separate apps in one repo:

| Layer | Path | Stack |
|---|---|---|
| Desktop app (renderer) | `src/` | React 19 + TypeScript + Vite 6 + Tailwind 3.4 + shadcn/ui |
| Electron main process | `electron/` | Node + Electron 33 + sql.js (WASM SQLite) |
| API proxy server | `server/` | Express + better-sqlite3 + JWT (standalone, not built by root scripts) |

### Key Boundaries

- **`electron/preload.ts`** bridges main ↔ renderer via `contextBridge`. Renderer accesses all DB/IPC through `window.electronAPI.*` — never import electron modules in `src/`.
- **`electron/ipc/db.ts`** — SQLite init, migrations, query helpers. Migrations use `try { ALTER TABLE } catch {}` pattern (no migration framework).
- **`electron/ipc/version.ts`** — content-addressable version control (SHA-256 blobs + manifest commits).
- **`electron/ipc/consistency.ts`** — auto-fix checks run on app start and before commits.
- **`electron/ipc/font.ts`** — custom font discovery from `fonts/` dir (packaged) or project root `fonts/` (dev).
- **`src/lib/api.ts`** — LLM streaming via `window.electronAPI.api.streamChat`. All API calls go through Electron main process to avoid CORS.
- **`src/lib/tools.ts`** — 16 AI tool definitions + handlers for function calling. `write_outline` and `update_progress` require HTML format content.
- **`src/stores/`** — Zustand stores (`editorStore`, `appStore`, `settingsStore`). `editorStore` has `pendingOutlineEdit` for outline diff review, `appStore` has `editorView` for chapter/outline toggle.

### Path Alias

`@/*` → `src/*` (configured in tsconfig + vite + vitest).

## Testing

### Unit Tests (Vitest)

- 10 test files co-located: `src/stores/*.test.ts`, `src/lib/*.test.ts`
- Environment: `node` (not jsdom) — tests use mock `window.electronAPI` objects
- Run single file: `npx vitest run src/lib/utils.test.ts`
- Run with pattern: `npx vitest run --reporter=verbose` (shows all test names)
- Coverage: `npm run test:coverage` (v8 provider, covers `src/**/*.{ts,tsx}`)

### E2E Tests (Playwright)

- 10 spec files in `e2e/`, launches real Electron via `_electron`
- **Must build first** (`vite build` before Playwright runs — `npm run e2e` handles this)
- Each test gets an isolated data dir (`e2e/.e2e-data/test-{timestamp}`), auto-cleaned
- Fixtures in `e2e/fixtures.ts`: `app` (ElectronApplication), `window` (Page), helper fns `closeApiDialog`, `closeBookIdeaDialog`, `reactClick`
- E2E config with API keys: `e2e/test.config.json` (gitignored). See `e2e/test.config.example.json` for template.
- Run single spec: `npx playwright test e2e/app.spec.ts`
- Run headed: `npm run e2e:headed`
- Tests need to dismiss dialogs on startup: API settings dialog + book idea dialog

## Database & Data

- **SQLite via sql.js (WASM)** — no native bindings needed in desktop app
- DB file: `{userData}/inkark.db` — portable, next to executable in packaged builds, `data/` in dev
- `userData` path overridden by `INKARK_E2E_USER_DATA` env var for e2e isolation
- Auto-save: db written to disk after every `run()` call (unless inside `transaction()`)
- ID format: `Date.now().toString(36) + Math.random().toString(36).slice(2, 9)` (base-36)

## Electron IPC Pattern

All IPC uses `ipcMain.handle` / `ipcRenderer.invoke` (request-response). Channel naming: `db:{entity}:{action}` (e.g. `db:chapter:save`). The preload script exposes a structured `window.electronAPI` object — renderer code never calls `ipcRenderer` directly.

Streaming API calls use a stream ID pattern: main process returns a stream ID, renderer subscribes via `api:stream:{id}` events, can abort via `api:abortStream`.

## Server (server/)

Independent Express app with its own `package.json`. Not built or started by root scripts.

```bash
cd server && npm install && npm run dev   # tsx watch mode
```

- Auth: bcryptjs + JWT
- LLM proxy: forwards to configured `LLM_BASE_URLS` with key rotation
- Deploy: Docker (`server/docker-compose.yml`), needs `.env` with `JWT_SECRET`, `LLM_BASE_URLS`, `LLM_API_KEYS`, `LLM_MODELS`
- Rate limiting: per-user daily token + request limits
- Routes: `chat.ts` (LLM proxy), auth middleware, rate-limit middleware

## Important Conventions

- **UI components**: shadcn/ui pattern — Radix primitives + CVA + `cn()` utility in `src/lib/utils.ts`
- **State**: Zustand stores with `persist` middleware for localStorage (settings) and in-memory (editor/app)
- **Editor**: TipTap (ProseMirror) — extensions in `src/extensions/`, custom `StaticCursor` extension
- **Styling**: Tailwind with CSS variables for theming (`hsl(var(--primary))` pattern), dark mode via `class` strategy
- **Imports**: Use `@/` path alias, not relative `../` for cross-directory imports
- **No comments in code** unless explicitly asked
- **Fonts**: custom fonts go in `fonts/` dir at project root (dev) or next to executable (packaged)
