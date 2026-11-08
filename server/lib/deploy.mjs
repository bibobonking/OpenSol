import { spawn } from 'node:child_process'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { HttpError } from './http.mjs'
import { resolveWorkspacePath } from './tools.mjs'
import { deploySecrets } from './providers.mjs'
import { setDeploySecret } from './store.mjs'

const CLIS = {
  vercel: { bin: 'vercel', pkg: 'vercel@latest', label: 'Vercel CLI' },
  netlify: { bin: 'netlify', pkg: 'netlify-cli@latest', label: 'Netlify CLI' },
  cloudflare: { bin: 'wrangler', pkg: 'wrangler@latest', label: 'Wrangler' },
}

function slugify(value, fallback = 'maxcode-site') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return slug || fallback
}

function suffix() {
  return Math.random().toString(36).slice(2, 7)
}

const IS_WINDOWS = process.platform === 'win32'

async function commandExists(bin) {
  // Direct spawn first: it is fast and works on Windows (.cmd shims). Fall back to a login shell
  // so tools installed through nvm/asdf/Homebrew profiles are still found.
  const direct = await runCapture(bin, ['--version'], { timeoutMs: 15_000, shell: IS_WINDOWS })
  if (direct.code === 0) return { installed: true, version: direct.stdout.split('\n')[0]?.trim() ?? '' }
  if (IS_WINDOWS) return { installed: false, version: '' }
  const result = await runCapture('bash', ['-lc', `command -v ${bin} >/dev/null 2>&1 && ${bin} --version`], {
    timeoutMs: 20_000,
  })
  return { installed: result.code === 0, version: result.stdout.split('\n')[0]?.trim() ?? '' }
}

export async function deployToolStatus() {
  const entries = await Promise.all(
    Object.entries(CLIS).map(async ([id, def]) => {
      const check = await commandExists(def.bin)
      return [id, { ...def, installed: check.installed, version: check.version }]
    }),
  )
  return Object.fromEntries(entries)
}

function runCapture(command, args, { cwd, env, timeoutMs = 120_000, shell = false } = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(command, args, {
      cwd,
      env: cleanEnv({ ...process.env, ...(env ?? {}) }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      shell,
    })
    const timer = setTimeout(() => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      if (stdout.length < 300_000) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 300_000) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: typeof code === 'number' ? code : -1, stdout, stderr })
    })
  })
}

/** spawn() rejects undefined env values on some Node versions; drop them. */
function cleanEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === 'string'))
}

function winQuote(arg) {
  return /[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

function runStreaming(command, args, { cwd, env, onLog, timeoutMs = 15 * 60 * 1000, signal }) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = IS_WINDOWS
      ? spawn([command, ...args].map(winQuote).join(' '), {
          cwd,
          env: cleanEnv({ ...process.env, ...(env ?? {}), CI: '1' }),
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
        })
      : spawn(command, args, {
          cwd,
          env: cleanEnv({ ...process.env, ...(env ?? {}), CI: '1' }),
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        })
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...result, stdout, stderr })
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const kill = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM')
        else child.kill('SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
      setTimeout(() => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
          else child.kill('SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }, 5000).unref()
    }
    const timer = setTimeout(() => {
      onLog({ stream: 'stderr', text: 'Deployment timed out after 15 minutes.\n' })
      kill()
    }, timeoutMs)
    if (signal) {
      if (signal.aborted) kill()
      else signal.addEventListener('abort', kill, { once: true })
    }
    const handle = (stream) => (chunk) => {
      const text = chunk.toString('utf8')
      if (stream === 'stdout') {
        if (stdout.length < 400_000) stdout += text
      } else if (stderr.length < 400_000) stderr += text
      for (const line of text.split('\n')) {
        if (line.trim()) onLog({ stream, text: line })
      }
    }
    child.stdout.on('data', handle('stdout'))
    child.stderr.on('data', handle('stderr'))
    child.on('error', (error) => fail(error))
    child.on('close', (code) => finish({ code: typeof code === 'number' ? code : -1 }))
  })
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30_000),
  })
  const raw = await response.text()
  let payload = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    payload = { raw }
  }
  if (!response.ok) {
    const message =
      payload?.errors?.[0]?.message ||
      payload?.error?.message ||
      (typeof payload?.message === 'string' ? payload.message : '') ||
      payload?.error ||
      raw.slice(0, 300)
    throw new HttpError(
      response.status,
      `Deploy API returned ${response.status}: ${typeof message === 'string' ? message : JSON.stringify(message)}`,
      'deploy_api_failed',
    )
  }
  return payload
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

