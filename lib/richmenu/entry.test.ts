import { describe, expect, it } from 'vitest'
import { countEntries, hasSingleEntry, pickSingleEntry } from './entry'

describe('countEntries / hasSingleEntry', () => {
  it('ไม่มีเมนูเลย นับเป็นศูนย์ และไม่ถือว่าครบ', () => {
    expect(countEntries([])).toBe(0)
    expect(hasSingleEntry([])).toBe(false)
  })

  it('พอดีหนึ่งอันถือว่าครบ', () => {
    const menus = [{ id: 'a', isEntry: true }, { id: 'b', isEntry: false }]
    expect(countEntries(menus)).toBe(1)
    expect(hasSingleEntry(menus)).toBe(true)
  })

  it('ศูนย์อันไม่ถือว่าครบ', () => {
    const menus = [{ id: 'a', isEntry: false }, { id: 'b', isEntry: false }]
    expect(hasSingleEntry(menus)).toBe(false)
  })

  it('มากกว่าหนึ่งอันไม่ถือว่าครบ — กรณีที่ควรเป็นไปไม่ได้ถ้า pickSingleEntry ถูกใช้เสมอ แต่ข้อมูลเดิมอาจหลุดมาได้', () => {
    const menus = [{ id: 'a', isEntry: true }, { id: 'b', isEntry: true }]
    expect(countEntries(menus)).toBe(2)
    expect(hasSingleEntry(menus)).toBe(false)
  })
})

describe('pickSingleEntry · สลับแล้วตัวเก่าต้องหลุดอัตโนมัติ (BR-78)', () => {
  it('ตั้งเมนูที่เลือกเป็นตัวเข้า ตัวอื่นทั้งหมดหลุด', () => {
    const menus = [
      { id: 'a', isEntry: true },
      { id: 'b', isEntry: false },
      { id: 'c', isEntry: false },
    ]
    const after = pickSingleEntry(menus, 'c')
    expect(after.map((m) => [m.id, m.isEntry])).toEqual([['a', false], ['b', false], ['c', true]])
    expect(hasSingleEntry(after)).toBe(true)
  })

  it('ไม่แก้ต้นฉบับ — pure function', () => {
    const menus = [{ id: 'a', isEntry: true }, { id: 'b', isEntry: false }]
    pickSingleEntry(menus, 'b')
    expect(menus[0].isEntry).toBe(true)
  })

  it('เลือกตัวที่เป็นตัวเข้าอยู่แล้ว ผลลัพธ์ยังคงมีแค่ตัวเดียว', () => {
    const menus = [{ id: 'a', isEntry: true }, { id: 'b', isEntry: false }]
    const after = pickSingleEntry(menus, 'a')
    expect(countEntries(after)).toBe(1)
  })

  it('เก็บฟิลด์อื่นของแต่ละแถวไว้ครบ ไม่ใช่แค่ id/isEntry', () => {
    const menus = [{ id: 'a', isEntry: true, alias: 'main' }, { id: 'b', isEntry: false, alias: 'promo' }]
    const after = pickSingleEntry(menus, 'b')
    expect(after[1]).toEqual({ id: 'b', isEntry: true, alias: 'promo' })
  })
})
