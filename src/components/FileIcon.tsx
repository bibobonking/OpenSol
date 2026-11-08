import { useId } from 'react'
import { cn } from '../lib/utils'

/**
 * Coloured file and folder icons. Colours are fixed per file type (like an editor's icon theme),
 * so they read the same in every app theme.
 */

interface FileKind {
  color: string
  /** Short mark printed on the badge. */
  label?: string
  /** A drawn glyph instead of a text label. */
  glyph?: 'image' | 'video' | 'audio' | 'archive' | 'lock' | 'gear' | 'terminal' | 'font' | 'db' | 'text' | 'braces' | 'tag'
}

const EXT: Record<string, FileKind> = {
  ts: { color: '#3178c6', label: 'TS' },
  tsx: { color: '#2d9fd8', label: 'TSX' },
  js: { color: '#f0c808', label: 'JS' },
  mjs: { color: '#f0c808', label: 'MJS' },
  cjs: { color: '#f0c808', label: 'CJS' },
  jsx: { color: '#e6b800', label: 'JSX' },
  json: { color: '#f59e0b', glyph: 'braces' },
  jsonc: { color: '#f59e0b', glyph: 'braces' },
  json5: { color: '#f59e0b', glyph: 'braces' },
  html: { color: '#e5532d', label: 'HTML' },
  htm: { color: '#e5532d', label: 'HTML' },
  css: { color: '#3b82f6', label: 'CSS' },
  scss: { color: '#cf649a', label: 'SCSS' },
  sass: { color: '#cf649a', label: 'SASS' },
  less: { color: '#2b4c80', label: 'LESS' },
  md: { color: '#4f8fd8', label: 'MD' },
  mdx: { color: '#f9ac00', label: 'MDX' },
  py: { color: '#3b78b0', label: 'PY' },
  rb: { color: '#cc342d', label: 'RB' },
  go: { color: '#00add8', label: 'GO' },
  rs: { color: '#d36f3b', label: 'RS' },
  java: { color: '#e76f00', label: 'JAVA' },
  kt: { color: '#a97bff', label: 'KT' },
  swift: { color: '#f05138', label: 'SWIFT' },
  c: { color: '#5c8dbc', label: 'C' },
  h: { color: '#8a63d2', label: 'H' },
  cpp: { color: '#3d7fc0', label: 'C++' },
  cs: { color: '#7a4fd0', label: 'C#' },
  php: { color: '#777bb3', label: 'PHP' },
  lua: { color: '#2c2d72', label: 'LUA' },
  dart: { color: '#2bb7f6', label: 'DART' },
  vue: { color: '#41b883', label: 'VUE' },
  svelte: { color: '#ff3e00', label: 'SVLT' },
  astro: { color: '#ff5d01', label: 'ASTRO' },
  sql: { color: '#d4a017', label: 'SQL' },
  graphql: { color: '#e535ab', label: 'GQL' },
  gql: { color: '#e535ab', label: 'GQL' },
  sh: { color: '#4caf50', glyph: 'terminal' },
  bash: { color: '#4caf50', glyph: 'terminal' },
  zsh: { color: '#4caf50', glyph: 'terminal' },
  ps1: { color: '#4a7bd0', glyph: 'terminal' },
  bat: { color: '#4caf50', glyph: 'terminal' },
  yml: { color: '#cb4b4b', label: 'YML' },
  yaml: { color: '#cb4b4b', label: 'YML' },
  toml: { color: '#9c4221', label: 'TOML' },
  xml: { color: '#e37933', label: 'XML' },
  svg: { color: '#ffb13b', glyph: 'image' },
  png: { color: '#26a69a', glyph: 'image' },
  jpg: { color: '#26a69a', glyph: 'image' },
  jpeg: { color: '#26a69a', glyph: 'image' },
  gif: { color: '#26a69a', glyph: 'image' },
  webp: { color: '#26a69a', glyph: 'image' },
  avif: { color: '#26a69a', glyph: 'image' },
  ico: { color: '#26a69a', glyph: 'image' },
  bmp: { color: '#26a69a', glyph: 'image' },
  mp4: { color: '#e05d8c', glyph: 'video' },
  mov: { color: '#e05d8c', glyph: 'video' },
  webm: { color: '#e05d8c', glyph: 'video' },
  mkv: { color: '#e05d8c', glyph: 'video' },
  mp3: { color: '#a855f7', glyph: 'audio' },
  wav: { color: '#a855f7', glyph: 'audio' },
  ogg: { color: '#a855f7', glyph: 'audio' },
  flac: { color: '#a855f7', glyph: 'audio' },
  zip: { color: '#b8860b', glyph: 'archive' },
  tar: { color: '#b8860b', glyph: 'archive' },
  gz: { color: '#b8860b', glyph: 'archive' },
  tgz: { color: '#b8860b', glyph: 'archive' },
  rar: { color: '#b8860b', glyph: 'archive' },
  '7z': { color: '#b8860b', glyph: 'archive' },
  pdf: { color: '#e5484d', label: 'PDF' },
  doc: { color: '#2b6cb0', label: 'DOC' },
  docx: { color: '#2b6cb0', label: 'DOC' },
  xls: { color: '#1f8a4c', label: 'XLS' },
  xlsx: { color: '#1f8a4c', label: 'XLS' },
  csv: { color: '#1f8a4c', label: 'CSV' },
  ppt: { color: '#d35230', label: 'PPT' },
  pptx: { color: '#d35230', label: 'PPT' },
  txt: { color: '#8b95a5', glyph: 'text' },
  log: { color: '#8b95a5', glyph: 'text' },
  env: { color: '#d4b106', glyph: 'gear' },
  ini: { color: '#8b95a5', glyph: 'gear' },
  conf: { color: '#8b95a5', glyph: 'gear' },
  lock: { color: '#8b95a5', glyph: 'lock' },
  ttf: { color: '#c2410c', glyph: 'font' },
  otf: { color: '#c2410c', glyph: 'font' },
  woff: { color: '#c2410c', glyph: 'font' },
  woff2: { color: '#c2410c', glyph: 'font' },
  db: { color: '#6b7fd7', glyph: 'db' },
  sqlite: { color: '#6b7fd7', glyph: 'db' },
  wasm: { color: '#7c4dff', label: 'WASM' },
  ipynb: { color: '#f37726', label: 'IPYNB' },
}

