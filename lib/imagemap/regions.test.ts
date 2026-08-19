import { describe, expect, it } from 'vitest'
import {
  MAX_AREAS, MAX_ALT_TEXT_LENGTH, MAX_LABEL_LENGTH, MAX_TEXT_LENGTH, MAX_URI_LENGTH, MIN_AREA_SIZE,
  validateAltText, validateTapAreas, type TapArea,
} from './regions'

const CANVAS_HEIGHT = 600

const uriArea = (patch: Partial<TapArea> = {}): TapArea => ({
  id: 'a1', x: 10, y: 10, width: 200, height: 100,
  action: { type: 'uri', linkUri: 'https://example.com' },
  ...patch,
})

const messageArea = (patch: Partial<TapArea> = {}): TapArea => ({
  id: 'a2', x: 10, y: 10, width: 200, height: 100,
  action: { type: 'message', text: 'สวัสดี' },
  ...patch,
})

describe('validateTapAreas · โครงทั่วไป', () => {
  it('ชุดพื้นที่ที่ถูกต้องผ่านด่าน — ทั้ง uri และ message', () => {
    const result = validateTapAreas([uriArea(), messageArea({ id: 'a2', y: 200 })], CANVAS_HEIGHT)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.areas).toHaveLength(2)
  })

  it('ว่างเปล่าก็ผ่าน — การ์ดที่ยังไม่วาดพื้นที่กดเลยยังบันทึกร่างได้', () => {
    expect(validateTapAreas([], CANVAS_HEIGHT).ok).toBe(true)
  })

  it('ไม่ใช่ array ปฏิเสธ', () => {
    expect(validateTapAreas(null, CANVAS_HEIGHT).ok).toBe(false)
    expect(validateTapAreas({}, CANVAS_HEIGHT).ok).toBe(false)
  })

  it(`เกินเพดาน ${MAX_AREAS} พื้นที่ ปฏิเสธ`, () => {
    const many = Array.from({ length: MAX_AREAS + 1 }, (_, i) => uriArea({ id: `a${i}`, y: i }))
    const result = validateTapAreas(many, 10_000)
    expect(result.ok).toBe(false)
  })

  it('id ซ้ำกัน ปฏิเสธ', () => {
    const result = validateTapAreas([uriArea({ id: 'dup' }), messageArea({ id: 'dup', y: 300 })], CANVAS_HEIGHT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('ซ้ำ')
  })

  it('ไม่มี id ปฏิเสธ', () => {
    const result = validateTapAreas([{ ...uriArea(), id: '' }], CANVAS_HEIGHT)
    expect(result.ok).toBe(false)
  })
})

describe('validateTapAreas · กรอบพื้นที่', () => {
  it(`เล็กกว่าเพดานต่ำสุด ${MIN_AREA_SIZE}px ปฏิเสธ`, () => {
    expect(validateTapAreas([uriArea({ width: MIN_AREA_SIZE - 1 })], CANVAS_HEIGHT).ok).toBe(false)
    expect(validateTapAreas([uriArea({ height: MIN_AREA_SIZE - 1 })], CANVAS_HEIGHT).ok).toBe(false)
  })

  it('พอดีเพดานต่ำสุดเป๊ะ ผ่าน', () => {
    expect(validateTapAreas([uriArea({ width: MIN_AREA_SIZE, height: MIN_AREA_SIZE })], CANVAS_HEIGHT).ok).toBe(true)
  })

  it('x หรือ y ติดลบ หลุดขอบซ้าย/บน ปฏิเสธ', () => {
    expect(validateTapAreas([uriArea({ x: -1 })], CANVAS_HEIGHT).ok).toBe(false)
    expect(validateTapAreas([uriArea({ y: -1 })], CANVAS_HEIGHT).ok).toBe(false)
  })

  it('พื้นที่ยื่นเลยขอบขวา (x+width > 1040) ปฏิเสธ', () => {
    expect(validateTapAreas([uriArea({ x: 900, width: 200 })], CANVAS_HEIGHT).ok).toBe(false)
  })

  it('พื้นที่ยื่นเลยขอบล่าง (y+height > canvasHeight) ปฏิเสธ', () => {
    expect(validateTapAreas([uriArea({ y: CANVAS_HEIGHT - 10, height: 50 })], CANVAS_HEIGHT).ok).toBe(false)
  })

  it('พิกัดไม่ใช่ตัวเลข ปฏิเสธ', () => {
    expect(validateTapAreas([{ ...uriArea(), x: 'ten' }], CANVAS_HEIGHT).ok).toBe(false)
  })
})

