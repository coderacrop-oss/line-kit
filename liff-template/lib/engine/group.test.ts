import { describe, expect, it } from 'vitest'
import { avgScoresFromMembers, axisCountsFromMembers, evaluateGroupArchetype, matchesGroupCondition } from './group'
import type { QuizConfig } from '../schema'

const baseCfg: QuizConfig = {
  mode: 'solo',
  axes: [
    { id: 'ei', label: 'E/I', poles: ['E', 'I'] },
    { id: 'sn', label: 'S/N', poles: ['S', 'N'] },
  ],
  questions: [{ id: 'q1', text: 'q1', options: [{ id: 'a', label: 'A', scores: { ei: 1 } }, { id: 'b', label: 'B', scores: { ei: -1 } }] }],
  results: [{ code: 'E', title: 't', body: 'b' }],
  fallbackResultCode: 'E',
  group: {
    enabled: true, minMembers: 2, maxMembers: 50, resultLocksAt: 0,
    archetypes: [{ code: 'fallback', title: 't', body: 'b', minGroupSize: 2, fallback: true }],
    fallbackArchetype: 'fallback',
  },
}

const member = (topAxis: string, axisScores: Record<string, number>) => ({ topAxis, axisScores })

describe('axisCountsFromMembers', () => {
  it('counts how many members have each topAxis', () => {
    const counts = axisCountsFromMembers([member('ei', {}), member('ei', {}), member('sn', {})])
    expect(counts).toEqual({ ei: 2, sn: 1 })
  })
})

describe('avgScoresFromMembers', () => {
  it('normalises each member (clamping negatives to 0, summing to 1) then averages', () => {
    // member A: ei=4, sn=0 -> normalised {ei:1, sn:0}. member B: ei=0, sn=4 -> normalised {ei:0, sn:1}.
    // average: {ei: 0.5, sn: 0.5}
    const avg = avgScoresFromMembers([member('ei', { ei: 4, sn: 0 }), member('sn', { ei: 0, sn: 4 })])
    expect(avg.ei).toBeCloseTo(0.5)
    expect(avg.sn).toBeCloseTo(0.5)
  })

  it('a member whose raw scores sum to 0 (all-zero) normalises to all-zero rather than divide-by-zero', () => {
    const avg = avgScoresFromMembers([member('ei', { ei: 0, sn: 0 })])
    expect(avg).toEqual({ ei: 0, sn: 0 })
  })

  it('a member whose clamped scores sum to 0 (all-negative) normalises to all-zero, not the raw negatives', () => {
    const avg = avgScoresFromMembers([member('ei', { ei: -9, sn: -5 })])
    expect(avg).toEqual({ ei: 0, sn: 0 })
  })
})

describe('matchesGroupCondition', () => {
  it('hasAxes + hasMode "any": true if at least one listed axis has a member', () => {
    expect(matchesGroupCondition(
      { hasAxes: ['ei', 'sn'], hasMode: 'any', topN: 1, dominantThreshold: 0.5 },
      { ei: 1, foo: 3 }, {},
    )).toBe(true)
  })

  it('hasAxes + hasMode "all": false unless every listed axis has a member', () => {
    expect(matchesGroupCondition(
      { hasAxes: ['ei', 'sn'], hasMode: 'all', topN: 1, dominantThreshold: 0.5 },
      { ei: 1 }, {},
    )).toBe(false)
  })

  it('topAxes + topN: true if the group\'s top-N axes by member count overlap the list', () => {
    // axisCounts sorted desc: ei(5), sn(3), tf(1) — top 2 = [ei, sn]
    expect(matchesGroupCondition(
      { topAxes: ['sn'], topN: 2, hasMode: 'any', dominantThreshold: 0.5 },
      { ei: 5, sn: 3, tf: 1 }, {},
    )).toBe(true)
    expect(matchesGroupCondition(
      { topAxes: ['tf'], topN: 2, hasMode: 'any', dominantThreshold: 0.5 },
      { ei: 5, sn: 3, tf: 1 }, {},
    )).toBe(false)
  })

  it('isBalanced: true only if every axis average is below dominantThreshold', () => {
    expect(matchesGroupCondition(
      { isBalanced: true, hasMode: 'any', topN: 1, dominantThreshold: 0.5 },
      {}, { ei: 0.4, sn: 0.4 },
    )).toBe(true)
    expect(matchesGroupCondition(
      { isBalanced: true, hasMode: 'any', topN: 1, dominantThreshold: 0.5 },
      {}, { ei: 0.6, sn: 0.4 },
    )).toBe(false)
  })

  it('minMembersWithAxis: requires at least N members on that one axis', () => {
    expect(matchesGroupCondition(
      { hasAxes: ['ei'], hasMode: 'any', minMembersWithAxis: 3, topN: 1, dominantThreshold: 0.5 },
      { ei: 2 }, {},
    )).toBe(false)
    expect(matchesGroupCondition(
      { hasAxes: ['ei'], hasMode: 'any', minMembersWithAxis: 2, topN: 1, dominantThreshold: 0.5 },
      { ei: 2 }, {},
    )).toBe(true)
  })

  it('maxDistinct: caps the number of distinct axes present', () => {
    expect(matchesGroupCondition(
      { maxDistinct: 1, hasMode: 'any', topN: 1, dominantThreshold: 0.5 },
      { ei: 3, sn: 2 }, {},
    )).toBe(false)
    expect(matchesGroupCondition(
      { maxDistinct: 2, hasMode: 'any', topN: 1, dominantThreshold: 0.5 },
      { ei: 3, sn: 2 }, {},
    )).toBe(true)
  })

  it('a condition with every field unset matches unconditionally', () => {
    expect(matchesGroupCondition({ hasMode: 'any', topN: 1, dominantThreshold: 0.5 }, {}, {})).toBe(true)
  })
})

