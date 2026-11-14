import { Service, type Context } from 'cordis'
import type { AgentMode, AppSettings, ToolName } from '../../types'
import { mcpDefinition, mcpDefinitions, resolveToolSetting } from '../mcp-tools'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolPreExecuteResult,
  ToolResult,
  ToolSchema,
} from '../types'

const READ_ONLY_TOOLS = new Set<ToolName>([
  'read_file',
  'list_files',
  'grep',
  'web_search',
  'read_url',
])

export function toolAllowedInMode(name: ToolName, mode: AgentMode): boolean {
  if (mode === 'build') return true
  return READ_ONLY_TOOLS.has(name) || name === 'shell' || name === 'git' || name === 'subagent'
}

export class ToolService extends Service {
  static provide = 'tools'
  private definitions = new Map<ToolName, ToolDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  register(definition: ToolDefinition): () => void {
    this.definitions.set(definition.name, definition)
    return () => {
      if (this.definitions.get(definition.name) === definition) {
        this.definitions.delete(definition.name)
      }
    }
  }

  get(name: ToolName): ToolDefinition | undefined {
    return this.definitions.get(name) ?? mcpDefinition(name)
  }

  list(): ToolDefinition[] {
    return [...this.definitions.values(), ...mcpDefinitions()]
  }

  schemas(
    settings: AppSettings,
    mode: AgentMode = 'build',
    { subagent = false }: { subagent?: boolean } = {},
  ): ToolSchema[] {
    const list: ToolSchema[] = []
    // Subagents stay on the built-in read-only tools; MCP tools are not offered to them.
    const all = subagent ? [...this.definitions.values()] : this.list()
    for (const def of all) {
      if (def.name === 'subagent' && subagent) continue
      if (!resolveToolSetting(settings, def.name)?.enabled) continue
      const allowed = def.allowedInMode ? def.allowedInMode(mode) : toolAllowedInMode(def.name, mode)
      if (!allowed) continue
      if ((def.name === 'web_search' || def.name === 'read_url') && !settings.webSearchEnabled) continue
      list.push({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
      })
    }
    return list
  }

  async execute(
    name: ToolName,
    args: Record<string, unknown>,
    settings: AppSettings,
    mode: AgentMode,
    signal: AbortSignal,
    callId?: string,
    turnId?: string,
    extra: Pick<ToolExecutionContext, 'sessionId' | 'onProgress'> = {},
  ): Promise<ToolResult> {
    const exec: ToolExecutionContext = { name, args, settings, mode, signal, callId, turnId, ...extra }

    // 1. tools/pre-execute waterfall (approval, permission gate, mode checks)
    const preDecision: ToolPreExecuteResult = await this.ctx.events.waterfall(
      'tools/pre-execute',
      exec,
      async () => {
        if (!resolveToolSetting(settings, name)?.enabled) {
          return { decision: 'deny', reason: 'This tool is disabled or its MCP server is not connected (Settings → Tools / MCP).' }
        }
        const def = this.get(name)
        const allowed = def?.allowedInMode ? def.allowedInMode(mode) : toolAllowedInMode(name, mode)
        if (!allowed) {
          return {
            decision: 'deny',
            reason: 'Plan mode is read-only. Do not edit files or change git state. Finish with an implementation plan instead.',
          }
        }
        if ((name === 'web_search' || name === 'read_url') && !settings.webSearchEnabled) {
          return { decision: 'deny', reason: 'Web access is turned off for this session.' }
        }
        return { decision: 'allow' }
      },
    )

    if (preDecision.decision === 'deny') {
      const deniedResult: ToolResult = { output: preDecision.reason ?? 'Tool call denied.', isError: true }
      this.ctx.events.emit('tools/result', deniedResult, exec)
      return deniedResult
    }

    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    // 2. tools/execute waterfall
    const result: ToolResult = await this.ctx.events.waterfall('tools/execute', exec, async () => {
      const def = this.get(name)
      if (!def) {
        return { output: `Tool "${name}" is not registered.`, isError: true }
      }
      return await def.execute(args, exec)
    })

    // 3. tools/post-execute waterfall
    const finalResult: ToolResult = await this.ctx.events.waterfall(
      'tools/post-execute',
      result,
      exec,
      async () => result,
    )

    // 4. tools/result emit
    this.ctx.events.emit('tools/result', finalResult, exec)
    return finalResult
  }
}
