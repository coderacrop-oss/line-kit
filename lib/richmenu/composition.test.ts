import { describe, expect, it } from 'vitest'
import { IMAGE_MAX_BYTES } from '../assets/validate'
import {
  emptyComposition, isValidHexColor, MAX_LAYERS, MAX_TEXT_LENGTH, MIN_LAYER_SIZE,
  validateComposition, validateLayerImageUpload, type Composition, type ImageLayer, type TextLayer,
} from './composition'
import { MENU_CANVAS } from './layouts'

const image = (patch: Partial<ImageLayer> = {}): ImageLayer => ({
  id: 'l1', type: 'image', assetId: 'asset-1', fit: 'cover',
  x: 0, y: 0, width: 200, height: 200, ...patch,
})

const text = (patch: Partial<TextLayer> = {}): TextLayer => ({
  id: 'l2', type: 'text', text: 'สวัสดี', fontSize: 30, color: '#000000', align: 'left', bold: false,
  x: 0, y: 0, width: 200, height: 60, ...patch,
})

const composition = (patch: Partial<Composition> = {}): Composition => ({
  canvasWidth: MENU_CANVAS.large.width,
  canvasHeight: MENU_CANVAS.large.height,
  background: { type: 'color', color: '#FFFFFF' },
  layers: [],
  ...patch,
})

describe('isValidHexColor', () => {
  it('รับเฉพาะรหัสหกหลักนำด้วย #', () => {
    expect(isValidHexColor('#17756A')).toBe(true)
    expect(isValidHexColor('#000000')).toBe(true)
  })

  it.each(['17756A', '#17756', '#GGGGGG', 'red', '', null, undefined, 123])('ปฏิเสธ %s', (value) => {
    expect(isValidHexColor(value)).toBe(false)
  })
})

describe('emptyComposition', () => {
  it('เริ่มต้นเป็นพื้นขาวล้วน ไม่มีชั้นไหนเลย', () => {
    const c = emptyComposition(MENU_CANVAS.large)
    expect(c.layers).toEqual([])
    expect(c.background).toEqual({ type: 'color', color: '#FFFFFF' })
    expect(c.canvasWidth).toBe(2500)
    expect(c.canvasHeight).toBe(1686)
  })
})

describe('validateComposition · โครงทั่วไป', () => {
  it('งานแต่งภาพที่ถูกต้องผ่านด่าน', () => {
    const result = validateComposition(composition({ layers: [image(), text()] }))
    expect(result.ok).toBe(true)
  })

  it('ไม่ใช่ object ปฏิเสธ', () => {
    expect(validateComposition(null).ok).toBe(false)
    expect(validateComposition('x').ok).toBe(false)
    expect(validateComposition(42).ok).toBe(false)
  })

  it('ขนาดผืนภาพไม่ตรงกับผืนใหญ่หรือผืนเล็กที่ระบบรองรับ ปฏิเสธ', () => {
    const result = validateComposition(composition({ canvasWidth: 1000, canvasHeight: 1000 }))
    expect(result.ok).toBe(false)
  })

  it('รับได้ทั้งผืนใหญ่และผืนเล็ก', () => {
    expect(validateComposition(composition()).ok).toBe(true)
    expect(validateComposition(composition({
      canvasWidth: MENU_CANVAS.small.width, canvasHeight: MENU_CANVAS.small.height,
    })).ok).toBe(true)
  })

  it('พื้นหลังสีที่ไม่ใช่ hex ปฏิเสธ', () => {
    const result = validateComposition(composition({ background: { type: 'color', color: 'blue' } }))
    expect(result.ok).toBe(false)
  })

  it('layers ไม่ใช่อาเรย์ ปฏิเสธ', () => {
    const result = validateComposition({ ...composition(), layers: 'x' })
    expect(result.ok).toBe(false)
  })

  it(`เกินเพดาน ${MAX_LAYERS} ชั้น ปฏิเสธ`, () => {
    const layers = Array.from({ length: MAX_LAYERS + 1 }, (_, i) => image({ id: `l${i}` }))
    const result = validateComposition(composition({ layers }))
    expect(result.ok).toBe(false)
  })

  it(`พอดีเพดาน ${MAX_LAYERS} ชั้น ยังผ่าน`, () => {
    const layers = Array.from({ length: MAX_LAYERS }, (_, i) => image({ id: `l${i}` }))
    const result = validateComposition(composition({ layers }))
    expect(result.ok).toBe(true)
  })

  it('id ของชั้นซ้ำกัน ปฏิเสธ', () => {
    const result = validateComposition(composition({ layers: [image({ id: 'dup' }), text({ id: 'dup' })] }))
    expect(result.ok).toBe(false)
  })
})

describe('validateComposition · ชั้นภาพ', () => {
  it('ไม่มี assetId ปฏิเสธ', () => {
    const result = validateComposition(composition({ layers: [image({ assetId: '' })] }))
    expect(result.ok).toBe(false)
  })

  it('fit ที่ไม่รู้จัก ปฏิเสธ', () => {
    const result = validateComposition(composition({ layers: [{ ...image(), fit: 'stretch' as never }] }))
    expect(result.ok).toBe(false)
  })
})

