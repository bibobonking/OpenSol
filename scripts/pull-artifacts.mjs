// Downloads the artifacts of the most recent build.yml run into ./out
import { execFileSync } from 'node:child_process'

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' })

const [run] = JSON.parse(gh(['run', 'list', '--workflow', 'build.yml', '--limit', '1', '--json', 'databaseId,status,conclusion']))
if (!run) {
  console.error('No build.yml run found.')
  process.exit(1)
}
if (run.status !== 'completed') {
  console.error(`Run ${run.databaseId} is ${run.status}. Wait for it to finish.`)
  process.exit(1)
}

gh(['run', 'download', String(run.databaseId), '--dir', 'out'])
console.log(`Downloaded run ${run.databaseId} (${run.conclusion}) -> out/`)
