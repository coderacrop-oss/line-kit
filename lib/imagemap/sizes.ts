import { describeBytes, IMAGE_MIME_TYPES } from '../assets/validate'

/**
 * ค่าคงที่และตัวตรวจไฟล์ของริชเมสเสจ — ล้วนเป็นฟังก์ชันบริสุทธิ์ ไม่แตะ @napi-rs/canvas
 *
 * ตั้งใจแยกออกจาก generate.ts (ตัวปั้นภาพ 5 ขนาดจริง) เพราะ @napi-rs/canvas เป็นไบนารี
 * ฝั่งเซิร์ฟเวอร์ล้วน — ครั้งหนึ่งไฟล์นี้เคย import มันปนอยู่ด้วย แล้ว ImagemapCropModal.tsx
 * ('use client') ก็ import ค่าคงที่จากไฟล์นี้ ผลคือ webpack ของ Next.js ลาก @napi-rs/canvas
 * ทั้งก้อนไปมัดรวมกับโค้ดฝั่ง browser ด้วย แล้ว build บน Vercel ล้มเพราะไบนารี .node
 * ใช้ในเบราว์เซอร์ไม่ได้ (ยืนยันจาก log จริง) — แยกไฟล์คือทางแก้ถาวร ไม่ใช่แค่เลี่ยง import
 * ที่ไม่จำเป็นออกทีละจุด เพราะไฟล์เดียวกันมีทั้งโค้ดที่ปลอดภัยและไม่ปลอดภัยสำหรับ client
 * ปนกันไม่ได้อีกต่อไป
 *
 * ดู header comment ของ generate.ts สำหรับเหตุผลที่ต้องปั้นครบ 5 ขนาดเสมอและย่อตาม
 * สัดส่วนเดิมไม่ครอบตัด — ความรู้นั้นอยู่ติดกับโค้ดที่ทำจริง ไม่ใช่ที่นี่
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
