import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSkillMarkdown } from './skills.ts'

test('frontmatter supplies the name and description', () => {
  const skill = parseSkillMarkdown('---\nname: API reviewer\ndescription: "Checks a diff"\n---\n# Ignored\n\nBody text.', 'fallback')
  assert.equal(skill.name, 'API reviewer')
  assert.equal(skill.description, 'Checks a diff')
  assert.equal(skill.instructions, '# Ignored\n\nBody text.')
})

test('a plain SKILL.md falls back to its heading and first paragraph', () => {
  const skill = parseSkillMarkdown('# Deploy helper\n\nRuns the release checklist.\n\n## Steps\n1. build', 'fallback')
  assert.equal(skill.name, 'Deploy helper')
  assert.equal(skill.description, 'Runs the release checklist.')
})

test('an empty fallback markdown still returns a usable skill', () => {
  const skill = parseSkillMarkdown('', 'my-skill')
  assert.equal(skill.name, 'my-skill')
  assert.equal(skill.description, 'Installed from a folder')
})