const NAMES: Record<string, FileKind> = {
  'package.json': { color: '#8bc34a', glyph: 'braces' },
  'package-lock.json': { color: '#8b95a5', glyph: 'lock' },
  'tsconfig.json': { color: '#3178c6', glyph: 'gear' },
  'jsconfig.json': { color: '#f0c808', glyph: 'gear' },
  dockerfile: { color: '#2496ed', label: 'DKR' },
  'docker-compose.yml': { color: '#2496ed', label: 'DKR' },
  'docker-compose.yaml': { color: '#2496ed', label: 'DKR' },
  makefile: { color: '#6d8086', glyph: 'terminal' },
  '.gitignore': { color: '#f05133', glyph: 'tag' },
  '.gitattributes': { color: '#f05133', glyph: 'tag' },
  '.npmignore': { color: '#cb3837', glyph: 'tag' },
  '.npmrc': { color: '#cb3837', glyph: 'gear' },
  '.env': { color: '#d4b106', glyph: 'gear' },
  '.editorconfig': { color: '#8b95a5', glyph: 'gear' },
  '.prettierrc': { color: '#56b3b4', glyph: 'gear' },
  '.eslintrc': { color: '#7c7ce0', glyph: 'gear' },
  'vite.config.ts': { color: '#a259ff', glyph: 'gear' },
  'vite.config.js': { color: '#a259ff', glyph: 'gear' },
  'tailwind.config.js': { color: '#38bdf8', glyph: 'gear' },
  'tailwind.config.ts': { color: '#38bdf8', glyph: 'gear' },
  'readme.md': { color: '#42a5f5', label: 'MD' },
  'license': { color: '#d4b106', glyph: 'text' },
  'changelog.md': { color: '#42a5f5', label: 'MD' },
  'claude.md': { color: '#d97757', label: 'MD' },
  'agents.md': { color: '#d97757', label: 'MD' },
}

const DEFAULT_FILE: FileKind = { color: '#8b95a5', glyph: 'text' }

