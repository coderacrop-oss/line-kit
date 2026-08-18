import { describe, expect, it } from 'vitest'
import { periodKey } from '../daykey'
import { describeDayClock } from './dayclock'

describe('describeDayClock', () => {
  it('วันปกติบอกว่าตัดที่เที่ยงคืนตามเขตเวลาไหน', () => {
    const said = describeDayClock('Asia/Bangkok', 86400)
    expect(said).toContain('เที่ยงคืน')
    expect(said).toContain('Asia/Bangkok')
  })

  it('เขตเวลาที่ตั้งไว้จริงต้องอยู่ในประโยค ไม่ใช่เขตเวลาที่เดาเอา', () => {
    expect(describeDayClock('UTC', 86400)).toContain('UTC')
    expect(describeDayClock('Asia/Tokyo', 86400)).toContain('Asia/Tokyo')
  })

  it('วันสั้นบอกเป็นวินาที และบอกว่าใช้สำหรับเดโม่', () => {
    const said = describeDayClock('Asia/Bangkok', 30)
    expect(said).toContain('30')
    expect(said).toContain('เดโม่')
  })

  it('วันสั้นมากยังบอกเวลาที่มากกว่าศูนย์ — "0 นาที" ไม่ได้บอกอะไรใคร', () => {
    expect(describeDayClock('UTC', 1)).not.toContain('0 นาที')
    expect(describeDayClock('UTC', 1)).toContain('1 นาที')
  })

  it('ศูนย์คือจำกัดตลอดแคมเปญ ไม่ใช่วันยาวศูนย์วินาที', () => {
    expect(describeDayClock('UTC', 0)).toContain('ตลอดแคมเปญ')
  })
})

/**
 * ประโยคนี้มีค่าก็ต่อเมื่อมันตรงกับสิ่งที่เครื่องนับจริง
 *
 * describeDayClock exists to tell someone what their two numbers will do. If it
 * describes one rule while periodKey counts by another, it is worse than no
 * sentence at all — it is a confident wrong answer. These pin the two together
 * at the boundaries where they could drift apart.
 */
describe('ประโยคตรงกับสิ่งที่ periodKey ทำจริง', () => {
  const at = new Date('2026-08-19T10:00:00Z')

  it('ค่าที่ยาวกว่าหนึ่งวันถูกนับเป็นวันตามปฏิทิน ประโยคจึงพูดถึงเที่ยงคืนเหมือนกัน', () => {
    expect(periodKey(at, 'UTC', 172_800)).toBe(periodKey(at, 'UTC', 86_400))
    expect(describeDayClock('UTC', 172_800)).toContain('เที่ยงคืน')
  })

  it('ค่าติดลบถูกนับเหมือนศูนย์ ประโยคจึงพูดถึงตลอดแคมเปญเหมือนกัน', () => {
    expect(periodKey(at, 'UTC', -5)).toBe(periodKey(at, 'UTC', 0))
    expect(describeDayClock('UTC', -5)).toContain('ตลอดแคมเปญ')
  })

  it('ค่าที่สั้นกว่าหนึ่งวันถูกแบ่งเป็นช่วง ประโยคจึงไม่พูดถึงเที่ยงคืน', () => {
    expect(periodKey(at, 'UTC', 30)).not.toBe(periodKey(at, 'UTC', 86_400))
    expect(describeDayClock('UTC', 30)).not.toContain('เที่ยงคืน')
  })
})
