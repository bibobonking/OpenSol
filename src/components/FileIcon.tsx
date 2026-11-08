import type { LucideIcon } from 'lucide-react'
import {
  Braces,
  FileArchive,
  FileAudio,
  FileCode2,
  FileCog,
  FileImage,
  FileKey2,
  FileLock2,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Palette,
  Terminal,
} from 'lucide-react'
import { cn } from '../lib/utils'

const TYPES: Record<string, { icon: LucideIcon; tone: string }> = {
  ts: { icon: FileCode2, tone: 'text-sky-500' },
  tsx: { icon: FileCode2, tone: 'text-sky-500' },
  js: { icon: FileCode2, tone: 'text-amber-400' },
  jsx: { icon: FileCode2, tone: 'text-amber-400' },
  mjs: { icon: FileCode2, tone: 'text-amber-400' },
  cjs: { icon: FileCode2, tone: 'text-amber-400' },
  rs: { icon: FileCode2, tone: 'text-orange-400' },
  go: { icon: FileCode2, tone: 'text-cyan-400' },
  py: { icon: FileCode2, tone: 'text-emerald-400' },
  rb: { icon: FileCode2, tone: 'text-rose-400' },
  java: { icon: FileCode2, tone: 'text-red-400' },
  css: { icon: Palette, tone: 'text-fuchsia-400' },
  scss: { icon: Palette, tone: 'text-pink-400' },
  sass: { icon: Palette, tone: 'text-pink-400' },
  less: { icon: Palette, tone: 'text-pink-400' },
  html: { icon: FileCode2, tone: 'text-orange-500' },
  vue: { icon: FileCode2, tone: 'text-emerald-500' },
  svelte: { icon: FileCode2, tone: 'text-orange-500' },
  json: { icon: Braces, tone: 'text-yellow-500' },
  jsonc: { icon: Braces, tone: 'text-yellow-500' },
  yaml: { icon: FileCog, tone: 'text-teal-400' },
  yml: { icon: FileCog, tone: 'text-teal-400' },
  toml: { icon: FileCog, tone: 'text-teal-400' },
  ini: { icon: FileCog, tone: 'text-teal-400' },
  env: { icon: FileKey2, tone: 'text-amber-500' },
  md: { icon: FileText, tone: 'text-violet-400' },
  mdx: { icon: FileText, tone: 'text-violet-400' },
  txt: { icon: FileText, tone: 'text-slate-400' },
  csv: { icon: FileText, tone: 'text-emerald-400' },
  svg: { icon: FileImage, tone: 'text-purple-400' },
  png: { icon: FileImage, tone: 'text-purple-400' },
  jpg: { icon: FileImage, tone: 'text-purple-400' },
  jpeg: { icon: FileImage, tone: 'text-purple-400' },
  gif: { icon: FileImage, tone: 'text-purple-400' },
  webp: { icon: FileImage, tone: 'text-purple-400' },
  ico: { icon: FileImage, tone: 'text-purple-400' },
  mp3: { icon: FileAudio, tone: 'text-rose-400' },
  wav: { icon: FileAudio, tone: 'text-rose-400' },
  mp4: { icon: FileVideo, tone: 'text-rose-400' },
  mov: { icon: FileVideo, tone: 'text-rose-400' },
  zip: { icon: FileArchive, tone: 'text-amber-500' },
  gz: { icon: FileArchive, tone: 'text-amber-500' },
  tar: { icon: FileArchive, tone: 'text-amber-500' },
  lock: { icon: FileLock2, tone: 'text-slate-400' },
  sh: { icon: Terminal, tone: 'text-emerald-400' },
  bash: { icon: Terminal, tone: 'text-emerald-400' },
  zsh: { icon: Terminal, tone: 'text-emerald-400' },
  sql: { icon: FileText, tone: 'text-cyan-400' },
}

const SPECIAL: Array<{ match: RegExp; icon: LucideIcon; tone: string }> = [
  { match: /^(dockerfile|makefile|justfile)$/i, icon: FileCog, tone: 'text-sky-400' },
  { match: /^\.env/i, icon: FileKey2, tone: 'text-amber-500' },
  { match: /^(\.gitignore|\.gitattributes|\.npmignore|\.dockerignore)$/i, icon: FileCog, tone: 'text-slate-400' },
  { match: /^package(-lock)?\.json$/i, icon: Braces, tone: 'text-emerald-400' },
  { match: /^(vite|webpack|rollup|tsconfig|tailwind|postcss)\./i, icon: FileCog, tone: 'text-sky-400' },
  { match: /^readme/i, icon: FileText, tone: 'text-violet-400' },
  { match: /^skill\.md$/i, icon: FileText, tone: 'text-accent' },
]

export function fileTone(path: string): { icon: LucideIcon; tone: string } {
  const name = path.split('/').pop() ?? path
  const special = SPECIAL.find((entry) => entry.match.test(name))
  if (special) return { icon: special.icon, tone: special.tone }
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ''
  return TYPES[extension] ?? { icon: FileText, tone: 'text-faint' }
}

export function FileIcon({
  path,
  type = 'file',
  open = false,
  size = 13,
  className,
}: {
  path: string
  type?: 'file' | 'dir' | 'link'
  open?: boolean
  size?: number
  className?: string
}) {
  if (type === 'dir') {
    const Icon = open ? FolderOpen : Folder
    return <Icon size={size} className={cn('shrink-0 fill-amber-400/25 text-amber-500', className)} />
  }
  const { icon: Icon, tone } = fileTone(path)
  return <Icon size={size} className={cn('shrink-0', tone, className)} />
}
