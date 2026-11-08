# Changelog

## 3.1.0

**New**
<<<<<<< HEAD
- **MCP panel + OAuth** — MCP has its own panel (sidebar → MCP, Settings → MCP → Open MCP panel, or Ctrl/⌘ K) instead of living inside Settings: server list, edit-in-place, templates, tool filter and **Import JSON** (Claude Desktop / Cursor / VS Code `mcpServers`). Remote servers can use **OAuth 2.1** (discovery, dynamic client registration, PKCE, automatic refresh; tokens stay in the encrypted secrets file) and there is a third connection type, legacy **HTTP+SSE**, next to stdio and Streamable HTTP. See `server/lib/mcp-oauth.mjs`.
- **MCP connect** — Add local (stdio) or remote (Streamable HTTP) Model Context Protocol servers; their tools reach the agent as `mcp__<server>__<tool>`. Per-server approval (ask / auto), per-tool switches, secrets masked in the UI. The daemon owns every connection (`server/lib/mcp.mjs`).
=======
- **MCP connect** — Settings → MCP (and the sidebar). Add local (stdio) or remote (Streamable HTTP) Model Context Protocol servers; their tools reach the agent as `mcp__<server>__<tool>`. Per-server approval (ask / auto), per-tool switches, secrets masked in the UI. The daemon owns every connection (`server/lib/mcp.mjs`).
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
- **Remove workspace** — trash button on each workspace in the sidebar (removes it from the list; the folder stays on disk).
- **Sessions tab** — new tab in the workspace panel: sessions of the open workspace (or all), with rename, AI title and delete. New sessions record the workspace they started in.
- **AI session titles** — after the first answer the model names the session (Settings → General turns it off). "Name with AI" in the session menu regenerates a title; names you type are never overwritten.
- **Edit stats** — file edits show `+added −removed` and where the change starts (`L42:7`), with a mini diff in the tool card; the task header and the Undo bar show the turn total.
- **OpenSol Desktop** — Tauri app (`desktop/`) using the OS webview: WebKitGTK (Linux), WebView2 (Windows 10/11), WKWebView (macOS). The web version is unchanged. See `desktop/README.md`.

**Changed**
<<<<<<< HEAD
- Brand name is now **OpenSoftX** (the app is still OpenSol).
- Model Deck: the provider highlight no longer drifts off its button and the active provider scrolls into view.
=======
>>>>>>> 06883a5ac287b170578cf9db1a53d71235123333
- Thoughts are closed by default, also while the model is still thinking.
- New **Model Deck** replaces the dropdown picker: centered overlay, provider rail, context bars, and a draggable effort throttle; the composer shows live effort bars. `Ctrl/⌘ M` opens it.
- Redesigned Settings: numbered rail with a sliding pill, large section headers, card layout.
- More motion: spring knob, staggered rows, blur-in titles, diff rows, tool rows. All of it respects `prefers-reduced-motion`.
- Daemon now persists `chatFontSize`, `workDetail` and `autoCollapseWork` (they were dropped before).
