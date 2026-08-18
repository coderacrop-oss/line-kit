import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { coverScale, fitImageToCanvas, MAX_UPSCALE, OUTPUT_MAX_BYTES, SOURCE_MAX_BYTES } from './fit'

/** ภาพจริงสีเดียวขนาดที่กำหนด เข้ารหัส JPEG จริง — ไม่ใช่ของปลอมที่แค่มีนามสกุลถูก */
async function solidJpeg(width: number, height: number): Promise<Uint8Array> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#3366cc'
  ctx.fillRect(0, 0, width, height)
  return new Uint8Array(await canvas.encode('jpeg', 90))
}

describe('coverScale', () => {
  it('ภาพเล็กกว่าผืนเป้าหมายทั้งสองด้าน — ใช้สเกลของด้านที่ขาดมากกว่า', () => {
    expect(coverScale({ width: 1000, height: 1000 }, { width: 2500, height: 1686 })).toBeCloseTo(2.5)
  })

  it('ภาพใหญ่กว่าผืนเป้าหมายทั้งสองด้าน — ย่อลงด้วยสเกลของด้านที่เกินน้อยกว่า', () => {
    expect(coverScale({ width: 5000, height: 5000 }, { width: 2500, height: 1686 })).toBeCloseTo(0.5)
  })

  it('ขนาดตรงกับผืนเป้าหมายเป๊ะ — สเกลเป็น 1', () => {
    expect(coverScale({ width: 2500, height: 1686 }, { width: 2500, height: 1686 })).toBe(1)
  })
})

describe('fitImageToCanvas · ตัด/ย่อภาพให้พอดีผืนเป้าหมายอัตโนมัติ', () => {
  const target = { width: 2500, height: 1686 }

  it('ภาพสี่เหลี่ยมจัตุรัส (ไม่ตรงสัดส่วนเลย) ยังถูกตัดให้พอดีผืนใหญ่ได้ — ไม่ปฏิเสธเพราะสัดส่วนต่างกัน', async () => {
    // 1300×1300 → สเกลที่ต้องใช้ ~1.92 เท่า ยังต่ำกว่า MAX_UPSCALE (2)
    const source = await solidJpeg(1300, 1300)
    const result = await fitImageToCanvas(source, target)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mime).toBe('image/jpeg')
    expect(result.data.byteLength).toBeGreaterThan(0)
    expect(result.data.byteLength).toBeLessThanOrEqual(OUTPUT_MAX_BYTES)
  })

  it('ภาพขนาดตรงเป๊ะกับผืนเป้าหมายอยู่แล้ว ก็ยังผ่านได้ตามปกติ (สเกล 1 ไม่ใช่กรณีพิเศษที่พัง)', async () => {
    const source = await solidJpeg(target.width, target.height)
    const result = await fitImageToCanvas(source, target)
    expect(result.ok).toBe(true)
  })

  it('ผลลัพธ์เป็นภาพขนาดผืนเป้าหมายพอดี ไม่ใช่ขนาดอื่น', async () => {
    const { loadImage } = await import('@napi-rs/canvas')
    // 1300×1700 → สเกลที่ต้องใช้ ~1.92 เท่า ยังต่ำกว่า MAX_UPSCALE (2)
    const source = await solidJpeg(1300, 1700)
    const result = await fitImageToCanvas(source, target)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const decoded = await loadImage(Buffer.from(result.data))
    expect(decoded.width).toBe(target.width)
    expect(decoded.height).toBe(target.height)
  })

  it('ต้นฉบับเล็กเกินไปจนต้องขยายเกินเพดาน MAX_UPSCALE — ปฏิเสธ ไม่ส่งภาพเบลอขึ้น LINE', async () => {
    // ผืนใหญ่กว้าง 2500 · ต้นฉบับกว้าง 500 = ต้องขยาย 5 เท่า เกิน MAX_UPSCALE (2) แน่นอน
    const source = await solidJpeg(500, 338)
    const result = await fitImageToCanvas(source, target)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('เบลอ')
  })

  it('สเกลที่ต้องใช้จริงต่ำกว่า MAX_UPSCALE เล็กน้อย ยังผ่านได้ ไม่ใช่ถูกปัดตกที่ขอบพอดี', async () => {
    // ต้องขยายด้านสั้นสุด ~1.9 เท่า < 2
    const width = Math.ceil(target.width / (MAX_UPSCALE - 0.1))
    const height = Math.ceil(target.height / (MAX_UPSCALE - 0.1))
    const source = await solidJpeg(width, height)
    const result = await fitImageToCanvas(source, target)
    expect(result.ok).toBe(true)
  })

  it('ไฟล์ต้นฉบับใหญ่เกิน SOURCE_MAX_BYTES ถูกปฏิเสธก่อนแม้แต่จะพยายามถอดรหัส', async () => {
    const oversized = new Uint8Array(SOURCE_MAX_BYTES + 1)
    const result = await fitImageToCanvas(oversized, target)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('ใหญ่เกินไป')
  })

  it('ผืนเป้าหมายผืนเล็ก (2500×843) ก็ทำงานเหมือนกัน ไม่ใช่ผูกกับผืนใหญ่ตายตัว', async () => {
    const small = { width: 2500, height: 843 }
    const source = await solidJpeg(1600, 1600)
    const result = await fitImageToCanvas(source, small)
    expect(result.ok).toBe(true)
  })
})
