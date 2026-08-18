import { describe, expect, it } from 'vitest'
import { substitute } from './vars'
import type { PlayerState } from '../state'

const state: PlayerState = {
  attributes: { pet_name: 'โมจิ' },
  counters: { food: 62 },
  entitlements: [], playCounts: {}, completed: [],
}

describe('substitute', () => {
  it('แทนค่าสะสมและค่าประจำตัว', () => {
    expect(substitute('{{attr.pet_name}} กินไป {{counter.food}} หน่วย', state))
      .toBe('โมจิ กินไป 62 หน่วย')
  })
  it('ตัวแปรที่ไม่มีค่า กลายเป็นข้อความว่าง ไม่โผล่วงเล็บให้ผู้ใช้เห็น', () => {
    expect(substitute('สวัสดี {{attr.nickname}}', state)).toBe('สวัสดี ')
  })
  it('ค่าสะสมที่ยังไม่มี นับเป็นศูนย์', () => {
    expect(substitute('{{counter.water}}', state)).toBe('0')
  })
  it('ยอมรับช่องว่างในวงเล็บ', () => {
    expect(substitute('{{ counter.food }}', state)).toBe('62')
  })
  it('รูปแบบที่ไม่รู้จัก ปล่อยไว้เฉยๆ ไม่โยน', () => {
    expect(substitute('{{reward.mug}}', state)).toBe('{{reward.mug}}')
  })
  it('ข้อความที่ไม่มีตัวแปร ผ่านไปเหมือนเดิม', () => {
    expect(substitute('ไม่มีอะไร', state)).toBe('ไม่มีอะไร')
  })
  it('ตัวแปรหลายตัวติดกัน', () => {
    expect(substitute('{{counter.food}}{{counter.food}}', state)).toBe('6262')
  })
})
