// Pure helpers for the ask_question tool: the model's arguments are untrusted, so both the tool and the
// card read them through normalizeQuestions. Keep this file free of imports (it is unit-tested directly).

export interface AskOption {
  label: string
  /** Small grey comment shown under the option. */
  description: string
}

export interface AskQuestion {
  question: string
  /** Short chip shown on the step tab ("Database"). May be empty. */
  header: string
  options: AskOption[]
  multiSelect: boolean
}

export interface AskAnswer {
  /** Labels of the chosen options. */
  selected: string[]
  /** What the person typed in the always-present free-text field. */
  custom: string
}

export interface AskResult {
  dismissed: boolean
  answers: AskAnswer[]
}

export const MAX_QUESTIONS = 8
export const MAX_OPTIONS = 10

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

function normalizeOption(raw: unknown): AskOption | null {
  if (typeof raw === 'string') {
    const label = clip(raw, 140)
    return label ? { label, description: '' } : null
  }
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const label = clip(item.label ?? item.text ?? item.value ?? item.title, 140)
  if (!label) return null
  return { label, description: clip(item.description ?? item.comment ?? item.detail ?? item.hint, 400) }
}

/** Accepts { questions: [...] } or a single { question, options } and returns clean, bounded questions. */
export function normalizeQuestions(args: unknown): AskQuestion[] {
  const source = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  const list = Array.isArray(source.questions) ? source.questions : typeof source.question === 'string' ? [source] : []
  const out: AskQuestion[] = []
  for (const raw of list.slice(0, MAX_QUESTIONS)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const question = clip(item.question ?? item.prompt ?? item.text, 600)
    if (!question) continue
    const seen = new Set<string>()
    const options: AskOption[] = []
    for (const candidate of Array.isArray(item.options) ? item.options : []) {
      const option = normalizeOption(candidate)
      if (!option || seen.has(option.label.toLowerCase())) continue
      seen.add(option.label.toLowerCase())
      options.push(option)
      if (options.length >= MAX_OPTIONS) break
    }
    out.push({
      question,
      header: clip(item.header ?? item.title, 24),
      options,
      multiSelect: item.multiSelect === true || item.multiple === true || item.multi_select === true,
    })
  }
  return out
}

export function emptyAnswer(): AskAnswer {
  return { selected: [], custom: '' }
}

export function answerIsComplete(answer: AskAnswer | undefined): boolean {
  return Boolean(answer && (answer.selected.length > 0 || answer.custom.trim()))
}

/** The text the model reads back. */
export function formatAnswers(questions: AskQuestion[], result: AskResult): string {
  if (result.dismissed) {
    return 'The user dismissed the questions without answering. Continue with your best judgment, or ask in plain text if you are truly blocked.'
  }
  const lines = ['The user answered your questions:', '']
  questions.forEach((question, index) => {
    const answer = result.answers[index] ?? emptyAnswer()
    lines.push(`${index + 1}. ${question.header ? `[${question.header}] ` : ''}${question.question}`)
    if (answer.selected.length > 0) lines.push(`   Selected: ${answer.selected.join('; ')}`)
    if (answer.custom.trim()) lines.push(`   ${answer.selected.length > 0 ? 'Also wrote' : 'Wrote'}: ${answer.custom.trim()}`)
    if (!answerIsComplete(answer)) lines.push('   (no answer)')
  })
  lines.push('', 'Continue with these answers. Do not ask the same questions again.')
  return lines.join('\n')
}

/** Reads the structured result stored on a finished tool message; tolerant of old or malformed data. */
export function readResult(data: unknown, count: number): AskResult | null {
  if (!data || typeof data !== 'object') return null
  const raw = data as Record<string, unknown>
  if (typeof raw.dismissed !== 'boolean' || !Array.isArray(raw.answers)) return null
  const answers: AskAnswer[] = []
  for (let index = 0; index < count; index += 1) {
    const entry = raw.answers[index] as Record<string, unknown> | undefined
    answers.push({
      selected: Array.isArray(entry?.selected) ? entry.selected.filter((item): item is string => typeof item === 'string') : [],
      custom: typeof entry?.custom === 'string' ? entry.custom : '',
    })
  }
  return { dismissed: raw.dismissed, answers }
}
