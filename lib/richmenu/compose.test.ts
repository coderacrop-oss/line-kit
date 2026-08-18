import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import type { Composition, ImageLayer, TextLayer } from './composition'
import { flattenComposition } from './compose'
import { MENU_CANVAS } from './layouts'

/** ภาพจริงสีเดียว เข้ารหัส JPEG จริง — ไม่ใช่ของปลอมที่แค่มีนามสกุลถูก */
async function solidJpeg(width: number, height: number, color: string): Promise<Uint8Array> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, width, height)
  return new Uint8Array(await canvas.encode('jpeg', 95))
}

/** อ่านสี pixel เดียวจากภาพที่ flatten ออกมา — ถอดรหัสแล้ววาดลง canvas เปล่าเพื่ออ่าน getImageData */
async function pixelAt(data: Uint8Array, x: number, y: number): Promise<[number, number, number]> {
  const image = await loadImage(Buffer.from(data))
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
  return [r, g, b]
}

const closeTo = (actual: number, expected: number, tolerance = 25) => Math.abs(actual - expected) <= tolerance

const image = (patch: Partial<ImageLayer> = {}): ImageLayer => ({
  id: 'img', type: 'image', assetId: 'asset-1', fit: 'cover', x: 0, y: 0, width: 200, height: 200, ...patch,
})

const text = (patch: Partial<TextLayer> = {}): TextLayer => ({
  id: 'txt', type: 'text', text: 'สวัสดี', fontSize: 30, color: '#000000', align: 'left', bold: false,
  x: 0, y: 0, width: 300, height: 60, ...patch,
})

const composition = (patch: Partial<Composition> = {}): Composition => ({
  canvasWidth: MENU_CANVAS.large.width,
  canvasHeight: MENU_CANVAS.large.height,
  background: { type: 'color', color: '#FFFFFF' },
  layers: [],
  ...patch,
})

describe('flattenComposition · ขนาดผลลัพธ์', () => {
  it('ผลลัพธ์เป็นภาพขนาดผืนของงานแต่งภาพนั้นพอดี ไม่ว่าจะใหญ่หรือเล็ก', async () => {
    const large = await flattenComposition(composition(), async () => solidJpeg(10, 10, '#000'))
    expect(large.width).toBe(2500)
    expect(large.height).toBe(1686)

    const small = await flattenComposition(
      composition({ canvasWidth: MENU_CANVAS.small.width, canvasHeight: MENU_CANVAS.small.height }),
      async () => solidJpeg(10, 10, '#000'),
    )
    expect(small.width).toBe(2500)
    expect(small.height).toBe(843)
  })

  it('mime เป็น image/jpeg เสมอ', async () => {
    const result = await flattenComposition(composition(), async () => solidJpeg(10, 10, '#000'))
    expect(result.mime).toBe('image/jpeg')
  })
})

describe('flattenComposition · พื้นหลัง', () => {
  it('ไม่มีชั้นไหนเลย ทั้งภาพเป็นสีพื้นหลังล้วน', async () => {
    const result = await flattenComposition(composition({ background: { type: 'color', color: '#3366CC' } }), async () => solidJpeg(10, 10, '#000'))
    const [r, g, b] = await pixelAt(result.data, 1250, 843)
    expect(closeTo(r, 0x33)).toBe(true)
    expect(closeTo(g, 0x66)).toBe(true)
    expect(closeTo(b, 0xcc)).toBe(true)
  })
})

