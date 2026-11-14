import { Service, type Context } from 'cordis'
import type { ChatSession, Message } from '../../types'
import { useChats } from '../../store/chats'
import { turnHistory as extractTurnHistory } from '../../agent/queue'

export class SessionService extends Service {
  static provide = 'sessions'

  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  current(sessionId: string): ChatSession | undefined {
    return useChats.getState().sessions.find((s) => s.id === sessionId)
  }

  all(): ChatSession[] {
    return useChats.getState().sessions
  }

  getMessages(sessionId: string): Message[] {
    return this.current(sessionId)?.messages ?? []
  }

  addMessage(sessionId: string, message: Message): void {
    useChats.getState().addMessage(sessionId, message)
    void this.flush(sessionId)
  }

  updateMessage(sessionId: string, messageId: string, patch: Partial<Message>): void {
    useChats.getState().updateMessage(sessionId, messageId, patch)
    void this.flush(sessionId)
  }

  updateSession(sessionId: string, patch: Partial<ChatSession>): void {
    useChats.getState().updateSession(sessionId, patch)
    void this.flush(sessionId)
  }

  turnHistory(messages: Message[], userMessageId: string): Message[] | null {
    return extractTurnHistory(messages, userMessageId)
  }

  async flush(sessionId: string): Promise<void> {
    await this.ctx.events.parallel('session/flush', sessionId).catch(() => undefined)
  }
}
