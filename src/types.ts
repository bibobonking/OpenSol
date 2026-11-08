import type { ThemeId } from './lib/themes'

export type ApiFormat = 'openai' | 'anthropic' | 'gemini'

export type ApiKind = 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini'

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'openrouter'
  | 'opencode'
  | 'groq'
  | 'mistral'
  | 'xai'
  | 'together'
  | 'ollama'
  | 'custom'

export type Effort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type ReasoningOption =
  | { type: 'effort'; values: Effort[] }
  | { type: 'toggle' }
  | { type: 'budget_tokens'; min?: number; max?: number }

export interface ModelInfo {
  id: string
  name: string
  context?: number
  maxOutput?: number
  vision?: boolean
  reasoningOptions: ReasoningOption[]
  toolCall: boolean
  temperature: boolean
  family?: string
  apiKind: ApiKind
  free?: boolean
  canonicalId?: string
  /** USD per 1M tokens, when the provider or catalog publishes it. */
  pricing?: { input: number; output: number }
  note?: string
}

export interface ProviderDef {
  id: ProviderId
  name: string
  format: ApiFormat
  baseUrl: string
  keyless?: boolean
  keyHint: string
  note?: string
}

export interface ProviderCredentials {
  baseUrl?: string
}

export interface ProviderStatus {
  id: ProviderId
  name: string
  format: 'openai' | 'anthropic' | 'gemini' | 'opencode'
  baseUrl: string
  keyless: boolean
  configured: boolean
  hint: string
}

export interface SecretEntry {
  configured: boolean
  hint: string
}

export interface DeploySecretEntry extends SecretEntry {
  fields: Record<string, string>
}

export interface SecretsSummary {
  providers: Record<string, SecretEntry>
  search: SecretEntry
  deploy: {
    cloudflare: DeploySecretEntry
    netlify: DeploySecretEntry
    vercel: DeploySecretEntry
  }
  encryption: string
}

export type AgentMode = 'build' | 'plan'

export type BuiltinToolName =
  | 'shell'
  | 'read_file'
  | 'list_files'
  | 'write_file'
  | 'edit_file'
  | 'rewrite_file'
  | 'grep'
  | 'web_search'
  | 'read_url'
  | 'git'
  | 'subagent'
  | 'skill'

/** MCP tools are exposed to the model as mcp__<server>__<tool>. */
export type McpToolName = `mcp__${string}`

export type ToolName = BuiltinToolName | McpToolName

export interface ToolSetting {
  enabled: boolean
  approval: 'auto' | 'ask'
}

export type SearchProvider = 'duckduckgo' | 'tavily' | 'brave' | 'serper'

/** A skill folder installed on the daemon (SKILL.md + bundled files). */
export interface InstalledSkill {
  name: string
  title: string
  description: string
  enabled: boolean
  /** 'upload' | 'folder' | 'legacy' | `npm:<spec>` */
  source: string
  installedAt: string
  fileCount: number
  size: number
  path: string
}

export interface AppSettings {
  provider: ProviderId
  model: string
  effort: Effort
  webSearchEnabled: boolean
  temperature: number
  maxTokens: number
  systemPrompt: string
  /** Custom base prompts per workspace folder (absolute root path). Missing = use the shared prompt. */
  workspacePrompts: Record<string, string>
  providers: Record<string, ProviderCredentials>
  searchProvider: SearchProvider
  tools: Record<BuiltinToolName, ToolSetting>
  theme: ThemeId
  showTokenEstimate: boolean
  mode: AgentMode
  chatFontSize: number
  workDetail: 'concise' | 'detailed'
  autoCollapseWork: boolean
  /** Let the model name a session after its first answer. */
  aiSessionTitles: boolean
}

export interface Attachment {
  id: string
  name: string
  kind: 'image' | 'text'
  mime: string
  dataUrl?: string
  text?: string
  size: number
}

export interface ToolCall {
  id: string
  name: ToolName
  args: Record<string, unknown>
  /** Gemini thought signature that must be replayed with the tool call. */
  thoughtSignature?: string
}

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; call: ToolCall; status: ToolRunStatus; result?: string; durationMs?: number }

export type ToolRunStatus = 'running' | 'done' | 'error' | 'denied' | 'awaiting'

export interface UserMessage {
  id: string
  role: 'user'
  content: string
  attachments?: Attachment[]
  createdAt: number
}

export interface AssistantMessage {
  id: string
  role: 'assistant'
  content: string
  reasoning: string
  thinkingBlocks?: Array<{ text: string; signature?: string }>
  toolCalls: ToolCall[]
  model?: string
  provider?: ProviderId
  usage?: { input?: number; output?: number; cost?: number }
  /** Credits spent on this reply (provider-reported, else tokens × model price). */
  cost?: number
  error?: string
  stopped?: boolean
  durationMs?: number
  createdAt: number
  /** Tool calls in this round already have follow-up tool messages. */
  round: number
}

