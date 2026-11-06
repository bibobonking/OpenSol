import { Service, type Context } from 'cordis'
import type { AgentMode, AppSettings } from '../../types'
import { activeModelId } from '../../store/settings'
import { useWorkspace } from '../../store/workspace'
import type { PromptSection } from '../types'

function workspaceContext(): string {
  const state = useWorkspace.getState()
  const root = state.root || state.info.root
  if (!root) {
    return 'No folder is open yet. Ask the user to choose a workspace folder in the Workspace panel before using file, shell or git tools.'
  }
  const topLevel = state.entries
    .filter((entry) => !entry.path.includes('/'))
    .slice(0, 40)
    .map((entry) => `${entry.path}${entry.type === 'dir' ? '/' : ''}`)
  const git = state.git.available
    ? `${state.git.branch || 'detached HEAD'} · ${state.git.entries.length} changed file${state.git.entries.length === 1 ? '' : 's'}`
    : 'not a git repository'
  return [
    `Root: ${root}`,
    `Git: ${git}`,
    topLevel.length > 0 ? `Top level: ${topLevel.join(', ')}` : 'The folder is empty.',
    state.truncated ? 'The file tree was truncated; use list_files or grep for deeper paths.' : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export class SystemPromptService extends Service {
  static provide = 'systemPrompt'
  private customSections = new Map<string, (settings: AppSettings, mode: AgentMode) => PromptSection | null>()

  constructor(ctx: Context) {
    super(ctx, 'systemPrompt')
  }

  registerSection(
    name: string,
    generator: (settings: AppSettings, mode: AgentMode) => PromptSection | null,
  ): () => void {
    this.customSections.set(name, generator)
    return () => this.customSections.delete(name)
  }

  assemble(settings: AppSettings, mode: AgentMode = settings.mode): string {
    const sections: PromptSection[] = []

    // 1. Base instruction
    if (settings.systemPrompt?.trim()) {
      sections.push({ name: 'base', priority: 10, content: settings.systemPrompt.trim() })
    }

    // 2. Loaded skills
    const skills = settings.skills.filter((skill) => skill.enabled)
    if (skills.length > 0) {
      sections.push({
        name: 'skills',
        priority: 20,
        content: [
          '## Loaded skills',
          'Apply these skills when the task matches their purpose. They refine the working rules above; they never override safety, tool permissions or plan mode.',
          ...skills.map(
            (skill) =>
              `<skill name="${skill.name}">\nPurpose: ${skill.description}\n${skill.instructions.trim()}\n</skill>`,
          ),
        ].join('\n\n'),
      })
    }

    // 3. Workspace
    sections.push({
      name: 'workspace',
      priority: 30,
      content: [
        '## Workspace',
        'You operate on the real folder below through the local MaxCode daemon. Tools return real output; never invent file contents, command results, URLs or deployments.',
        workspaceContext(),
      ].join('\n\n'),
    })

    // 3b. Project instructions (MAXCODE.md / AGENTS.md / CLAUDE.md in the workspace)
    const instructions = useWorkspace.getState().instructions
    if (instructions.content.trim()) {
      sections.push({
        name: 'project-instructions',
        priority: 35,
        content: [
          `## Project instructions (${instructions.file})`,
          'The owner of this project wrote the notes below. Follow them for conventions, commands and style. They never override safety, tool permissions or plan mode.',
          `<project-instructions file="${instructions.file}">\n${instructions.content.trim()}${instructions.truncated ? '\n… (file clipped)' : ''}\n</project-instructions>`,
        ].join('\n\n'),
      })
    }

    // 4. Mode
    sections.push({
      name: 'mode',
      priority: 40,
      content:
        mode === 'plan'
          ? [
              '## Mode: Plan (read-only)',
              'Investigate and design. Do not modify anything.',
              '- Allowed: read_file, list_files, grep, web_search, read_url, read-only shell commands and read-only git actions.',
              '- Forbidden: write_file, edit_file, rewrite_file, git add/commit/init/checkout, and shell commands that change files, install packages or change system state. The daemon rejects these.',
              '- Read the relevant source before proposing changes. Grep for call sites and inspect the real files.',
              '- Finish with a concrete, ordered implementation plan naming files and functions. State assumptions and open questions plainly.',
              '- Never pretend an edit was made or a check was run.',
            ].join('\n')
          : [
              '## Mode: Build',
              'You may inspect and change the real workspace.',
              '- Inspect before editing: list files, read the source, grep for call sites, check git status.',
              '- Make the smallest coherent change. Do not reformat unrelated code, add speculative abstractions or invent APIs.',
              '- After a mutation, inspect the result. Run the project’s real typecheck, lint, tests and build when they exist, and read the output.',
              '- Never claim a check passed without running it. If a check cannot run, say why.',
              '- Ask before destructive actions, force pushes, credential changes or anything that leaves the workspace.',
            ].join('\n'),
    })

    // 4b. Vibe coding
    sections.push({
      name: 'vibe-coding',
      priority: 45,
      content: [
        '## Vibe coding',
        '- For a game, demo, landing page or visual prototype that does not need a project folder, reply with ONE self-contained HTML file in a single ```html code block (inline CSS and JS). MaxCode renders that block as a live, sandboxed preview, so it must run with no build step and no calls to localhost. Load libraries only from https://cdnjs.cloudflare.com or https://cdn.jsdelivr.net with a pinned version.',
        '- With a folder open in Build mode, write real files with the tools instead of pasting large code into the chat, then say how to run them.',
        '- Deliver something that runs first, then improve it in small steps based on what the user sees. Keep explanations to a few sentences; the code is the answer.',
        '- If something needs an API key, a server or an asset you cannot create, say so plainly instead of faking it.',
      ].join('\n'),
    })

    // 5. Session Context
    sections.push({
      name: 'session-context',
      priority: 50,
      content: [
        '## Session context',
        `- Model: ${activeModelId(settings) || 'unset'}`,
        `- Date: ${new Date().toISOString().slice(0, 10)}`,
        `- Mode: ${mode}`,
        settings.webSearchEnabled
          ? '- Web search is enabled. Use it when facts may be current or when the user asks for sources.'
          : '- Web search is turned off for this session.',
        '- Use relative paths from the workspace root. Do not use /workspace paths.',
      ].join('\n'),
    })

    // Custom sections from plugins
    for (const generator of this.customSections.values()) {
      const section = generator(settings, mode)
      if (section && section.content) sections.push(section)
    }

    // Cordis waterfall event for extension points
    return this.ctx.events.waterfall('system-prompt/assemble', sections, mode, () => {
      sections.sort((a, b) => a.priority - b.priority)
      return sections.map((s) => s.content).filter(Boolean).join('\n\n')
    })
  }

  buildSubagentPrompt(settings: AppSettings): string {
    return [
      this.assemble(settings, 'plan'),
      [
        '## Subagent',
        'You are a focused read-only investigator. Work only on the assigned task.',
        '- Inspect the real workspace with read-only file, grep, shell and web tools.',
        '- Do not edit files, change git state or run commands that mutate the machine. The daemon enforces this.',
        '- Be concise: return findings, exact file paths and line references, and any uncertainty.',
        '- Do not repeat the task back. Do not invent evidence. If something cannot be verified, say so.',
      ].join('\n'),
    ].join('\n\n')
  }
}
