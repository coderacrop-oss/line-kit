import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describeBytes, IMAGE_MIME_TYPES } from '../assets/validate'

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

/**
 * เกณฑ์ "เตือน" ไม่ใช่เกณฑ์ "ปฏิเสธ" — เล็กกว่านี้ยังอัปโหลด/ปั้นภาพได้ปกติ แค่ตัวแปร
 * กว้าง 1040 ต้องถูกขยายเกินตัวจากต้นฉบับ (เห็นเบลอได้) ดู imagemapUpscaleWarning
 */
export const MIN_SOURCE_WIDTH = IMAGEMAP_WIDTHS[IMAGEMAP_WIDTHS.length - 1]
export const SOURCE_MAX_BYTES = 8 * 1024 * 1024
export const OUTPUT_MAX_BYTES = 1024 * 1024

const QUALITY_STEPS = [85, 70, 55] as const

export type ImagemapUploadVerdict = { ok: true } | { ok: false; reason: string }

/**
 * ตรวจไฟล์ก่อนเป็นภาพฐานของริชเมสเสจ — คนละกติกากับ validateUpload() ของคลังภาพ
 * ทั่วไป (lib/assets/validate.ts) โดยตั้งใจ เหมือนที่ validateLayerImageUpload ของ
 * Rich Menu Compositor (lib/richmenu/composition.ts) ก็คนละกติกาด้วยเหตุผลเดียวกัน:
 * validateUpload บังคับกว้างอย่างน้อย 800px เพราะออกแบบมาสำหรับภาพที่ขยายเต็มความ
 * กว้างแชท — ริชเมสเสจมีพื้นอ้างอิงของตัวเอง (1040px กว้าง เป๊ะเสมอ) เพดานขั้นต่ำจึง
 * ผูกกับตัวเลขนั้นแทน ไม่ใช่ 800px ที่ยืมมาจากบริบทอื่น
 *
 * ไม่ปฏิเสธภาพที่แคบกว่า MIN_SOURCE_WIDTH อีกต่อไป (เคยปฏิเสธ) — ตัดสินใจแล้วว่ายอมรับ
 * ภาพทุกขนาด ให้คนเลือกเองว่าจะครอบ/จัดกรอบยังไงตอนอัปโหลด (ดู ImagemapCropModal.tsx)
 * แล้วปล่อยให้ตัวแปรกว้าง 1040 ถูกขยายจากต้นฉบับถ้าจำเป็น — imagemapUpscaleWarning
 * ด้านล่างเป็นคนเตือนแบบไม่บล็อกแทน
 */
export function validateImagemapUpload(
  file: { mime: string; bytes: number; width: number; height: number },
): ImagemapUploadVerdict {
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.mime)) {
    return { ok: false, reason: `ไฟล์ชนิด ${file.mime} ใช้ไม่ได้ — รับเฉพาะภาพ JPEG หรือ PNG` }
  }
  if (file.bytes <= 0) return { ok: false, reason: 'ไฟล์ว่าง ไม่มีข้อมูลอยู่ข้างใน — อัปโหลดใหม่อีกครั้ง' }
  if (file.width <= 0 || file.height <= 0) {
    return { ok: false, reason: 'อ่านขนาดของภาพในไฟล์นี้ไม่ออก — ไฟล์อาจเสียหายหรือไม่ใช่ชนิดที่บอกไว้' }
  }
  if (file.bytes > SOURCE_MAX_BYTES) {
    return {
      ok: false,
      reason: `ไฟล์ ${describeBytes(file.bytes)} เกินเพดาน ${describeBytes(SOURCE_MAX_BYTES)} — บีบอัดก่อนแล้วลองใหม่`,
    }
  }
  return { ok: true }
}

/**
 * ข้อความเตือนแบบไม่บล็อก (mild) ตอนภาพ/ส่วนที่เลือกไว้แคบกว่า MIN_SOURCE_WIDTH —
 * คู่กับ menuImageSizeWarning ของ lib/richmenu/image.ts แต่คนละความหมาย: ที่นั่นขนาด
 * ต้องตรงเป๊ะหนึ่งในสองแบบ (ปฏิเสธถ้าไม่ตรง) ส่วนที่นี่ยอมรับทุกขนาดอยู่แล้ว ข้อความนี้
 * แค่บอกไว้ก่อนว่าตัวแปร 1040px จะถูกขยายจากต้นฉบับ ไม่ใช่เหตุผลที่ทำให้ตกอะไร
 */
export function imagemapUpscaleWarning(width: number): string | null {
  if (width >= MIN_SOURCE_WIDTH) return null
  return `ส่วนที่เลือกไว้กว้าง ${width}px — แคบกว่า ${MIN_SOURCE_WIDTH}px (ขนาดใหญ่สุดที่ LINE ขอ) `
    + `ตัวแปรขนาดนั้นจะถูกขยายจากต้นฉบับ อาจเห็นเบลอเล็กน้อย`
}

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
 * ยอมรับภาพทุกขนาดกว้าง (เคยปฏิเสธภาพที่แคบกว่า 1040px/MIN_SOURCE_WIDTH — ไม่ทำแล้ว)
 * ภาพที่แคบกว่าตัวแปรกว้าง 1040 แค่ถูกขยายเกินตัว (`ctx.drawImage` scale ขึ้นตรงๆ
 * คณิตศาสตร์เดียวกับตอนย่อลง ไม่ต้องมีเส้นทางแยก) — มีแค่คำเตือนไม่บล็อกที่ชั้น UI
 * (imagemapUpscaleWarning ด้านบน) ไม่ใช่การปฏิเสธที่นี่อีกต่อไป
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
