import type {
  AgentMode,
  AppSettings,
  AssistantMessage,
  Message,
  ModelInfo,
  ToolCall,
  ToolMessage,
  ToolName,
  Usage,
} from '../types'
import type { AdapterResult } from '../agent/adapters/shared'

export interface ThinkingBlock {
  text: string
  signature?: string
}

export interface JsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface ToolSchema {
  name: ToolName
  description: string
  parameters: JsonSchema
}

export interface ToolResult {
  output: string
  isError: boolean
}

export interface ToolExecutionContext {
  name: ToolName
  args: Record<string, unknown>
  settings: AppSettings
  mode: AgentMode
  signal: AbortSignal
  callId?: string
}

export type ToolPreExecuteDecision = 'allow' | 'ask' | 'deny'

export interface ToolPreExecuteResult {
  decision: ToolPreExecuteDecision
  reason?: string
}

export interface StepContext {
  sessionId: string
  round: number
  history: Message[]
  settings: AppSettings
  mode: AgentMode
  signal: AbortSignal
  assistantId: string
}

export interface StepResult {
  sessionId: string
  round: number
  assistant: AssistantMessage
  toolResults: ToolMessage[]
  stopped?: boolean
}

export interface TurnResult {
  sessionId: string
  userMessageId: string
  rounds: number
  durationMs: number
  stopped?: boolean
  error?: string
}

export interface ModelRequest {
  settings: AppSettings
  model: ModelInfo | null
  history: Message[]
  system: string
  mode: AgentMode
  signal: AbortSignal
  handlers: {
    onText: (delta: string) => void
    onReasoning: (delta: string) => void
    onThinkingBlocks?: (blocks: ThinkingBlock[]) => void
    onToolCalls: (calls: ToolCall[]) => void
    onUsage: (usage: Usage) => void
  }
}

export interface PromptSection {
  name: string
  priority: number
  content: string
}

export interface ToolDefinition {
  name: ToolName
  description: string
  parameters: JsonSchema
  allowedInMode?: (mode: AgentMode) => boolean
  execute: (args: Record<string, unknown>, exec: ToolExecutionContext) => Promise<ToolResult>
}

declare module 'cordis' {
  interface Context {
    sessions: import('./services/sessions').SessionService
    systemPrompt: import('./services/system-prompt').SystemPromptService
    tools: import('./services/tools').ToolService
    llm: import('./services/llm').LlmService
    approval: import('./services/approval').ApprovalService
    compaction: import('./services/compaction').CompactionService
    subagents: import('./services/subagents').SubagentService
    agentLoop: import('./services/agent-loop').AgentLoopService
    ui: import('./services/ui').UiService
  }

  interface Events {
    'agent/pre-step': (step: StepContext, next: () => Promise<void> | void) => Promise<void> | void
    'agent/request': (req: ModelRequest, next: () => Promise<AdapterResult>) => Promise<AdapterResult>
    'agent/request-error': (error: unknown, ctx: StepContext, next: () => Promise<void> | void) => Promise<void> | void
    'agent/step-finish': (step: StepResult) => void
    'agent/turn-stopping': (sessionId: string) => Promise<void> | void
    'agent/turn-finish': (turn: TurnResult) => void
    'tools/pre-execute': (exec: ToolExecutionContext, next: () => Promise<ToolPreExecuteResult>) => Promise<ToolPreExecuteResult>
    'tools/execute': (exec: ToolExecutionContext, next: () => Promise<ToolResult>) => Promise<ToolResult>
    'tools/post-execute': (result: ToolResult, exec: ToolExecutionContext, next: () => Promise<ToolResult>) => Promise<ToolResult>
    'tools/result': (result: ToolResult, exec: ToolExecutionContext) => void
    'system-prompt/assemble': (sections: PromptSection[], mode: AgentMode, next: () => Promise<string> | string) => Promise<string> | string
    'session/flush': (sessionId: string) => Promise<void> | void
  }
}
