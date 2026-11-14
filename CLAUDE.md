# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # daemon on :4174 + Vite on :5173 (proxies /api)
npm test           # node --test — discovers *.test.mjs anywhere
node --test src/lib/themes.test.mjs   # single test file
npm run typecheck  # tsc -b --pretty
npm run build      # tsc -b && vite build → dist/
npm start          # daemon serving the prebuilt dist/ on :4174
node server/opensol.mjs {status,logs,stop}
```

Node 24 runs the `.test.mjs` files directly: they import TypeScript sources with an explicit `.ts` extension (`from './themes.ts'`) and rely on Node's built-in type stripping. See **Testing traps** below.

## Two processes, one app

The React app in `src/` never talks to a provider or the filesystem directly. It calls a local Node daemon (`server/daemon.mjs`, `127.0.0.1:4174`) over `/api`, and the daemon owns every privileged operation — provider credentials, workspace files, shell, git, search, deploy, plugins.

- **Provider calls** go browser → `POST /api/llm` → daemon → provider. Keys are AES-256-GCM encrypted in `~/.opensol/secrets.enc`; the browser only ever sees a masked hint, so adding a provider means touching both `src/` and `server/lib/providers.mjs`.
- **Tool calls** are dispatched by the client agent loop via `src/lib/daemon.ts` → `POST /api/tools/execute` → `server/lib/tools.mjs`.
- **All `/api` routes** require a session cookie plus `x-maxcode-csrf`; Host, Origin and `Sec-Fetch-Site` are checked in `server/daemon.mjs`. New routes go inside the `pathname.startsWith('/api/')` block, after the session guard.

The daemon is documented as zero-runtime-dependency, but `shared/plugin-package.mjs` imports `fflate` from `node_modules` at runtime (`server/lib/plugins.mjs` imports it). That dependency is *not* bundled — a `node_modules`-free copy of the app cannot load plugins.

## MCP

`server/lib/mcp.mjs` owns every connection (stdio, Streamable HTTP, legacy SSE). Remote servers may set `oauth: { enabled }`: on a 401 the server becomes `needs_auth`, the MCP panel (`src/components/McpPanel.tsx`) calls `POST /api/mcp/:id/authorize`, and the provider redirects to `/oauth/mcp/callback`. That one route is handled *before* `guardRequest` (the redirect is cross-site); the one-time `state` is its CSRF guard. Clients and tokens live in `secrets.enc` under `mcpOAuth`, never in `state.json`.

**Sync is event-driven, never timed.** `McpManager` emits `{type:'server'|'servers'}` events (`subscribe`) that `GET /api/mcp/events` streams to `src/store/mcp.ts` (started from `applySnapshot`). Tool lists change through `scheduleRefresh` (debounced `list_changed`) or `#settleTools` (after a state-changing call on a server without `listChanged`); both go through `#syncTools`, which compares a hash and emits only on change. `callTool` returns `toolsChanged` and `src/core/mcp-tools.ts` applies it before returning the result — keep that order, it is what lets the next LLM request carry the new tools mid-turn. Lost connections reconnect themselves (`#scheduleReconnect`, keeps last tools, `reconnecting` flag, `#ready` waits for it); `mcpServerUsable` is the client-side gate. Transport kinds fall back to each other (`isTransportMismatch`) and `#handshake` negotiates the protocol version.

## Ask Question

`ask_question` (`src/core/plugins/tools/ask.ts`) parks the loop in `askUser` (`src/store/questions.ts`) until `QuestionCard` answers, skips or the run is stopped. The agent loop marks it `awaiting` (never approval-gated). Arguments are untrusted: always read them through `normalizeQuestions` (`src/lib/ask-question.ts`, unit-tested). The free-text field is rendered by the card for every question — the model must not add an "Other" option.

## Agent core (Cordis kernel)

`src/core/kernel.ts` builds one Cordis `Context` with services (`sessions`, `systemPrompt`, `tools`, `approval`, `llm`, `compaction`, `subagents`, `ui`, `agentLoop`, `titles`) and first-party tool plugins (`src/core/plugins/tools/*`). `src/agent/index.ts` is a thin facade over `kernel.agentLoop`; `src/agent/adapters/*` are the provider adapters. The model gets its tools from `LlmService` (`request.tools`, default `tools.schemas(settings, mode)`); pass `tools: []` for plain completions.

`AgentLoopService` has no round cap: a turn ends when the model stops calling tools, errors, or the user stops it. Neighbouring `subagent` calls in one round run in parallel; every other call runs in order. Transient provider errors retry with backoff (`src/lib/retry.ts`).

`src/agent/queue.ts` serializes runs **per session** (`createTurnQueue`) and caps each run's history with `turnHistory`, which stops at the *next* user message. This is what keeps a prompt submitted mid-stream from either being consumed early or splitting into a second reply — do not replace it with a slice of the store.

**Compaction** (`src/core/services/compaction.ts`, pure helpers in `src/lib/compact-plan.ts`): checked before a turn and between tool rounds at `AUTO_COMPACT_THRESHOLD`; `/compact [focus]` runs it by hand. It keeps the newest turns verbatim (cut always lands on a user message, so tool calls keep their results), summarises the rest with the model (rolling over chunks, merging a previous summary), tracks written files from tool calls, and falls back to a deterministic summary if the model fails and the window is nearly full. The summary is an assistant message with `compaction` metadata, shown as a divider by `CompactionNote`. Mid-turn compaction appends a handoff user message and the loop continues from it.

