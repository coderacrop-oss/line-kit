import { describe, expect, it } from 'vitest'
import { planEffects, type EffectSpec } from './effects'
import type { Outcome } from './resolve'

const outcome: Outcome = { id: 'a', cardId: 'c', rewardCode: 'sticker' }

describe('planEffects', () => {
  it('set_attribute ใช้ค่าคงที่ตามที่ตั้ง', () => {
    expect(planEffects([{ type: 'set_attribute', key: 'pet_type', value: 'dog' }], outcome))
      .toEqual([{ type: 'set_attribute', key: 'pet_type', value: 'dog' }])
  })
  it('add_units รับจำนวนจากค่าที่ตั้งไว้', () => {
    expect(planEffects([{ type: 'add_units', counterCode: 'food', amount: 2 }], outcome))
      .toEqual([{ type: 'add_units', counterCode: 'food', amount: 2 }])
  })
  it('grant_reward ที่ไม่ระบุรางวัล ใช้รางวัลของผลลัพธ์ที่ออก', () => {
    expect(planEffects([{ type: 'grant_reward' }], outcome))
      .toEqual([{ type: 'grant_reward', rewardCode: 'sticker' }])
  })
  it('grant_reward ที่ระบุรางวัลเอง ชนะรางวัลของผลลัพธ์', () => {
    expect(planEffects([{ type: 'grant_reward', rewardCode: 'mug' }], outcome))
      .toEqual([{ type: 'grant_reward', rewardCode: 'mug' }])
  })
  it('grant_reward เมื่อผลลัพธ์ไม่มีรางวัล ถูกตัดออก ไม่ใช่แจกของว่าง', () => {
    expect(planEffects([{ type: 'grant_reward' }], { id: 'b', cardId: 'c' })).toEqual([])
  })
  it('ทำได้หลายอย่างพร้อมกัน และรักษาลำดับ', () => {
    const spec: EffectSpec[] = [
      { type: 'add_units', counterCode: 'food', amount: 1 },
      { type: 'set_attribute', key: 'last', value: 'a' },
    ]
    expect(planEffects(spec, outcome).map((e) => e.type)).toEqual(['add_units', 'set_attribute'])
  })
  it('ไม่มี effect เลย คืนรายการว่าง', () => {
    expect(planEffects([], outcome)).toEqual([])
  })
})
