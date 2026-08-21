import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import {
  generateImagemapVariants, IMAGEMAP_WIDTHS, imagemapUpscaleWarning, isImagemapWidth, MIN_SOURCE_WIDTH,
  OUTPUT_MAX_BYTES, SOURCE_MAX_BYTES, validateImagemapUpload,
} from './sizes'

/** ภาพจริงสีเดียวขนาดที่กำหนด เข้ารหัส JPEG จริง — ไม่ใช่ของปลอมที่แค่มีนามสกุลถูก */
async function solidJpeg(width: number, height: number): Promise<Uint8Array> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#3366cc'
  ctx.fillRect(0, 0, width, height)
  return new Uint8Array(await canvas.encode('jpeg', 90))
}

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

describe('generateImagemapVariants', () => {
  it('ภาพสี่เหลี่ยมจัตุรัสกว้าง 1040 — ได้ครบห้าขนาด สัดส่วนเดียวกันทุกขนาด', async () => {
    const source = await solidJpeg(1040, 1040)
    const result = await generateImagemapVariants(source)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.baseWidth).toBe(1040)
    expect(result.baseHeight).toBe(1040)
    for (const width of IMAGEMAP_WIDTHS) {
      const variant = result.variants[width]
      expect(variant.width).toBe(width)
      expect(variant.height).toBe(width) // จัตุรัส สัดส่วน 1:1 คงที่ทุกขนาด
      expect(variant.mime).toBe('image/jpeg')
      expect(variant.data.byteLength).toBeGreaterThan(0)
      expect(variant.data.byteLength).toBeLessThanOrEqual(OUTPUT_MAX_BYTES)
    }
  })

  it('ภาพแนวนอน 2080×1040 (2:1) — ทุกขนาดคงสัดส่วนเดิม ไม่ถูกครอบตัด', async () => {
    const source = await solidJpeg(2080, 1040)
    const result = await generateImagemapVariants(source)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.baseHeight).toBe(520) // 1040 กว้าง ที่สัดส่วน 2:1 → สูง 520
    for (const width of IMAGEMAP_WIDTHS) {
      const variant = result.variants[width]
      expect(variant.height).toBe(Math.round(width / 2))
    }
  })

  it('ผลลัพธ์แต่ละขนาดถอดรหัสกลับมาได้ขนาดตรงตามที่ประกาศไว้จริง', async () => {
    const source = await solidJpeg(1040, 780)
    const result = await generateImagemapVariants(source)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    for (const width of IMAGEMAP_WIDTHS) {
      const decoded = await loadImage(Buffer.from(result.variants[width].data))
      expect(decoded.width).toBe(width)
      expect(decoded.height).toBe(result.variants[width].height)
    }
  })

  it(`ภาพแคบกว่า ${MIN_SOURCE_WIDTH}px ผ่านได้แล้ว (เคยปฏิเสธ) — ตัวแปรกว้าง 1040 ถูกขยายจากต้นฉบับ ไม่ล้ม`, async () => {
    const narrowWidth = MIN_SOURCE_WIDTH - 1
    const source = await solidJpeg(narrowWidth, 700)
    const result = await generateImagemapVariants(source)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // ตัวแปร 1040px ต้องถูกขยายขึ้นจากต้นฉบับที่แคบกว่า (พิสูจน์ว่าเส้นทางขยายทำงานจริง ไม่ใช่แค่ไม่ throw)
    const variant1040 = result.variants[1040]
    expect(variant1040.width).toBe(1040)
    expect(variant1040.width).toBeGreaterThan(narrowWidth)

    for (const width of IMAGEMAP_WIDTHS) {
      expect(result.variants[width].width).toBe(width)
      expect(result.variants[width].data.byteLength).toBeGreaterThan(0)
    }
  })

  it(`ภาพกว้างพอดี ${MIN_SOURCE_WIDTH}px เป๊ะ ยังผ่านได้ — ไม่ใช่ถูกปัดตกที่ขอบพอดี`, async () => {
    const source = await solidJpeg(MIN_SOURCE_WIDTH, 700)
    const result = await generateImagemapVariants(source)
    expect(result.ok).toBe(true)
  })

  it('ไฟล์ต้นฉบับใหญ่เกิน SOURCE_MAX_BYTES ถูกปฏิเสธก่อนแม้แต่จะพยายามถอดรหัส', async () => {
    const oversized = new Uint8Array(SOURCE_MAX_BYTES + 1)
    const result = await generateImagemapVariants(oversized)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('ใหญ่เกินไป')
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
