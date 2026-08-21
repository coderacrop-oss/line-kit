import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describeBytes } from '../assets/validate'
import {
  IMAGEMAP_WIDTHS, OUTPUT_MAX_BYTES, SOURCE_MAX_BYTES,
  type ImagemapVariant, type ImagemapVariantsResult, type ImagemapWidth,
} from './sizes'

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
 *
 * import @napi-rs/canvas เฉพาะไฟล์นี้ไฟล์เดียว — ห้ามย้ายกลับไปรวมกับ sizes.ts อีก
 * (ดูเหตุผลใน header comment ของไฟล์นั้น) ตัวไหน 'use client' import จากไฟล์นี้ตรงๆ
 * คือ import ผิดไฟล์แน่นอน
 */

const QUALITY_STEPS = [85, 70, 55] as const

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
 * ยอมรับภาพทุกขนาดกว้าง (เคยปฏิเสธภาพที่แคบกว่า 1040px/MIN_SOURCE_WIDTH — ไม่ทำแล้ว)
 * ภาพที่แคบกว่าตัวแปรกว้าง 1040 แค่ถูกขยายเกินตัว (`ctx.drawImage` scale ขึ้นตรงๆ
 * คณิตศาสตร์เดียวกับตอนย่อลง ไม่ต้องมีเส้นทางแยก) — มีแค่คำเตือนไม่บล็อกที่ชั้น UI
 * (imagemapUpscaleWarning ของ sizes.ts) ไม่ใช่การปฏิเสธที่นี่อีกต่อไป
 */
export async function generateImagemapVariants(data: Uint8Array): Promise<ImagemapVariantsResult> {
  if (data.byteLength > SOURCE_MAX_BYTES) {
    return {
      ok: false,
      reason: `ไฟล์ต้นฉบับใหญ่เกินไป (${describeBytes(data.byteLength)}) — ลดขนาดไฟล์ก่อนอัปโหลด`,
    }
  }

  const image = await loadImage(data)

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
