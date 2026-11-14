import { create } from 'zustand'
import { emptyAnswer, type AskAnswer, type AskQuestion, type AskResult } from '../lib/ask-question'

/** What the person has picked so far, kept per tool call so switching chats never loses it. */
export interface QuestionDraft {
  step: number
  answers: AskAnswer[]
}

interface QuestionsState {
  /** Tool call ids that are waiting for the person right now. */
  waiting: Record<string, boolean>
  drafts: Record<string, QuestionDraft>
  setDraft: (callId: string, draft: QuestionDraft) => void
}

export const useQuestions = create<QuestionsState>()((set) => ({
  waiting: {},
  drafts: {},
  setDraft: (callId, draft) => set((state) => ({ drafts: { ...state.drafts, [callId]: draft } })),
}))

const resolvers = new Map<string, (result: AskResult) => void>()

function settle(callId: string) {
  resolvers.delete(callId)
  useQuestions.setState((state) => {
    const waiting = { ...state.waiting }
    delete waiting[callId]
    const drafts = { ...state.drafts }
    delete drafts[callId]
    return { waiting, drafts }
  })
}

/** Parks the agent on the question card until the person answers, skips, or stops the run. */
export function askUser(callId: string, questions: AskQuestion[], signal: AbortSignal): Promise<AskResult> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise<AskResult>((resolve, reject) => {
    const onAbort = () => {
      settle(callId)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    resolvers.set(callId, (result) => {
      signal.removeEventListener('abort', onAbort)
      settle(callId)
      resolve(result)
    })
    useQuestions.setState((state) => ({
      waiting: { ...state.waiting, [callId]: true },
      drafts: {
        ...state.drafts,
        [callId]: state.drafts[callId] ?? { step: 0, answers: questions.map(() => emptyAnswer()) },
      },
    }))
  })
}

export function answerQuestions(callId: string, answers: AskAnswer[]): void {
  resolvers.get(callId)?.({ dismissed: false, answers })
}

export function dismissQuestions(callId: string): void {
  resolvers.get(callId)?.({ dismissed: true, answers: [] })
}
