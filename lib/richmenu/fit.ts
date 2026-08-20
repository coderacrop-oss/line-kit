import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describeBytes } from '../assets/validate'
import { coverScale } from './scale'

/**
 * ตัด/ย่อภาพให้พอดีผืนที่ผังต้องการโดยอัตโนมัติ — เหมือนตัวเลือก "อัปโหลดรูปและ
 * นำไปใช้" ของ LINE เอง ซึ่งรับได้หลายขนาดต่อกลุ่ม ไม่ใช่ขนาดเดียวเป๊ะๆ
 *
 * ก่อนหน้านี้จอบังคับภาพขนาด 2500×1686/2500×843 พอดีเท่านั้น ภาพที่ใกล้เคียงแต่
 * ไม่ตรงเป๊ะ (เช่นถ่ายมาสี่เหลี่ยมจัตุรัส หรือย่อมาคนละอัตราส่วน) ถูกปฏิเสธหมด — ผู้ใช้
 * ต้องออกไปตัด/ย่อเองก่อนด้วยโปรแกรมอื่นแล้วค่อยกลับมาอัปโหลดใหม่ ฟังก์ชันนี้ทำงาน
 * แทนขั้นนั้น
 *
 * วิธีตัด: ย่อ/ขยายภาพต้นฉบับ (คงอัตราส่วนเดิม) จนด้านที่สั้นกว่าเทียบกับผืนเป้าหมาย
 * เต็มพอดี แล้วครอบตัดส่วนเกินออกจากกึ่งกลาง — พฤติกรรมเดียวกับ CSS `object-fit:
 * cover` ที่ภาพตัวอย่างบนจอนี้ใช้แสดงผลอยู่แล้ว ผลลัพธ์จึงตรงกับสิ่งที่คนตั้งค่าเห็น
 * ในกล่องตัวอย่างตั้งแต่ต้น
 */

/** ขยายเกินกว่านี้ภาพจะเบลอเห็นได้ชัด — ปฏิเสธแทนที่จะส่งของไม่มีคุณภาพขึ้น LINE จริง */
export const MAX_UPSCALE = 2

/** ไฟล์ต้นฉบับก่อนตัด/ย่อ เผื่อไว้กว้างกว่าคลังภาพทั่วไป เพราะภาพถ่ายความละเอียดสูงมักใหญ่กว่า 1 MB ก่อนบีบอัด */
export const SOURCE_MAX_BYTES = 8 * 1024 * 1024

/** เพดานไฟล์ผลลัพธ์ — ใช้ค่าเดียวกับคลังภาพทั่วไป (lib/assets/validate.ts) เพราะขึ้น LINE ด้วยเหตุผลเดียวกัน (กันภาพในแชทแตก/โหลดช้า) */
export const OUTPUT_MAX_BYTES = 1024 * 1024

const QUALITY_STEPS = [85, 70, 55] as const

export type FitResult =
  | { ok: true; data: Uint8Array; mime: 'image/jpeg' }
  | { ok: false; reason: string }

// coverScale ย้ายไปอยู่ที่ ./scale.ts (ฟังก์ชันบริสุทธิ์ไม่มี import ใดๆ) เพื่อให้
// lib/richmenu/crop.ts (ซึ่งถูก import จาก client component) ใช้คณิตศาสตร์ตัวเดียวกันได้
// โดยไม่ลาก @napi-rs/canvas (native binary) เข้าไปในบันเดิลฝั่งเบราว์เซอร์ด้วย —
// export ซ้ำไว้ตรงนี้เพื่อไม่ให้โค้ด/เทสต์เดิมที่ import coverScale จาก './fit' ต้องแก้
export { coverScale } from './scale'

export async function fitImageToCanvas(
  data: Uint8Array, target: { width: number; height: number },
): Promise<FitResult> {
  if (data.byteLength > SOURCE_MAX_BYTES) {
    return {
      ok: false,
      reason: `ไฟล์ต้นฉบับใหญ่เกินไป (${describeBytes(data.byteLength)}) — ลดขนาดไฟล์ก่อนอัปโหลด`,
    }
  }

  const image = await loadImage(data)
  const scale = coverScale({ width: image.width, height: image.height }, target)
  if (scale > MAX_UPSCALE) {
    return {
      ok: false,
      reason: `ภาพเล็กเกินไปสำหรับผังนี้ — ต้องขยาย ${scale.toFixed(1)} เท่าเพื่อให้เต็มผืน `
        + `${target.width}×${target.height} ซึ่งจะเห็นเบลอชัดเจน ใช้ภาพความละเอียดสูงกว่านี้`,
    }
  }

  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  const dx = (target.width - drawWidth) / 2
  const dy = (target.height - drawHeight) / 2

  const canvas = createCanvas(target.width, target.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, dx, dy, drawWidth, drawHeight)

  // ลดคุณภาพลงเป็นขั้นจนกว่าจะพอดีเพดาน — ภาพเนื้อหาซับซ้อนที่ 2500×1686 นานๆ ครั้ง
  // จะเกิน 1 MB ที่คุณภาพเริ่มต้น ลดคุณภาพยังดีกว่าปฏิเสธทั้งที่ตัด/ย่อมาถูกขนาดแล้ว
  for (const quality of QUALITY_STEPS) {
    const buffer = await canvas.encode('jpeg', quality)
    if (buffer.byteLength <= OUTPUT_MAX_BYTES) {
      return { ok: true, data: new Uint8Array(buffer), mime: 'image/jpeg' }
    }
  }

  return {
    ok: false,
    reason: `ตัด/ย่อภาพให้พอดีผังแล้ว ไฟล์ยังใหญ่เกินเพดาน ${describeBytes(OUTPUT_MAX_BYTES)} — ใช้ภาพที่มีรายละเอียดน้อยกว่านี้`,
  }
}
