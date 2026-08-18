import { describe, expect, it } from 'vitest'
import { matchKeyword, normalizeText, type KeywordRule } from './keyword'

const rule = (o: Partial<KeywordRule> & { id: string; keyword: string }): KeywordRule => ({
  matchMode: 'exact', sortOrder: 0, ...o,
})

describe('normalizeText', () => {
  it('ตัดช่องว่างหัวท้ายและยุบช่องว่างซ้ำ', () => {
    expect(normalizeText('  เสี่ยง   ทาย  ')).toBe('เสี่ยง ทาย')
  })
  it('ตัวพิมพ์ใหญ่เล็กไม่ต่างกัน', () => {
    expect(normalizeText('PLAY')).toBe(normalizeText('play'))
  })
  it('ตัดอักขระที่มองไม่เห็นออก', () => {
    expect(normalizeText('เล่น​')).toBe('เล่น')
  })
})

describe('matchKeyword', () => {
  const rules = [
    rule({ id: 'r1', keyword: 'เล่น', matchMode: 'contains', sortOrder: 1 }),
    rule({ id: 'r2', keyword: 'เล่นเกม', matchMode: 'exact', sortOrder: 2 }),
  ]

  it('exact ชนะ contains แม้ sortOrder จะมากกว่า', () => {
    expect(matchKeyword('เล่นเกม', rules)?.id).toBe('r2')
  })
  it('ไม่มี exact ตรง จึงตกมาที่ contains', () => {
    expect(matchKeyword('อยากเล่นจัง', rules)?.id).toBe('r1')
  })
  it('ไม่ตรงเลยคืน null', () => {
    expect(matchKeyword('สวัสดี', rules)).toBeNull()
  })
  it('เทียบหลัง normalize ทั้งสองฝั่ง', () => {
    expect(matchKeyword('  เล่นเกม  ', rules)?.id).toBe('r2')
  })
  it('ข้อความว่างคืน null', () => {
    expect(matchKeyword('   ', rules)).toBeNull()
  })
  it('ในกลุ่มเดียวกันใช้ sortOrder ตัดสิน', () => {
    const many = [
      rule({ id: 'b', keyword: 'เล่น', matchMode: 'contains', sortOrder: 5 }),
      rule({ id: 'a', keyword: 'เล่น', matchMode: 'contains', sortOrder: 1 }),
    ]
    expect(matchKeyword('มาเล่นกัน', many)?.id).toBe('a')
  })
})
