import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { DATA_DIR } from './store.mjs'

/**
 * Checkpoints remember what a file looked like the first time the agent touched it
 * during one turn, so the whole turn's file edits can be undone. They only cover
 * the file tools (write, rewrite, edit); shell commands are not tracked.
 */

const DIR = path.join(DATA_DIR, 'checkpoints')
const ID = /^[A-Za-z0-9_-]{1,120}$/
const MAX_FILE_BYTES = 1_000_000
const MAX_FILES = 200
const KEEP = 30

const chains = new Map()

export function isCheckpointId(value) {
  return typeof value === 'string' && ID.test(value)
}

function fileFor(id) {
  return path.join(DIR, `${id}.json`)
}

function serial(id, task) {
  const previous = chains.get(id) ?? Promise.resolve()
  const next = previous.then(task, task)
  const tail = next.then(
    () => undefined,
    () => undefined,
  )
  chains.set(id, tail)
  void tail.then(() => {
    if (chains.get(id) === tail) chains.delete(id)
  })
  return next
}

async function load(id) {
  try {
    const parsed = JSON.parse(await readFile(fileFor(id), 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.files && typeof parsed.files === 'object') return parsed
    return null
  } catch {
    return null
  }
}

async function save(checkpoint) {
  await mkdir(DIR, { recursive: true, mode: 0o700 })
  const target = fileFor(checkpoint.id)
  const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temp, JSON.stringify(checkpoint), { mode: 0o600 })
  await rename(temp, target)
}

async function prune() {
  let names
  try {
    names = (await readdir(DIR)).filter((name) => name.endsWith('.json'))
  } catch {
    return
  }
  if (names.length <= KEEP) return
  const dated = []
  for (const name of names) {
    const info = await stat(path.join(DIR, name)).catch(() => null)
    if (info) dated.push({ name, time: info.mtimeMs })
  }
  dated.sort((a, b) => b.time - a.time)
  for (const old of dated.slice(KEEP)) await rm(path.join(DIR, old.name), { force: true })
}

/** Remember the pre-change state of one file. Only the first record per turn counts. */
export function recordBefore(id, root, relative, absolute) {
  if (!isCheckpointId(id)) return Promise.resolve(false)
  return serial(id, async () => {
    const checkpoint = (await load(id)) ?? { id, root, createdAt: Date.now(), files: {} }
    if (checkpoint.root !== root) return false
    if (relative in checkpoint.files) return false
    if (Object.keys(checkpoint.files).length >= MAX_FILES) return false

    const info = await stat(absolute).catch(() => null)
    if (!info) {
      checkpoint.files[relative] = { existed: false }
    } else if (!info.isFile() || info.size > MAX_FILE_BYTES) {
      checkpoint.files[relative] = { existed: true, skipped: true }
    } else {
      const buffer = await readFile(absolute)
      checkpoint.files[relative] = buffer.includes(0)
        ? { existed: true, skipped: true }
        : { existed: true, content: buffer.toString('utf8'), mode: info.mode & 0o777 }
    }
    const isNew = Object.keys(checkpoint.files).length === 1
    await save(checkpoint)
    if (isNew) await prune()
    return true
  })
}

export async function readCheckpoint(id) {
  if (!isCheckpointId(id)) return null
  return load(id)
}

export function describeCheckpoint(checkpoint) {
  return {
    id: checkpoint.id,
    createdAt: checkpoint.createdAt,
    files: Object.entries(checkpoint.files).map(([file, entry]) => ({
      path: file,
      existed: entry.existed === true,
      skipped: entry.skipped === true,
    })),
  }
}

export async function dropCheckpoint(id) {
  if (!isCheckpointId(id)) return
  await serial(id, () => rm(fileFor(id), { force: true }))
}
