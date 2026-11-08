import { gunzipSync } from 'node:zlib'
import { HttpError } from './http.mjs'

const MAX_TARBALL = 12 * 1024 * 1024
const MAX_FILES = 200
const MAX_FILE = 512 * 1024

function registryName(pkg) {
  return pkg.startsWith('@') ? pkg.replace('/', '%2f') : encodeURIComponent(pkg)
}

/** Minimal ustar reader: enough for npm packages, no extra dependency. */
function untar(buffer) {
  const files = new Map()
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    if (!name) break
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8) || 0
    const type = String.fromCharCode(header[156] || 48)
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const full = prefix ? `${prefix}/${name}` : name
    offset += 512
    if (type === '0' || type === '\0' || type === '48') {
      if (files.size < MAX_FILES && size > 0 && size <= MAX_FILE) {
        files.set(full, buffer.subarray(offset, offset + size).toString('utf8'))
      }
    }
    offset += Math.ceil(size / 512) * 512
  }
  return files
}

function skillFile(files) {
  const candidates = [...files.keys()].filter((path) => /(^|\/)SKILL\.md$/i.test(path))
  candidates.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
  return candidates[0] ?? ''
}

function parseSkill(markdown, fallbackName) {
  const text = markdown.replace(/\r\n/g, '\n')
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  const meta = {}
  let body = text
  if (front) {
    for (const line of front[1].split('\n')) {
      const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim())
      if (match) meta[match[1].toLowerCase()] = match[2].replace(/^["']|["']$/g, '').trim()
    }
    body = text.slice(front[0].length)
  }
  const heading = /^#\s+(.+)$/m.exec(body)
  const paragraph = body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith('#') && !part.startsWith('---'))
  return {
    name: meta.name || heading?.[1]?.trim() || fallbackName,
    description: (meta.description || paragraph || 'Installed from npm').replace(/[#>*`]/g, '').replace(/\s+/g, ' ').slice(0, 200),
    instructions: body.trim(),
  }
}

function slug(value) {
  return String(value || 'skill')
    .toLowerCase()
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'skill'
}

export async function installSkillFromNpm(packageName) {
  const pkg = String(packageName ?? '').trim()
  if (!/^(@[a-z0-9-_.]+\/)?[a-z0-9-_.]+$/i.test(pkg)) {
    throw new HttpError(400, 'Enter a valid npm package name, for example @scope/skill-name.', 'bad_skill_package')
  }
  const metaResponse = await fetch(`https://registry.npmjs.org/${registryName(pkg)}`, {
    signal: AbortSignal.timeout(20_000),
  })
  if (!metaResponse.ok) {
    throw new HttpError(404, `npm could not find "${pkg}".`, 'skill_not_found')
  }
  const meta = await metaResponse.json()
  const version = meta?.['dist-tags']?.latest
  const tarball = version ? meta?.versions?.[version]?.dist?.tarball : ''
  if (!version || typeof tarball !== 'string' || !tarball.startsWith('https://registry.npmjs.org/')) {
    throw new HttpError(502, 'npm did not return a download for that package.', 'skill_not_found')
  }
  const archiveResponse = await fetch(tarball, { signal: AbortSignal.timeout(30_000) })
  if (!archiveResponse.ok) throw new HttpError(502, 'Could not download the skill package.', 'skill_download_failed')
  const bytes = new Uint8Array(await archiveResponse.arrayBuffer())
  if (bytes.length > MAX_TARBALL) throw new HttpError(413, 'That package is too large for a skill.', 'skill_too_large')

  let files
  try {
    files = untar(gunzipSync(bytes))
  } catch {
    throw new HttpError(502, 'That package is not a readable npm tarball.', 'skill_download_failed')
  }
  // Strip the leading "package/" folder npm adds.
  const normalised = new Map()
  for (const [path, content] of files) {
    const clean = path.replace(/^package\//, '').replace(/\\/g, '/')
    if (clean && !clean.includes('..')) normalised.set(clean, content)
  }
  const skillPath = skillFile(normalised)
  if (!skillPath) throw new HttpError(400, 'That package has no SKILL.md, so it is not a skill.', 'skill_missing_manifest')
  const root = skillPath.includes('/') ? skillPath.slice(0, skillPath.lastIndexOf('/') + 1) : ''
  const scoped = new Map()
  for (const [path, content] of normalised) {
    if (root && !path.startsWith(root)) continue
    scoped.set(root ? path.slice(root.length) : path, content)
  }
  const parsed = parseSkill(normalised.get(skillPath), pkg)
  return {
    id: `skill_${slug(pkg)}`,
    name: parsed.name,
    description: parsed.description,
    instructions: parsed.instructions,
    enabled: true,
    source: 'npm',
    package: pkg,
    version,
    files: Object.fromEntries(scoped),
  }
}
