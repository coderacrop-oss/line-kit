import { describe, expect, it } from 'vitest'
import { resolve, type Outcome } from './resolve'
import { seededRng } from '../test-utils/rng'

const outcomes: Outcome[] = [
  { id: 'a', cardId: 'card-a', weight: 1, rewardCode: 'sticker' },
  { id: 'b', cardId: 'card-b', weight: 99, rewardCode: 'mug' },
]

describe('resolve · fixed', () => {
  it('คืนตัวที่ผู้เล่นกดเป็นตัวแรก', () => {
    expect(resolve('fixed', outcomes, { pickedId: 'a' }, seededRng(1))[0].id).toBe('a')
  })
  it('กดตัวที่ไม่มีอยู่ คืนรายการว่าง', () => {
    expect(resolve('fixed', outcomes, { pickedId: 'zzz' }, seededRng(1))).toEqual([])
  })
})

describe('resolve · weighted', () => {
  it('seed เดิมได้ผลเดิมทุกครั้ง', () => {
    const a = resolve('weighted', outcomes, {}, seededRng(42)).map((o) => o.id)
    const b = resolve('weighted', outcomes, {}, seededRng(42)).map((o) => o.id)
    expect(a).toEqual(b)
  })
  it('น้ำหนักมากถูกหยิบบ่อยกว่าอย่างชัดเจน', () => {
    let bFirst = 0
    for (let seed = 0; seed < 400; seed++) {
      if (resolve('weighted', outcomes, {}, seededRng(seed))[0].id === 'b') bFirst++
    }
    expect(bFirst).toBeGreaterThan(340)
  })
  it('คืนครบทุกตัวเป็นลำดับสำรอง ไม่ใช่ตัวเดียว', () => {
    expect(resolve('weighted', outcomes, {}, seededRng(7))).toHaveLength(2)
  })
  it('ไม่มีตัวไหนซ้ำในรายการ', () => {
    const ids = resolve('weighted', outcomes, {}, seededRng(9)).map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('น้ำหนักเป็นศูนย์ทั้งหมด ไม่ทำให้พัง และยังคงที่ตาม seed', () => {
    const zero: Outcome[] = [{ id: 'x', cardId: 'c', weight: 0 }, { id: 'y', cardId: 'c', weight: 0 }]
    const a = resolve('weighted', zero, {}, seededRng(3)).map((o) => o.id)
    const b = resolve('weighted', zero, {}, seededRng(3)).map((o) => o.id)
    expect(a).toHaveLength(2)
    expect(a).toEqual(b)
  })
  it('ไม่มีผลลัพธ์เลย คืนรายการว่าง', () => {
    expect(resolve('weighted', [], {}, seededRng(1))).toEqual([])
  })
})

describe('resolve · score', () => {
  const bands: Outcome[] = [
    { id: 'low', cardId: 'c1', scoreMin: 0, scoreMax: 4 },
    { id: 'high', cardId: 'c2', scoreMin: 5, scoreMax: 10 },
  ]
  it('เลือกช่วงที่คะแนนตกอยู่', () => {
    expect(resolve('score', bands, { score: 7 }, seededRng(1))[0].id).toBe('high')
  })
  it('ขอบของช่วงนับรวม', () => {
    expect(resolve('score', bands, { score: 5 }, seededRng(1))[0].id).toBe('high')
    expect(resolve('score', bands, { score: 4 }, seededRng(1))[0].id).toBe('low')
  })
  it('คะแนนนอกทุกช่วง คืนรายการว่าง ให้ผู้เรียกใช้การ์ดสำรอง', () => {
    expect(resolve('score', bands, { score: 99 }, seededRng(1))).toEqual([])
  })
  it('ไม่ส่งคะแนนมา นับเป็นศูนย์', () => {
    expect(resolve('score', bands, {}, seededRng(1))[0].id).toBe('low')
  })
})

describe('resolve · quota', () => {
  it('เรียงเหมือน weighted — การตัดโควตาจริงเกิดที่ฐานข้อมูล', () => {
    const a = resolve('quota', outcomes, {}, seededRng(11)).map((o) => o.id)
    const b = resolve('weighted', outcomes, {}, seededRng(11)).map((o) => o.id)
    expect(a).toEqual(b)
  })
})