export function fileKind(name: string): FileKind {
  const lower = name.toLowerCase()
  if (NAMES[lower]) return NAMES[lower]
  if (lower.startsWith('.env')) return NAMES['.env']
  if (/\.(test|spec)\.[a-z]+$/.test(lower)) {
    const base = EXT[lower.split('.').pop() ?? '']
    return { color: '#26b36b', label: base?.label ? `${base.label.slice(0, 2)}·T` : 'TEST' }
  }
  if (/\.d\.m?ts$/.test(lower)) return { color: '#3178c6', label: 'D.TS' }
  const dot = lower.lastIndexOf('.')
  if (dot > 0) return EXT[lower.slice(dot + 1)] ?? DEFAULT_FILE
  return DEFAULT_FILE
}

function Glyph({ kind, color }: { kind: NonNullable<FileKind['glyph']>; color: string }) {
  const common = { stroke: color, strokeWidth: 1.25, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' }
  switch (kind) {
    case 'image':
      return (
        <g {...common}>
          <circle cx="6.3" cy="8.3" r="0.9" fill={color} stroke="none" />
          <path d="M3.8 12.4l2.7-2.7 1.6 1.6 1.8-2.3 2.3 3.4z" fill={color} fillOpacity="0.35" />
        </g>
      )
    case 'video':
      return <path d="M6 7.4v4l3.6-2z" fill={color} stroke={color} strokeWidth="0.8" strokeLinejoin="round" />
    case 'audio':
      return (
        <g {...common}>
          <path d="M7.6 12V7.2l3-.8v4.6" />
          <circle cx="6.5" cy="12" r="1.1" fill={color} />
          <circle cx="9.5" cy="11" r="1.1" fill={color} />
        </g>
      )
    case 'archive':
      return (
        <g {...common}>
          <path d="M8 3.5v9" strokeDasharray="1.2 1.2" />
          <rect x="6.8" y="9.6" width="2.4" height="2.4" rx="0.5" fill={color} fillOpacity="0.4" />
        </g>
      )
    case 'lock':
      return (
        <g {...common}>
          <rect x="5.4" y="8.6" width="5.2" height="3.8" rx="0.9" fill={color} fillOpacity="0.3" />
          <path d="M6.4 8.6V7.4a1.6 1.6 0 013.2 0v1.2" />
        </g>
      )
    case 'gear':
      return (
        <g {...common}>
          <circle cx="8" cy="9.6" r="1.4" />
          <path d="M8 6.6v.9M8 11.7v.9M5 9.6h.9M10.1 9.6H11M5.9 7.5l.6.6M9.5 11.1l.6.6M5.9 11.7l.6-.6M9.5 8.1l.6-.6" />
        </g>
      )
    case 'terminal':
      return (
        <g {...common}>
          <path d="M5.2 7.6l2 1.8-2 1.8" />
          <path d="M8.6 12h2.4" />
        </g>
      )
    case 'font':
      return <path d="M5.2 12.4L8 6.4l2.8 6M6.1 10.6h3.8" {...common} />
    case 'db':
      return (
        <g {...common}>
          <ellipse cx="8" cy="7.2" rx="2.7" ry="1.1" />
          <path d="M5.3 7.2v4.4c0 .6 1.2 1.1 2.7 1.1s2.7-.5 2.7-1.1V7.2M5.3 9.4c0 .6 1.2 1.1 2.7 1.1s2.7-.5 2.7-1.1" />
        </g>
      )
    case 'braces':
      return (
        <g {...common}>
          <path d="M6.8 6.6c-1 0-1.3.5-1.3 1.2v.8c0 .6-.4.9-.9 1 .5.1.9.4.9 1v.8c0 .7.3 1.2 1.3 1.2" />
          <path d="M9.2 6.6c1 0 1.3.5 1.3 1.2v.8c0 .6.4.9.9 1-.5.1-.9.4-.9 1v.8c0 .7-.3 1.2-1.3 1.2" />
        </g>
      )
    case 'tag':
      return (
        <g {...common}>
          <path d="M5.6 9.2l2.4-2.4 2.9 2.9L8.5 12z" fill={color} fillOpacity="0.3" />
          <circle cx="8" cy="8.9" r="0.55" fill={color} stroke="none" />
        </g>
      )
    default:
      return (
        <g {...common}>
          <path d="M5.4 7.2h5.2M5.4 9.3h5.2M5.4 11.4h3.2" />
        </g>
      )
  }
}

export function FileIcon({ name, size = 15, className }: { name: string; size?: number; className?: string }) {
  const kind = fileKind(name)
  const gradient = useId()
  const label = kind.label
  const small = label && label.length > 3
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={cn('shrink-0', className)} aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={kind.color} stopOpacity="0.2" />
          <stop offset="1" stopColor={kind.color} stopOpacity="0.07" />
        </linearGradient>
      </defs>
      <path
        d="M3.6 1.4h5.6l3.4 3.4v9a1.2 1.2 0 01-1.2 1.2H3.6a1.2 1.2 0 01-1.2-1.2V2.6a1.2 1.2 0 011.2-1.2z"
        fill={`url(#${gradient})`}
        stroke={kind.color}
        strokeOpacity="0.85"
        strokeWidth="1"
      />
      <path d="M9.2 1.4v2.2a1.2 1.2 0 001.2 1.2h2.2" fill={kind.color} fillOpacity="0.25" stroke={kind.color} strokeOpacity="0.85" strokeWidth="1" strokeLinejoin="round" />
      {label ? (
        <>
          <rect x="2.4" y="9" width="11.2" height="4.4" rx="0.9" fill={kind.color} />
          <text
            x="8"
            y="12.35"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontWeight="800"
            fontSize={small ? 3.3 : 3.9}
            letterSpacing={small ? 0.1 : 0.2}
            fill="#fff"
          >
            {label}
          </text>
        </>
      ) : (
        <Glyph kind={kind.glyph ?? 'text'} color={kind.color} />
      )}
    </svg>
  )
}

