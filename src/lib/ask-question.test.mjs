import assert from 'node:assert/strict'
import test from 'node:test'
import { answerIsComplete, formatAnswers, normalizeQuestions, readResult } from './ask-question.ts'

test('several questions, option comments and multi-select survive normalisation', () => {
  const questions = normalizeQuestions({
    questions: [
      { question: 'Which database?', header: 'Database', options: [{ label: 'Postgres', description: 'Best for relations' }, 'SQLite'] },
      { question: 'Which features?', multiSelect: true, options: [{ label: 'Auth' }, { label: 'Search' }] },
    ],
  })
  assert.equal(questions.length, 2)
  assert.equal(questions[0].options[0].description, 'Best for relations')
  assert.equal(questions[0].options[1].label, 'SQLite')
  assert.equal(questions[1].multiSelect, true)
})

test('junk from the model is dropped, not thrown', () => {
  assert.deepEqual(normalizeQuestions(null), [])
  assert.deepEqual(normalizeQuestions({ questions: [42, { question: '' }, { options: ['x'] }] }), [])
  const [single] = normalizeQuestions({ question: 'One?', options: ['A', 'a', 'B'] })
  assert.deepEqual(single.options.map((option) => option.label), ['A', 'B'])
})

test('answers are formatted for the model, including the free-text field', () => {
  const questions = normalizeQuestions({ questions: [{ question: 'Pick', options: ['A', 'B'] }, { question: 'Why?', options: [] }] })
  const text = formatAnswers(questions, { dismissed: false, answers: [{ selected: ['A'], custom: '' }, { selected: [], custom: 'because' }] })
  assert.match(text, /Selected: A/)
  assert.match(text, /Wrote: because/)
  assert.match(formatAnswers(questions, { dismissed: true, answers: [] }), /dismissed/)
})

test('completeness and stored results', () => {
  assert.equal(answerIsComplete({ selected: [], custom: '  ' }), false)
  assert.equal(answerIsComplete({ selected: [], custom: 'x' }), true)
  assert.equal(readResult({ dismissed: false, answers: [{ selected: ['A'], custom: 'z' }] }, 2).answers.length, 2)
  assert.equal(readResult('nope', 1), null)
})
