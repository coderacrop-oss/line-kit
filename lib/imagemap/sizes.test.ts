import { describe, expect, it } from 'vitest'
import {
  IMAGEMAP_WIDTHS, imagemapUpscaleWarning, isImagemapWidth, MIN_SOURCE_WIDTH,
  SOURCE_MAX_BYTES, validateImagemapUpload,
} from './sizes'

// generateImagemapVariants (@napi-rs/canvas, ฝั่งเซิร์ฟเวอร์ล้วน) ย้ายไปเทสต์ใน
// generate.test.ts คู่กับ generate.ts — ดูเหตุผลใน header comment ของ sizes.ts

describe('isImagemapWidth', () => {
  it('รับเฉพาะห้าขนาดที่ LINE ขอเป๊ะๆ', () => {
    expect(IMAGEMAP_WIDTHS).toEqual([240, 300, 460, 700, 1040])
    for (const width of IMAGEMAP_WIDTHS) expect(isImagemapWidth(width)).toBe(true)
  })

  it('ปฏิเสธขนาดอื่นทั้งหมด รวมถึงค่าที่ใกล้เคียง', () => {
    for (const width of [0, -1, 239, 241, 500, 1041, 2500, 1.5]) {
      expect(isImagemapWidth(width)).toBe(false)
    }
  })
})

describe('validateImagemapUpload', () => {
  const okFile = { mime: 'image/jpeg', bytes: 1000, width: 1200, height: 800 }

  it('ไฟล์ปกติผ่านด่าน', () => {
    expect(validateImagemapUpload(okFile)).toEqual({ ok: true })
  })

  it('ชนิดไฟล์อื่นนอกจาก JPEG/PNG ปฏิเสธ', () => {
    expect(validateImagemapUpload({ ...okFile, mime: 'image/gif' }).ok).toBe(false)
  })

  it('ไฟล์ว่าง (0 ไบต์) ปฏิเสธ', () => {
    expect(validateImagemapUpload({ ...okFile, bytes: 0 }).ok).toBe(false)
  })

  it('ขนาดภาพเป็นศูนย์ ปฏิเสธ', () => {
    expect(validateImagemapUpload({ ...okFile, width: 0 }).ok).toBe(false)
    expect(validateImagemapUpload({ ...okFile, height: 0 }).ok).toBe(false)
  })

  it(`ไฟล์ใหญ่เกิน ${SOURCE_MAX_BYTES} ไบต์ ปฏิเสธ`, () => {
    expect(validateImagemapUpload({ ...okFile, bytes: SOURCE_MAX_BYTES + 1 }).ok).toBe(false)
  })

  it(`แคบกว่า ${MIN_SOURCE_WIDTH}px ผ่านได้แล้ว (เคยปฏิเสธ) — ตอนนี้แค่เตือนไม่บล็อกที่ชั้น UI แทน`, () => {
    expect(validateImagemapUpload({ ...okFile, width: MIN_SOURCE_WIDTH - 1 })).toEqual({ ok: true })
  })

  it(`กว้างพอดี ${MIN_SOURCE_WIDTH}px เป๊ะ ผ่านได้ — ไม่ใช่ถูกปัดตกที่ขอบพอดี`, () => {
    expect(validateImagemapUpload({ ...okFile, width: MIN_SOURCE_WIDTH }).ok).toBe(true)
  })

  it('MIN_SOURCE_WIDTH คือ 1040 (ขนาดใหญ่สุดของ LINE) ไม่ใช่ 800px ที่ยืมมาจากคลังภาพทั่วไป', () => {
    expect(MIN_SOURCE_WIDTH).toBe(1040)
  })
})

describe('imagemapUpscaleWarning', () => {
  it(`กว้างพอดีหรือมากกว่า ${MIN_SOURCE_WIDTH}px — ไม่เตือน (null)`, () => {
    expect(imagemapUpscaleWarning(MIN_SOURCE_WIDTH)).toBeNull()
    expect(imagemapUpscaleWarning(MIN_SOURCE_WIDTH + 500)).toBeNull()
  })

  it(`แคบกว่า ${MIN_SOURCE_WIDTH}px — เตือนด้วยข้อความไม่ว่าง`, () => {
    const warning = imagemapUpscaleWarning(MIN_SOURCE_WIDTH - 1)
    expect(warning).not.toBeNull()
    expect(warning?.length).toBeGreaterThan(0)
  })
})