describe('validateComposition · ชั้นข้อความ', () => {
  it('ข้อความว่างเปล่า (หรือมีแต่ช่องว่าง) ปฏิเสธ', () => {
    expect(validateComposition(composition({ layers: [text({ text: '' })] })).ok).toBe(false)
    expect(validateComposition(composition({ layers: [text({ text: '   ' })] })).ok).toBe(false)
  })

  it(`ข้อความยาวเกิน ${MAX_TEXT_LENGTH} ตัวอักษร ปฏิเสธ`, () => {
    const result = validateComposition(composition({ layers: [text({ text: 'ก'.repeat(MAX_TEXT_LENGTH + 1) })] }))
    expect(result.ok).toBe(false)
  })

  it('สีไม่ใช่ hex ปฏิเสธ', () => {
    const result = validateComposition(composition({ layers: [text({ color: 'black' })] }))
    expect(result.ok).toBe(false)
  })

  it('การจัดแนวที่ไม่รู้จัก ปฏิเสธ', () => {
    const result = validateComposition(composition({ layers: [{ ...text(), align: 'justify' as never }] }))
    expect(result.ok).toBe(false)
  })

  it('ขนาดตัวอักษรนอกช่วงที่รับได้ ปฏิเสธ', () => {
    expect(validateComposition(composition({ layers: [text({ fontSize: 1 })] })).ok).toBe(false)
    expect(validateComposition(composition({ layers: [text({ fontSize: 9999 })] })).ok).toBe(false)
  })
})

describe('validateComposition · ตำแหน่งและขนาดของกล่อง', () => {
  it(`เล็กกว่า ${MIN_LAYER_SIZE}px ปฏิเสธ`, () => {
    const result = validateComposition(composition({ layers: [image({ width: 5, height: 5 })] }))
    expect(result.ok).toBe(false)
  })

  it('ลากยื่นเลยขอบผืนภาพได้บ้าง — ไม่ปฏิเสธทันทีที่ไม่พอดีเป๊ะ', () => {
    const result = validateComposition(composition({ layers: [image({ x: -100, y: -100 })] }))
    expect(result.ok).toBe(true)
  })

  it('ไกลจากผืนภาพเกินไป (หลุดไปหลายเท่าตัว) ปฏิเสธ', () => {
    const result = validateComposition(composition({ layers: [image({ x: -1_000_000, y: 0 })] }))
    expect(result.ok).toBe(false)
  })

  it('ใหญ่กว่าผืนภาพมากเกินไป ปฏิเสธ', () => {
    const result = validateComposition(composition({ layers: [image({ width: 1_000_000, height: 1_000_000 })] }))
    expect(result.ok).toBe(false)
  })

  it('x/y/width/height ไม่ใช่ตัวเลขจำกัดค่า (NaN/Infinity) ปฏิเสธ', () => {
    expect(validateComposition(composition({ layers: [image({ width: NaN })] })).ok).toBe(false)
    expect(validateComposition(composition({ layers: [image({ x: Infinity })] })).ok).toBe(false)
  })
})

describe('validateLayerImageUpload', () => {
  const file = (patch: Partial<{ mime: string; bytes: number; width: number; height: number }> = {}) => ({
    mime: 'image/jpeg', bytes: 1000, width: 100, height: 100, ...patch,
  })

  it('ไฟล์ปกติผ่าน แม้จะเล็กกว่า 800px ที่ validateUpload ของคลังภาพทั่วไปบังคับ', () => {
    // ต่างจาก lib/assets/validate.ts:validateUpload โดยตั้งใจ — ภาพของหนึ่งชั้น
    // ไม่ได้ขยายเต็มความกว้างแชทเหมือนภาพเมนู/การ์ดทั้งใบ
    expect(validateLayerImageUpload(file({ width: 100, height: 100 })).ok).toBe(true)
    expect(validateLayerImageUpload(file({ width: 20, height: 20 })).ok).toBe(true)
  })

  it('ชนิดไฟล์ที่ไม่รับ ปฏิเสธ', () => {
    expect(validateLayerImageUpload(file({ mime: 'image/gif' })).ok).toBe(false)
  })

  it('ไฟล์ว่าง ปฏิเสธ', () => {
    expect(validateLayerImageUpload(file({ bytes: 0 })).ok).toBe(false)
  })

  it('อ่านขนาดไม่ออก (กว้างหรือสูงเป็นศูนย์) ปฏิเสธ', () => {
    expect(validateLayerImageUpload(file({ width: 0 })).ok).toBe(false)
    expect(validateLayerImageUpload(file({ height: 0 })).ok).toBe(false)
  })

  it(`เกินเพดาน ${IMAGE_MAX_BYTES} ไบต์ ปฏิเสธ`, () => {
    expect(validateLayerImageUpload(file({ bytes: IMAGE_MAX_BYTES + 1 })).ok).toBe(false)
  })

  it('พอดีเพดานไบต์เป๊ะ ยังผ่าน', () => {
    expect(validateLayerImageUpload(file({ bytes: IMAGE_MAX_BYTES })).ok).toBe(true)
  })
})
