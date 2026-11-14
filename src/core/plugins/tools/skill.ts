import type { Context } from 'cordis'
import { readSkillApi } from '../../../lib/daemon'
import type { ToolResult } from '../../types'

const MAX_TOOL_OUTPUT = 60_000

export const name = 'tool-skill'
export const inject = ['tools']

export function apply(ctx: Context) {
  return ctx.tools.register({
    name: 'skill',
    description:
      'Load an installed skill by name. With only `name` it returns the skill\'s SKILL.md instructions and the list of bundled files. Pass `file` (relative path, e.g. "references/api.md") to read one bundled file. Skill scripts can be run with the shell tool from the returned directory.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name from the Skills list in the system prompt.' },
        file: { type: 'string', description: 'Optional bundled file to read, relative to the skill folder.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    allowedInMode: () => true,
    async execute(args): Promise<ToolResult> {
      const skillName = typeof args.name === 'string' ? args.name.trim() : ''
      if (!skillName) return { output: 'Missing string argument "name".', isError: true }
      try {
        const result = await readSkillApi(skillName, typeof args.file === 'string' ? args.file : undefined)
        const parts = [`Skill: ${result.name} · ${result.file}`, `Directory: ${result.directory}`, '────', result.content]
        if (result.files && result.files.length > 0) {
          parts.push('────', `Bundled files (read with this tool's "file" argument):\n${result.files.map((item) => `- ${item}`).join('\n')}`)
        }
        const text = parts.join('\n')
        return {
          output: text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n… truncated` : text,
          isError: false,
        }
      } catch (error) {
        return { output: error instanceof Error ? error.message : 'Could not load the skill.', isError: true }
      }
    },
  })
}
