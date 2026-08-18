import { describe, expect, it } from 'vitest'
import { computeMove, computeResize, RESIZE_HANDLES, type Rect } from './gesture'

const box: Rect = { x: 100, y: 100, width: 200, height: 150 }

describe('computeMove', () => {
  it('ขยับตำแหน่งตามระยะที่ลาก ขนาดไม่เปลี่ยน', () => {
    expect(computeMove(box, 30, -20)).toEqual({ x: 130, y: 80, width: 200, height: 150 })
  })

  it('ระยะเป็นศูนย์ ตำแหน่งเดิมทุกประการ', () => {
    expect(computeMove(box, 0, 0)).toEqual(box)
  })
})

describe('computeResize · ทิศทางของแต่ละแฮนเดิล', () => {
  it('se (มุมขวาล่าง) — ขยายกว้าง/สูง มุมซ้ายบนไม่ขยับ', () => {
    const result = computeResize('se', box, 50, 30)
    expect(result).toEqual({ x: 100, y: 100, width: 250, height: 180 })
  })

  it('nw (มุมซ้ายบน) — ขอบขวาล่างไม่ขยับ (x+width และ y+height คงเดิม)', () => {
    const result = computeResize('nw', box, 20, 10)
    expect(result.x + result.width).toBe(box.x + box.width)
    expect(result.y + result.height).toBe(box.y + box.height)
    expect(result).toEqual({ x: 120, y: 110, width: 180, height: 140 })
  })

  it('e (ขวา) — กว้างเปลี่ยน สูง/y ไม่เปลี่ยน x ไม่เปลี่ยน', () => {
    const result = computeResize('e', box, 40, 999)
    expect(result).toEqual({ x: 100, y: 100, width: 240, height: 150 })
  })

  it('w (ซ้าย) — ขอบขวาอยู่นิ่ง (x+width คงเดิม)', () => {
    const result = computeResize('w', box, 40, 0)
    expect(result.x + result.width).toBe(box.x + box.width)
    expect(result).toEqual({ x: 140, y: 100, width: 160, height: 150 })
  })

  it('n (บน) — ขอบล่างอยู่นิ่ง (y+height คงเดิม)', () => {
    const result = computeResize('n', box, 0, 40)
    expect(result.y + result.height).toBe(box.y + box.height)
    expect(result).toEqual({ x: 100, y: 140, width: 200, height: 110 })
  })

  it('s (ล่าง) — สูงเปลี่ยน ตำแหน่ง y ไม่เปลี่ยน', () => {
    const result = computeResize('s', box, 0, 40)
    expect(result).toEqual({ x: 100, y: 100, width: 200, height: 190 })
  })

  it('sw (มุมซ้ายล่าง) — ขอบขวาบนอยู่นิ่ง', () => {
    const result = computeResize('sw', box, -20, 30)
    expect(result.x + result.width).toBe(box.x + box.width)
    expect(result.y).toBe(box.y)
    expect(result).toEqual({ x: 80, y: 100, width: 220, height: 180 })
  })

  it('ne (มุมขวาบน) — ขอบซ้ายล่างอยู่นิ่ง', () => {
    const result = computeResize('ne', box, 30, -20)
    expect(result.x).toBe(box.x)
    expect(result.y + result.height).toBe(box.y + box.height)
    expect(result).toEqual({ x: 100, y: 80, width: 230, height: 170 })
  })
})

describe('computeResize · เพดานขนาดต่ำสุด', () => {
  it('ลากจนกว้างต่ำกว่าเพดาน — หยุดที่เพดานพอดี ไม่ติดลบหรือกลับด้าน', () => {
    const result = computeResize('e', box, -195, 0, 20)
    expect(result.width).toBe(20)
  })

  it('ลากขอบซ้ายจนแคบกว่าเพดาน — ขอบขวายังอยู่ที่เดิม (ไม่ใช่ x ติดลบทะลุไปอีกฝั่ง)', () => {
    const result = computeResize('w', box, 195, 0, 20)
    expect(result.width).toBe(20)
    expect(result.x + result.width).toBe(box.x + box.width)
  })

  it('ลากจนสูงต่ำกว่าเพดาน — หยุดที่เพดานพอดี', () => {
    const result = computeResize('s', box, 0, -145, 20)
    expect(result.height).toBe(20)
  })

  it('ลากขอบบนจนเตี้ยกว่าเพดาน — ขอบล่างยังอยู่ที่เดิม', () => {
    const result = computeResize('n', box, 0, 145, 20)
    expect(result.height).toBe(20)
    expect(result.y + result.height).toBe(box.y + box.height)
  })

  it('ทุกแฮนเดิลไม่เคยให้ขนาดต่ำกว่าเพดานเลยไม่ว่าจะลากย้อนไกลแค่ไหน', () => {
    for (const handle of RESIZE_HANDLES) {
      const result = computeResize(handle, box, -99999, -99999, 15)
      expect(result.width).toBeGreaterThanOrEqual(15)
      expect(result.height).toBeGreaterThanOrEqual(15)
    }
  })
})
