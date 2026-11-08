# Changelog

## 3.1.3

**New**
- **Skills you install** — skills are no longer just `SKILL.md` files bundled with the app: upload a folder or install an npm package in Settings → Skills, and the agent loads the matching procedure with the new `skill` tool (`list` / `read` / `run`). Skill scripts run through the daemon in a throwaway temp folder and are blocked in Plan mode. Built-in skills were removed.
- **Credits spent** — provider usage is parsed from the OpenAI-compatible `usage.cost` / `total_cost` fields (OpenRouter is asked to include usage), summed per provider and shown on the home dashboard. Providers that report no cost show `—` instead of a guessed price.
- **Prompts per session and workspace** — the prompt button in the top bar now edits three levels: the shared prompt, a per-workspace prompt and a per-session prompt. Precedence is session → workspace → shared.
- **File tree icons** — `FileIcon.tsx` maps extensions and special names to colored Lucide icons (code, config, markdown, images, media, locks, shells) and the workspace tree uses them.
- **New mark** — a solar-aperture logo carries the app, favicon and desktop shell.

**Changed**
- **Deploy rebuilt** — the Deploy modal detects framework, package manager, build command and output folder through the new `/api/deploy/inspect` route, picks `dist` / `build` / `out` / `.output/public` / `public` automatically, shows the last deployment and reports failures with useful errors.
- **No tool-round ceiling** — the agent loop no longer stops after a fixed number of tool rounds; it runs until the model stops or the user stops it.
- **Model Deck** — hover no longer jitters the provider rail and the active provider only scrolls into view for keyboard navigation.
- **Plugins are paused** — the Plugins button and Settings tab are disabled for maintenance; the code remains in place.

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
