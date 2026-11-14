import { Service, type Context } from 'cordis'
import type { AgentMode, AppSettings } from '../../types'
import { activeModelId } from '../../store/settings'
import { useWorkspace } from '../../store/workspace'
import { skillCatalogPrompt } from '../../store/skills'
import { resolveBasePrompt } from '../../lib/system-prompt'
import { useSettings } from '../../store/settings'
import type { PromptSection } from '../types'
import { SUBAGENT_TYPES, type SubagentType } from '../../lib/subagent-types'

function environmentContext(): string {
  const daemon = useSettings.getState().daemon
  const os = daemon?.os ?? ''
  const shell = daemon?.shell ?? ''
  if (!os && !shell) return ''
  const guide =
    os === 'win32'
      ? [
          '- Commands run in PowerShell, not bash. Use PowerShell syntax: `Get-ChildItem`, `Get-Content`, `Select-String`, `$env:NAME`, `;` (not `&&` on Windows PowerShell 5).',
          '- Do not assume `ls -la`, `grep`, `sed`, `cat <<EOF` or `export` exist. Paths may use `\\` or `/`; quote paths that contain spaces.',
        ]
      : os === 'darwin'
        ? [
            '- Commands run in a login shell on macOS (BSD userland). `sed -i` needs an argument (`sed -i \'\'`), `date`, `xargs` and `grep` differ from GNU; prefer portable flags or the dedicated file tools.',
          ]
        : os === 'linux'
          ? ['- Commands run in bash with GNU userland.']
          : []
  return ['## Environment', `- OS: ${os || 'unknown'}${daemon?.arch ? ` (${daemon.arch})` : ''}`, `- Shell: ${shell || 'unknown'}`, ...guide].join('\n')
}

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
  static inject = ['sessions']
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

  assemble(settings: AppSettings, mode: AgentMode = settings.mode, sessionId?: string): string {
    const sections: PromptSection[] = []

    // 1. Base instruction
    // Session prompt beats workspace prompt beats the app-wide one.
    const workspaceState = useWorkspace.getState()
    const session = sessionId ? this.ctx.sessions.current(sessionId) : undefined
    const base = resolveBasePrompt(settings, session, workspaceState.root || workspaceState.info.root)
    if (base.text.trim()) {
      sections.push({ name: 'base', priority: 10, content: base.text.trim() })
    }

    // 2. Skill catalog (names + descriptions; bodies load on demand through the skill tool)
    const catalog = skillCatalogPrompt()
    if (catalog && settings.tools.skill?.enabled !== false) {
      sections.push({ name: 'skills', priority: 20, content: catalog })
    }

    // 3. Workspace
    sections.push({
      name: 'workspace',
      priority: 30,
      content: [
        '## Workspace',
        'You operate on the real folder below through the local OpenSol daemon. Tools return real output; never invent file contents, command results, URLs or deployments.',
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

    // 3c. Operating system and shell
    const environment = environmentContext()
    if (environment) sections.push({ name: 'environment', priority: 38, content: environment })

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
              '- Finish with a concrete, ordered implementation plan naming files and functions. State assumptions plainly; settle open decisions with `ask_question` before writing the final plan when it is available.',
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
        '- For a game, demo, landing page or visual prototype that does not need a project folder, reply with ONE self-contained HTML file in a single ```html code block (inline CSS and JS). OpenSol renders that block as a live, sandboxed preview, so it must run with no build step and no calls to localhost. Load libraries only from https://cdnjs.cloudflare.com or https://cdn.jsdelivr.net with a pinned version.',
        '- With a folder open in Build mode, write real files with the tools instead of pasting large code into the chat, then say how to run them.',
        '- Deliver something that runs first, then improve it in small steps based on what the user sees. Keep explanations to a few sentences; the code is the answer.',
        '- If something needs an API key, a server or an asset you cannot create, say so plainly instead of faking it.',
      ].join('\n'),
    })

    // 4c. Asking the user
    if (settings.tools.ask_question?.enabled !== false) {
      sections.push({
        name: 'ask-question',
        priority: 47,
        content: [
          '## Asking the user',
          '- Use `ask_question` when the request is ambiguous, when there are real alternatives with different trade-offs, or before a costly or irreversible step. Do not ask what you can learn by reading the project, and do not ask about trivial choices.',
          '- Put every question you have in ONE call (up to 8), each with 2–6 clear options, a short `header` and `multiSelect: true` when several options can apply. Put the recommended option first and end its label with "(Recommended)". Add a one-sentence `description` under an option when its meaning or trade-off is not obvious.',
          '- Never add an "Other" option: the interface already gives every question a free-text field. Treat typed text as the answer.',
          '- After the answers arrive, continue the work; do not repeat the questions. If the user skips, use your best judgment and say which assumption you made.',
        ].join('\n'),
      })
    }

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

  buildSubagentPrompt(settings: AppSettings, sessionId?: string, type: SubagentType = 'explore'): string {
    const spec = SUBAGENT_TYPES[type]
    return [
      this.assemble(settings, 'plan', sessionId),
      [
        `## Subagent (${spec.label})`,
        'You are a focused, read-only investigator working for the main agent. You cannot ask the user questions and cannot start other subagents.',
        '- Work only on the assigned task. Do not edit files, change git state or run commands that mutate the machine; the daemon enforces this.',
        ...spec.guidance.map((line) => `- ${line}`),
        '- Be efficient: you have a limited number of rounds. Batch independent tool calls in one round.',
        '- Finish with a concise report: the answer first, then evidence (paths, lines, URLs), then open questions. Do not repeat the task. Do not invent evidence; say what could not be verified.',
      ].join('\n'),
    ].join('\n\n')
  }
}
