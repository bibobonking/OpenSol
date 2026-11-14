import { Service, type Context } from 'cordis'
import type { AppSettings, BuiltinToolName, Message } from '../../types'
import { activeModelId, useSettings } from '../../store/settings'
import { useChats } from '../../store/chats'
import { useRuntime } from '../../store/ui'
import { findModel } from '../../store/models'
import { effortOptions } from '../../lib/reasoning'
import { createId } from '../../store/chats'
import type { TurnResult } from '../types'

const TITLE_SYSTEM =
  'You name chat sessions for a coding assistant. Reply with the title only: 2 to 6 words, in the same language as the user, no quotes, no markdown, no trailing punctuation.'

function clip(value: string, max: number) {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

export function cleanTitle(raw: string): string {
  const first = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  if (!first) return ''
  const title = first
    .replace(/^(title|tiêu đề)\s*[:：-]\s*/i, '')
    .replace(/^[#>*\-\s"'“”‘’`]+|[\s"'“”‘’`.。!]+$/g, '')
    .trim()
  return title.length > 64 ? `${title.slice(0, 63).trim()}…` : title
}

function excerpt(messages: Message[]) {
  const user = messages.find((message) => message.role === 'user')
  const assistant = [...messages].reverse().find((message) => message.role === 'assistant' && message.content.trim())
  return {
    user: user && user.role === 'user' ? clip(user.content, 700) : '',
    assistant: assistant && assistant.role === 'assistant' ? clip(assistant.content, 700) : '',
  }
}

/** Lets the model name a session after its first answer, or on demand from the sidebar. */
export class TitleService extends Service {
  static provide = 'titles'
  static inject = ['llm', 'sessions']

  private inflight = new Set<string>()

  constructor(ctx: Context) {
    super(ctx, 'titles')
    this.ctx.on('agent/turn-finish', (turn: TurnResult) => {
      if (turn.error || turn.stopped) return
      const settings = useSettings.getState()
      if (!settings.aiSessionTitles) return
      const session = this.ctx.sessions.current(turn.sessionId)
      // Only a title that is still the first-message excerpt may be replaced; names the person typed stay.
      if (!session || (session.titleSource ?? 'auto') !== 'auto') return
      void this.generate(turn.sessionId)
    })
  }

  async generate(sessionId: string, { force = false } = {}): Promise<string | null> {
    if (this.inflight.has(sessionId)) return null
    const session = this.ctx.sessions.current(sessionId)
    if (!session) return null
    if (!force && (session.titleSource ?? 'auto') !== 'auto') return null
    const { user, assistant } = excerpt(session.messages)
    if (!user) return null

    const settings = useSettings.getState()
    const model = findModel(settings.provider, activeModelId(settings))
    // No tools, no web, the lowest reasoning effort the model offers: a title is not worth a thinking budget.
    const tools = Object.fromEntries(
      Object.entries(settings.tools).map(([name, value]) => [name, { ...value, enabled: false }]),
    ) as Record<BuiltinToolName, AppSettings['tools'][BuiltinToolName]>
    const efforts = effortOptions(model)
    const titleSettings: AppSettings = {
      ...settings,
      tools,
      webSearchEnabled: false,
      temperature: 0.3,
      maxTokens: 512,
      effort: efforts[0] ?? settings.effort,
    }
    const history: Message[] = [
      {
        id: createId('title'),
        role: 'user',
        createdAt: Date.now(),
        content: `Name this conversation.\n\nUser: ${user}\n\nAssistant: ${assistant || '(no answer yet)'}`,
      },
    ]

    this.inflight.add(sessionId)
    useRuntime.getState().setTitling(sessionId, true)
    try {
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), 25_000)
      let streamed = ''
      const result = await this.ctx.llm
        .stream({
          settings: titleSettings,
          model,
          history,
          system: TITLE_SYSTEM,
          mode: 'plan',
          signal: controller.signal,
          handlers: {
            onText: (delta) => {
              streamed += delta
            },
            onReasoning: () => undefined,
            onToolCalls: () => undefined,
            onUsage: () => undefined,
          },
        })
        .finally(() => window.clearTimeout(timer))
      const title = cleanTitle(result.content || streamed)
      const latest = this.ctx.sessions.current(sessionId)
      if (!title || !latest) return null
      if (!force && (latest.titleSource ?? 'auto') !== 'auto') return null
      this.ctx.sessions.updateSession(sessionId, { title, titleSource: 'ai' })
      return title
    } catch {
      return null
    } finally {
      this.inflight.delete(sessionId)
      useRuntime.getState().setTitling(sessionId, false)
    }
  }
}

export function sessionTitleSource(sessionId: string) {
  return useChats.getState().sessions.find((session) => session.id === sessionId)?.titleSource
}
