import { describe, expect, it } from 'vitest'
import { evaluate, evaluateAll, type PlayerState } from './state'

const state: PlayerState = {
  attributes: { pet_type: 'dog' },
  counters: { food: 62 },
  entitlements: ['sticker'],
  playCounts: { feed: 14 },
  completed: ['quiz'],
}

describe('evaluate', () => {
  it('has_attribute แบบไม่ระบุค่า ดูแค่ว่ามีคีย์ไหม', () => {
    expect(evaluate({ type: 'has_attribute', key: 'pet_type' }, state)).toBe(true)
    expect(evaluate({ type: 'has_attribute', key: 'nope' }, state)).toBe(false)
  })
  it('has_attribute แบบระบุค่า ต้องตรงค่าด้วย', () => {
    expect(evaluate({ type: 'has_attribute', key: 'pet_type', value: 'dog' }, state)).toBe(true)
    expect(evaluate({ type: 'has_attribute', key: 'pet_type', value: 'cat' }, state)).toBe(false)
  })
  it('not_has_attribute ตรงข้ามกับ has', () => {
    expect(evaluate({ type: 'not_has_attribute', key: 'nope' }, state)).toBe(true)
    expect(evaluate({ type: 'not_has_attribute', key: 'pet_type' }, state)).toBe(false)
  })
  it('has_entitlement', () => {
    expect(evaluate({ type: 'has_entitlement', rewardCode: 'sticker' }, state)).toBe(true)
    expect(evaluate({ type: 'has_entitlement', rewardCode: 'mug' }, state)).toBe(false)
  })
  it('activity_completed อ่านจากรายการที่จบแล้ว', () => {
    expect(evaluate({ type: 'activity_completed', activityCode: 'quiz' }, state)).toBe(true)
    expect(evaluate({ type: 'activity_not_completed', activityCode: 'quiz' }, state)).toBe(false)
    expect(evaluate({ type: 'activity_not_completed', activityCode: 'feed' }, state)).toBe(true)
  })
  it('activity_play_count เทียบจำนวนครั้ง', () => {
    expect(evaluate({ type: 'activity_play_count', activityCode: 'feed', op: 'gte', count: 10 }, state)).toBe(true)
    expect(evaluate({ type: 'activity_play_count', activityCode: 'feed', op: 'lt', count: 10 }, state)).toBe(false)
    expect(evaluate({ type: 'activity_play_count', activityCode: 'new', op: 'lt', count: 1 }, state)).toBe(true)
  })
})

describe('evaluateAll', () => {
  it('ไม่มีเงื่อนไข = ผ่านเสมอ', () => {
    expect(evaluateAll(null, state)).toBe(true)
    expect(evaluateAll([], state)).toBe(true)
  })
  it('ต้องผ่านทุกข้อ', () => {
    expect(evaluateAll([
      { type: 'has_attribute', key: 'pet_type' },
      { type: 'has_entitlement', rewardCode: 'sticker' },
    ], state)).toBe(true)
    expect(evaluateAll([
      { type: 'has_attribute', key: 'pet_type' },
      { type: 'has_entitlement', rewardCode: 'mug' },
    ], state)).toBe(false)
  })
})
