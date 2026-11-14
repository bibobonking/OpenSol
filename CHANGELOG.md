# Changelog

## 3.2.3

**MCP: tools that follow the server**
- **Auto sync, event-driven.** A server that opens tools after an action (10 tools before a project exists, 100 after) is picked up the moment it happens. The daemon listens for `notifications/tools/list_changed` (stdio, legacy SSE, the POST stream *and* the optional Streamable HTTP GET stream), coalesces bursts, re-reads the list and publishes it only when a hash of names, descriptions and schemas really changed. Servers that never send the notification are re-listed once right after a tool call that may change state. Nothing polls on a timer.
- **The agent keeps going.** The new tool list is applied before the tool result is handed back, the result carries a short note naming the new tools, and the next model request already includes them: no stop, no new message. A call to a tool the list no longer knows re-reads the list once before it is refused.
- **Live push to the app.** `GET /api/mcp/events` streams every status/tool change to the UI (the 1.2 s "connecting" poll is gone). MCP servers are now loaded at startup, not only after the **+** menu is opened.
- **Auto-reconnect.** A server that exits or drops is reconnected with back-off (0.4 s → 30 s); its last known tools stay callable meanwhile and a call made during the gap waits for the reconnect instead of failing. A lost Streamable HTTP session (404) is re-opened transparently.
- **Compatibility.** Protocol negotiation steps down 2025-06-18 → 2025-03-26 → 2024-11-05 and uses what the server answers; a Streamable HTTP URL that only speaks legacy HTTP+SSE (and the other way round) is detected and used automatically, so existing configs keep working; JSON batch replies, SSE notifications inside POST replies, servers without the tools capability, and `roots/list` are handled.

**Approvals**
- **Allow / Deny act at once.** The card flips to "running" / "denied" on the click instead of waiting for the tool to finish, and a double click is ignored.

**New: Ask Question**
- Agent tool `ask_question` (also in Plan mode): several questions per call, single or multi-select, a small comment under every option, a "Recommended" convention, and a free-text field at the end of **every** question without the model asking for it. Tabs, Back/Next, number keys, Skip; answers go back to the model as text and the card keeps a summary. Turn it off in Settings → Tools.

**Other**
- **Desktop is now Electron.** The Tauri/Rust wrapper was replaced by Electron and
  electron-builder for Linux, Windows and macOS. The app still starts (or reuses) the same
  local daemon, now on Electron's built-in Node runtime, and keeps the same data folder.
- Version 3.2.3 everywhere (package, daemon, desktop, MCP client info).

## Realeased 3.2.0 - Final Version

- **Shell on every OS.** Commands run in bash (Linux), a login zsh/bash (macOS) or PowerShell/cmd (Windows) instead of a hard-coded `/bin/bash`; the agent is told which. `OPENSOL_SHELL` overrides. Plan mode has a read-only allowlist per shell family, process trees are killed correctly on Windows, and deploy builds use the same shell.
- **Smarter compaction.** Keeps the newest turns verbatim, merges earlier summaries, tracks changed files from tool calls, handles huge sessions in chunks, retries, falls back safely, also runs between tool rounds, and has `/compact [focus]`. Summaries show as a divider you can expand.
- **Better subagents.** Types `explore`/`research`/`review`, parallel calls, live progress in the tool card, round budget with forced report, context pruning, transient-error retry, and approval now actually applies to them. Subagents can no longer start subagents or receive tools outside their type.
- **New composer and home.** Compact box with the folder picker above it, a **+** menu (files, web search, MCP, skills link), plain-text Build/Plan, permission, effort and model controls whose panels flip and scroll to stay on screen, and a simpler new-session screen.
- Mascot is now optional: Settings → General → Show mascot (off by default).
- Cleanup: removed the legacy `src/agent/{compact,subagent,tools,prompt,model,approval}.ts` duplicates, a stale `server/package.json`, unused composer/ChatView code, and merge-conflict markers in `.gitignore` and `.npmignore`. Docs synced (`~/.opensol`, build workflow name, architecture).
- Agent loop: removed the 16-round cap (subagents now have their own round budget, see above). Provider errors now retry up to 5 times with backoff, only for transient errors (429 bursts, 5xx, overload, network); quota, credit and "limit reached" errors are never retried.
- Model deck: hovering no longer scrolls the list, which made rows jump.
- Plugins button disabled for maintenance.
- Skills: real skill folders (SKILL.md + scripts/references) installed by folder upload or npm, loaded on demand through the new `skill` tool. Built-in skills removed.
- Credits spent shown per session (top bar) and in the dashboard, for every provider (provider-reported cost, else tokens × model price).
- File tree: colored file and folder icons, indent guides, git status marks.
- Deploy: redesigned with steps and project detection; fixed Netlify creating a new site every deploy, Vercel org-id error, wrong URL picked from CLI output, missing output folder.
- System prompt per session and per workspace (button in the top bar).
- New OpenSol icon.


## 3.1.2

**New**
- **MCP panel + OAuth** — MCP has its own panel (sidebar → MCP, Settings → MCP → Open MCP panel, or Ctrl/⌘ K) instead of living inside Settings: server list, edit-in-place, templates, tool filter and **Import JSON** (Claude Desktop / Cursor / VS Code `mcpServers`). Remote servers can use **OAuth 2.1** (discovery, dynamic client registration, PKCE, automatic refresh; tokens stay in the encrypted secrets file) and there is a third connection type, legacy **HTTP+SSE**, next to stdio and Streamable HTTP. See `server/lib/mcp-oauth.mjs`.
- **MCP connect** — Add local (stdio) or remote (Streamable HTTP) Model Context Protocol servers; their tools reach the agent as `mcp__<server>__<tool>`. Per-server approval (ask / auto), per-tool switches, secrets masked in the UI. The daemon owns every connection (`server/lib/mcp.mjs`).
- **Remove workspace** — trash button on each workspace in the sidebar (removes it from the list; the folder stays on disk).
- **Sessions tab** — new tab in the workspace panel: sessions of the open workspace (or all), with rename, AI title and delete. New sessions record the workspace they started in.
- **AI session titles** — after the first answer the model names the session (Settings → General turns it off). "Name with AI" in the session menu regenerates a title; names you type are never overwritten.
- **Edit stats** — file edits show `+added −removed` and where the change starts (`L42:7`), with a mini diff in the tool card; the task header and the Undo bar show the turn total.
- **OpenSol Desktop** — Tauri app (`desktop/`) using the OS webview: WebKitGTK (Linux), WebView2 (Windows 10/11), WKWebView (macOS). The web version is unchanged. See `desktop/README.md`.

**Changed**
- Brand name is now **OpenSoftX** (the app is still OpenSol).
- Model Deck: the provider highlight no longer drifts off its button and the active provider scrolls into view.
- Thoughts are closed by default, also while the model is still thinking.
- New **Model Deck** replaces the dropdown picker: centered overlay, provider rail, context bars, and a draggable effort throttle; the composer shows live effort bars. `Ctrl/⌘ M` opens it.
- Redesigned Settings: numbered rail with a sliding pill, large section headers, card layout.
- More motion: spring knob, staggered rows, blur-in titles, diff rows, tool rows. All of it respects `prefers-reduced-motion`.
- Daemon now persists `chatFontSize`, `workDetail` and `autoCollapseWork` (they were dropped before).