describe('evaluateGroupArchetype', () => {
  it('returns null when member count is below group.minMembers', () => {
    const cfg = { ...baseCfg, group: { ...baseCfg.group!, minMembers: 3 } }
    expect(evaluateGroupArchetype(cfg, [member('ei', {}), member('ei', {})])).toBeNull()
  })

  it('picks the highest min_group_size tier the group qualifies for, most-specific condition first', () => {
    const cfg: QuizConfig = {
      ...baseCfg,
      group: {
        enabled: true, minMembers: 2, maxMembers: 50, resultLocksAt: 0,
        fallbackArchetype: 'small-fallback',
        archetypes: [
          { code: 'small-fallback', title: 't', body: 'b', minGroupSize: 2, fallback: true },
          { code: 'big-special', title: 't', body: 'b', minGroupSize: 4, fallback: false, condition: { isBalanced: true, hasMode: 'any', topN: 1, dominantThreshold: 0.5 } },
          { code: 'big-fallback', title: 't', body: 'b', minGroupSize: 4, fallback: true },
        ],
      },
    }
    // 5 balanced members (no axis dominates; ei/sn ~40-40 each) — qualifies for size-4 tier, matches big-special
    // Member avg after normalization: ei=0.4, sn=0.4 (both < dominantThreshold 0.5)
    const members = [
      member('ei', { ei: 2, sn: 0 }), member('ei', { ei: 2, sn: 0 }),
      member('sn', { ei: 0, sn: 2 }), member('sn', { ei: 0, sn: 2 }),
      member('ei', { ei: 0, sn: 0 }),
    ]
    expect(evaluateGroupArchetype(cfg, members)?.code).toBe('big-special')
  })

  it('falls back to the fallback archetype of the highest qualifying tier when no condition matches', () => {
    const cfg: QuizConfig = {
      ...baseCfg,
      group: {
        enabled: true, minMembers: 2, maxMembers: 50, resultLocksAt: 0,
        fallbackArchetype: 'small-fallback',
        archetypes: [
          { code: 'small-fallback', title: 't', body: 'b', minGroupSize: 2, fallback: true },
          { code: 'big-special', title: 't', body: 'b', minGroupSize: 4, fallback: false, condition: { hasAxes: ['tf'], hasMode: 'any', topN: 1, dominantThreshold: 0.5 } },
          { code: 'big-fallback', title: 't', body: 'b', minGroupSize: 4, fallback: true },
        ],
      },
    }
    const members = [member('ei', {}), member('sn', {}), member('ei', {}), member('sn', {})]
    expect(evaluateGroupArchetype(cfg, members)?.code).toBe('big-fallback')
  })

  it('a member with all-negative scores does not get counted as "balanced" via leaked raw negatives (regression)', () => {
    // 2 members maximally ei-dominant + 1 member all-negative on every axis.
    // Pre-fix: the all-negative member's un-clamped raw scores leaked into avgNorm, dragging the
    // average below dominantThreshold and wrongly satisfying isBalanced. Post-fix, the all-negative
    // member contributes 0 on every axis, so ei's average stays high (dominated by the 2 ei members)
    // and isBalanced correctly fails to match.
    const cfg: QuizConfig = {
      ...baseCfg,
      group: {
        enabled: true, minMembers: 2, maxMembers: 50, resultLocksAt: 0,
        fallbackArchetype: 'fallback',
        archetypes: [
          { code: 'fallback', title: 't', body: 'b', minGroupSize: 2, fallback: true },
          { code: 'balanced', title: 't', body: 'b', minGroupSize: 2, fallback: false, condition: { isBalanced: true, hasMode: 'any', topN: 1, dominantThreshold: 0.5 } },
        ],
      },
    }
    const members = [
      member('ei', { ei: 9, sn: 0 }),
      member('ei', { ei: 9, sn: 0 }),
      member('ei', { ei: -9, sn: -9 }),
    ]
    expect(evaluateGroupArchetype(cfg, members)?.code).toBe('fallback')
  })

  it('a non-fallback archetype with no condition is never matched (dead entry, same as KimLIFF)', () => {
    const cfg: QuizConfig = {
      ...baseCfg,
      group: {
        enabled: true, minMembers: 2, maxMembers: 50, resultLocksAt: 0,
        fallbackArchetype: 'fallback',
        archetypes: [
          { code: 'conditionless', title: 't', body: 'b', minGroupSize: 2, fallback: false },
          { code: 'fallback', title: 't', body: 'b', minGroupSize: 2, fallback: true },
        ],
      },
    }
    expect(evaluateGroupArchetype(cfg, [member('ei', {}), member('sn', {})])?.code).toBe('fallback')
  })
})
