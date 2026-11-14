// Pure helpers for the MCP panel: form <-> config conversion, presets and JSON import.
// Keep `import type` only here: node --test loads this file directly (see CLAUDE.md).
import type { McpServer, McpTransport } from '../types'

export interface McpServerInput {
  id?: string
  name: string
  transport?: McpTransport
  enabled?: boolean
  approval?: 'auto' | 'ask'
  disabledTools?: string[]
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  oauth?: { enabled: boolean; clientId?: string; clientSecret?: string; scope?: string } | null
}

export interface McpDraft {
  /** Present when editing an existing server. */
  id?: string
  name: string
  transport: McpTransport
  command: string
  args: string
  env: string
  url: string
  headers: string
  oauth: boolean
  clientId: string
  clientSecret: string
  scope: string
}

export const EMPTY_DRAFT: McpDraft = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  env: '',
  url: '',
  headers: '',
  oauth: false,
  clientId: '',
  clientSecret: '',
  scope: '',
}

export interface McpPreset {
  label: string
  description: string
  draft: Partial<McpDraft>
}

export const MCP_PRESETS: McpPreset[] = [
  { label: 'Filesystem', description: 'Read and write files in a folder', draft: { name: 'Filesystem', command: 'npx', args: '-y @modelcontextprotocol/server-filesystem .' } },
  { label: 'Memory', description: 'Knowledge-graph memory', draft: { name: 'Memory', command: 'npx', args: '-y @modelcontextprotocol/server-memory' } },
  { label: 'Fetch', description: 'Fetch web pages as markdown', draft: { name: 'Fetch', command: 'uvx', args: 'mcp-server-fetch' } },
  { label: 'Linear', description: 'Issues and projects · OAuth', draft: { name: 'Linear', transport: 'http', url: 'https://mcp.linear.app/mcp', oauth: true } },
  { label: 'Notion', description: 'Pages and databases · OAuth', draft: { name: 'Notion', transport: 'http', url: 'https://mcp.notion.com/mcp', oauth: true } },
  { label: 'Sentry', description: 'Errors and traces · OAuth', draft: { name: 'Sentry', transport: 'http', url: 'https://mcp.sentry.dev/mcp', oauth: true } },
  { label: 'Atlassian', description: 'Jira and Confluence · SSE + OAuth', draft: { name: 'Atlassian', transport: 'sse', url: 'https://mcp.atlassian.com/v1/sse', oauth: true } },
  { label: 'DeepWiki', description: 'Repo docs · no sign-in', draft: { name: 'DeepWiki', transport: 'http', url: 'https://mcp.deepwiki.com/mcp' } },
]

/** Shell-like split that keeps quoted segments together. */
export function splitArgs(value: string): string[] {
  const out: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value))) out.push(match[1] ?? match[2] ?? match[3])
  return out
}

export function joinArgs(args: string[] = []): string {
  return args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ')
}

export function parsePairs(value: string, separator: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of value.split('\n')) {
    const index = line.indexOf(separator)
    if (index < 1) continue
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return out
}

export function formatPairs(record: Record<string, string> | undefined, separator: string): string {
  return Object.entries(record ?? {})
    .map(([key, value]) => `${key}${separator === ':' ? ': ' : separator}${value}`)
    .join('\n')
}

export function draftFromServer(server: McpServer): McpDraft {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command ?? '',
    args: joinArgs(server.args),
    env: formatPairs(server.env, '='),
    url: server.url ?? '',
    headers: formatPairs(server.headers, ':'),
    oauth: Boolean(server.oauth?.enabled),
    clientId: server.oauth?.clientId ?? '',
    clientSecret: server.oauth?.clientSecret ?? '',
    scope: server.oauth?.scope ?? '',
  }
}

export function draftIsValid(draft: McpDraft): boolean {
  if (!draft.name.trim()) return false
  if (draft.transport === 'stdio') return Boolean(draft.command.trim())
  return /^https?:\/\//i.test(draft.url.trim())
}

/** Builds the payload for PUT /api/mcp. `previous` keeps flags the form does not edit. */
export function inputFromDraft(draft: McpDraft, previous?: McpServer): McpServerInput {
  const base = {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name.trim(),
    transport: draft.transport,
    enabled: previous?.enabled ?? true,
    approval: previous?.approval ?? ('ask' as const),
    disabledTools: previous?.disabledTools ?? [],
  }
  if (draft.transport === 'stdio') {
    return { ...base, command: draft.command.trim(), args: splitArgs(draft.args), env: parsePairs(draft.env, '=') }
  }
  return {
    ...base,
    url: draft.url.trim(),
    headers: parsePairs(draft.headers, ':'),
    oauth: draft.oauth
      ? { enabled: true, clientId: draft.clientId.trim(), clientSecret: draft.clientSecret.trim(), scope: draft.scope.trim() }
      : null,
  }
}

export function inputFromServer(server: McpServer): McpServerInput {
  return inputFromDraft(draftFromServer(server), server)
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const strings = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (isObject(value)) for (const [key, item] of Object.entries(value)) if (typeof item === 'string' || typeof item === 'number') out[key] = String(item)
  return out
}

function entryToInput(name: string, raw: Json): McpServerInput | null {
  const enabled = raw.disabled === true ? false : true
  const url = [raw.url, raw.serverUrl, raw.httpUrl].find((item): item is string => typeof item === 'string')
  if (url) {
    const kind = String(raw.type ?? raw.transport ?? '').toLowerCase()
    const transport: McpTransport = kind.includes('sse') || (!kind && /\/sse\/?$/i.test(url)) ? 'sse' : 'http'
    const headers = strings(raw.headers)
    const hasAuthHeader = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')
    return { name, transport, enabled, url, headers, oauth: hasAuthHeader ? null : { enabled: true } }
  }
  if (typeof raw.command === 'string' && raw.command.trim()) {
    const args = Array.isArray(raw.args) ? raw.args.filter((item): item is string => typeof item === 'string') : []
    return { name, transport: 'stdio', enabled, command: raw.command, args, env: strings(raw.env) }
  }
  return null
}

const looksLikeServer = (value: unknown) => isObject(value) && (typeof value.command === 'string' || typeof value.url === 'string' || typeof value.serverUrl === 'string' || typeof value.httpUrl === 'string')

/** Accepts Claude Desktop / Cursor / VS Code style JSON ({ mcpServers | servers: {...} }) or one server object. */
export function parseMcpJson(text: string): { servers: McpServerInput[]; skipped: string[] } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('That is not valid JSON.')
  }
  if (!isObject(data)) throw new Error('Expected a JSON object.')
  let map: Json | null = null
  for (const candidate of [data.mcpServers, data.servers, isObject(data.mcp) ? data.mcp.servers : undefined]) {
    if (isObject(candidate)) {
      map = candidate
      break
    }
  }
  if (!map) {
    if (looksLikeServer(data)) map = { Imported: data }
    else if (Object.values(data).length > 0 && Object.values(data).every(looksLikeServer)) map = data
  }
  if (!map) throw new Error('No MCP servers found. Expect {"mcpServers": {"name": {"command": …} or {"url": …}}}.')
  const servers: McpServerInput[] = []
  const skipped: string[] = []
  for (const [name, raw] of Object.entries(map)) {
    const input = isObject(raw) ? entryToInput(name.slice(0, 60), raw) : null
    if (input) servers.push(input)
    else skipped.push(name)
  }
  if (servers.length === 0) throw new Error('None of those entries has a "command" or a "url".')
  return { servers, skipped }
}