interface FolderKind {
  color: string
  glyph?: 'src' | 'git' | 'node' | 'dist' | 'public' | 'test' | 'docs' | 'config' | 'server' | 'components' | 'style' | 'github'
}

const FOLDERS: Record<string, FolderKind> = {
  src: { color: '#3b82f6', glyph: 'src' },
  source: { color: '#3b82f6', glyph: 'src' },
  app: { color: '#3b82f6', glyph: 'src' },
  lib: { color: '#6366f1', glyph: 'src' },
  core: { color: '#6366f1', glyph: 'src' },
  components: { color: '#a855f7', glyph: 'components' },
  component: { color: '#a855f7', glyph: 'components' },
  ui: { color: '#a855f7', glyph: 'components' },
  pages: { color: '#a855f7', glyph: 'components' },
  views: { color: '#a855f7', glyph: 'components' },
  styles: { color: '#ec4899', glyph: 'style' },
  css: { color: '#ec4899', glyph: 'style' },
  node_modules: { color: '#6aa84f', glyph: 'node' },
  '.git': { color: '#f05133', glyph: 'git' },
  '.github': { color: '#8b95a5', glyph: 'github' },
  dist: { color: '#8b95a5', glyph: 'dist' },
  build: { color: '#8b95a5', glyph: 'dist' },
  out: { color: '#8b95a5', glyph: 'dist' },
  '.next': { color: '#8b95a5', glyph: 'dist' },
  public: { color: '#14b8a6', glyph: 'public' },
  static: { color: '#14b8a6', glyph: 'public' },
  assets: { color: '#14b8a6', glyph: 'public' },
  images: { color: '#14b8a6', glyph: 'public' },
  test: { color: '#ef4444', glyph: 'test' },
  tests: { color: '#ef4444', glyph: 'test' },
  __tests__: { color: '#ef4444', glyph: 'test' },
  spec: { color: '#ef4444', glyph: 'test' },
  docs: { color: '#0ea5e9', glyph: 'docs' },
  doc: { color: '#0ea5e9', glyph: 'docs' },
  server: { color: '#6366f1', glyph: 'server' },
  api: { color: '#6366f1', glyph: 'server' },
  scripts: { color: '#22c55e', glyph: 'config' },
  config: { color: '#f59e0b', glyph: 'config' },
  '.claude': { color: '#d97757', glyph: 'config' },
  '.vscode': { color: '#2b8ae8', glyph: 'config' },
}

const DEFAULT_FOLDER: FolderKind = { color: '#e0a526' }

