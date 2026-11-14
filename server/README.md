# OpenSol daemon

`server/` is the local Node daemon (`127.0.0.1:4174`, no runtime dependencies besides `fflate` for plugin packages). It owns everything privileged: provider credentials, workspace files, shell, git, search, MCP connections, plugins, skills and deploys. The React app in `src/` only talks to it over `/api`.

```bash
node server/opensol.mjs start --open   # background daemon + browser (also: npm start)
node server/opensol.mjs status | logs | stop
node server/daemon.mjs                 # foreground, for debugging
```

| File | Role |
|---|---|
| `daemon.mjs` | HTTP server, session cookie + CSRF guard, `/api` routes, static `dist/` |
| `opensol.mjs` | CLI: start, stop, status, logs, open |
| `lib/store.mjs` | data directory (`~/.opensol`, or `OPENSOL_DATA`), state, AES-256-GCM secrets |
| `lib/tools.mjs` | file, grep, git and shell tools, workspace path guard, checkpoints |
| `lib/shell.mjs` | picks bash/zsh/PowerShell/cmd per OS, kills process trees, Plan-mode allowlist |
| `lib/providers.mjs`, `lib/mcp*.mjs`, `lib/plugins.mjs`, `lib/skills.mjs`, `lib/deploy.mjs` | providers, MCP (+OAuth), plugins, skills, deploys |

Shell selection: Linux → bash; macOS → your `$SHELL` (zsh/bash) as a login shell; Windows → `pwsh`, else Windows PowerShell, else `cmd`. Set `OPENSOL_SHELL` to force one. Commands run in the workspace root with `OPENSOL=1` and `OPENSOL_WORKSPACE` set.

See the root `README.md` for the full feature list and `CLAUDE.md` for architecture notes.
