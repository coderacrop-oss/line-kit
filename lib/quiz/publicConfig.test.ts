import { describe, expect, it } from 'vitest'
import { toPublicQuizConfig } from './publicConfig'
import type { QuizConfig } from './schema'

const cfg: QuizConfig = {
  mode: 'solo',
  axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }],
  questions: [{
    id: 'q1', text: 'q1',
    options: [{ id: 'a', label: 'A', scores: { ei: 3 } }],
  }],
  results: [{ code: 'E', title: 'title', body: 'secret answer key' }],
  fallbackResultCode: 'E',
}

describe('toPublicQuizConfig', () => {
  it('never includes results, option scores, poles, or fallbackResultCode', () => {
    const pub = toPublicQuizConfig(cfg)
    expect(pub).not.toHaveProperty('results')
    expect(pub).not.toHaveProperty('fallbackResultCode')
    expect(pub.axes[0]).not.toHaveProperty('poles')
    expect(pub.questions[0].options[0]).not.toHaveProperty('scores')
  })

  it('keeps the fields a player-facing screen needs', () => {
    const pub = toPublicQuizConfig(cfg)
    expect(pub).toEqual({
      mode: 'solo',
      axes: [{ id: 'ei', label: 'E/I' }],
      questions: [{ id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A' }] }],
    })
  })
})
