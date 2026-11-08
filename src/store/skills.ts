import { create } from 'zustand'
import type { InstalledSkill } from '../types'
import {
  installSkillNpm,
  listSkillsApi,
  removeSkillApi,
  setSkillEnabledApi,
  uploadSkillFiles,
  type SkillUploadFile,
} from '../lib/daemon'

interface SkillsState {
  skills: InstalledSkill[]
  loaded: boolean
  loading: boolean
  error: string
  load: () => Promise<void>
  upload: (files: SkillUploadFile[]) => Promise<string[]>
  installNpm: (spec: string) => Promise<string[]>
  setEnabled: (name: string, enabled: boolean) => Promise<void>
  remove: (name: string) => Promise<void>
}

export const useSkills = create<SkillsState>()((set) => ({
  skills: [],
  loaded: false,
  loading: false,
  error: '',
  load: async () => {
    set({ loading: true })
    try {
      const { skills } = await listSkillsApi()
      set({ skills, loaded: true, loading: false, error: '' })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : 'Could not load skills.' })
    }
  },
  upload: async (files) => {
    const result = await uploadSkillFiles(files)
    set({ skills: result.skills, loaded: true })
    return result.installed
  },
  installNpm: async (spec) => {
    const result = await installSkillNpm(spec)
    set({ skills: result.skills, loaded: true })
    return result.installed
  },
  setEnabled: async (name, enabled) => {
    set((state) => ({ skills: state.skills.map((skill) => (skill.name === name ? { ...skill, enabled } : skill)) }))
    try {
      const result = await setSkillEnabledApi(name, enabled)
      set({ skills: result.skills })
    } catch (error) {
      set((state) => ({
        skills: state.skills.map((skill) => (skill.name === name ? { ...skill, enabled: !enabled } : skill)),
        error: error instanceof Error ? error.message : 'Could not update the skill.',
      }))
    }
  },
  remove: async (name) => {
    const result = await removeSkillApi(name)
    set({ skills: result.skills })
  },
}))

export function enabledSkills(): InstalledSkill[] {
  return useSkills.getState().skills.filter((skill) => skill.enabled)
}

/** Catalog section for the system prompt: names and descriptions only; bodies load through the skill tool. */
export function skillCatalogPrompt(): string {
  const skills = enabledSkills()
  if (skills.length === 0) return ''
  return [
    '## Skills',
    'Skills are folders of expert instructions. When a task matches a skill below, call the `skill` tool with its name BEFORE starting, then follow what it returns. Load bundled files (scripts, references) with the same tool via `file`. Do not guess a skill\'s contents.',
    ...skills.map((skill) => `- ${skill.name}: ${skill.description || 'No description.'}`),
  ].join('\n')
}
