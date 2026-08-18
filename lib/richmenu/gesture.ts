import { MIN_LAYER_SIZE } from './composition'

/**
 * คณิตศาสตร์ล้วนๆ ของการลาก/ปรับขนาดชั้นหนึ่งชั้น — เรียกทุกเฟรมระหว่างลาก (จาก
 * requestAnimationFrame ของ LayerNode.tsx) จึงต้องเป็นฟังก์ชันบริสุทธิ์ที่เร็วและ
 * ทดสอบได้โดยไม่ต้องพึ่ง DOM/pointer event จริง — ฝั่ง UI แค่คำนวณระยะที่ลากมา
 * (deltaX/deltaY) แล้วส่งเข้าที่นี่ ทุกเฟรมคำนวณจากตำแหน่งเริ่มต้นของเจสเจอร์เดิม
 * เสมอ (ไม่ใช่ทบจากเฟรมก่อนหน้า) กันไม่ให้พลาดสะสมเวลาลากนานๆ
 */

export type Rect = { x: number; y: number; width: number; height: number }

export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type ResizeHandle = (typeof RESIZE_HANDLES)[number]

/** ลากย้ายตำแหน่ง — ขนาดไม่เปลี่ยน */
export function computeMove(origin: Rect, deltaX: number, deltaY: number): Rect {
  return { x: origin.x + deltaX, y: origin.y + deltaY, width: origin.width, height: origin.height }
}

/**
 * ลากปรับขนาดจากแฮนเดิลหนึ่งในแปดจุด — ขอบตรงข้ามกับแฮนเดิลที่ลากอยู่นิ่งเสมอ
 * (ลากมุมขวาล่าง มุมซ้ายบนต้องไม่ขยับ) ชนเพดานขนาดต่ำสุดแล้วขอบที่กำลังลากหยุด
 * ที่ระยะนั้นแทนที่จะให้ค่าติดลบหรือขนาดกลับด้าน
 */
export function computeResize(
  handle: ResizeHandle, origin: Rect, deltaX: number, deltaY: number, minSize = MIN_LAYER_SIZE,
): Rect {
  const left = handle === 'nw' || handle === 'w' || handle === 'sw'
  const right = handle === 'ne' || handle === 'e' || handle === 'se'
  const top = handle === 'nw' || handle === 'n' || handle === 'ne'
  const bottom = handle === 'sw' || handle === 's' || handle === 'se'

  let x = origin.x
  let y = origin.y
  let width = origin.width
  let height = origin.height

  if (right) width = origin.width + deltaX
  if (bottom) height = origin.height + deltaY
  if (left) { x = origin.x + deltaX; width = origin.width - deltaX }
  if (top) { y = origin.y + deltaY; height = origin.height - deltaY }

  if (width < minSize) {
    if (left) x = origin.x + origin.width - minSize
    width = minSize
  }
  if (height < minSize) {
    if (top) y = origin.y + origin.height - minSize
    height = minSize
  }

  return { x, y, width, height }
}
