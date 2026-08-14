import { describe, expect, it } from 'vitest'
import { summarize } from './campaigns'

const row = {
  id: 'c1', name: 'Krob Pet', code: 'krobpet', status: 'published' as const,
  activity_count: 4, channel_name: 'OA ครบเจ็ด',
  start_at: new Date('2026-08-01T00:00:00Z'),
  end_at: new Date('2026-08-31T00:00:00Z'),
}
const NOW = new Date('2026-08-19T00:00:00Z')

describe('summarize', () => {
  it('นับวันที่เหลือจากวันจบ', () => {
    expect(summarize(row, NOW).daysLeft).toBe(12)
  })

  it('แคมเปญที่ยังไม่เริ่ม วันที่เหลือยังนับจากวันจบ ไม่ติดลบ', () => {
    expect(summarize(row, new Date('2026-07-01T00:00:00Z')).daysLeft).toBeGreaterThan(0)
  })

  // ปัดขึ้น ไม่ใช่ปัดลง — วันที่เหลืออีกครึ่งวันยังเป็นวันที่เล่นได้อยู่
  // ถ้าปัดลง คนที่เปิดหน้านี้ตอนบ่ายจะเห็นจำนวนวันลดลงหนึ่งวันทั้งที่ยังเล่นได้
  it('เศษของวันยังนับเป็นวัน', () => {
    expect(summarize(row, new Date('2026-08-19T13:00:00Z')).daysLeft).toBe(12)
  })

  it('แคมเปญที่หมดเวลาแล้วแต่ยังไม่ปิด บอกศูนย์ ไม่ใช่ค่าติดลบ', () => {
    expect(summarize(row, new Date('2026-09-20T00:00:00Z')).daysLeft).toBe(0)
  })

  it('แคมเปญที่จบแล้วบอกว่าเหลือกี่วันก่อนลบข้อมูล นับจากวันจบ + 30', () => {
    const closed = { ...row, status: 'closed' as const }
    expect(summarize(closed, new Date('2026-09-12T00:00:00Z')).purgeInDays).toBe(18)
  })

  it('แคมเปญที่จบและพ้น 30 วันแล้ว บอกศูนย์ ไม่ใช่ค่าติดลบ', () => {
    const closed = { ...row, status: 'closed' as const }
    expect(summarize(closed, new Date('2026-10-30T00:00:00Z')).purgeInDays).toBe(0)
  })

  it('สองกำหนดนี้ไม่เคยขึ้นพร้อมกัน — แถวหนึ่งนับถอยหลังได้เรื่องเดียว', () => {
    const live = summarize(row, NOW)
    expect(live.daysLeft).not.toBeNull()
    expect(live.purgeInDays).toBeNull()

    const closed = summarize({ ...row, status: 'closed' as const }, NOW)
    expect(closed.daysLeft).toBeNull()
    expect(closed.purgeInDays).not.toBeNull()
  })

  it('แคมเปญร่างที่ยังไม่ผูกบัญชี คืน null ไม่ใช่สตริงว่าง', () => {
    const draft = { ...row, status: 'draft' as const, channel_name: null }
    expect(summarize(draft, NOW).channelName).toBeNull()
  })

  it('ส่งชื่อ รหัส และจำนวนกิจกรรมต่อออกไปตามเดิม', () => {
    expect(summarize(row, NOW)).toMatchObject({
      id: 'c1', name: 'Krob Pet', code: 'krobpet', status: 'published', activityCount: 4,
    })
  })
})
