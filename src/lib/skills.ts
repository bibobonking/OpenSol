import type { Skill } from '../types'

const TEXT_FILE = /\.(md|markdown|txt|json|ya?ml|toml|js|mjs|cjs|ts|tsx|jsx|py|sh|bash|zsh|css|html|xml|csv)$/i
const MAX_FILE = 512 * 1024
const MAX_TOTAL = 4 * 1024 * 1024
const MAX_FILES = 200

export interface ParsedSkill {
  name: string
  description: string
  instructions: string
}

/** Read the optional YAML frontmatter, then the first heading and paragraph. */
export function parseSkillMarkdown(markdown: string, fallbackName: string): ParsedSkill {
  const text = String(markdown ?? '').replace(/\r\n/g, '\n')
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  const meta: Record<string, string> = {}
  let body = text
  if (front) {
    for (const line of front[1].split('\n')) {
      const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim())
      if (match) meta[match[1].toLowerCase()] = match[2].replace(/^["']|["']$/g, '').trim()
    }
    body = text.slice(front[0].length)
  }
  const heading = /^#\s+(.+)$/m.exec(body)
  const paragraph = body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith('#') && !part.startsWith('---'))
  return {
    name: meta.name || heading?.[1]?.trim() || fallbackName,
    description: (meta.description || paragraph || 'Installed from a folder')
      .replace(/[#>*`]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 200),
    instructions: body.trim(),
  }
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'skill'
  )
}

type FolderFile = { path: string; text: string }

function pickSkillPath(files: FolderFile[]) {
  const candidates = files.filter((file) => /(^|\/)SKILL\.md$/i.test(file.path))
  candidates.sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
  return candidates[0]?.path ?? ''
}

/** Turn a folder upload into a skill. Files stay in settings so the skill tool can run them. */
export async function skillFromFolder(files: File[]): Promise<Skill> {
  const queue = files.slice(0, MAX_FILES)
  const read: FolderFile[] = []
  let total = 0
  for (const file of queue) {
    const path = file.webkitRelativePath || file.name
    if (file.size > MAX_FILE || !TEXT_FILE.test(path)) continue
    if (total + file.size > MAX_TOTAL) break
    const text = await file.text()
    total += text.length
    read.push({ path, text })
  }
  if (read.length === 0) throw new Error('That folder has no readable text files.')
  const skillPath = pickSkillPath(read)
  if (!skillPath) throw new Error('That folder has no SKILL.md.')
  // Strip the folder the user picked so paths are relative to the skill root.
  const rootMatch = /^(.*?)\//.exec(skillPath)
  const root = rootMatch?.[1] ?? ''
  const scoped = read
    .filter((file) => !root || file.path === root || file.path.startsWith(`${root}/`))
    .map((file) => ({ path: root ? file.path.slice(root.length + 1) : file.path, text: file.text }))
  const manifest = scoped.find((file) => /^SKILL\.md$/i.test(file.path)) ?? scoped[0]
  const parsed = parseSkillMarkdown(manifest.text, root.split('/').pop() || 'skill')
  return {
    id: `skill_${slug(parsed.name)}`,
    name: parsed.name,
    description: parsed.description,
    instructions: parsed.instructions,
    enabled: true,
    source: 'folder',
    files: Object.fromEntries(scoped.map((file) => [file.path, file.text])),
  }
}
