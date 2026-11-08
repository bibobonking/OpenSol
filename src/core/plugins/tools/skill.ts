import type { Context } from 'cordis'
import { executeDaemonTool } from '../../../lib/daemon'
import type { Skill } from '../../../types'
import type { ToolResult } from '../../types'

function findSkill(skills: Skill[], name: string): Skill | undefined {
  const clean = name.trim().toLowerCase()
  return skills.find((skill) => skill.id.toLowerCase() === clean || skill.name.toLowerCase() === clean)
}

function text(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === 'string' ? String(args[key]).trim() : ''
}

export const name = 'tool-skill'
export const inject = ['tools']

export function apply(ctx: Context) {
  const unregister = ctx.tools.register({
    name: 'skill',
    description:
      'Work with installed skills. Use action "list" to see them, "read" to load a skill’s SKILL.md, and "run" to execute a command inside the skill folder.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'read', 'run'], description: 'What to do.' },
        name: { type: 'string', description: 'Skill id or name. Required for read and run.' },
        command: { type: 'string', description: 'Shell command to run inside the skill folder. Required for run.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    allowedInMode: () => true,
    async execute(args, exec): Promise<ToolResult> {
      const skills = exec.settings.skills.filter((skill) => skill.enabled)
      const action = text(args, 'action') || 'list'

      if (action === 'list') {
        if (skills.length === 0) return { output: 'No skills are installed.', isError: false }
        return {
          output: skills
            .map((skill) => `${skill.name} (${skill.id})${skill.package ? ` · ${skill.package}` : ''}\n  ${skill.description}`)
            .join('\n'),
          isError: false,
        }
      }

      const target = findSkill(skills, text(args, 'name'))
      if (!target) {
        return {
          output: `No enabled skill matches "${text(args, 'name')}". Call action "list" to see the available skills.`,
          isError: true,
        }
      }

      if (action === 'read') {
        const files = Object.keys(target.files ?? {})
        return {
          output: [
            `# ${target.name}`,
            target.description,
            target.package ? `Package: ${target.package}` : '',
            files.length > 0 ? `Files:\n${files.map((file) => `- ${file}`).join('\n')}` : '',
            '---',
            target.instructions.trim() || 'This skill has no instructions.',
          ]
            .filter(Boolean)
            .join('\n\n'),
          isError: false,
        }
      }

      if (action === 'run') {
        if (exec.mode === 'plan') {
          return { output: 'Plan mode is read-only: skill scripts may change the machine, so they cannot run here.', isError: true }
        }
        const command = text(args, 'command')
        if (!command) return { output: 'Pass the command to run inside the skill folder.', isError: true }
        if (!target.files || Object.keys(target.files).length === 0) {
          return { output: `"${target.name}" has no files to run. Install it from a folder or npm.`, isError: true }
        }
        const result = (await executeDaemonTool(
          'skill_run',
          { name: target.id, files: target.files, command },
          exec.mode,
          exec.signal,
        )).result as { stdout?: string; stderr?: string; code?: number }
        const code = typeof result.code === 'number' ? result.code : 1
        const body = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
        return {
          output: body || `The skill command exited with code ${code} and printed nothing.`,
          isError: code !== 0,
        }
      }

      return { output: `Unknown skill action "${action}". Use list, read or run.`, isError: true }
    },
  })

  return () => unregister()
}
