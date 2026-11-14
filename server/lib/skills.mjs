// Agent Skills store. A skill is a folder with a SKILL.md (YAML frontmatter: name, description)
// plus any bundled files (scripts/, references/, assets/). Folders live in <data>/skills/<name>/.
// The model only sees name + description up front and loads the rest on demand with the `skill` tool.
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HttpError } from './http.mjs'
import { DATA_DIR, loadState } from './store.mjs'

export const SKILLS_DIR = path.join(DATA_DIR, 'skills')
const STATE_FILE = path.join(SKILLS_DIR, '.state.json')
const META_FILE = '.skill-meta.json'

const MAX_FILES = 500
const MAX_FILE_BYTES = 1024 * 1024
const MAX_TOTAL_BYTES = 6 * 1024 * 1024
const MAX_READ_BYTES = 200 * 1024
const NPM_TIMEOUT_MS = 120_000
const NPM_SPEC = /^(?:@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*(?:@[A-Za-z0-9][A-Za-z0-9._+-]*)?$/
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '__pycache__'])
const TEXT_EXT = /\.(md|markdown|txt|json|ya?ml|toml|csv|tsv|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|sh|bash|zsh|ps1|rb|go|rs|java|c|h|cpp|sql|ini|cfg|env|svg)$/i

let writes = Promise.resolve()
function serial(task) {
  const next = writes.then(task, task)
  writes = next.catch(() => undefined)
  return next
}

export function slugifySkillName(value) {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 64)
  return slug
}

function assertName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) {
    throw new HttpError(400, 'Invalid skill name.', 'invalid_skill_name')
  }
  return name
}

/** Minimal YAML frontmatter reader: scalars, quoted strings and `>` / `|` blocks. */
export function parseSkillMarkdown(text) {
  const clean = String(text ?? '').replace(/^﻿/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(clean)
  const meta = {}
  let body = clean
  if (match) {
    body = match[2]
    const lines = match[1].split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const entry = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[index])
      if (!entry) continue
      const key = entry[1]
      let value = entry[2].trim()
      if (/^[>|][+-]?$/.test(value)) {
        const block = []
        while (index + 1 < lines.length && (/^\s+/.test(lines[index + 1]) || lines[index + 1] === '')) {
          block.push(lines[index + 1].trim())
          index += 1
        }
        value = block.join(value.startsWith('>') ? ' ' : '\n').trim()
      } else if (/^(["']).*\1$/.test(value)) {
        value = value.slice(1, -1)
      }
      meta[key] = value
    }
  }
  return { meta, body: body.trim() }
}

function describeSkill(raw, folder) {
  const { meta, body } = parseSkillMarkdown(raw)
  const heading = /^#\s+(.+)$/m.exec(body)
  const firstParagraph = body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith('#'))
  return {
    name: slugifySkillName(meta.name || folder) || slugifySkillName(heading?.[1]) || folder,
    description: String(meta.description || firstParagraph || heading?.[1] || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600),
  }
}

async function readState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8'))
    return {
      disabled: Array.isArray(parsed.disabled) ? parsed.disabled.filter((item) => typeof item === 'string') : [],
      legacyMigrated: parsed.legacyMigrated === true,
    }
  } catch {
    return { disabled: [], legacyMigrated: false }
  }
}

async function writeState(state) {
  await mkdir(SKILLS_DIR, { recursive: true, mode: 0o700 })
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
}

async function walk(root, base = root, depth = 0, out = []) {
  if (depth > 8) return out
  let entries
  try {
    entries = await readdir(base, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === META_FILE) continue
    const full = path.join(base, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(root, full, depth + 1, out)
    } else if (entry.isFile()) {
      const info = await stat(full)
      out.push({ path: path.relative(root, full).split(path.sep).join('/'), size: info.size })
    }
  }
  return out
}

async function loadSkillRecord(folder, disabled) {
  const dir = path.join(SKILLS_DIR, folder)
  let raw
  try {
    raw = await readFile(path.join(dir, 'SKILL.md'), 'utf8')
  } catch {
    return null
  }
  let meta = {}
  try {
    meta = JSON.parse(await readFile(path.join(dir, META_FILE), 'utf8'))
  } catch {
    // Folder was placed by hand; that is fine.
  }
  const info = describeSkill(raw, folder)
  const files = await walk(dir)
  return {
    name: folder,
    title: info.name,
    description: info.description,
    enabled: !disabled.includes(folder),
    source: typeof meta.source === 'string' ? meta.source : 'folder',
    installedAt: typeof meta.installedAt === 'string' ? meta.installedAt : '',
    fileCount: files.length,
    size: files.reduce((total, file) => total + file.size, 0),
    path: dir,
  }
}

