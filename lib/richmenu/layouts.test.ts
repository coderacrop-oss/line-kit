import { describe, expect, it } from 'vitest'
import {
  asLayoutKey, canvasFor, identifyLayout, LAYOUT_KEYS, LAYOUTS, layoutRects, layoutsOfSize,
  MAX_AREAS, MENU_CANVAS,
} from './layouts'

describe('layoutRects · §5.2 พิกัดต้องเป็นจำนวนเต็มล้วน ไม่มีเปอร์เซ็นต์', () => {
  it.each(LAYOUT_KEYS)('ผัง "%s" ใช้พิกัดเป็นจำนวนเต็มทุกช่อง', (key) => {
    for (const rect of layoutRects(key)) {
      for (const value of [rect.x, rect.y, rect.width, rect.height]) {
        expect(Number.isInteger(value)).toBe(true)
      }
    }
  })

  it.each(LAYOUT_KEYS)('ผัง "%s" ไม่ล้นขอบผืนภาพของตัวเอง', (key) => {
    const canvas = canvasFor(key)
    for (const rect of layoutRects(key)) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(canvas.width)
      expect(rect.y + rect.height).toBeLessThanOrEqual(canvas.height)
    }
  })

  it.each(LAYOUT_KEYS)('ผัง "%s" เติมเต็มผืนภาพของตัวเองพอดี ไม่มีช่องว่างเหลือ', (key) => {
    const canvas = canvasFor(key)
    const total = layoutRects(key).reduce((sum, r) => sum + r.width * r.height, 0)
    expect(total).toBe(canvas.width * canvas.height)
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
    const first = layoutRects('large_2h')
    first[0].x = 999
    expect(layoutRects('large_2h')[0].x).toBe(0)
  })
})

describe('LAYOUTS · รายการสำหรับปุ่มเลือกผัง', () => {
  it('มีสิบสองแบบตรงกับ LAYOUT_KEYS', () => {
    expect(LAYOUTS.map((l) => l.key)).toEqual([...LAYOUT_KEYS])
  })

  it('จำนวนช่องตรงกับพิกัดจริงของผังนั้น', () => {
    for (const option of LAYOUTS) {
      expect(option.count).toBe(layoutRects(option.key).length)
    }
  })

  it('ทุกผังมีป้ายเป็นข้อความ ไม่ใช่สตริงว่าง', () => {
    for (const option of LAYOUTS) {
      expect(option.label.length).toBeGreaterThan(0)
    }
  })

  it('ผังที่นับช่องเท่ากันแต่แบ่งคนละแบบ ต้องมีป้ายไม่ซ้ำกัน — ไม่งั้นแยกไม่ออกว่ากดอันไหน', () => {
    const bySize = new Map<string, string[]>()
    for (const option of LAYOUTS) {
      const key = `${option.size}:${option.count}`
      bySize.set(key, [...(bySize.get(key) ?? []), option.label])
    }
    for (const [group, labels] of bySize) {
      expect(new Set(labels).size, group).toBe(labels.length)
    }
  })

  it('แปดผังเป็นของผืนใหญ่ (เจ็ดแบบ LINE + หนึ่งแบบกำหนดเอง) ห้าผังเป็นของผืนเล็ก', () => {
    expect(layoutsOfSize('large')).toHaveLength(8)
    expect(layoutsOfSize('small')).toHaveLength(5)
  })
})

describe('origin · ผังไหนลอกมาจาก LINE ตรงๆ ผังไหนระบบนี้เพิ่มเอง', () => {
  it('มีผังแบบกำหนดเองอยู่หนึ่งแบบเท่านั้น (large_8 · ตาราง 2×4)', () => {
    const custom = LAYOUTS.filter((option) => option.origin === 'custom')
    expect(custom.map((option) => option.key)).toEqual(['large_8'])
  })

  it('ที่เหลืออีกสิบสองแบบเป็นแบบ LINE ทั้งหมด', () => {
    const line = LAYOUTS.filter((option) => option.origin === 'line')
    expect(line).toHaveLength(12)
  })
})

describe('canvasFor · ขนาดผืนภาพที่ผังนั้นบังคับ', () => {
  it('ผังของผืนใหญ่ทุกอันต้องการภาพ 2500×1686', () => {
    for (const option of layoutsOfSize('large')) {
      expect(canvasFor(option.key)).toEqual(MENU_CANVAS.large)
    }
  })

  it('ผังของผืนเล็กทุกอันต้องการภาพ 2500×843', () => {
    for (const option of layoutsOfSize('small')) {
      expect(canvasFor(option.key)).toEqual(MENU_CANVAS.small)
    }
  })
})

describe('identifyLayout · หาผังจากพิกัดช่องที่มีอยู่จริง', () => {
  it.each(LAYOUT_KEYS)('พิกัดของผัง "%s" หาผังกลับมาได้ตรงตัว', (key) => {
    expect(identifyLayout(layoutRects(key))).toBe(key)
  })

  it('ลำดับของช่องไม่มีผลต่อการหาผัง — เทียบเป็นชุด ไม่ใช่เทียบทีละตำแหน่ง', () => {
    const reversed = [...layoutRects('large_6')].reverse()
    expect(identifyLayout(reversed)).toBe('large_6')
  })

  it('พิกัดที่ไม่ตรงผังไหนเลย กลับเป็น large_1 แทนการไม่มีสถานะ', () => {
    expect(identifyLayout([])).toBe('large_1')
    expect(identifyLayout([{ x: 0, y: 0, width: 10, height: 10 }])).toBe('large_1')
  })
})

describe('asLayoutKey', () => {
  it('รับเฉพาะค่าที่อยู่ใน LAYOUT_KEYS', () => {
    expect(asLayoutKey('large_6')).toBe('large_6')
    expect(asLayoutKey('six')).toBeNull()
    expect(asLayoutKey(null)).toBeNull()
    expect(asLayoutKey(undefined)).toBeNull()
  })
})