function FolderGlyph({ kind, color }: { kind: NonNullable<FolderKind['glyph']>; color: string }) {
  const p = { stroke: '#fff', strokeWidth: 1.15, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none', opacity: 0.95 }
  void color
  switch (kind) {
    case 'src':
      return <path {...p} d="M6.6 8.4L5.2 9.8l1.4 1.4M9.4 8.4l1.4 1.4-1.4 1.4" />
    case 'git':
      return (
        <g {...p}>
          <circle cx="6.2" cy="11" r="0.8" />
          <circle cx="6.2" cy="8.6" r="0.8" />
          <circle cx="9.8" cy="9.4" r="0.8" />
          <path d="M6.2 9.4v.8M7 8.7c1.6 0 2.1.2 2.1.9" />
        </g>
      )
    case 'node':
      return <path {...p} d="M8 7.6l2.3 1.3v2.4L8 12.6l-2.3-1.3V8.9z" />
    case 'dist':
      return <path {...p} d="M8 7.6v3.6M6.4 9.8L8 11.4l1.6-1.6" />
    case 'public':
      return (
        <g {...p}>
          <circle cx="8" cy="10" r="2.1" />
          <path d="M5.9 10h4.2M8 7.9c.8.6.8 3.6 0 4.2M8 7.9c-.8.6-.8 3.6 0 4.2" />
        </g>
      )
    case 'test':
      return <path {...p} d="M7.1 7.6h1.8M7.4 7.6v1.9l-1.4 2.4h4l-1.4-2.4V7.6" />
    case 'docs':
      return <path {...p} d="M6.2 8h3.6M6.2 9.8h3.6M6.2 11.6h2.2" />
    case 'config':
      return (
        <g {...p}>
          <circle cx="8" cy="9.9" r="1.2" />
          <path d="M8 7.6v.7M8 11.5v.7M5.7 9.9h.7M9.6 9.9h.7" />
        </g>
      )
    case 'server':
      return (
        <g {...p}>
          <rect x="5.7" y="7.6" width="4.6" height="1.7" rx="0.5" />
          <rect x="5.7" y="10.1" width="4.6" height="1.7" rx="0.5" />
        </g>
      )
    case 'components':
      return <path {...p} d="M6 8.2h2v2H6zM8.4 10.6h2v2h-2zM8.4 8.2h2v1.6h-2z" />
    case 'style':
      return <path {...p} d="M8 7.6c1.6 1.4 2.3 2.4 2.3 3.3a2.3 2.3 0 01-4.6 0c0-.9.7-1.9 2.3-3.3z" />
    case 'github':
      return <circle {...p} cx="8" cy="9.9" r="2.1" />
    default:
      return null
  }
}

export function FolderIcon({ name, open = false, size = 16, className }: { name: string; open?: boolean; size?: number; className?: string }) {
  const kind = FOLDERS[name.toLowerCase()] ?? DEFAULT_FOLDER
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={cn('shrink-0', className)} aria-hidden="true">
      {/* Back panel with tab */}
      <path d="M1.8 3.6A1.2 1.2 0 013 2.4h3.1c.4 0 .7.1.95.4l.75.8H13a1.2 1.2 0 011.2 1.2v7.2A1.2 1.2 0 0113 13.2H3a1.2 1.2 0 01-1.2-1.2z" fill={kind.color} fillOpacity="0.55" />
      {/* Front panel: tilted when open */}
      {open ? (
        <path d="M3.2 6.2a1 1 0 01.96-.7h10.2a.8.8 0 01.78 1l-1.4 5.7a1.2 1.2 0 01-1.17.9H3a1.2 1.2 0 01-1.2-1.2z" fill={kind.color} />
      ) : (
        <path d="M1.8 5.6A1.2 1.2 0 013 4.4h10A1.2 1.2 0 0114.2 5.6V12A1.2 1.2 0 0113 13.2H3A1.2 1.2 0 011.8 12z" fill={kind.color} />
      )}
      <path d={open ? 'M4.3 5.9h9.6' : 'M2.4 5.1h11.2'} stroke="#fff" strokeOpacity="0.35" strokeWidth="0.7" strokeLinecap="round" />
      {kind.glyph && !open && <FolderGlyph kind={kind.glyph} color={kind.color} />}
      {kind.glyph && open && (
        <g transform="translate(0.6 0)">
          <FolderGlyph kind={kind.glyph} color={kind.color} />
        </g>
      )}
    </svg>
  )
}
