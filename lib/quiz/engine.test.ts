import { describe, expect, it } from 'vitest'
import { dominantAxis, resolvePair, resolveSolo, scoreAnswers, validateAnswers } from './engine'
import type { QuizConfig } from './schema'

const cfg: QuizConfig = {
  mode: 'duo',
  axes: [
    { id: 'ei', label: 'E/I', poles: ['E', 'I'] },
    { id: 'sn', label: 'S/N', poles: ['N', 'S'] },
  ],
  questions: [
    { id: 'q1', text: 'q1', options: [
      { id: 'q1_a', label: 'A', scores: { ei: 3, sn: 0 } },
      { id: 'q1_b', label: 'B', scores: { ei: -3, sn: 0 } },
    ] },
    { id: 'q2', text: 'q2', options: [
      { id: 'q2_a', label: 'A', scores: { ei: 0, sn: 2 } },
      { id: 'q2_b', label: 'B', scores: { ei: 0, sn: -2 } },
    ] },
    { id: 'q3', text: 'q3', options: [
      { id: 'q3_a', label: 'A', scores: { ei: 1, sn: 0 } },
      { id: 'q3_b', label: 'B', scores: { ei: -1, sn: 0 } },
    ] },
  ],
  results: [
    { code: 'ES', title: 'ES', body: 'b' },
    { code: 'EN', title: 'EN', body: 'b' },
    { code: 'IS', title: 'IS', body: 'b' },
    { code: 'IN', title: 'IN', body: 'b' },
    { code: 'ES-IN', title: 'pair', body: 'b', pair: ['ei', 'sn'] },
  ],
  fallbackResultCode: 'ES',
}

describe('scoreAnswers', () => {
  it('sums per-axis deltas from the chosen options, defaulting unanswered axes to 0', () => {
    const scores = scoreAnswers(cfg, [
      { questionId: 'q1', optionId: 'q1_a' }, // ei +3
      { questionId: 'q2', optionId: 'q2_b' }, // sn -2
      { questionId: 'q3', optionId: 'q3_a' }, // ei +1
    ])
    expect(scores).toEqual({ ei: 4, sn: -2 })
  })
})

describe('dominantAxis', () => {
  it('picks the first pole when a score is positive, second when negative, first on exact 0 (tiebreak)', () => {
    expect(dominantAxis(cfg, { ei: 4, sn: -2 })).toBe('ES')
    expect(dominantAxis(cfg, { ei: -4, sn: 2 })).toBe('IN')
    expect(dominantAxis(cfg, { ei: 0, sn: 0 })).toBe('EN')
  })
})

describe('validateAnswers', () => {
  it('rejects a missing question', () => {
    const err = validateAnswers(cfg, [{ questionId: 'q1', optionId: 'q1_a' }])
    expect(err).not.toBeNull()
  })
  it('rejects an option id that does not belong to its question', () => {
    const err = validateAnswers(cfg, [
      { questionId: 'q1', optionId: 'q2_a' },
      { questionId: 'q2', optionId: 'q2_a' },
      { questionId: 'q3', optionId: 'q3_a' },
    ])
    expect(err).not.toBeNull()
  })
  it('accepts a complete, valid answer set', () => {
    const err = validateAnswers(cfg, [
      { questionId: 'q1', optionId: 'q1_a' },
      { questionId: 'q2', optionId: 'q2_a' },
      { questionId: 'q3', optionId: 'q3_a' },
    ])
    expect(err).toBeNull()
  })
})

describe('resolveSolo', () => {
  it('resolves to the result whose code matches the computed type code', () => {
    const out = resolveSolo(cfg, [
      { questionId: 'q1', optionId: 'q1_a' },
      { questionId: 'q2', optionId: 'q2_a' },
      { questionId: 'q3', optionId: 'q3_a' },
    ])
    expect(out.resultCode).toBe('EN')
    expect(out.usedFallback).toBe(false)
  })

  it('falls back when no result matches the computed type code', () => {
    const cfgNoMatch: QuizConfig = { ...cfg, results: [{ code: 'ZZ', title: 'z', body: 'b' }], fallbackResultCode: 'ZZ' }
    const out = resolveSolo(cfgNoMatch, [
      { questionId: 'q1', optionId: 'q1_a' },
      { questionId: 'q2', optionId: 'q2_a' },
      { questionId: 'q3', optionId: 'q3_a' },
    ])
    expect(out.resultCode).toBe('ZZ')
    expect(out.usedFallback).toBe(true)
  })
})

describe('resolvePair', () => {
  it('combines both sides\' scores axis-by-axis and matches a pair rule against each side\'s own dominant axis', () => {
    const answersA = [
      { questionId: 'q1', optionId: 'q1_a' }, // A: ei +3
      { questionId: 'q2', optionId: 'q2_b' }, // A: sn -2  -> A axis "ES"
      { questionId: 'q3', optionId: 'q3_a' },
    ]
    const answersB = [
      { questionId: 'q1', optionId: 'q1_b' }, // B: ei -3
      { questionId: 'q2', optionId: 'q2_a' }, // B: sn +2  -> B axis "IN"
      { questionId: 'q3', optionId: 'q3_b' },
    ]
    const out = resolvePair(cfg, answersA, answersB)
    expect(out.axisA).toBe('ES')
    expect(out.axisB).toBe('IN')
    expect(out.resultCode).toBe('ES-IN')
    expect(out.combined).toEqual({ ei: 0, sn: 0 })
  })
})
