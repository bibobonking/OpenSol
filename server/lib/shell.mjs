// Cross-platform shell resolution for the `shell` tool and deploy builds.
// Pure helpers (resolveShell, planShellAllowed, describeShell) take injected platform/env so
// Windows and macOS behaviour is unit-tested from any OS.
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const PS_PROLOGUE = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$ErrorActionPreference="Continue";'
// Keeps the exit code of the last native command; PowerShell otherwise reports 0.
const PS_EPILOGUE = ';if($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0){exit $LASTEXITCODE}elseif(-not $?){exit 1}'

function platformName(platform) {
  return platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'
}

function posixShell(id, file) {
  return { id, file, family: 'posix', label: id, args: (command) => ['-lc', command] }
}

function powershell(id, file) {
  return {
    id,
    file,
    family: 'powershell',
    label: id === 'pwsh' ? 'PowerShell 7' : 'PowerShell',
    args: (command) => [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `${PS_PROLOGUE}${command}${PS_EPILOGUE}`,
    ],
  }
}

function cmdShell(file) {
  return { id: 'cmd', file, family: 'cmd', label: 'cmd', args: (command) => ['/d', '/s', '/c', command] }
}

function findOnPath(name, env, platform, exists) {
  const sep = platform === 'win32' ? ';' : ':'
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']
  const join = platform === 'win32' ? path.win32.join : path.posix.join
  for (const dir of String(env.PATH ?? env.Path ?? '').split(sep).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`)
      if (exists(candidate)) return candidate
    }
  }
  return ''
}

/** Picks the shell used to run agent commands. OPENSOL_SHELL (path or name) overrides detection. */
export function resolveShell({ platform = process.platform, env = process.env, exists = existsSync } = {}) {
  const override = String(env.OPENSOL_SHELL ?? '').trim()
  if (override) {
    const base = path.basename(override.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '')
    if (base === 'pwsh' || base === 'powershell') return powershell(base, override)
    if (base === 'cmd') return cmdShell(override)
    return posixShell(base || 'sh', override)
  }

  if (platform === 'win32') {
    const pwsh = findOnPath('pwsh', env, platform, exists)
    if (pwsh) return powershell('pwsh', pwsh)
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows'
    const legacy = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (exists(legacy)) return powershell('powershell', legacy)
    const onPath = findOnPath('powershell', env, platform, exists)
    if (onPath) return powershell('powershell', onPath)
    return cmdShell(env.ComSpec ?? env.COMSPEC ?? 'cmd.exe')
  }

  if (platform === 'darwin') {
    const user = String(env.SHELL ?? '')
    const base = path.posix.basename(user)
    if ((base === 'zsh' || base === 'bash') && user && exists(user)) return posixShell(base, user)
    for (const [id, file] of [['zsh', '/bin/zsh'], ['bash', '/bin/bash'], ['sh', '/bin/sh']]) {
      if (exists(file)) return posixShell(id, file)
    }
    return posixShell('sh', '/bin/sh')
  }

  for (const [id, file] of [['bash', '/bin/bash'], ['bash', '/usr/bin/bash'], ['bash', '/usr/local/bin/bash']]) {
    if (exists(file)) return posixShell(id, file)
  }
  const bash = findOnPath('bash', env, platform, exists)
  if (bash) return posixShell('bash', bash)
  return posixShell('sh', exists('/bin/sh') ? '/bin/sh' : 'sh')
}

let cached
export function currentShell() {
  cached ??= resolveShell()
  return cached
}

export function describeShell(shell = currentShell(), { platform = process.platform, arch = os.arch() } = {}) {
  const system = platformName(platform)
  return `${shell.label} on ${system}${platform === 'darwin' ? ` (${arch})` : ''}`
}

/** Kills a spawned command and everything it started. */
export function killTree(child) {
  if (!child?.pid) return
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.on('error', () => child.kill('SIGKILL'))
    } else {
      process.kill(-child.pid, 'SIGKILL')
    }
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
  }
}

const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'branch', 'remote', 'rev-parse', 'ls-files'])
const POSIX_READ = new Set([
  'pwd', 'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'tree', 'file', 'stat', 'du', 'df', 'date', 'whoami', 'git',
])
const WINDOWS_READ = new Set([
  'dir', 'type', 'cd', 'where', 'where.exe', 'findstr', 'hostname', 'whoami', 'echo', 'git',
  'get-childitem', 'gci', 'ls', 'get-content', 'gc', 'cat', 'select-string', 'sls', 'get-location', 'pwd',
  'get-item', 'gi', 'test-path', 'get-date', 'get-command', 'measure-object',
])

/**
 * Plan mode runs only read-only commands. Chaining, redirection and substitution are refused
 * outright so an allowlisted head cannot smuggle a second command.
 */
export function planShellAllowed(command, shell = currentShell()) {
  if (/[;&|><`$(){}[\]\n\r%^]/.test(command)) return false
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false
  const windows = shell.family !== 'posix'
  const head = windows ? tokens[0].toLowerCase() : tokens[0]
  if (!(windows ? WINDOWS_READ : POSIX_READ).has(head)) return false
  if (head === 'git' && !GIT_READ.has(tokens[1] ?? '')) return false
  if (head === 'find' && tokens.some((t) => /^-(delete|exec|execdir|ok|okdir|fprint\w*|fls)$/.test(t))) return false
  return true
}
