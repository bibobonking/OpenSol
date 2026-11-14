import type { AppSettings, ToolName, ToolSetting } from '../types'
import { mcpCall } from '../lib/daemon'
import { isMcpToolName, mcpServerUsable, useMcp } from '../store/mcp'
import type { ToolDefinition, ToolSchema } from './types'

const MAX_OUTPUT = 28_000

function toParameters(schema: Record<string, unknown>): ToolSchema['parameters'] {
  const properties =
    schema.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, unknown>)
      : {}
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : undefined
  return { type: 'object', properties, ...(required?.length ? { required } : {}) }
}

function toolsChangedNote(server: string, added: string[], removed: string[]): string {
  const list = (items: string[]) => `${items.slice(0, 12).join(', ')}${items.length > 12 ? `, … (+${items.length - 12})` : ''}`
  const parts = [`[OpenSol: the tool list of MCP server “${server}” changed.`]
  if (added.length) parts.push(`New tools you can call from your next step: ${list(added)}.`)
  if (removed.length) parts.push(`No longer available: ${list(removed)}.`)
  parts.push('Keep going; nothing needs to be restarted.]')
  return parts.join(' ')
}

/** A connected, enabled MCP tool as a regular tool definition; null when it is not callable now. */
export function mcpDefinition(name: ToolName): ToolDefinition | undefined {
  if (!isMcpToolName(name)) return undefined
  const hit = useMcp.getState().lookup(name)
  if (!hit) return undefined
  const { server, tool } = hit
  if (!mcpServerUsable(server) || server.disabledTools.includes(tool.name)) return undefined
  return {
    name,
    description: `[MCP server “${server.name}”] ${tool.description || tool.name}`.slice(0, 1200),
    parameters: toParameters(tool.inputSchema),
    allowedInMode: (mode) => mode === 'build' || tool.readOnly,
    async execute(args, exec) {
      const { result, toolsChanged } = await mcpCall(server.id, tool.name, args, exec.signal)
      let text = result.text.trim() || '(the tool returned no output)'
      if (text.length > MAX_OUTPUT) text = `${text.slice(0, MAX_OUTPUT)}\n… truncated (${text.length - MAX_OUTPUT} more characters)`
      if (toolsChanged) {
        // The new list is in the store before this result is handed back, so the very next model request
        // already carries it. The note tells the model, so the turn goes on without stopping.
        useMcp.getState().applyServer(toolsChanged.server)
        text += `\n\n${toolsChangedNote(server.name, toolsChanged.added, toolsChanged.removed)}`
      }
      return { output: text, isError: result.isError }
    },
  }
}

export function mcpDefinitions(): ToolDefinition[] {
  const out: ToolDefinition[] = []
  for (const server of useMcp.getState().servers) {
    for (const tool of server.tools) {
      const definition = mcpDefinition(tool.fn)
      if (definition) out.push(definition)
    }
  }
  return out
}

/** Enabled/approval for any tool: built-ins come from Settings → Tools, MCP tools from their server. */
export function resolveToolSetting(settings: AppSettings, name: ToolName): ToolSetting | undefined {
  if (!isMcpToolName(name)) return settings.tools[name]
  const hit = useMcp.getState().lookup(name)
  if (!hit) return undefined
  const { server, tool } = hit
  return {
    enabled: mcpServerUsable(server) && !server.disabledTools.includes(tool.name),
    approval: server.approval,
  }
}
