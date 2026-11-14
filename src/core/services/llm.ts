import { Service, type Context } from 'cordis'
import type { AdapterResult } from '../../agent/adapters/shared'
import { streamAnthropic } from '../../agent/adapters/anthropic'
import { streamGemini } from '../../agent/adapters/gemini'
import { streamOpenAI } from '../../agent/adapters/openai'
import { streamOpenAIResponses } from '../../agent/adapters/openai-responses'
import { apiKindFor } from '../../store/models'
import type { ModelRequest, ToolSchema } from '../types'

export class LlmService extends Service {
  static provide = 'llm'
  static inject = ['tools']

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  async stream(input: ModelRequest): Promise<AdapterResult> {
    const request: ModelRequest & { tools: ToolSchema[] } = {
      ...input,
      tools: input.tools ?? this.ctx.tools.schemas(input.settings, input.mode),
    }
    return await this.ctx.events.waterfall('agent/request', request, async () => {
      const kind = apiKindFor(request.settings.provider, request.settings.model, request.model)
      switch (kind) {
        case 'anthropic':
          return await streamAnthropic(request)
        case 'gemini':
          return await streamGemini(request)
        case 'openai-responses':
          return await streamOpenAIResponses(request)
        default:
          return await streamOpenAI(request)
      }
    })
  }
}
