export interface DiffOp {
  type: 'ctx' | 'add' | 'del'
  text: string
}

/** Line diff via LCS on the changed middle; common head and tail are trimmed first. */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }
  const x = a.slice(start, endA)
  const y = b.slice(start, endB)
  const ops: DiffOp[] = a.slice(0, start).map((text) => ({ type: 'ctx', text }))

  if (x.length * y.length > 2_000_000) {
    x.forEach((text) => ops.push({ type: 'del', text }))
    y.forEach((text) => ops.push({ type: 'add', text }))
  } else {
    const table: Uint32Array[] = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1))
    for (let i = x.length - 1; i >= 0; i -= 1) {
      for (let j = y.length - 1; j >= 0; j -= 1) {
        table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) {
        ops.push({ type: 'ctx', text: x[i] })
        i += 1
        j += 1
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        ops.push({ type: 'del', text: x[i] })
        i += 1
      } else {
        ops.push({ type: 'add', text: y[j] })
        j += 1
      }
    }
    while (i < x.length) ops.push({ type: 'del', text: x[i++] })
    while (j < y.length) ops.push({ type: 'add', text: y[j++] })
  }
  a.slice(endA).forEach((text) => ops.push({ type: 'ctx', text }))
  return ops
}

export function diffStats(ops: DiffOp[]) {
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.type === 'add') added += 1
    else if (op.type === 'del') removed += 1
  }
  return { added, removed }
}
