import type { AppSettings, ToolName, ToolSetting } from '../types'
import { mcpCall } from '../lib/daemon'
import { isMcpToolName, useMcp } from '../store/mcp'
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

/** A connected, enabled MCP tool as a regular tool definition; null when it is not callable now. */
export function mcpDefinition(name: ToolName): ToolDefinition | undefined {
  if (!isMcpToolName(name)) return undefined
  const hit = useMcp.getState().lookup(name)
  if (!hit) return undefined
  const { server, tool } = hit
  if (!server.enabled || server.status !== 'connected' || server.disabledTools.includes(tool.name)) return undefined
  return {
    name,
    description: `[MCP server “${server.name}”] ${tool.description || tool.name}`.slice(0, 1200),
    parameters: toParameters(tool.inputSchema),
    allowedInMode: (mode) => mode === 'build' || tool.readOnly,
    async execute(args, exec) {
      const { result } = await mcpCall(server.id, tool.name, args, exec.signal)
      const text = result.text.trim() || '(the tool returned no output)'
      return {
        output: text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… truncated (${text.length - MAX_OUTPUT} more characters)` : text,
        isError: result.isError,
      }
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
    enabled: server.enabled && server.status === 'connected' && !server.disabledTools.includes(tool.name),
    approval: server.approval,
  }
}