function urlsIn(text) {
  return (String(text).replace(ANSI, '').match(/https:\/\/[^\s"'<>)\]]+/g) ?? []).map((url) => url.replace(/[.,;]+$/, ''))
}

/** Picks the live site URL from CLI output, ignoring dashboards, docs and build-log links. */
function liveUrl(text, preferred, ignored = /(app\.netlify\.com|vercel\.com|dash\.cloudflare\.com|developers\.cloudflare\.com|docs\.|github\.com|npmjs\.)/i) {
  const urls = urlsIn(text).filter((url) => !ignored.test(url))
  const preferredMatches = urls.filter((url) => preferred.test(url))
  const pool = preferredMatches.length > 0 ? preferredMatches : urls
  return pool[pool.length - 1] ?? ''
}

async function resolveCli(provider) {
  const def = CLIS[provider]
  if (!def) throw new HttpError(400, `Unknown deploy provider: ${provider}`, 'bad_deploy_provider')
  const direct = await commandExists(def.bin)
  if (direct.installed) {
    return { command: def.bin, prefix: [], label: def.label }
  }
  const npx = await commandExists('npx')
  if (!npx.installed) {
    throw new HttpError(
      500,
      `${def.label} is not installed. Install Node.js (which includes npx), then try again.`,
      'cli_missing',
    )
  }
  return { command: 'npx', prefix: ['--yes', def.pkg], label: def.label }
}

async function pathInfo(target) {
  return stat(target).catch(() => null)
}

async function readPackageJson(cwd) {
  try {
    const parsed = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

async function packageManager(cwd) {
  if (await pathInfo(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await pathInfo(path.join(cwd, 'yarn.lock'))) return 'yarn'
  if ((await pathInfo(path.join(cwd, 'bun.lockb'))) || (await pathInfo(path.join(cwd, 'bun.lock')))) return 'bun'
  return 'npm'
}

const OUTPUT_CANDIDATES = ['dist', 'build', 'out', '.output/public', 'public']

async function folderHasFiles(dir) {
  try {
    const entries = await readdir(dir)
    return entries.length > 0
  } catch {
    return false
  }
}

/** Looks at a project folder and suggests how it should be built and which folder to publish. */
export async function detectProject(raw) {
  const cwd = await resolveDeployPath(raw)
  await ensureDir(cwd)
  const pkg = await readPackageJson(cwd)
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
  const framework =
    deps.next ? 'Next.js'
    : deps.nuxt ? 'Nuxt'
    : deps['@sveltejs/kit'] ? 'SvelteKit'
    : deps.astro ? 'Astro'
    : deps.vite ? 'Vite'
    : deps['react-scripts'] ? 'Create React App'
    : deps['@angular/core'] ? 'Angular'
    : deps.vue ? 'Vue'
    : pkg ? 'Node project'
    : ''
  const manager = await packageManager(cwd)
  const hasBuild = typeof pkg?.scripts?.build === 'string'
  const buildCommand = hasBuild ? (manager === 'npm' ? 'npm run build' : `${manager} build`) : ''

  let outputDir = ''
  for (const candidate of OUTPUT_CANDIDATES) {
    const dir = path.join(cwd, ...candidate.split('/'))
    if ((await pathInfo(dir))?.isDirectory() && (await folderHasFiles(dir))) {
      // `public` is only a real output for projects without a build step; otherwise it is source assets.
      if (candidate === 'public' && hasBuild) continue
      outputDir = candidate
      break
    }
  }
  const staticSite = !hasBuild && Boolean(await pathInfo(path.join(cwd, 'index.html')))
  if (!outputDir && staticSite) outputDir = '.'
  const expected = hasBuild ? (deps['react-scripts'] ? 'build' : deps.nuxt ? '.output/public' : deps.next ? 'out' : 'dist') : ''
  return {
    path: cwd,
    name: slugify(pkg?.name ? String(pkg.name).replace(/^@[^/]+\//, '') : path.basename(cwd), ''),
    framework: framework || (staticSite ? 'Static site' : ''),
    packageManager: pkg ? manager : '',
    hasNodeModules: Boolean(await pathInfo(path.join(cwd, 'node_modules'))),
    buildCommand,
    outputDir,
    expectedOutputDir: outputDir || expected,
    built: Boolean(outputDir),
  }
}

async function runBuild(cwd, command, onLog, signal) {
  const result = IS_WINDOWS
    ? await runStreaming(command, [], { cwd, onLog, signal, env: { MAXCODE_DEPLOY: '1' } })
    : await runStreaming('/bin/bash', ['-lc', command], { cwd, onLog, signal, env: { MAXCODE_DEPLOY: '1' } })
  if (result.code !== 0) {
    throw new HttpError(500, `"${command}" failed with exit code ${result.code}. Fix the error in the log, then deploy again.`, 'build_failed')
  }
}

function outputDirFor(cwd, outputDir) {
  const clean = typeof outputDir === 'string' ? outputDir.trim() : ''
  if (!clean) return cwd
  const resolved = path.resolve(cwd, clean)
  if (!resolved.startsWith(cwd.endsWith(path.sep) ? cwd : `${cwd}${path.sep}`) && resolved !== cwd) {
    throw new HttpError(400, 'The output folder must stay inside the deploy folder.', 'bad_output')
  }
  return resolved
}

async function ensureDir(target) {
  const info = await stat(target).catch(() => null)
  if (!info?.isDirectory()) throw new HttpError(400, 'The folder to deploy does not exist.', 'bad_deploy_path')
}

/**
 * The deploy panel can target the open workspace or another project folder.
 * Absolute paths are accepted only when they resolve to a real directory, so
 * a typo can never create or deploy an arbitrary path.
 */
async function resolveDeployPath(raw) {
  const input = typeof raw === 'string' ? raw.trim() : ''
  if (!input) return (await resolveWorkspacePath('', { allowRoot: true })).absolute
  const expanded = input === '~' ? os.homedir() : input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input
  if (path.isAbsolute(expanded)) {
    const info = await stat(expanded).catch(() => null)
    if (!info?.isDirectory()) {
      throw new HttpError(400, 'That project folder does not exist.', 'bad_deploy_path')
    }
    return realpath(expanded)
  }
  return (await resolveWorkspacePath(expanded, { allowRoot: true })).absolute
}

async function netlifyDeploy({ cwd, targetDir, projectName, siteId, onLog, signal }) {
  const secrets = (await deploySecrets()).netlify ?? {}
  const token = secrets.authToken
  if (!token) {
    throw new HttpError(400, 'Add a Netlify personal access token in Settings → Deploy.', 'missing_deploy_token')
  }
  // An explicit site id wins; otherwise reuse the site from the last deploy instead of creating a new one every time.
  const requested = typeof siteId === 'string' ? siteId.trim() : ''
  let site = requested || (typeof secrets.siteId === 'string' ? secrets.siteId : '')
  let siteUrl = ''
  if (site && !requested) {
    const existing = await fetchJson(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(site)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null)
    if (existing) siteUrl = String(existing.ssl_url ?? existing.url ?? '')
    else {
      onLog({ stream: 'meta', text: 'The site from the last deploy no longer exists. Creating a new one.' })
      site = ''
    }
  }
  if (!site) {
    const name = slugify(projectName || path.basename(cwd), `maxcode-${suffix()}`)
    onLog({ stream: 'meta', text: `Creating Netlify site "${name}"…` })
    let created
    try {
      created = await fetchJson('https://api.netlify.com/api/v1/sites', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    } catch (error) {
      if (error instanceof HttpError && (error.status === 422 || error.status === 409)) {
        const retryName = `${name}-${suffix()}`
        onLog({ stream: 'meta', text: `Site name was taken, retrying as "${retryName}".` })
        created = await fetchJson('https://api.netlify.com/api/v1/sites', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: retryName }),
        })
      } else {
        throw error
      }
    }
    site = String(created.id ?? '')
    siteUrl = String(created.ssl_url ?? created.url ?? '')
    if (!site) throw new HttpError(502, 'Netlify did not return a site id.', 'deploy_api_failed')
    onLog({ stream: 'meta', text: `Created site ${siteUrl || site}` })
  }

  await setDeploySecret('netlify', { siteId: site })

  const cli = await resolveCli('netlify')
  onLog({ stream: 'meta', text: `Deploying ${targetDir} with ${cli.label}…` })
  const result = await runStreaming(
    cli.command,
    [
      ...cli.prefix,
      'deploy',
      '--no-build',
      '--prod',
      '--dir',
      targetDir,
      '--site',
      site,
      '--message',
      `OpenSol deploy ${new Date().toISOString()}`,
    ],
    { cwd, onLog, signal, env: { NETLIFY_AUTH_TOKEN: token } },
  )
  if (result.code !== 0) {
    throw new HttpError(500, `Netlify deploy failed (exit ${result.code}).`, 'deploy_failed')
  }
  const url = liveUrl(result.stdout, /\.netlify\.app/i) || siteUrl
  if (url) await setDeploySecret('netlify', { lastUrl: url })
  return { provider: 'netlify', url, siteId: site }
}

async function vercelDeploy({ cwd, targetDir, projectName, onLog, signal }) {
  const secrets = (await deploySecrets()).vercel ?? {}
  const token = secrets.token
  if (!token) {
    throw new HttpError(400, 'Add a Vercel access token in Settings → Deploy.', 'missing_deploy_token')
  }
  const cli = await resolveCli('vercel')
  const teamId = (typeof secrets.teamId === 'string' && secrets.teamId) || ''
  const name = slugify(projectName || path.basename(cwd), '')
  const base = [...cli.prefix, 'deploy', targetDir, '--prod', '--yes', '--token', token]
  if (teamId) base.push('--scope', teamId)
  const run = (args) => {
    onLog({ stream: 'meta', text: `Deploying ${targetDir} with ${cli.label}${name ? ` as "${name}"` : ''}…` })
    // The token goes through the environment too; never log the argument list.
    return runStreaming(cli.command, args, { cwd, onLog, signal, env: { VERCEL_TOKEN: token } })
  }
  // VERCEL_ORG_ID must not be set alone (the CLI then demands VERCEL_PROJECT_ID), so the team goes through --scope.
  let result = await run(name ? [...base, '--name', name] : base)
  if (result.code !== 0 && name && /(unknown|unexpected|unrecognized).{0,40}--?name|--name.{0,40}(unknown|not)/i.test(`${result.stderr}\n${result.stdout}`)) {
    onLog({ stream: 'meta', text: 'This Vercel CLI no longer accepts --name; retrying without it.' })
    result = await run(base)
  }
  if (result.code !== 0) {
    throw new HttpError(500, `Vercel deploy failed (exit ${result.code}). See the log above.`, 'deploy_failed')
  }
  const url = liveUrl(`${result.stdout}\n${result.stderr}`, /\.vercel\.app/i)
  if (!url) throw new HttpError(502, 'Vercel did not report a deployment URL.', 'deploy_url_missing')
  await setDeploySecret('vercel', { projectName: name || projectName || '', lastUrl: url })
  return { provider: 'vercel', url, project: name || projectName || '' }
}

async function cloudflareDeploy({ cwd, targetDir, projectName, onLog, signal }) {
  const secrets = (await deploySecrets()).cloudflare ?? {}
  const token = secrets.apiToken
  const accountId = secrets.accountId
  if (!token || !accountId) {
    throw new HttpError(
      400,
      'Add a Cloudflare API token and account id in Settings → Deploy.',
      'missing_deploy_token',
    )
  }
  const name = slugify(projectName || path.basename(cwd), `maxcode-${suffix()}`)
  let exists = false
  try {
    await fetchJson(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(name)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    exists = true
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) {
      const message = error instanceof Error ? error.message : ''
      if (!/8000007|not found/i.test(message)) throw error
    }
  }
  if (!exists) {
    onLog({ stream: 'meta', text: `Creating Cloudflare Pages project "${name}"…` })
    try {
      await fetchJson(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, production_branch: 'main' }),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (!/already exists|8000011/i.test(message)) throw error
    }
  }
  await setDeploySecret('cloudflare', { projectName: name })

  const cli = await resolveCli('cloudflare')
  onLog({ stream: 'meta', text: `Deploying ${targetDir} to Cloudflare Pages…` })
  const result = await runStreaming(
    cli.command,
    [
      ...cli.prefix,
      'pages',
      'deploy',
      targetDir,
      `--project-name=${name}`,
      '--branch=main',
      '--commit-dirty=true',
    ],
    {
      cwd,
      onLog,
      signal,
      env: {
        CLOUDFLARE_API_TOKEN: token,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        WRANGLER_SEND_METRICS: 'false',
      },
    },
  )
  if (result.code !== 0) {
    throw new HttpError(500, `Cloudflare Pages deploy failed (exit ${result.code}).`, 'deploy_failed')
  }
  const url = `https://${name}.pages.dev`
  const reported = liveUrl(`${result.stdout}\n${result.stderr}`, /\.pages\.dev/i)
  onLog({ stream: 'meta', text: reported && reported !== url ? `This deployment: ${reported}` : `Production alias: ${url}` })
  await setDeploySecret('cloudflare', { lastUrl: url })
  return { provider: 'cloudflare', url, project: name }
}

export async function runDeploy(input, { onLog = () => undefined, onStep = () => undefined, signal } = {}) {
  const provider = String(input?.provider ?? '')
  if (!['cloudflare', 'netlify', 'vercel'].includes(provider)) {
    throw new HttpError(400, 'Choose Cloudflare Pages, Netlify or Vercel.', 'bad_deploy_provider')
  }
  onStep({ id: 'prepare', label: 'Inspect project' })
  const absolute = await resolveDeployPath(input?.path)
  await ensureDir(absolute)
  const detected = await detectProject(absolute)

  const requestedOutput = typeof input?.outputDir === 'string' ? input.outputDir.trim() : ''
  const auto = !requestedOutput || requestedOutput === 'auto'
  let buildCommand = typeof input?.buildCommand === 'string' ? input.buildCommand.trim() : ''
  let outputDir = auto ? detected.outputDir : requestedOutput

  const outputMissing = async () => {
    const dir = auto ? detected.outputDir : requestedOutput
    if (!dir) return true
    const info = await pathInfo(path.resolve(absolute, dir))
    return !info?.isDirectory()
  }
  if (!buildCommand && (await outputMissing()) && detected.buildCommand) {
    buildCommand = detected.buildCommand
    onLog({ stream: 'meta', text: `No output folder yet. Building first with "${buildCommand}".` })
  }

  if (buildCommand) {
    const needsInstall = detected.packageManager && !detected.hasNodeModules && /\b(npm|pnpm|yarn|bun)\b/.test(buildCommand)
    if (needsInstall) {
      onStep({ id: 'install', label: 'Install dependencies' })
      const install = detected.packageManager === 'npm' ? 'npm install' : `${detected.packageManager} install`
      onLog({ stream: 'meta', text: `node_modules is missing. Running ${install}.` })
      await runBuild(absolute, install, onLog, signal)
    }
    onStep({ id: 'build', label: 'Build' })
    onLog({ stream: 'meta', text: `Running build: ${buildCommand}` })
    await runBuild(absolute, buildCommand, onLog, signal)
  }

  if (auto) {
    outputDir = (await detectProject(absolute)).outputDir
    if (!outputDir) {
      throw new HttpError(
        400,
        `No output folder found in ${path.basename(absolute)}. Add a build command that creates dist/, build/ or out/, or choose the folder to publish.`,
        'bad_output',
      )
    }
  }
  const targetDir = outputDirFor(absolute, outputDir)
  const info = await pathInfo(targetDir)
  if (!info?.isDirectory()) {
    throw new HttpError(
      400,
      `The output folder "${outputDir}" does not exist${buildCommand ? ' after the build' : '. Add a build command or pick another folder'}.`,
      'bad_output',
    )
  }
  if (!(await folderHasFiles(targetDir))) {
    throw new HttpError(400, `The output folder "${outputDir}" is empty, so there is nothing to publish.`, 'bad_output')
  }
  if (!(await pathInfo(path.join(targetDir, 'index.html')))) {
    onLog({ stream: 'meta', text: `Note: ${outputDir} has no index.html, so the site root may show a 404.` })
  }

  onStep({ id: 'publish', label: 'Publish' })
  const common = {
    cwd: absolute,
    targetDir,
    projectName: String(input?.projectName ?? '').trim() || detected.name,
    siteId: String(input?.siteId ?? ''),
    onLog,
    signal,
  }
  if (provider === 'netlify') return netlifyDeploy(common)
  if (provider === 'vercel') return vercelDeploy(common)
  return cloudflareDeploy(common)
}
