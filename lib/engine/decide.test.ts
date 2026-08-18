import { describe, expect, it } from 'vitest'
import { decide, type DecideInput } from './decide'
import { seededRng } from '../test-utils/rng'
import type { PlayerState } from '../state'

const state: PlayerState = {
  attributes: {}, counters: {}, entitlements: [], playCounts: {}, completed: [],
}

const base: DecideInput = {
  entryRules: [],
  resolveMethod: 'weighted',
  outcomes: [{ id: 'a', cardId: 'card-a', weight: 1, rewardCode: 'sticker' }],
  effectSpec: [{ type: 'grant_reward' }],
  input: {},
  ctx: {
    state,
    now: new Date('2026-08-14T05:00:00Z'),
    playsThisPeriod: 0,
    campaignStart: new Date('2026-08-01T00:00:00Z'),
    campaignEnd: new Date('2026-08-31T00:00:00Z'),
  },
  rng: seededRng(1),
}

describe('decide', () => {
  it('เข้าเล่นไม่ได้ คืนการ์ดของเงื่อนไขที่กั้น', () => {
    const d = decide({
      ...base,
      entryRules: [{ type: 'limit', count: 1, per: 'day', cardId: 'วันนี้เล่นแล้ว' }],
      ctx: { ...base.ctx, playsThisPeriod: 1 },
    })
    expect(d).toEqual({ kind: 'blocked', cardId: 'วันนี้เล่นแล้ว' })
  })

  it('เข้าเล่นได้ คืนรายการผลลัพธ์เรียงลำดับพร้อม effect', () => {
    const d = decide(base)
    expect(d.kind).toBe('played')
    if (d.kind !== 'played') throw new Error('unreachable')
    expect(d.ranked[0].id).toBe('a')
    expect(d.effects).toEqual([{ type: 'grant_reward', rewardCode: 'sticker' }])
  })

  it('ตัดสินไม่ได้เลย ใช้การ์ดสำรอง', () => {
    const d = decide({ ...base, resolveMethod: 'score', outcomes: [], input: { score: 5 }, fallbackCardId: 'สำรอง' })
    expect(d).toEqual({ kind: 'blocked', cardId: 'สำรอง' })
  })

  it('effect คำนวณจากผลลัพธ์อันดับหนึ่ง', () => {
    const d = decide({
      ...base,
      outcomes: [
        { id: 'a', cardId: 'c', weight: 0, rewardCode: 'ไม่ควรได้' },
        { id: 'b', cardId: 'c', weight: 100, rewardCode: 'ควรได้' },
      ],
    })
    if (d.kind !== 'played') throw new Error('unreachable')
    expect(d.effects).toEqual([{ type: 'grant_reward', rewardCode: d.ranked[0].rewardCode }])
  })

  it('เข้าเล่นไม่ได้แล้วไม่มี effect ให้ลงเลย', () => {
    const d = decide({ ...base, entryRules: [{ type: 'has_entitlement', rewardCode: 'x', cardId: 'ไม่ได้' }] })
    expect(d).not.toHaveProperty('effects')
  })
})
