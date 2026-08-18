import { describe, expect, it } from 'vitest'
import { ALIGN_DIRECTIONS, alignLayer } from './align'
import type { Rect } from './gesture'

const canvas = { width: 2500, height: 1686 }
const box: Rect = { x: 300, y: 400, width: 500, height: 200 }

describe('alignLayer', () => {
  it('left — ชิดขอบซ้ายผืนภาพ (x = 0) ไม่แตะ y/ขนาด', () => {
    expect(alignLayer(box, canvas, 'left')).toEqual({ ...box, x: 0 })
  })

  it('right — ขอบขวาของชั้นชิดขอบขวาของผืนภาพพอดี', () => {
    const result = alignLayer(box, canvas, 'right')
    expect(result.x + result.width).toBe(canvas.width)
    expect(result.y).toBe(box.y)
  })

  it('top — ชิดขอบบน (y = 0)', () => {
    expect(alignLayer(box, canvas, 'top')).toEqual({ ...box, y: 0 })
  })

  it('bottom — ขอบล่างของชั้นชิดขอบล่างของผืนภาพพอดี', () => {
    const result = alignLayer(box, canvas, 'bottom')
    expect(result.y + result.height).toBe(canvas.height)
    expect(result.x).toBe(box.x)
  })

  it('center-h — อยู่กึ่งกลางแนวนอนของผืนภาพพอดี', () => {
    const result = alignLayer(box, canvas, 'center-h')
    expect(result.x).toBe((canvas.width - box.width) / 2)
    expect(result.x + box.width / 2).toBe(canvas.width / 2)
  })

  it('center-v — อยู่กึ่งกลางแนวตั้งของผืนภาพพอดี', () => {
    const result = alignLayer(box, canvas, 'center-v')
    expect(result.y).toBe((canvas.height - box.height) / 2)
  })

  it('ทุกทิศไม่แตะขนาดของชั้นเลย', () => {
    for (const direction of ALIGN_DIRECTIONS) {
      const result = alignLayer(box, canvas, direction)
      expect(result.width).toBe(box.width)
      expect(result.height).toBe(box.height)
    }
  })
})
