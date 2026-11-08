// Downloads the artifacts of the most recent build.yml run into ./out
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' })

const [run] = JSON.parse(gh(['run', 'list', '--workflow', 'build.yml', '--limit', '1', '--json', 'databaseId,status,conclusion']))
if (!run) {
  console.error('No build.yml run found.')
  process.exit(1)
}

// gh has no --clobber here, and a half-downloaded artifact makes extraction fail.
rmSync('out', { recursive: true, force: true })
gh(['run', 'download', String(run.databaseId), '--dir', 'out'])
console.log(`Downloaded run ${run.databaseId} (${run.status}/${run.conclusion || 'running'}) -> out/`)
