import { describe, expect, it } from 'vitest'
import {
  asLayoutKey, identifyLayout, LAYOUT_KEYS, LAYOUTS, layoutRects, MAX_AREAS,
  MENU_IMAGE_HEIGHT, MENU_IMAGE_WIDTH,
} from './layouts'

describe('layoutRects · §5.2 พิกัดต้องเป็นจำนวนเต็มล้วน ไม่มีเปอร์เซ็นต์', () => {
  it.each(LAYOUT_KEYS)('ผัง "%s" ใช้พิกัดเป็นจำนวนเต็มทุกช่อง', (key) => {
    for (const rect of layoutRects(key)) {
      for (const value of [rect.x, rect.y, rect.width, rect.height]) {
        expect(Number.isInteger(value)).toBe(true)
      }
    }
  })

  it.each(LAYOUT_KEYS)('ผัง "%s" ไม่ล้นขอบภาพ 2500×1686', (key) => {
    for (const rect of layoutRects(key)) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(MENU_IMAGE_WIDTH)
      expect(rect.y + rect.height).toBeLessThanOrEqual(MENU_IMAGE_HEIGHT)
    }
  })

  it.each(LAYOUT_KEYS)('ผัง "%s" เติมเต็มผืนภาพพอดี ไม่มีช่องว่างเหลือ', (key) => {
    const total = layoutRects(key).reduce((sum, r) => sum + r.width * r.height, 0)
    expect(total).toBe(MENU_IMAGE_WIDTH * MENU_IMAGE_HEIGHT)
  })

  it.each(LAYOUT_KEYS)('ผัง "%s" ไม่มีช่องซ้อนทับกัน', (key) => {
    const rects = layoutRects(key)
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width
          && a.y < b.y + b.height && b.y < a.y + a.height
        expect(overlap).toBe(false)
      }
    }
  })

  it('ผังทุกแบบอยู่ห่างจากเพดาน 20 ช่องของ LINE มาก', () => {
    for (const key of LAYOUT_KEYS) {
      expect(layoutRects(key).length).toBeLessThanOrEqual(MAX_AREAS)
    }
  })

  it('คืนอาเรย์ใหม่ทุกครั้ง — แก้ค่าที่คืนมาไม่กระทบผังต้นฉบับ', () => {
    const first = layoutRects('two')
    first[0].x = 999
    expect(layoutRects('two')[0].x).toBe(0)
  })
})

describe('LAYOUTS · รายการสำหรับปุ่มเลือกผัง', () => {
  it('มีสี่แบบตรงกับ LAYOUT_KEYS', () => {
    expect(LAYOUTS.map((l) => l.key)).toEqual([...LAYOUT_KEYS])
  })

  it('ป้ายบนปุ่มคือจำนวนช่องของผังนั้น', () => {
    for (const option of LAYOUTS) {
      expect(option.label).toBe(String(option.count))
      expect(option.count).toBe(layoutRects(option.key).length)
    }
  })
})

describe('identifyLayout · หาผังจากจำนวนช่องที่มีอยู่จริง', () => {
  it.each([
    [1, 'one'], [2, 'two'], [3, 'three'], [6, 'six'],
  ] as const)('%i ช่อง → ผัง %s', (count, key) => {
    expect(identifyLayout(count)).toBe(key)
  })

  it('จำนวนที่ไม่ตรงผังไหนเลย กลับเป็น one แทนการไม่มีสถานะ', () => {
    expect(identifyLayout(0)).toBe('one')
    expect(identifyLayout(4)).toBe('one')
    expect(identifyLayout(99)).toBe('one')
  })
})

describe('asLayoutKey', () => {
  it('รับเฉพาะค่าที่อยู่ใน LAYOUT_KEYS', () => {
    expect(asLayoutKey('six')).toBe('six')
    expect(asLayoutKey('seven')).toBeNull()
    expect(asLayoutKey(null)).toBeNull()
    expect(asLayoutKey(undefined)).toBeNull()
  })
})