describe('validateTapAreas · แอ็กชัน uri', () => {
  it('ไม่มีลิงก์ ปฏิเสธ', () => {
    expect(validateTapAreas([uriArea({ action: { type: 'uri', linkUri: '' } })], CANVAS_HEIGHT).ok).toBe(false)
  })

  it('ลิงก์ไม่ใช่ http/https ปฏิเสธ', () => {
    expect(validateTapAreas([uriArea({ action: { type: 'uri', linkUri: 'ftp://x.com' } })], CANVAS_HEIGHT).ok).toBe(false)
    expect(validateTapAreas([uriArea({ action: { type: 'uri', linkUri: 'javascript:alert(1)' } })], CANVAS_HEIGHT).ok).toBe(false)
  })

  it(`ลิงก์ยาวเกิน ${MAX_URI_LENGTH} ตัวอักษร ปฏิเสธ`, () => {
    const long = `https://example.com/${'a'.repeat(MAX_URI_LENGTH)}`
    expect(validateTapAreas([uriArea({ action: { type: 'uri', linkUri: long } })], CANVAS_HEIGHT).ok).toBe(false)
  })

  it('มีป้ายกำกับ (label) เก็บไว้ · ว่างหรือไม่ใส่แปลว่าไม่มีป้าย', () => {
    const withLabel = validateTapAreas(
      [uriArea({ action: { type: 'uri', linkUri: 'https://example.com', label: 'ไปหน้าโปรโมชัน' } })], CANVAS_HEIGHT,
    )
    expect(withLabel.ok).toBe(true)
    if (withLabel.ok) expect(withLabel.areas[0].action).toMatchObject({ label: 'ไปหน้าโปรโมชัน' })

    const withoutLabel = validateTapAreas([uriArea({ action: { type: 'uri', linkUri: 'https://example.com' } })], CANVAS_HEIGHT)
    if (withoutLabel.ok) expect(withoutLabel.areas[0].action).not.toHaveProperty('label')
  })

  it(`ป้ายกำกับยาวเกิน ${MAX_LABEL_LENGTH} ตัวอักษร ปฏิเสธ`, () => {
    const long = 'ก'.repeat(MAX_LABEL_LENGTH + 1)
    expect(validateTapAreas([uriArea({ action: { type: 'uri', linkUri: 'https://example.com', label: long } })], CANVAS_HEIGHT).ok).toBe(false)
  })
})

describe('validateTapAreas · แอ็กชัน message', () => {
  it('ไม่มีข้อความ ปฏิเสธ', () => {
    expect(validateTapAreas([messageArea({ action: { type: 'message', text: '' } })], CANVAS_HEIGHT).ok).toBe(false)
  })

  it(`ข้อความยาวเกิน ${MAX_TEXT_LENGTH} ตัวอักษร ปฏิเสธ`, () => {
    const long = 'ก'.repeat(MAX_TEXT_LENGTH + 1)
    expect(validateTapAreas([messageArea({ action: { type: 'message', text: long } })], CANVAS_HEIGHT).ok).toBe(false)
  })
})

describe('validateTapAreas · ชนิดแอ็กชันอื่นที่ไม่รองรับ', () => {
  it('postback หรือ clipboard ปฏิเสธ — BR-47 รองรับแค่ uri กับ message', () => {
    expect(validateTapAreas([uriArea({ action: { type: 'postback' } as never })], CANVAS_HEIGHT).ok).toBe(false)
    expect(validateTapAreas([uriArea({ action: { type: 'clipboard' } as never })], CANVAS_HEIGHT).ok).toBe(false)
  })
})

describe('validateAltText', () => {
  it('ข้อความปกติผ่าน', () => {
    const result = validateAltText('โปรโมชันพิเศษ')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.altText).toBe('โปรโมชันพิเศษ')
  })

  it('ว่างเปล่าหรือมีแต่ช่องว่าง ปฏิเสธ — LINE บังคับให้มีเสมอ', () => {
    expect(validateAltText('').ok).toBe(false)
    expect(validateAltText('   ').ok).toBe(false)
    expect(validateAltText(undefined).ok).toBe(false)
  })

  it(`ยาวเกิน ${MAX_ALT_TEXT_LENGTH} ตัวอักษร ปฏิเสธ`, () => {
    expect(validateAltText('ก'.repeat(MAX_ALT_TEXT_LENGTH + 1)).ok).toBe(false)
  })
})
