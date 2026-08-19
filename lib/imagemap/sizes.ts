import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describeBytes } from '../assets/validate'

/**
 * ปั้นภาพต้นฉบับหนึ่งภาพให้กลายเป็นภาพ 5 ขนาดที่ LINE ดึงไปแสดง — ยืนยันจาก source
 * ของ line-bot-sdk-nodejs (ImagemapMessage.baseSize + ตัวอย่างจริงที่เผยแพร่) ว่า
 * LINE เรียก `{baseUrl}/240`, `/300`, `/460`, `/700`, `/1040` เอง (ไม่มีนามสกุลไฟล์
 * ต่อท้าย) แล้วเลือกใช้ขนาดไหนตามไคลเอนต์ของผู้เล่นเอง — ฝั่งเราต้องเตรียมไว้ให้
 * ครบทั้งห้าเสมอ ไม่ใช่ resize สดตอนมีคนขอ (เส้นทางนี้ถูกยิงจากเซิร์ฟเวอร์ของ LINE
 * ทุกครั้งที่การ์ดถูกแสดง เร็วเท่าที่ทำได้คือข้อกำหนดจริง ไม่ใช่แค่ทางเลือก)
 *
 * ทั้งห้าขนาดต้องเป็นภาพเดียวกัน สัดส่วนเดียวกัน — ย่อตามสัดส่วนเดิมล้วนๆ ไม่ครอบตัด
 * (คนละกติกากับ fitImageToCanvas ของ Rich Menu ที่ครอบให้เต็มผืนเป้าหมายเสมอ เพราะ
 * ที่นั่นภาพต้องเต็มกรอบเมนูพอดี ส่วนที่นี่ผืนภาพยึดตามสัดส่วนของภาพที่คนอัปโหลดเอง)
 */

export const IMAGEMAP_WIDTHS = [240, 300, 460, 700, 1040] as const
export type ImagemapWidth = (typeof IMAGEMAP_WIDTHS)[number]

export const isImagemapWidth = (value: number): value is ImagemapWidth =>
  (IMAGEMAP_WIDTHS as readonly number[]).includes(value)

/** เล็กกว่านี้ต้องขยายเกินตัวเพื่อให้ได้ตัวแปรกว้าง 1040 — เห็นเบลอชัดเจน */
export const MIN_SOURCE_WIDTH = IMAGEMAP_WIDTHS[IMAGEMAP_WIDTHS.length - 1]
export const SOURCE_MAX_BYTES = 8 * 1024 * 1024
export const OUTPUT_MAX_BYTES = 1024 * 1024

const QUALITY_STEPS = [85, 70, 55] as const

export type ImagemapVariant = { data: Uint8Array; mime: 'image/jpeg'; width: number; height: number }

export type ImagemapVariantsResult =
  | { ok: true; baseWidth: number; baseHeight: number; variants: Record<ImagemapWidth, ImagemapVariant> }
  | { ok: false; reason: string }

async function encodeWithQualityFallback(
  canvas: { encode: (f: 'jpeg', q: number) => Promise<Buffer> }, label: string,
): Promise<Uint8Array> {
  for (const quality of QUALITY_STEPS) {
    const buffer = await canvas.encode('jpeg', quality)
    if (buffer.byteLength <= OUTPUT_MAX_BYTES) return new Uint8Array(buffer)
  }
  throw new Error(
    `ย่อภาพขนาด ${label} แล้ว ไฟล์ยังใหญ่เกินเพดาน ${describeBytes(OUTPUT_MAX_BYTES)} — ใช้ภาพที่มีรายละเอียดน้อยกว่านี้`,
  )
}

/**
 * ย่อภาพต้นฉบับให้ได้ทั้งห้าขนาดของ LINE พร้อมกัน — คงสัดส่วนเดิมทุกขนาด
 *
 * ปฏิเสธภาพที่แคบกว่า 1040px (MIN_SOURCE_WIDTH) เพราะขนาดใหญ่สุดที่ LINE ขอคือ
 * 1040px กว้าง — แคบกว่านี้ต้องขยายเกินตัวเสมอ ต่างจาก validateUpload ทั่วไปของคลัง
 * ภาพ (lib/assets/validate.ts) ที่ตั้งพื้นขั้นต่ำไว้ที่ 800px สำหรับภาพเต็มความกว้าง
 * แชท — ริชเมสเสจมีพื้นของตัวเอง ไม่ใช้ค่าเดียวกัน
 */
export async function generateImagemapVariants(data: Uint8Array): Promise<ImagemapVariantsResult> {
  if (data.byteLength > SOURCE_MAX_BYTES) {
    return {
      ok: false,
      reason: `ไฟล์ต้นฉบับใหญ่เกินไป (${describeBytes(data.byteLength)}) — ลดขนาดไฟล์ก่อนอัปโหลด`,
    }
  }

  const image = await loadImage(data)
  if (image.width < MIN_SOURCE_WIDTH) {
    return {
      ok: false,
      reason: `ภาพกว้าง ${image.width}px — เล็กเกินไปสำหรับริชเมสเสจ ต้องกว้างอย่างน้อย ${MIN_SOURCE_WIDTH}px `
        + `(ขนาดใหญ่สุดที่ LINE ขอ) ใช้ภาพความละเอียดสูงกว่านี้`,
    }
  }

  const baseWidth = IMAGEMAP_WIDTHS[IMAGEMAP_WIDTHS.length - 1]
  const baseHeight = Math.round(image.height * (baseWidth / image.width))

  const variants = {} as Record<ImagemapWidth, ImagemapVariant>
  for (const width of IMAGEMAP_WIDTHS) {
    const height = Math.round(image.height * (width / image.width))
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0, width, height)
    const encoded = await encodeWithQualityFallback(canvas, `${width}px`)
    variants[width] = { data: encoded, mime: 'image/jpeg', width, height }
  }

  return { ok: true, baseWidth, baseHeight, variants }
}
