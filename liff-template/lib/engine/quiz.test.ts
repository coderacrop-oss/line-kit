import { describe, expect, it } from 'vitest'
import { dominantAxis, resolvePair, resolveSolo, scoreAnswers, strongestAxis, validateAnswers } from './quiz'
import type { QuizConfig } from '../schema'

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
    { code: 'ES-IN', title: 'pair', body: 'b', pair: ['ei', 'ei'] },
    { code: 'ES', title: 'ES', body: 'b' },
    { code: 'EN', title: 'EN', body: 'b' },
    { code: 'IS', title: 'IS', body: 'b' },
    { code: 'IN', title: 'IN', body: 'b' },
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

describe('strongestAxis', () => {
  it('returns the axis ID with the largest absolute score', () => {
    expect(strongestAxis(cfg, { ei: 4, sn: -2 })).toBe('ei')
    expect(strongestAxis(cfg, { ei: -2, sn: 4 })).toBe('sn')
    expect(strongestAxis(cfg, { ei: 3, sn: 3 })).toBe('ei') // Tie: prefer first declared axis
  })

  it('returns the first axis on exact tie', () => {
    expect(strongestAxis(cfg, { ei: 0, sn: 0 })).toBe('ei')
    expect(strongestAxis(cfg, { ei: 5, sn: 5 })).toBe('ei')
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
  it('matches pair rule based on each player\'s strongest axis ID', () => {
    const answersA = [
      { questionId: 'q1', optionId: 'q1_a' }, // A: ei +3, sn 0
      { questionId: 'q2', optionId: 'q2_b' }, // A: ei 0, sn -2
      { questionId: 'q3', optionId: 'q3_a' }, // A: ei +1, sn 0
      // Total: ei +4 (strongest), sn -2
    ]
    const answersB = [
      { questionId: 'q1', optionId: 'q1_b' }, // B: ei -3, sn 0
      { questionId: 'q2', optionId: 'q2_a' }, // B: ei 0, sn +2
      { questionId: 'q3', optionId: 'q3_b' }, // B: ei -1, sn 0
      // Total: ei -4 (strongest), sn +2
    ]
    const out = resolvePair(cfg, answersA, answersB)
    expect(out.axisA).toBe('ei')
    expect(out.axisB).toBe('ei')
    expect(out.resultCode).toBe('ES-IN') // Matches pair: ['ei', 'ei']
    expect(out.combined).toEqual({ ei: 0, sn: 0 })
  })

  it('matches pair rules via tuple comparison, not code string pattern', () => {
    // Rule with code that doesn't follow any axisA-axisB naming convention
    const cfgCustomName: QuizConfig = {
      ...cfg,
      results: [
        { code: 'balanced_pair', title: 'pair', body: 'b', pair: ['ei', 'ei'] },
        { code: 'ES', title: 'ES', body: 'b' },
        { code: 'EN', title: 'EN', body: 'b' },
        { code: 'IS', title: 'IS', body: 'b' },
        { code: 'IN', title: 'IN', body: 'b' },
      ],
    }
    const answersA = [
      { questionId: 'q1', optionId: 'q1_a' },
      { questionId: 'q2', optionId: 'q2_b' },
      { questionId: 'q3', optionId: 'q3_a' },
    ]
    const answersB = [
      { questionId: 'q1', optionId: 'q1_b' },
      { questionId: 'q2', optionId: 'q2_a' },
      { questionId: 'q3', optionId: 'q3_b' },
    ]
    const out = resolvePair(cfgCustomName, answersA, answersB)
    expect(out.resultCode).toBe('balanced_pair')
    expect(out.usedFallback).toBe(false)
  })

  it('catch-all rules (no pair field) match unconditionally, first one wins', () => {
    // Catch-all rule listed first should win immediately, even if pair-specific rules exist after
    const cfgCatchall: QuizConfig = {
      ...cfg,
      results: [
        { code: 'CATCHALL', title: 'catch', body: 'b' }, // No pair field: catch-all
        { code: 'ES', title: 'ES', body: 'b' },
        { code: 'specific_pair', title: 'pair', body: 'b', pair: ['ei', 'sn'] },
      ],
    }
    const answersA = [
      { questionId: 'q1', optionId: 'q1_a' },
      { questionId: 'q2', optionId: 'q2_b' },
      { questionId: 'q3', optionId: 'q3_a' },
    ]
    const answersB = [
      { questionId: 'q1', optionId: 'q1_b' },
      { questionId: 'q2', optionId: 'q2_a' },
      { questionId: 'q3', optionId: 'q3_b' },
    ]
    const out = resolvePair(cfgCatchall, answersA, answersB)
    // Catch-all should win, not the pair-specific rule
    expect(out.resultCode).toBe('CATCHALL')
    expect(out.usedFallback).toBe(false)
  })
})
