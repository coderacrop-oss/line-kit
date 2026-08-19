import { describe, expect, it } from 'vitest'
import { encodePostback, decodePostback } from '../match/postback'
import { decodeRichMenuPostback, encodeRichMenuPostback } from './postback'

describe('rich menu postback', () => {
  it('เข้ารหัสแล้วถอดกลับได้ของเดิม — ชี้ไปกิจกรรม', () => {
    const p = { c: 'summer', a: 'draw' }
    expect(decodeRichMenuPostback(encodeRichMenuPostback(p))).toEqual(p)
  })

  it('เข้ารหัสแล้วถอดกลับได้ของเดิม — ชี้ไปการ์ด', () => {
    const p = { c: 'summer', card: 'card-win' }
    expect(decodeRichMenuPostback(encodeRichMenuPostback(p))).toEqual(p)
  })

  it('ค่าที่มีอักขระพิเศษยังถอดกลับได้ตรง', () => {
    const p = { c: 'sum&mer', a: 'a=b' }
    expect(decodeRichMenuPostback(encodeRichMenuPostback(p))).toEqual(p)
  })

  it('ปฏิเสธตอนสร้างเมื่อไม่มีทั้ง a และ card', () => {
    expect(() => encodeRichMenuPostback({ c: 'summer' })).toThrow(/a หรือ card/)
  })

  it('ปฏิเสธตอนสร้างเมื่อมีทั้ง a และ card พร้อมกัน', () => {
    expect(() => encodeRichMenuPostback({ c: 'summer', a: 'draw', card: 'card-win' })).toThrow(/a หรือ card/)
  })

  it('ปฏิเสธตั้งแต่ตอนสร้างเมื่อยาวเกิน 300', () => {
    const p = { c: 'x'.repeat(200), a: 'y'.repeat(200) }
    expect(() => encodeRichMenuPostback(p)).toThrow(/300/)
  })

  it('ถอดของที่ไม่ใช่ payload ของเรา คืน null ไม่โยน', () => {
    expect(decodeRichMenuPostback('')).toBeNull()
    expect(decodeRichMenuPostback('hello world')).toBeNull()
    expect(decodeRichMenuPostback('c=summer&a=draw')).toBeNull() // ไม่มี rm=1
    expect(decodeRichMenuPostback('rm=1&c=summer')).toBeNull() // ไม่มีทั้ง a และ card
    expect(decodeRichMenuPostback('rm=1&c=summer&a=draw&card=win')).toBeNull() // มีทั้งคู่
    expect(decodeRichMenuPostback('rm=0&c=summer&a=draw')).toBeNull() // rm ผิดค่า
    expect(decodeRichMenuPostback('rm=1&c=summer&a=draw&extra=x')).toBeNull() // คีย์แปลกที่ไม่รู้จัก
  })

  it('payload ของปุ่มบนการ์ดจริง (เข้ารหัสด้วย encodePostback) ไม่ถูก decodeRichMenuPostback รับ', () => {
    const cardButton = encodePostback({ c: 'summer', a: 'draw', d: '2026-08-14' })
    expect(decodeRichMenuPostback(cardButton)).toBeNull()
  })

  it('payload ของปุ่มเมนู (เข้ารหัสด้วย encodeRichMenuPostback) ไม่ถูก decodePostback รับ', () => {
    const richMenuActivity = encodeRichMenuPostback({ c: 'summer', a: 'draw' })
    const richMenuCard = encodeRichMenuPostback({ c: 'summer', card: 'card-win' })
    expect(decodePostback(richMenuActivity)).toBeNull()
    expect(decodePostback(richMenuCard)).toBeNull()
  })
})
