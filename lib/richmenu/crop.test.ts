import { describe, expect, it } from 'vitest'
import {
  clampPan, clampZoom, drawOrigin, drawScale, MAX_ZOOM, maxPan, MIN_ZOOM,
} from './crop'

describe('clampZoom', () => {
  it('ต่ำกว่า MIN_ZOOM ถูกดันขึ้นมาที่ MIN_ZOOM — ซูมออกเกิน cover-fit ไม่ได้', () => {
    expect(clampZoom(0.3)).toBe(MIN_ZOOM)
  })

  it('เกิน MAX_ZOOM ถูกดึงกลับมาที่ MAX_ZOOM', () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM)
  })

  it('อยู่ในช่วงอยู่แล้ว ไม่เปลี่ยนค่า', () => {
    expect(clampZoom(2)).toBe(2)
  })
})

describe('drawScale', () => {
  const target = { width: 2500, height: 1686 }

  it('zoom=1 (MIN_ZOOM) ให้สเกลเท่ากับ coverScale เป๊ะๆ — คือ cover-fit เดิม ไม่ซูมเพิ่ม', () => {
    // 1000x1000 → coverScale = max(2500/1000, 1686/1000) = 2.5
    expect(drawScale({ width: 1000, height: 1000 }, target, 1)).toBeCloseTo(2.5)
  })

  it('zoom=2 ให้สเกลเป็นสองเท่าของ cover-fit', () => {
    expect(drawScale({ width: 1000, height: 1000 }, target, 2)).toBeCloseTo(5)
  })

  it('zoom ที่เกินเพดานถูกหนีบก่อนคูณเสมอ — เรียกด้วย 99 เท่ากับเรียกด้วย MAX_ZOOM', () => {
    expect(drawScale({ width: 1000, height: 1000 }, target, 99))
      .toBeCloseTo(drawScale({ width: 1000, height: 1000 }, target, MAX_ZOOM))
  })
})

describe('maxPan', () => {
  it('ภาพที่วาดพอดีกรอบเป๊ะ (ไม่มีส่วนเกิน) — เลื่อนไม่ได้เลย', () => {
    expect(maxPan(2500, 2500)).toBe(0)
  })

  it('ภาพใหญ่กว่ากรอบ — เลื่อนได้ครึ่งหนึ่งของส่วนที่เกิน', () => {
    expect(maxPan(3000, 2500)).toBe(250)
  })

  it('ไม่มีทางติดลบ แม้ภาพจะเล็กกว่ากรอบ (ไม่ควรเกิดขึ้นจริงเพราะซูมต่ำสุดคือ cover-fit แต่ฟังก์ชันยังต้องปลอดภัย)', () => {
    expect(maxPan(2000, 2500)).toBe(0)
  })
})

describe('clampPan', () => {
  it('อยู่ในช่วงที่เลื่อนได้ — ไม่เปลี่ยนค่า', () => {
    expect(clampPan(100, 3000, 2500)).toBe(100)
  })

  it('เลื่อนเกินขอบขวา/ล่าง — หนีบที่ maxPan พอดี ไม่ให้เห็นช่องว่าง', () => {
    expect(clampPan(9999, 3000, 2500)).toBe(250)
  })

  it('เลื่อนเกินขอบซ้าย/บน — หนีบที่ -maxPan พอดี', () => {
    expect(clampPan(-9999, 3000, 2500)).toBe(-250)
  })

  it('ภาพพอดีกรอบเป๊ะ ไม่ว่าจะขอเลื่อนเท่าไหร่ก็หนีบกลับเป็นศูนย์เสมอ', () => {
    expect(clampPan(500, 2500, 2500)).toBe(0)
  })
})

describe('drawOrigin', () => {
  const target = { width: 2500, height: 1686 }

  it('offset เป็นศูนย์ — ภาพอยู่กึ่งกลางเป๊ะ (เหมือนพฤติกรรม fitImageToCanvas เดิม)', () => {
    const { dx, dy } = drawOrigin(3000, 2000, target, 0, 0)
    expect(dx).toBeCloseTo((2500 - 3000) / 2)
    expect(dy).toBeCloseTo((1686 - 2000) / 2)
  })

  it('เลื่อนในช่วงที่อนุญาต — บวกเข้ากับตำแหน่งกึ่งกลางตรงๆ', () => {
    const { dx, dy } = drawOrigin(3000, 2000, target, 100, 50)
    expect(dx).toBeCloseTo((2500 - 3000) / 2 + 100)
    expect(dy).toBeCloseTo((1686 - 2000) / 2 + 50)
  })

  it('เลื่อนเกินขอบที่ส่งมา — ผลลัพธ์ยังคลุมกรอบเต็มเสมอ (ไม่มีทางเห็นช่องว่างต่อให้ผู้เรียกส่งค่าพัง)', () => {
    const { dx, dy } = drawOrigin(3000, 2000, target, 999999, -999999)
    // dx ต้อง <= 0 และ dx + drawWidth ต้อง >= target.width
    expect(dx).toBeLessThanOrEqual(0)
    expect(dx + 3000).toBeGreaterThanOrEqual(target.width)
    expect(dy).toBeLessThanOrEqual(0)
    expect(dy + 2000).toBeGreaterThanOrEqual(target.height)
  })

  it('ภาพพอดีกรอบเป๊ะ (ไม่มีที่ให้เลื่อน) — dx/dy เป็นศูนย์เสมอไม่ว่า offset จะเท่าไหร่', () => {
    const { dx, dy } = drawOrigin(2500, 1686, target, 500, 500)
    expect(dx).toBe(0)
    expect(dy).toBe(0)
  })
})
