export type ThemeId = 'light' | 'dark' | 'system' | 'night-owl' | 'claude-code' | 'flame'

export type ResolvedThemeId = Exclude<ThemeId, 'system'>

export interface ThemeMeta {
  id: ResolvedThemeId
  label: string
  /** Whether `dark:` Tailwind variants apply for this palette. */
  dark: boolean
}

export const THEMES: ThemeMeta[] = [
  { id: 'light', label: 'Light', dark: false },
  { id: 'dark', label: 'Dark', dark: true },
  { id: 'night-owl', label: 'Night Owl', dark: true },
  { id: 'claude-code', label: 'Claude Code', dark: true },
  { id: 'flame', label: 'Flame', dark: true },
]

const RESOLVED_IDS = new Set<string>([...THEMES.map((theme) => theme.id)])

export function isResolvedTheme(value: unknown): value is ResolvedThemeId {
  return typeof value === 'string' && RESOLVED_IDS.has(value)
}

export function resolveTheme(theme: ThemeId, prefersDark: boolean): ResolvedThemeId {
  if (theme === 'system') return prefersDark ? 'dark' : 'light'
  return isResolvedTheme(theme) ? theme : 'light'
}

export function themeIsDark(theme: ThemeId, prefersDark: boolean): boolean {
  const resolved = resolveTheme(theme, prefersDark)
  return THEMES.find((entry) => entry.id === resolved)?.dark ?? false
}

export function normalizeTheme(value: unknown): ThemeId {
  if (value === 'system') return 'system'
  return isResolvedTheme(value) ? value : 'system'
}