async function migrateLegacy() {
  const state = await readState()
  if (state.legacyMigrated) return
  try {
    const legacy = (await loadState()).settings?.skills
    if (Array.isArray(legacy)) {
      for (const item of legacy) {
        if (!item || typeof item !== 'object' || item.builtIn === true) continue
        const name = slugifySkillName(item.name)
        const instructions = typeof item.instructions === 'string' ? item.instructions.trim() : ''
        if (!name || !instructions) continue
        const dir = path.join(SKILLS_DIR, name)
        await mkdir(dir, { recursive: true, mode: 0o700 })
        const description = String(item.description ?? '').replace(/\s+/g, ' ').trim()
        const header = `---\nname: ${name}\ndescription: ${JSON.stringify(description || String(item.name))}\n---\n\n`
        await writeFile(path.join(dir, 'SKILL.md'), `${header}${instructions}\n`, { mode: 0o600 })
        await writeFile(path.join(dir, META_FILE), JSON.stringify({ source: 'legacy', installedAt: new Date().toISOString() }))
        if (item.enabled !== true) state.disabled.push(name)
      }
    }
  } catch {
    // Migration is best-effort.
  }
  state.legacyMigrated = true
  await writeState(state)
}

export async function listSkills() {
  await mkdir(SKILLS_DIR, { recursive: true, mode: 0o700 })
  await serial(migrateLegacy)
  const { disabled } = await readState()
  const folders = (await readdir(SKILLS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
  const records = []
  for (const folder of folders) {
    const record = await loadSkillRecord(folder, disabled)
    if (record) records.push(record)
  }
  return records
}

function safeRelative(input) {
  const parts = String(input ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.')
  if (parts.length === 0 || parts.some((part) => part === '..' || SKIP_DIRS.has(part))) return null
  return parts.join('/')
}

/** files: [{ path, bytes: Buffer }] with forward-slash relative paths. Finds every SKILL.md root and installs it. */
async function installFiles(files, source) {
  if (files.length === 0) throw new HttpError(400, 'No files were provided.', 'empty_skill')
  if (files.length > MAX_FILES) throw new HttpError(400, `A skill can hold at most ${MAX_FILES} files.`, 'skill_too_large')
  let total = 0
  for (const file of files) {
    if (file.bytes.length > MAX_FILE_BYTES) {
      throw new HttpError(400, `${file.path} is larger than 1 MB.`, 'skill_too_large')
    }
    total += file.bytes.length
  }
  if (total > MAX_TOTAL_BYTES) throw new HttpError(400, 'Skill folder is larger than 6 MB.', 'skill_too_large')

  const roots = files
    .filter((file) => path.posix.basename(file.path).toLowerCase() === 'skill.md')
    .map((file) => path.posix.dirname(file.path))
    .map((dir) => (dir === '.' ? '' : dir))
  if (roots.length === 0) {
    throw new HttpError(400, 'No SKILL.md found. A skill folder must contain a SKILL.md file.', 'missing_skill_md')
  }
  // Keep outermost roots only so scripts/ or references/ never turn into skills of their own.
  const unique = [...new Set(roots)].sort((a, b) => a.length - b.length)
  const outer = unique.filter((root) => !unique.some((other) => other !== root && (other === '' || root.startsWith(`${other}/`))))
  const effective = outer.length > 0 ? outer : unique

  const installed = []
  await serial(async () => {
    await mkdir(SKILLS_DIR, { recursive: true, mode: 0o700 })
    for (const root of effective) {
      const prefix = root ? `${root}/` : ''
      const members = files.filter((file) => (root ? file.path.startsWith(prefix) : true))
      const skillFile = members.find((file) => file.path.slice(prefix.length).toLowerCase() === 'skill.md')
      if (!skillFile) continue
      const folder = root ? path.posix.basename(root) : ''
      const info = describeSkill(skillFile.bytes.toString('utf8'), slugifySkillName(folder) || 'skill')
      const name = slugifySkillName(info.name) || slugifySkillName(folder)
      if (!name) throw new HttpError(400, 'The skill needs a name in its SKILL.md frontmatter.', 'missing_skill_name')

      const stage = path.join(SKILLS_DIR, `.stage-${randomBytes(4).toString('hex')}`)
      await mkdir(stage, { recursive: true, mode: 0o700 })
      for (const member of members) {
        const relative = member.path.slice(prefix.length)
        const target = path.join(stage, ...relative.split('/'))
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
        await writeFile(target, member.bytes, { mode: 0o600 })
      }
      // Normalise the entry file name so lookups are case-stable.
      if (skillFile.path.slice(prefix.length) !== 'SKILL.md') {
        await rename(path.join(stage, skillFile.path.slice(prefix.length)), path.join(stage, 'SKILL.md'))
      }
      await writeFile(path.join(stage, META_FILE), JSON.stringify({ source, installedAt: new Date().toISOString() }))
      const final = path.join(SKILLS_DIR, name)
      await rm(final, { recursive: true, force: true })
      await rename(stage, final)
      installed.push(name)
    }
  })
  if (installed.length === 0) throw new HttpError(400, 'No valid skill was found.', 'missing_skill_md')
  const state = await readState()
  if (installed.some((name) => state.disabled.includes(name))) {
    await writeState({ ...state, disabled: state.disabled.filter((name) => !installed.includes(name)) })
  }
  return installed
}

/** Browser folder upload: entries carry webkitRelativePath-style paths and base64 data. */
export async function installSkillUpload(entries) {
  if (!Array.isArray(entries)) throw new HttpError(400, 'Expected a list of files.', 'invalid_skill_upload')
  const files = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.data !== 'string') continue
    const relative = safeRelative(entry.path)
    if (!relative) continue
    files.push({ path: relative, bytes: Buffer.from(entry.data, 'base64') })
  }
  return installFiles(files, 'upload')
}

function run(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { ...options, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
  })
}