describe('flattenComposition · ชั้นภาพ', () => {
  it('สีของภาพชั้นเดียวปรากฏอยู่ในตำแหน่งกล่องของมันจริง', async () => {
    const composed = composition({
      background: { type: 'color', color: '#FFFFFF' },
      layers: [image({ x: 100, y: 100, width: 300, height: 300 })],
    })
    const result = await flattenComposition(composed, async (assetId) => {
      expect(assetId).toBe('asset-1')
      return solidJpeg(300, 300, '#CC3333')
    })
    const [r, g, b] = await pixelAt(result.data, 250, 250)
    expect(closeTo(r, 0xcc)).toBe(true)
    expect(closeTo(g, 0x33)).toBe(true)
    expect(closeTo(b, 0x33)).toBe(true)
  })

  it('นอกกล่องของภาพ ยังเป็นสีพื้นหลัง — ภาพไม่เลอะออกนอกกล่องของตัวเอง', async () => {
    const composed = composition({
      background: { type: 'color', color: '#FFFFFF' },
      layers: [image({ x: 100, y: 100, width: 200, height: 200 })],
    })
    const result = await flattenComposition(composed, async () => solidJpeg(200, 200, '#CC3333'))
    const [r, g, b] = await pixelAt(result.data, 2000, 1500)
    expect(closeTo(r, 0xff)).toBe(true)
    expect(closeTo(g, 0xff)).toBe(true)
    expect(closeTo(b, 0xff)).toBe(true)
  })

  it('ชั้นหลังในอาเรย์ (z สูงกว่า) ทับชั้นก่อนหน้าเมื่อซ้อนทับกัน', async () => {
    const composed = composition({
      layers: [
        image({ id: 'bottom', assetId: 'a-bottom', x: 100, y: 100, width: 300, height: 300 }),
        image({ id: 'top', assetId: 'a-top', x: 150, y: 150, width: 300, height: 300 }),
      ],
    })
    const result = await flattenComposition(composed, async (assetId) => (
      assetId === 'a-bottom' ? solidJpeg(300, 300, '#0000FF') : solidJpeg(300, 300, '#00FF00')
    ))
    // จุดซ้อนทับ (200,200) ต้องเป็นสีของชั้นบน (เขียว) ไม่ใช่ชั้นล่าง (น้ำเงิน)
    const [r, g, b] = await pixelAt(result.data, 200, 200)
    expect(closeTo(g, 0xff)).toBe(true)
    expect(closeTo(r, 0)).toBe(true)
    expect(closeTo(b, 0)).toBe(true)
  })

  it('fit: contain ไม่ตัดภาพ — มีพื้นที่ว่าง (สีพื้นหลัง) เหลือในกล่องถ้าสัดส่วนไม่ตรง', async () => {
    // กล่องสี่เหลี่ยมจัตุรัส แต่ภาพต้นฉบับแบนกว้าง — contain ต้องเหลือแถบพื้นหลังบน-ล่าง
    const composed = composition({
      background: { type: 'color', color: '#FFFFFF' },
      layers: [image({ x: 0, y: 0, width: 400, height: 400, fit: 'contain' })],
    })
    const result = await flattenComposition(composed, async () => solidJpeg(400, 100, '#CC3333'))
    const [, , bAtEdge] = await pixelAt(result.data, 200, 10) // มุมบนของกล่อง สี่เหลี่ยม — ควรว่าง (พื้นหลัง) เพราะภาพเตี้ยกว่ากล่องมาก
    expect(closeTo(bAtEdge, 0xff)).toBe(true)
    const [rAtCenter] = await pixelAt(result.data, 200, 200) // กึ่งกลางกล่อง — ต้องมีภาพอยู่
    expect(closeTo(rAtCenter, 0xcc)).toBe(true)
  })
})

describe('flattenComposition · ชั้นข้อความ', () => {
  it('ข้อความไทยเรนเดอร์จริง — มี pixel สีตัวอักษรปรากฏอยู่ในกล่อง ไม่ใช่ว่างเปล่า (กันปัญหาฟอนต์ไม่มีในเครื่องเซิร์ฟเวอร์)', async () => {
    const composed = composition({
      background: { type: 'color', color: '#FFFFFF' },
      layers: [text({ text: 'กขค', fontSize: 80, color: '#000000', x: 20, y: 20, width: 400, height: 120 })],
    })
    const result = await flattenComposition(composed, async () => solidJpeg(10, 10, '#000'))

    const image = await loadImage(Buffer.from(result.data))
    const canvas = createCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const region = ctx.getImageData(20, 20, 400, 120).data

    let darkPixelCount = 0
    for (let i = 0; i < region.length; i += 4) {
      if (region[i] < 100 && region[i + 1] < 100 && region[i + 2] < 100) darkPixelCount++
    }
    expect(darkPixelCount).toBeGreaterThan(50)
  })

  it('ตัดบรรทัดข้อความยาวให้พอดีความกว้างกล่อง — เกิดมากกว่าหนึ่งบรรทัดเมื่อยาวเกิน (มีหมึกทั้งแถวบนและแถวล่างของกล่อง)', async () => {
    const composed = composition({
      layers: [text({
        text: 'สวัสดีชาวโลกทุกคนวันนี้อากาศดีมากเลยครับขอให้มีความสุขกันถ้วนหน้า',
        fontSize: 40, x: 0, y: 0, width: 300, height: 600,
      })],
    })
    const result = await flattenComposition(composed, async () => solidJpeg(10, 10, '#000'))

    const image = await loadImage(Buffer.from(result.data))
    const canvas = createCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)

    const hasInkIn = (y0: number, height: number): boolean => {
      const region = ctx.getImageData(0, y0, 300, height).data
      for (let i = 0; i < region.length; i += 4) {
        if (region[i] < 150 && region[i + 1] < 150 && region[i + 2] < 150) return true
      }
      return false
    }

    // แถวแรก (ใกล้บนกล่อง) และแถวที่ไกลลงมาพอจะเป็นได้เฉพาะบรรทัดถัดๆ ไป ต้องมีหมึกทั้งคู่
    expect(hasInkIn(0, 60)).toBe(true)
    expect(hasInkIn(180, 60)).toBe(true)
  })
})

describe('flattenComposition · เพดานไฟล์ผลลัพธ์', () => {
  it('ไฟล์ผลลัพธ์ไม่เกินเพดานเดียวกับ fit.ts เสมอ', async () => {
    const composed = composition({
      layers: [image({ x: 0, y: 0, width: 2500, height: 1686 })],
    })
    const result = await flattenComposition(composed, async () => solidJpeg(2500, 1686, '#336699'))
    expect(result.data.byteLength).toBeLessThanOrEqual(1024 * 1024)
  })
})
