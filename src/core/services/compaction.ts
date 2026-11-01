import { Service, type Context } from 'cordis'
import { compactSession, isCompacting } from '../../agent/compact'
import { contextUsageRatio, AUTO_COMPACT_THRESHOLD } from '../../lib/context'
import { findModel } from '../../store/models'
import { activeModelId, useSettings } from '../../store/settings'
import { useChats } from '../../store/chats'

export class CompactionService extends Service {
  static provide = 'compaction'
  static inject = ['sessions', 'llm']

  constructor(ctx: Context) {
    super(ctx, 'compaction')
  }

  isCompacting(sessionId: string): boolean {
    return isCompacting(sessionId)
  }

  async compact(sessionId: string): Promise<boolean> {
    return await compactSession(sessionId)
  }

  async checkAutoCompact(sessionId: string): Promise<boolean> {
    const session = useChats.getState().sessions.find((item) => item.id === sessionId)
    if (!session || session.messages.length < 4 || this.isCompacting(sessionId)) return false

    const settings = useSettings.getState()
    const modelInfo = findModel(settings.provider, activeModelId(settings))
    const ratio = contextUsageRatio(session.messages, modelInfo)

    if (ratio >= AUTO_COMPACT_THRESHOLD) {
      window.dispatchEvent(
        new CustomEvent('maxcode:notice', {
          detail: {
            message: `Context at ${Math.round(ratio * 100)}% — compacting session before next request…`,
            tone: 'info',
          },
        }),
      )
      return await this.compact(sessionId)
    }
    return false
  }
}
