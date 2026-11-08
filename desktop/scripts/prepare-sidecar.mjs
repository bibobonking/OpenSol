// Copies the Node.js binary that is running this script next to the Tauri build as the
// "opensol-node" sidecar, named with the Rust target triple Tauri expects.
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.resolve(here, '..', 'src-tauri', 'binaries')
const triple = (process.env.TAURI_TARGET_TRIPLE ||
  /host: (\S+)/.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1])
if (!triple) throw new Error('Could not detect the Rust target triple.')

mkdirSync(out, { recursive: true })
const target = path.join(out, `opensol-node-${triple}${process.platform === 'win32' ? '.exe' : ''}`)
copyFileSync(process.execPath, target)
if (process.platform !== 'win32') chmodSync(target, 0o755)
console.log(`sidecar: ${process.execPath} -> ${target}`)
