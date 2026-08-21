import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { generateImagemapVariants } from './generate'
import { IMAGEMAP_WIDTHS, MIN_SOURCE_WIDTH, OUTPUT_MAX_BYTES, SOURCE_MAX_BYTES } from './sizes'

/** ภาพจริงสีเดียวขนาดที่กำหนด เข้ารหัส JPEG จริง — ไม่ใช่ของปลอมที่แค่มีนามสกุลถูก */
async function solidJpeg(width: number, height: number): Promise<Uint8Array> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#3366cc'
  ctx.fillRect(0, 0, width, height)
  return new Uint8Array(await canvas.encode('jpeg', 90))
}

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
