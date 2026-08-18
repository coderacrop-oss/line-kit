import { describe, expect, it } from 'vitest'
import { checkEntry, type EntryContext, type EntryRule } from './entry'
import type { PlayerState } from '../state'

const state: PlayerState = {
  attributes: { pet_type: 'dog' }, counters: {}, entitlements: [], playCounts: {}, completed: [],
}
const ctx: EntryContext = {
  state,
  now: new Date('2026-08-14T05:00:00Z'),
  playsThisPeriod: 0,
  campaignStart: new Date('2026-08-01T00:00:00Z'),
  campaignEnd: new Date('2026-08-31T00:00:00Z'),
}

describe('checkEntry', () => {
  it('ไม่มีเงื่อนไข = เข้าเล่นได้', () => {
    expect(checkEntry([], ctx)).toEqual({ allowed: true })
  })
  it('ผ่านทุกข้อ = เข้าเล่นได้', () => {
    expect(checkEntry([{ type: 'has_attribute', key: 'pet_type', cardId: 'c1' }], ctx)).toEqual({ allowed: true })
  })
  it('คืนการ์ดของข้อแรกที่ไม่ผ่าน ไม่ใช่ข้อสุดท้าย', () => {
    const rules: EntryRule[] = [
      { type: 'has_entitlement', rewardCode: 'nope', cardId: 'ไม่มีสิทธิ์' },
      { type: 'has_attribute', key: 'missing', cardId: 'ไม่มีค่า' },
    ]
    expect(checkEntry(rules, ctx)).toEqual({ allowed: false, cardId: 'ไม่มีสิทธิ์' })
  })
  it('limit ต่อวัน — เล่นครบแล้วเข้าไม่ได้', () => {
    const rules: EntryRule[] = [{ type: 'limit', count: 1, per: 'day', cardId: 'วันนี้เล่นแล้ว' }]
    expect(checkEntry(rules, { ...ctx, playsThisPeriod: 1 })).toEqual({ allowed: false, cardId: 'วันนี้เล่นแล้ว' })
    expect(checkEntry(rules, { ...ctx, playsThisPeriod: 0 })).toEqual({ allowed: true })
  })
  it('time_window — นอกช่วงวันที่ของแคมเปญเข้าไม่ได้', () => {
    const rules: EntryRule[] = [{ type: 'time_window', cardId: 'ยังไม่เริ่ม' }]
    expect(checkEntry(rules, { ...ctx, now: new Date('2026-07-31T00:00:00Z') }))
      .toEqual({ allowed: false, cardId: 'ยังไม่เริ่ม' })
  })
  it('time_window — จำกัดชั่วโมงตามเวลาท้องถิ่นของแคมเปญ', () => {
    const rules: EntryRule[] = [
      { type: 'time_window', hoursOfDay: [18, 19, 20], timezone: 'Asia/Bangkok', cardId: 'ยังไม่ถึงเวลา' },
    ]
    expect(checkEntry(rules, ctx)).toEqual({ allowed: false, cardId: 'ยังไม่ถึงเวลา' })
    expect(checkEntry(rules, { ...ctx, now: new Date('2026-08-14T12:00:00Z') })).toEqual({ allowed: true })
  })
  it('เงื่อนไขชนิดที่ไม่รู้จัก ถือว่าไม่ผ่าน ไม่ใช่ปล่อยผ่าน', () => {
    const rules = [{ type: 'wat', cardId: 'กันไว้ก่อน' }] as unknown as EntryRule[]
    expect(checkEntry(rules, ctx)).toEqual({ allowed: false, cardId: 'กันไว้ก่อน' })
  })
})
