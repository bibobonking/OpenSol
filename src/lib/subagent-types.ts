import type { ToolName } from '../types'

export type SubagentType = 'explore' | 'research' | 'review'

export interface SubagentSpec {
  label: string
  /** One line for the main agent's tool description. */
  summary: string
  /** Built-in tools this kind of subagent may call. All are read-only in Plan mode. */
  tools: ToolName[]
  /** Hard cap on model rounds; the subagent is then forced to report. */
  maxRounds: number
  guidance: string[]
}

export const SUBAGENT_TYPES: Record<SubagentType, SubagentSpec> = {
  explore: {
    label: 'Explore',
    summary: 'fast, local: find where something lives, trace a flow or a bug through the codebase',
    tools: ['read_file', 'list_files', 'grep', 'shell', 'git', 'skill'],
    maxRounds: 24,
    guidance: [
      'Search wide first (grep, list_files), then read only the files that matter.',
      'Run independent searches in the same round instead of one after another.',
      'Report exact paths with line numbers and a short quote or code reference for each claim.',
    ],
  },
  research: {
    label: 'Research',
    summary: 'look things up on the web (docs, release notes, errors) and cross-check with the local code',
    tools: ['read_file', 'list_files', 'grep', 'web_search', 'read_url', 'skill'],
    maxRounds: 18,
    guidance: [
      'Prefer primary sources (official docs, changelogs, source repositories). Open the pages you cite.',
      'Cross-check important claims with a second source or with the local code.',
      'Report each finding with its URL, and say plainly what you could not confirm.',
    ],
  },
  review: {
    label: 'Review',
    summary: 'critically review code or a diff for bugs, regressions, missing tests and risky changes',
    tools: ['read_file', 'list_files', 'grep', 'shell', 'git', 'skill'],
    maxRounds: 30,
    guidance: [
      'Start from `git status` and `git diff` when the task is about recent changes; otherwise read the named files.',
      'Check call sites and edge cases, not just the changed lines. Verify a suspected bug by reading the code it touches.',
      'Report findings ordered by severity, each with file:line, why it is a problem and a concrete fix. Say "no issues found" if that is the truth.',
    ],
  },
}

export function subagentType(value: unknown): SubagentType {
  return value === 'research' || value === 'review' ? value : 'explore'
}