/** Line-level change report for a file edit: +added, −removed and where it started (1-based). */
export interface FileDiff {
  added: number
  removed: number
  line?: number
  column?: number
}

export interface ToolMessage {
  id: string
  role: 'tool'
  call: ToolCall
  status: ToolRunStatus
  result?: string
  durationMs?: number
  diff?: FileDiff
  createdAt: number
  round: number
}

export type Message = UserMessage | AssistantMessage | ToolMessage

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
  provider?: ProviderId
  model?: string
  mode?: AgentMode
  /** Workspace folder the session was started in. */
  workspace?: string
  /** Who last set the title; only 'auto' titles may be replaced by the AI. */
  titleSource?: 'auto' | 'ai' | 'user'
  /** Custom base prompt for this session only. Undefined = inherit (workspace prompt, else the shared one). */
  systemPrompt?: string
}

export type McpStatus = 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'needs_auth' | 'error'

export type McpTransport = 'stdio' | 'http' | 'sse'

export interface McpOAuth {
  enabled: boolean
  clientId: string
  /** Masked by the daemon; send the mask back to keep the stored secret. */
  clientSecret: string
  scope: string
  authorized: boolean
}

export interface McpTool {
  name: string
  fn: McpToolName
  description: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
}

export interface McpServer {
  id: string
  name: string
  transport: McpTransport
  enabled: boolean
  approval: 'auto' | 'ask'
  disabledTools: string[]
  status: McpStatus
  error: string
  serverInfo: { name?: string; version?: string } | null
  connectedAt: number | null
  tools: McpTool[]
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  oauth?: McpOAuth | null
}

export interface Usage {
  input?: number
  output?: number
  /** Credits/USD the provider itself reported for this request. */
  cost?: number
}

export interface StreamHandlers {
  onText: (delta: string) => void
  onReasoning: (delta: string) => void
  onToolCalls: (calls: ToolCall[]) => void
  onUsage: (usage: Usage) => void
}

export interface ToolEvent {
  id: string
  name: ToolName
  args: Record<string, unknown>
  status: ToolRunStatus
  result?: string
  durationMs?: number
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface ShellResult {
  stdout: string
  stderr: string
  code: number
}

export interface WorkspaceRecord {
  path: string
  name: string
  lastOpened: number
}

export interface WorkspaceInfo {
  root: string
  name: string
  available: boolean
  error: string
  workspaces: WorkspaceRecord[]
}

export interface WorkspaceEntry {
  name: string
  path: string
  type: 'file' | 'dir' | 'link'
  size: number
  mtime: number
}

export interface WorkspaceFile {
  path: string
  size: number
  mtime: number
  binary: boolean
  truncated: boolean
  content: string
  base64: string
  hash: string
}

export interface DaemonInfo {
  version: string
  dataDir: string
  home: string
  platform: string
  node: string
}

export type DeployProviderId = 'cloudflare' | 'netlify' | 'vercel'

export interface DeployToolInfo {
  bin: string
  pkg: string
  label: string
  installed: boolean
  version: string
}

export interface DeployRequest {
  provider: DeployProviderId
  path: string
  outputDir?: string
  buildCommand?: string
  projectName?: string
  siteId?: string
  mode?: AgentMode
}

export interface DeployDetection {
  path: string
  name: string
  framework: string
  packageManager: string
  hasNodeModules: boolean
  buildCommand: string
  outputDir: string
  expectedOutputDir: string
  built: boolean
}

export interface DeployResult {
  provider: DeployProviderId
  url: string
  siteId?: string
  project?: string
}

export type DeployEvent =
  | { type: 'start'; provider: DeployProviderId; path?: string }
  | { type: 'step'; id: string; label: string }
  | { type: 'log'; stream: 'stdout' | 'stderr' | 'meta'; text: string }
  | { type: 'done'; result: DeployResult }
  | { type: 'error'; message: string; code?: string }

export interface DaemonSnapshot {
  version: string
  dataDir: string
  home: string
  platform: string
  node: string
  settings: Partial<AppSettings>
  chats: { sessions: ChatSession[]; activeId: string | null }
  workspace: WorkspaceInfo
  secrets: SecretsSummary
  secretsError: string
  providers: ProviderStatus[]
  deployTools: Record<DeployProviderId, DeployToolInfo>
  deploySecrets: SecretsSummary['deploy']
  migration: { migratedAt: string | null }
  modelCatalog: { providers: string[] }
}
