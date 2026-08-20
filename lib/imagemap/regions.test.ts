import { describe, expect, it } from 'vitest'
import {
  MAX_AREAS, MAX_ALT_TEXT_LENGTH, MAX_LABEL_LENGTH, MAX_TEXT_LENGTH, MAX_URI_LENGTH, MIN_AREA_SIZE,
  validateAltText, validateAltTextDraft, validateTapAreas, validateTapAreasDraft,
  validateVideoArea, validateVideoExternalLink, type TapArea,
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

describe('validateTapAreasDraft · ผ่อนกว่า validateTapAreas ตรงจุดเดียว: ลิงก์/ข้อความว่างได้', () => {
  it('ลิงก์ว่างเปล่า — ผ่านเป็นร่างได้ (จริง (strict) จะปฏิเสธ)', () => {
    const draft = validateTapAreasDraft([uriArea({ action: { type: 'uri', linkUri: '' } })], CANVAS_HEIGHT)
    expect(draft.ok).toBe(true)
    const strict = validateTapAreas([uriArea({ action: { type: 'uri', linkUri: '' } })], CANVAS_HEIGHT)
    expect(strict.ok).toBe(false)
  })

  it('ข้อความว่างเปล่า (message) — ผ่านเป็นร่างได้', () => {
    const draft = validateTapAreasDraft([messageArea({ action: { type: 'message', text: '' } })], CANVAS_HEIGHT)
    expect(draft.ok).toBe(true)
  })

  it('ลิงก์ที่มีค่าจริงแต่ผิดสคีม (ไม่ใช่ http/https) ยังถูกปฏิเสธแม้เป็นร่าง — ผ่อนแค่ "ว่าง" อย่างเดียว', () => {
    const draft = validateTapAreasDraft([uriArea({ action: { type: 'uri', linkUri: 'javascript:alert(1)' } })], CANVAS_HEIGHT)
    expect(draft.ok).toBe(false)
  })

  it('กรอบ/ขนาด/id ซ้ำ/เพดานจำนวน ยังถูกตรวจเข้มเหมือนเดิมทุกข้อ ไม่ใช่ผ่อนไปหมด', () => {
    expect(validateTapAreasDraft([uriArea({ width: MIN_AREA_SIZE - 1 })], CANVAS_HEIGHT).ok).toBe(false)
    expect(validateTapAreasDraft([uriArea({ id: 'dup' }), messageArea({ id: 'dup', y: 300 })], CANVAS_HEIGHT).ok).toBe(false)
  })
})

describe('validateAltTextDraft · ผ่อนกว่า validateAltText ตรงจุดเดียว: ว่างได้', () => {
  it('ว่างเปล่า — ผ่านเป็นร่างได้ (จริง (strict) จะปฏิเสธ)', () => {
    expect(validateAltTextDraft('').ok).toBe(true)
    expect(validateAltText('').ok).toBe(false)
  })

  it(`ยาวเกิน ${MAX_ALT_TEXT_LENGTH} ตัวอักษร ยังถูกปฏิเสธแม้เป็นร่าง`, () => {
    expect(validateAltTextDraft('ก'.repeat(MAX_ALT_TEXT_LENGTH + 1)).ok).toBe(false)
  })

  it('ไม่ใช่ string เลย ถูกปฏิเสธ', () => {
    expect(validateAltTextDraft(undefined).ok).toBe(false)
    expect(validateAltTextDraft(42).ok).toBe(false)
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

describe('validateVideoArea · พื้นที่เล่นวิดีโอของริชวิดีโอ', () => {
  it('null (ยังไม่เคยวางพื้นที่เลย) เป็นค่าที่ถูกต้อง ไม่ใช่ error', () => {
    expect(validateVideoArea(null, CANVAS_HEIGHT)).toEqual({ ok: true, area: null })
  })

  it('undefined ก็เป็นค่าที่ถูกต้องเช่นกัน', () => {
    expect(validateVideoArea(undefined, CANVAS_HEIGHT)).toEqual({ ok: true, area: null })
  })

  it('กรอบที่ถูกต้อง — ผ่าน คืนกรอบเดิมกลับมา', () => {
    const box = { x: 10, y: 20, width: 300, height: 150 }
    expect(validateVideoArea(box, CANVAS_HEIGHT)).toEqual({ ok: true, area: box })
  })

  it('เล็กกว่า MIN_AREA_SIZE — ปฏิเสธ กฎเดียวกับพื้นที่กด', () => {
    const out = validateVideoArea({ x: 0, y: 0, width: MIN_AREA_SIZE - 1, height: 100 }, CANVAS_HEIGHT)
    expect(out.ok).toBe(false)
  })

  it('หลุดขอบภาพด้านล่าง — ปฏิเสธ', () => {
    const out = validateVideoArea({ x: 0, y: CANVAS_HEIGHT - 10, width: 100, height: 100 }, CANVAS_HEIGHT)
    expect(out.ok).toBe(false)
  })

  it('หลุดขอบด้านขวา (เกิน 1040 กว้างอ้างอิง) — ปฏิเสธ', () => {
    const out = validateVideoArea({ x: 900, y: 0, width: 300, height: 100 }, CANVAS_HEIGHT)
    expect(out.ok).toBe(false)
  })

  it('รูปร่างไม่ใช่ object — ปฏิเสธ', () => {
    expect(validateVideoArea('not-an-object', CANVAS_HEIGHT).ok).toBe(false)
  })

  it('ไม่มีชนิดแอ็กชัน/label ติดมาด้วยเลย — คืนแค่กรอบสี่ค่า ไม่มีฟิลด์เกิน', () => {
    const result = validateVideoArea({ x: 1, y: 2, width: 100, height: 100, action: { type: 'uri' } }, CANVAS_HEIGHT)
    expect(result).toEqual({ ok: true, area: { x: 1, y: 2, width: 100, height: 100 } })
  })
})

describe('validateVideoExternalLink · ลิงก์หลังวิดีโอเล่นจบ', () => {
  it('ว่างทั้งคู่ — ผ่าน (ไม่บังคับต้องมี ต่างจากลิงก์ของพื้นที่กด)', () => {
    expect(validateVideoExternalLink('', '')).toEqual({ ok: true, linkUri: '', label: '' })
  })

  it('ลิงก์ http/https ปกติ — ผ่าน', () => {
    expect(validateVideoExternalLink('https://example.com/more', 'ดูเพิ่ม'))
      .toEqual({ ok: true, linkUri: 'https://example.com/more', label: 'ดูเพิ่ม' })
  })

  it('ลิงก์ไม่ใช่ http/https (เช่น javascript:) — ปฏิเสธ', () => {
    expect(validateVideoExternalLink('javascript:alert(1)', '').ok).toBe(false)
  })

  it('ลิงก์รูปแบบผิด (parse ไม่ได้เลย) — ปฏิเสธ', () => {
    expect(validateVideoExternalLink('not a url', '').ok).toBe(false)
  })

  it(`ลิงก์ยาวเกิน ${MAX_URI_LENGTH} ตัวอักษร — ปฏิเสธ`, () => {
    expect(validateVideoExternalLink('https://example.com/' + 'a'.repeat(MAX_URI_LENGTH), '').ok).toBe(false)
  })

  it(`ป้ายกำกับยาวเกิน ${MAX_LABEL_LENGTH} ตัวอักษร — ปฏิเสธ`, () => {
    expect(validateVideoExternalLink('', 'ก'.repeat(MAX_LABEL_LENGTH + 1)).ok).toBe(false)
  })

  it('ไม่ใช่ข้อความ (ชนิดผิด) — ปฏิเสธ', () => {
    expect(validateVideoExternalLink(123, '').ok).toBe(false)
    expect(validateVideoExternalLink('', 123).ok).toBe(false)
  })
})
