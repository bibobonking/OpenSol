import { Context } from 'cordis'
import './types'
import { SessionService } from './services/sessions'
import { SystemPromptService } from './services/system-prompt'
import { ToolService } from './services/tools'
import { ApprovalService } from './services/approval'
import { LlmService } from './services/llm'
import { CompactionService } from './services/compaction'
import { SubagentService } from './services/subagents'
import { UiService } from './services/ui'
import { AgentLoopService } from './services/agent-loop'
import { TitleService } from './services/titles'

import * as toolFs from './plugins/tools/fs'
import * as toolShell from './plugins/tools/shell'
import * as toolGrep from './plugins/tools/grep'
import * as toolGit from './plugins/tools/git'
import * as toolWeb from './plugins/tools/web'
import * as toolSubagent from './plugins/tools/subagent'
import * as toolSkill from './plugins/tools/skill'

export function createAppKernel(): Context {
  const ctx = new Context()

  // 1. Mount Core Services
  ctx.plugin(SessionService)
  ctx.plugin(SystemPromptService)
  ctx.plugin(ToolService)
  ctx.plugin(ApprovalService)
  ctx.plugin(LlmService)
  ctx.plugin(CompactionService)
  ctx.plugin(SubagentService)
  ctx.plugin(UiService)
  ctx.plugin(AgentLoopService)
  ctx.plugin(TitleService)

  // 2. Mount First-Party Tool Plugins
  ctx.plugin(toolFs)
  ctx.plugin(toolShell)
  ctx.plugin(toolGrep)
  ctx.plugin(toolGit)
  ctx.plugin(toolWeb)
  ctx.plugin(toolSubagent)
  ctx.plugin(toolSkill)

  return ctx
}

export const kernel = createAppKernel()
