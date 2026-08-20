import { coverScale } from './scale'

/**
 * คณิตศาสตร์ล้วนๆ ของเครื่องมือตัดภาพก่อนอัปโหลด (M4-S01) — ให้คนเลือกเองว่าจะเก็บ
 * ส่วนไหนของภาพไว้ในผืนเป้าหมาย แทนที่จะให้ `fitImageToCanvas` (ฝั่งเซิร์ฟเวอร์)
 * ครอบตัดจากกึ่งกลางให้อัตโนมัติเสมอ
 *
 * ไม่ใช่ตัวแก้ภาพที่เล็กเกินไป — สเกลต่ำสุดที่ยอมให้ซูมออกคือ coverScale เป๊ะๆ
 * (เหมือน fitImageToCanvas ทำอัตโนมัติ) ตัดภาพไม่ได้เพิ่มพิกเซลที่ไม่มีอยู่จริง
 * ภาพที่เล็กเกินไปจนต้องขยายเกิน MAX_UPSCALE ยังถูกปฏิเสธที่ปลายทางเดิมอยู่ดี
 * (ดู lib/richmenu/fit.ts) เครื่องมือนี้แค่ให้ "เลือกส่วนไหน" ของภาพที่ใหญ่พอแล้ว
 *
 * coverScale เอง import มาจาก ./scale.ts ไม่ใช่ ./fit.ts ตรงๆ — fit.ts ใช้
 * @napi-rs/canvas (native binary ฝั่งเซิร์ฟเวอร์) ไฟล์นี้ถูก import จาก CropModal.tsx
 * ซึ่งเป็น client component ถ้า import จาก fit.ts จะลาก native binary นั้นเข้าไปใน
 * บันเดิลฝั่งเบราว์เซอร์ด้วย แล้ว `next build` จะพัง (เจอมาแล้วจริงตอนพัฒนา)
 */

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

/** ซูมต่ำสุดคือพอดีเต็มกรอบ (coverScale) เป๊ะๆ — ซูมออกกว่านี้จะเห็นขอบว่างของกรอบ จึงห้ามไว้ */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * สเกลจริงที่ใช้วาดภาพต้นฉบับ (พิกเซลของผืนเป้าหมายต่อพิกเซลต้นฉบับ) — คือ
 * coverScale เดิมของ fit.ts คูณด้วยตัวคูณซูมที่คนเพิ่มเอง (เสมอ >= MIN_ZOOM)
 */
export function drawScale(
  source: { width: number; height: number }, target: { width: number; height: number }, zoom: number,
): number {
  return coverScale(source, target) * clampZoom(zoom)
}

/** ระยะเลื่อนสูงสุดในแกนเดียว — เลื่อนเกินนี้แล้วขอบของภาพจะโผล่พ้นกรอบ เห็นเป็นช่องว่าง */
export function maxPan(drawSize: number, targetSize: number): number {
  return Math.max(0, (drawSize - targetSize) / 2)
}

/** หนีบระยะเลื่อนให้อยู่ในช่วงที่ภาพยังคลุมกรอบเต็มเสมอ ไม่มีช่องว่างโผล่ */
export function clampPan(offset: number, drawSize: number, targetSize: number): number {
  const max = maxPan(drawSize, targetSize)
  return Math.min(max, Math.max(-max, offset))
}

export type DrawOrigin = { dx: number; dy: number }

/**
 * มุมบนซ้ายจริงของภาพที่วาดบนผืนเป้าหมาย (หน่วยพิกเซลของผืนเป้าหมาย) — ใช้กับ
 * `ctx.drawImage(image, dx, dy, drawWidth, drawHeight)` ได้ตรงๆ
 *
 * offsetX/offsetY คือระยะที่คนเลื่อนภาพออกจากกึ่งกลาง (บวก = เลื่อนภาพไปทางขวา/ล่าง)
 * ถูกหนีบด้วย clampPan ก่อนเสมอ ต่อให้ผู้เรียกส่งค่าที่เกินขอบมา ผลลัพธ์ก็ยังคลุม
 * กรอบเต็มอยู่ดี — ฟังก์ชันนี้จึงไม่มีทาง "ผิด" แม้ input จะมาจาก gesture ที่ลากเกินขอบ
 */
export function drawOrigin(
  drawWidth: number, drawHeight: number, target: { width: number; height: number },
  offsetX: number, offsetY: number,
): DrawOrigin {
  const baseX = (target.width - drawWidth) / 2
  const baseY = (target.height - drawHeight) / 2
  return {
    dx: baseX + clampPan(offsetX, drawWidth, target.width),
    dy: baseY + clampPan(offsetY, drawHeight, target.height),
  }
}
