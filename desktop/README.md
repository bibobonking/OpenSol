# OpenSol Desktop

OpenSol Desktop is the same OpenSol app in a native window. It uses each operating
system's own webview instead of bundling a browser:

| OS | Webview | Installer |
|---|---|---|
| Linux | WebKitGTK 4.1 | `.deb`, `.AppImage` |
| Windows 10 / 11 | Microsoft WebView2 (installed on demand on Windows 10) | `.exe` (NSIS), `.msi` |
| macOS 11+ | WKWebView | `.dmg` (Apple Silicon and Intel) |

The web version (`npm start`, `dist/`) is unchanged and still works. Desktop and web share the
same data folder (`~/.opensol`), so keys, chats and settings are the same in both.

## How it works

1. The window opens a small loading page.
2. If an OpenSol daemon of the same version already runs on `127.0.0.1:4174` it is reused.
   Otherwise the app starts its own daemon with a bundled Node.js (`opensol-node`) on a free port.
3. The window navigates to the daemon. Links to other sites open in your default browser.
4. When you close the window, a daemon that the app started is stopped.

## Build it yourself

Requirements: Node 22+, Rust (stable), and the Tauri prerequisites for your OS
(<https://tauri.app/start/prerequisites/>). From the repository root:

```bash
npm ci
npm run build                      # the web app → dist/
node desktop/scripts/prepare-sidecar.mjs   # copies this machine's Node as the sidecar
cd desktop && npx @tauri-apps/cli@2 build
```

Installers appear in `desktop/src-tauri/target/release/bundle/`. Each OS has to be built on that
OS (Windows installers on Windows, macOS on macOS); `.github/workflows/build.yml` does all four
on GitHub Actions when you push a `v*` tag or run it manually.

For a quick run from source: `cd desktop/src-tauri && cargo run` (needs `dist/` built).
