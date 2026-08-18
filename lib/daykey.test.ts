import { describe, expect, it } from 'vitest'
import { periodKey } from './daykey'

describe('periodKey', () => {
  it('ใช้วันตามเขตเวลาของแคมเปญ ไม่ใช่ UTC', () => {
    expect(periodKey(new Date('2026-08-14T18:30:00Z'), 'Asia/Bangkok', 86400)).toBe('2026-08-15')
  })

  it('ก่อนเที่ยงคืนกรุงเทพยังเป็นวันเดิม', () => {
    expect(periodKey(new Date('2026-08-14T16:59:00Z'), 'Asia/Bangkok', 86400)).toBe('2026-08-14')
  })

  it('วันสั้นแบบเดโม่ 30 วินาที แบ่งวันเป็นช่วงย่อย', () => {
    const a = periodKey(new Date('2026-08-14T00:00:10Z'), 'UTC', 30)
    const b = periodKey(new Date('2026-08-14T00:00:40Z'), 'UTC', 30)
    expect(a).not.toBe(b)
  })

  it('ช่วงเดียวกันได้คีย์เดียวกันเสมอ', () => {
    const a = periodKey(new Date('2026-08-14T00:00:10Z'), 'UTC', 30)
    const b = periodKey(new Date('2026-08-14T00:00:25Z'), 'UTC', 30)
    expect(a).toBe(b)
  })

  it('จำกัดตลอดแคมเปญใช้คีย์คงที่', () => {
    expect(periodKey(new Date('2026-08-14T00:00:00Z'), 'UTC', 0)).toBe('ALL')
  })
})
