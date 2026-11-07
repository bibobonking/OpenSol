import { Service, type Context } from 'cordis'
import { runSubagent } from '../../agent/subagent'

export class SubagentService extends Service {
  static provide = 'subagents'
  static inject = ['tools', 'llm', 'systemPrompt']

  constructor(ctx: Context) {
    super(ctx, 'subagents')
  }

  async run(task: string, context: string, signal: AbortSignal): Promise<string> {
    return await runSubagent(task, context, signal)
  }
}
