import { describe, expect, it } from 'vitest'
import { decodePostback, encodePostback } from './postback'

describe('postback', () => {
  it('เข้ารหัสแล้วถอดกลับได้ของเดิม', () => {
    const p = { c: 'krobpet', a: 'feed', d: '2026-08-14', p: '3' }
    expect(decodePostback(encodePostback(p))).toEqual(p)
  })

  it('ช่องที่ไม่ได้ใส่ ไม่โผล่ตอนถอด', () => {
    const p = { c: 'krobpet', a: 'feed', d: '2026-08-14' }
    const back = decodePostback(encodePostback(p))
    expect(back).toEqual(p)
    expect(back).not.toHaveProperty('r')
  })

  it('ปฏิเสธตั้งแต่ตอนสร้างเมื่อยาวเกิน 300', () => {
    const p = { c: 'x'.repeat(200), a: 'y'.repeat(200), d: '2026-08-14' }
    expect(() => encodePostback(p)).toThrow(/300/)
  })

  it('ค่าที่มีอักขระพิเศษยังถอดกลับได้ตรง', () => {
    const p = { c: 'krobpet', a: 'feed', d: '2026-08-14', p: 'a&b=c' }
    expect(decodePostback(encodePostback(p))).toEqual(p)
  })

  it('ถอดของที่ไม่ใช่ payload ของเรา คืน null ไม่โยน', () => {
    expect(decodePostback('')).toBeNull()
    expect(decodePostback('hello world')).toBeNull()
    expect(decodePostback('a=feed&d=2026-08-14')).toBeNull()
  })
})
