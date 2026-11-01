const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024
const MAX_PACKAGE_BYTES = 10 * 1024 * 1024
const MAX_FILES = 100
const MAX_MANIFEST_BYTES = 64 * 1024
const CAPABILITIES = new Set([
  'workspace.list',
  'workspace.read',
  'workspace.write',
  'workspace.edit',
  'ui.commands',
  'ui.panels',
  'ui.themes',
  'network.request',
])
const MANIFEST_KEYS = new Set([
  'id',
  'name',
  'version',
  'apiVersion',
  'entry',
  'stylesheet',
  'capabilities',
  'domains',
])

function packageError(message) {
  throw new Error(`Invalid plugin package: ${message}`)
}

function bytesToString(bytes) {
  if (typeof bytes === 'string') return bytes
  return new TextDecoder('utf-8').decode(bytes)
}

function stringToBytes(str) {
  return new TextEncoder().encode(str)
}

function validateSource(path, content, apiVersion) {
  // API v2: skip validation — full kernel access, blob isolation is enough
  if (apiVersion === 2) return

  const source = bytesToString(content)
  const rule = path.endsWith('.js')
    ? [
        /\b(?:import|export)\b|\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(|\bnavigator\s*\.\s*sendBeacon\s*\(/i,
        'module imports and unmanaged network calls are forbidden',
      ]
    : path.endsWith('.css')
      ? [
          /@import\b|url\s*\(\s*(['"]?)(?!data:image\/(?:png|jpeg|gif|webp);base64,)[^)]*\)/i,
          'external CSS resources and imports are forbidden',
        ]
      : null
  if (!rule) return
  const found = rule[0].exec(source)
  if (!found) return
  const line = source.slice(0, found.index).split('\n').length
  const hit = found[0].length > 60 ? `${found[0].slice(0, 60)}…` : found[0]
  packageError(`${rule[1]}: found "${hit}" at ${path}:${line}`)
}

function safePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[a-zA-Z]:/.test(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    packageError(`unsafe path "${String(value)}"`)
  }
  return value
}

function validateDomain(value) {
  if (typeof value !== 'string' || value.length > 253 || value.endsWith('.')) {
    packageError('invalid domain')
  }
  const labels = value.split('.')
  if (
    labels.length < 2 ||
    labels.some((label) => !/^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
  ) {
    packageError(`invalid domain "${value}"`)
  }
  return value.toLowerCase()
}

export function validatePluginManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) packageError('manifest must be an object')
  if (Object.keys(value).some((key) => !MANIFEST_KEYS.has(key))) packageError('unknown manifest field')
  const { id, name, version, apiVersion, entry, stylesheet, capabilities, domains } = value
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) packageError('invalid plugin id')
  if (typeof name !== 'string' || !name.trim() || name.length > 100) packageError('invalid plugin name')
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    packageError('invalid plugin version')
  }
  if (apiVersion !== 1 && apiVersion !== 2) packageError('unsupported API version')
  safePath(entry)
  safePath(stylesheet)
  if (!entry.endsWith('.js') || !stylesheet.endsWith('.css')) packageError('entry must be JavaScript and stylesheet must be CSS')

  // API v2: capabilities optional (defaults to [])
  const normalizedCapabilities = capabilities ?? []
  if (!Array.isArray(normalizedCapabilities)) packageError('capabilities must be an array')
  if (apiVersion === 1 && normalizedCapabilities.some((item) => !CAPABILITIES.has(item))) {
    packageError('invalid capability')
  }

  if (domains !== undefined && !Array.isArray(domains)) packageError('domains must be an array')
  const normalizedDomains = (domains ?? []).map(validateDomain)
  if (new Set(normalizedDomains).size !== normalizedDomains.length) packageError('duplicate domain')
  return {
    id,
    name: name.trim(),
    version,
    apiVersion,
    entry,
    stylesheet,
    capabilities: [...new Set(normalizedCapabilities)],
    domains: normalizedDomains,
  }
}

function normalizeFiles(files, manifest) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) packageError('files must be a path-to-source object')
  const paths = Object.keys(files)
  if (paths.length > MAX_FILES) packageError('too many files')
  const normalized = {}
  let total = 0
  for (const rawPath of paths) {
    const filePath = safePath(rawPath)
    if (filePath === 'manifest.json') packageError('manifest is generated from the manifest field')
    if (/\.(?:mjs|cjs|jsx|ts|tsx)$/i.test(filePath) && filePath !== manifest.entry) {
      packageError(`undeclared executable file "${filePath}"`)
    }
    if (filePath !== manifest.entry && filePath !== manifest.stylesheet && /\.(?:js|css)$/i.test(filePath)) {
      packageError(`undeclared executable file "${filePath}"`)
    }
    const content = files[rawPath]
    if (typeof content !== 'string' && !(content instanceof Uint8Array)) {
      packageError(`file "${filePath}" must be text or bytes`)
    }
    const data = typeof content === 'string' ? stringToBytes(content) : content
    total += data.byteLength
    if (total > MAX_PACKAGE_BYTES) packageError('package is too large')
    if (filePath === manifest.entry || filePath === manifest.stylesheet) validateSource(filePath, data, manifest.apiVersion)
    normalized[filePath] = typeof content === 'string' ? content : bytesToString(data)
  }
  if (!(manifest.entry in normalized)) packageError('entry file is missing')
  if (!(manifest.stylesheet in normalized)) packageError('stylesheet file is missing')
  if (stringToBytes(normalized[manifest.entry]).byteLength > 2 * 1024 * 1024) packageError('entry file is too large')
  return normalized
}

export function buildPluginArchive(sources) {
  const manifest = validatePluginManifest(sources?.manifest)
  const files = normalizeFiles(sources?.files, manifest)
  const manifestJson = JSON.stringify(manifest)
  if (stringToBytes(manifestJson).byteLength > MAX_MANIFEST_BYTES) packageError('manifest is too large')

  const packageData = {
    format: 'cordis-plugin',
    manifest,
    files,
  }

  const encoded = stringToBytes(JSON.stringify(packageData))
  if (encoded.byteLength > MAX_ARCHIVE_BYTES) packageError('package is too large')
  return encoded
}

export function readPluginArchive(bytes) {
  if (!bytes || !(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    packageError('package archive is empty or invalid')
  }
  let parsed
  try {
    const text = new TextDecoder('utf-8').decode(bytes)
    parsed = JSON.parse(text)
  } catch {
    packageError('package is not a valid JSON archive')
  }

  if (!parsed || typeof parsed !== 'object') packageError('invalid package format')
  const manifest = validatePluginManifest(parsed.manifest)
  const files = parsed.files
  if (!files || typeof files !== 'object') packageError('missing package files')

  return {
    manifest,
    files,
  }
}