**Subagents** (`src/core/services/subagents.ts`, types in `src/lib/subagent-types.ts`): read-only (`plan` mode), per-type tool allowlist (`explore`, `research`, `review`), round budget then a forced report, old tool output pruned, live progress via `ToolExecutionContext.onProgress`. They never get MCP tools or the `subagent` tool.

## Chat rendering

Messages are stored flat (`UserMessage | AssistantMessage | ToolMessage`) with a `round` field. Presentation is derived, never stored: `src/lib/conversation.ts` (`groupConversationTurns`) folds consecutive tool messages into one `tools` segment and drops assistant rounds that only called tools. `TurnBlock` in `src/components/MessageItem.tsx` renders one user turn as one answer, and `UsedGroup` is the collapsible "Used N tools" cluster.

## Plugins

Lifecycle: install (disabled + untrusted) → review capabilities/domains (v1) → optional sandboxed preview → mark **Safe** → enable. A changed manifest hash invalidates grants and trust.

- `shared/plugin-package.mjs` is the package contract, shared verbatim by the browser and the daemon: plugin packages are zero-dependency UTF-8 JSON archives (`.plugin.json`) with `manifest`, one JS entry, one CSS stylesheet, bounded assets. Supports `apiVersion: 1` (legacy sandbox) and `apiVersion: 2` (free Cordis kernel plugin).
- `src/plugins/runtime.ts` runs Safe plugins as **blob ES modules** (`const maxcode = ...` injected).
  - **API v1**: Handed `createPluginApi` with capability guards, restricted host calls, and manual contribution tracking.
  - **API v2**: Handed a scoped Cordis child `Context` (`kernel.plugin(fn)`). The plugin has 100% unrestricted access to internal services (`ctx.tools`, `ctx.ui`, `ctx.sessions`, `ctx.llm`, `ctx.on(...)`, events, stores). When deactivated/uninstalled, `fiber.dispose()` cleans up all hooks and registrations automatically without mutating files on disk.
- `server/lib/plugins.mjs` stores packages under `~/.opensol/plugins` and is the **only** path to the network for v1 plugins. `network.request` is HTTPS-only, port 443, exact host from `manifest.domains` ∩ `grants.domains`, private IPs blocked, redirects refused, content-type allowlist, 64 KB request / 1 MB response / 12 s timeout.
- `src/plugins/api.ts` (`createPluginApi`) re-checks grants at every call site for v1 plugins.
- `src/plugins/preview.ts` builds the sandboxed preview (`iframe sandbox="allow-scripts"`, deliberately **no** `allow-same-origin`) with a stub API and validates every postMessage through `bridge.mjs`.

Safe is an explicit trust choice, not a sandbox — after Safe the plugin runs same-realm with full app privileges. The UI copy must keep saying so.

## Theming

Themes are `[data-theme='<id>']` attribute selectors on `<html>` in `src/index.css`, each defining the same 18 semantic RGB-triplet tokens (`--canvas`, `--ink`, `--accent`, `--syn-keyword`, …). The `dark` class is toggled alongside for Tailwind's `dark:` variants. `tailwind.config.js` maps those tokens to utilities; components should use tokens, never literal colors.

Three places must stay in sync when adding a theme: the CSS token block, `THEMES`/`NAMED`/`DARK` in `src/lib/themes.ts`, and the boot-time script inlined in `index.html` (which prevents a flash of the wrong theme before hydration). `src/lib/themes.test.mjs` enforces the token set.

Plugin themes are registered at runtime as `plugin-<pluginId>:<themeId>` and styled the same way, so `themeIsDark` must go through the registry rather than a hardcoded list.

## Testing traps

- Test files are colocated `*.test.mjs`; there is no framework. Import TypeScript with the explicit extension: `import { x } from './thing.ts'`.
- A `.ts` file imported by these tests **cannot** use extensionless relative imports — Node's ESM resolver fails with `ERR_MODULE_NOT_FOUND`. That is why helpers used by tests keep `import type` only or live in `.mjs`.
- `assert.rejects` does not catch a synchronous throw; API wrappers under test are `async` on purpose.

## Shell

`server/lib/shell.mjs` picks the shell per OS (bash on Linux, login zsh/bash on macOS, pwsh → Windows PowerShell → cmd on Windows; `OPENSOL_SHELL` overrides), kills whole process trees (`taskkill /T` on Windows) and owns the Plan-mode read-only allowlist. The daemon reports `os` and `shell` in its snapshot and `SystemPromptService` turns them into an Environment section. Platform logic is tested with injected `platform`/`env` in `server/lib/shell.test.mjs`.

## Traps

- Vite's root is the repo root. Edit `src/` and `index.html` only.
- `dist/` is committed and is what the daemon serves — a source change is invisible in `npm start` until `npm run build`.
- The data directory is `~/.opensol` (override with `OPENSOL_DATA`; `MAXCODE_DATA` and an existing `~/.maxcode` are still honoured); provider keys, chats, settings and plugins all live there, so tests and manual runs share state with the real app.
- The CSRF header is still named `x-maxcode-csrf` for compatibility; the plugin global is still `maxcode`.
