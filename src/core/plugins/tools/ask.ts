import type { Context } from 'cordis'
import { formatAnswers, normalizeQuestions } from '../../../lib/ask-question'
import { askUser } from '../../../store/questions'
import { createId } from '../../../store/chats'

export const name = 'tool-ask'
export const inject = ['tools']

export function apply(ctx: Context) {
  return ctx.tools.register({
    name: 'ask_question',
    description:
      'Ask the user one or more multiple-choice questions and wait for the answers. Use it to clarify an ambiguous request, choose between approaches, or confirm a decision before doing costly or irreversible work. ' +
      'You may ask up to 8 questions in one call (each with 2–6 options, one short `header`, and `multiSelect: true` when several options may apply). ' +
      'Give each option a short `label` and, when it helps, a one-sentence `description` shown under it; put your recommended option first and end its label with "(Recommended)". ' +
      'The interface adds a free-text field to every question automatically, so never add an "Other" option yourself. ' +
      'Do not use it for things you can find out by reading the project, or for trivial choices you can make yourself. Works in Plan mode too.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'The questions to show together, in order (1–8).',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'The full question, ending with a question mark.' },
              header: { type: 'string', description: 'Very short tab title for this question (max 24 characters), e.g. "Database".' },
              multiSelect: { type: 'boolean', description: 'True when the user may pick more than one option.' },
              options: {
                type: 'array',
                description: 'The choices (2–6). Do not include an "Other" option.',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'Short choice text (1–5 words).' },
                    description: { type: 'string', description: 'Optional small comment shown under the choice: what it means or its trade-off.' },
                  },
                  required: ['label'],
                },
              },
            },
            required: ['question', 'options'],
          },
        },
      },
      required: ['questions'],
      additionalProperties: false,
    },
    allowedInMode: () => true,
    async execute(args, exec) {
      const questions = normalizeQuestions(args)
      if (questions.length === 0) {
        return {
          output: 'ask_question needs a "questions" array; each item needs a "question" and an "options" array of {label, description}.',
          isError: true,
        }
      }
      const result = await askUser(exec.callId ?? createId('ask'), questions, exec.signal)
      return { output: formatAnswers(questions, result), isError: false, data: result }
    },
  })
}
