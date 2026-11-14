import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveShell, planShellAllowed, describeShell } from './shell.mjs'

const has = (...files) => (file) => files.includes(file)

test('linux prefers bash with a login shell', () => {
  const shell = resolveShell({ platform: 'linux', env: {}, exists: has('/bin/bash') })
  assert.equal(shell.file, '/bin/bash')
  assert.deepEqual(shell.args('echo hi'), ['-lc', 'echo hi'])
  assert.equal(describeShell(shell, { platform: 'linux' }), 'bash on Linux')
})

test('linux falls back to sh', () => {
  assert.equal(resolveShell({ platform: 'linux', env: {}, exists: () => false }).id, 'sh')
})

test('macOS uses the user zsh, else /bin/zsh', () => {
  const user = resolveShell({ platform: 'darwin', env: { SHELL: '/opt/homebrew/bin/zsh' }, exists: has('/opt/homebrew/bin/zsh') })
  assert.equal(user.file, '/opt/homebrew/bin/zsh')
  const fallback = resolveShell({ platform: 'darwin', env: { SHELL: '/usr/bin/fish' }, exists: has('/bin/zsh', '/bin/bash') })
  assert.equal(fallback.file, '/bin/zsh')
  assert.equal(describeShell(fallback, { platform: 'darwin', arch: 'arm64' }), 'zsh on macOS (arm64)')
})

test('windows prefers pwsh, then Windows PowerShell, then cmd', () => {
  const env = { PATH: 'C:\\Program Files\\PowerShell\\7', SystemRoot: 'C:\\Windows' }
  const pwsh = resolveShell({ platform: 'win32', env, exists: has('C:\\Program Files\\PowerShell\\7\\pwsh.exe') })
  assert.equal(pwsh.id, 'pwsh')
  const legacy = resolveShell({
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
    exists: has('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'),
  })
  assert.equal(legacy.id, 'powershell')
  const args = legacy.args('dir')
  assert.ok(args.includes('-NonInteractive') && args.at(-2) === '-Command')
  assert.match(args.at(-1), /dir.*exit \$LASTEXITCODE/)
  const cmd = resolveShell({ platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, exists: () => false })
  assert.equal(cmd.id, 'cmd')
  assert.deepEqual(cmd.args('dir'), ['/d', '/s', '/c', 'dir'])
  assert.equal(describeShell(legacy, { platform: 'win32' }), 'PowerShell on Windows')
})

test('OPENSOL_SHELL overrides detection', () => {
  assert.equal(resolveShell({ platform: 'linux', env: { OPENSOL_SHELL: '/usr/bin/zsh' }, exists: () => false }).id, 'zsh')
  assert.equal(resolveShell({ platform: 'linux', env: { OPENSOL_SHELL: 'pwsh' }, exists: () => false }).family, 'powershell')
})

test('plan mode allows only read-only posix commands', () => {
  const sh = resolveShell({ platform: 'linux', env: {}, exists: has('/bin/bash') })
  assert.equal(planShellAllowed('ls -la src', sh), true)
  assert.equal(planShellAllowed('git log', sh), true)
  assert.equal(planShellAllowed('git push', sh), false)
  assert.equal(planShellAllowed('cat a > b', sh), false)
  assert.equal(planShellAllowed('ls; rm -rf x', sh), false)
  assert.equal(planShellAllowed('find . -delete', sh), false)
  assert.equal(planShellAllowed('rm file', sh), false)
})

test('plan mode allows only read-only PowerShell/cmd commands', () => {
  const ps = resolveShell({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exists: () => false })
  assert.equal(ps.family, 'cmd')
  assert.equal(planShellAllowed('dir src', ps), true)
  assert.equal(planShellAllowed('Get-ChildItem src', ps), true)
  assert.equal(planShellAllowed('Get-Content package.json', ps), true)
  assert.equal(planShellAllowed('Remove-Item x', ps), false)
  assert.equal(planShellAllowed('Set-Content a b', ps), false)
  assert.equal(planShellAllowed('Invoke-Expression foo', ps), false)
  assert.equal(planShellAllowed('type a.txt > b.txt', ps), false)
  assert.equal(planShellAllowed('Get-Content a | Out-File b', ps), false)
})