export async function installSkillFromNpm(spec) {
  const value = typeof spec === 'string' ? spec.trim() : ''
  if (!NPM_SPEC.test(value)) {
    throw new HttpError(400, 'Enter an npm package name such as @scope/my-skills or my-skills@1.2.0.', 'invalid_npm_spec')
  }
  const at = value.lastIndexOf('@')
  const packageName = at > 0 ? value.slice(0, at) : value
  const work = await mkdtemp(path.join(tmpdir(), 'opensol-skill-'))
  try {
    await writeFile(path.join(work, 'package.json'), '{"name":"opensol-skill-install","private":true}\n')
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    try {
      await run(
        npm,
        ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--omit=dev', '--loglevel=error', value],
        { cwd: work, timeout: NPM_TIMEOUT_MS, shell: process.platform === 'win32' },
      )
    } catch (error) {
      const detail = String(error?.stderr || error?.message || '').split('\n').find((line) => line.trim()) ?? ''
      throw new HttpError(
        400,
        `npm could not install "${value}".${detail ? ` ${detail.trim().slice(0, 200)}` : ''}`,
        'npm_install_failed',
      )
    }
    const packageDir = path.join(work, 'node_modules', ...packageName.split('/'))
    const found = await walk(packageDir)
    const files = []
    for (const file of found) {
      const relative = safeRelative(file.path)
      if (!relative) continue
      files.push({ path: relative, bytes: await readFile(path.join(packageDir, ...relative.split('/'))) })
    }
    // A package whose only skill is its root SKILL.md takes the package name.
    const rootSkill = files.find((file) => file.path.toLowerCase() === 'skill.md')
    if (rootSkill && !parseSkillMarkdown(rootSkill.bytes.toString('utf8')).meta.name) {
      const body = rootSkill.bytes.toString('utf8')
      const slug = slugifySkillName(packageName.replace(/^@/, '').replace('/', '-'))
      rootSkill.bytes = Buffer.from(`---\nname: ${slug}\n---\n\n${body}`)
    }
    return await installFiles(files, `npm:${value}`)
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function removeSkill(name) {
  assertName(name)
  await serial(async () => {
    await rm(path.join(SKILLS_DIR, name), { recursive: true, force: true })
    const state = await readState()
    await writeState({ ...state, disabled: state.disabled.filter((item) => item !== name) })
  })
}

export async function setSkillEnabled(name, enabled) {
  assertName(name)
  await serial(async () => {
    const state = await readState()
    const disabled = new Set(state.disabled)
    if (enabled) disabled.delete(name)
    else disabled.add(name)
    await writeState({ ...state, disabled: [...disabled] })
  })
}

/** Load a skill for the model: SKILL.md (with the frontmatter removed) or one bundled text file. */
export async function readSkill(name, file) {
  assertName(name)
  const dir = path.join(SKILLS_DIR, name)
  let raw
  try {
    raw = await readFile(path.join(dir, 'SKILL.md'), 'utf8')
  } catch {
    throw new HttpError(404, `Skill "${name}" is not installed.`, 'skill_not_found')
  }
  const { disabled } = await readState()
  if (disabled.includes(name)) throw new HttpError(403, `Skill "${name}" is turned off in Settings → Skills.`, 'skill_disabled')

  if (typeof file === 'string' && file.trim() && file.trim().toLowerCase() !== 'skill.md') {
    const relative = safeRelative(file)
    if (!relative) throw new HttpError(400, 'Invalid file path.', 'invalid_skill_file')
    const target = path.join(dir, ...relative.split('/'))
    if (!target.startsWith(`${dir}${path.sep}`)) throw new HttpError(400, 'Invalid file path.', 'invalid_skill_file')
    let info
    try {
      info = await stat(target)
    } catch {
      throw new HttpError(404, `File "${relative}" is not in skill "${name}".`, 'skill_file_not_found')
    }
    if (!info.isFile()) throw new HttpError(400, `"${relative}" is not a file.`, 'invalid_skill_file')
    if (!TEXT_EXT.test(relative)) {
      return { name, file: relative, directory: dir, content: `(binary or unknown file type, ${info.size} bytes — use it from a shell command at ${target})` }
    }
    const content = await readFile(target, 'utf8')
    return {
      name,
      file: relative,
      directory: dir,
      content: content.length > MAX_READ_BYTES ? `${content.slice(0, MAX_READ_BYTES)}\n… truncated` : content,
    }
  }

  const { body } = parseSkillMarkdown(raw)
  const files = (await walk(dir)).filter((item) => item.path !== 'SKILL.md')
  return {
    name,
    file: 'SKILL.md',
    directory: dir,
    content: body.length > MAX_READ_BYTES ? `${body.slice(0, MAX_READ_BYTES)}\n… truncated` : body,
    files: files.map((item) => item.path),
  }
}
