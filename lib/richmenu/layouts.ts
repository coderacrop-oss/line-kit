/**
 * ผังช่องของ Rich Menu · ล้วนเป็นฟังก์ชันบริสุทธิ์ ไม่แตะ DB ไม่แตะเน็ต
 *
 * L2 §5.2 (v0.30) บังคับว่าพิกัดของ `rich_menu.areas` ต้องเป็นจำนวนเต็มล้วน
 * ไม่มีหน่วยเปอร์เซ็นต์ และ "ระบบต้องคำนวณจากผังช่องเอง" — ต้นแบบวาดเป็นปุ่มเลือก
 * ผังสำเร็จรูป (`m.layouts`) ไม่ใช่ให้ลากวาดเอง ที่นี่คือตัวคำนวณนั้น
 *
 * ภาพเมนูถูกบังคับให้เป็น 2500×1686 พอดีเสมอ (ดู lib/richmenu/image.ts) ผังทุกแบบ
 * จึงคำนวณบนผืนภาพขนาดนี้ตัวเดียว ไม่ต้องรับพารามิเตอร์ขนาดภาพ
 */

export const MENU_IMAGE_WIDTH = 2500
export const MENU_IMAGE_HEIGHT = 1686

/** เพดานของ LINE เอง (L1 OI-23 / L2 §5.2) · ผังทุกแบบด้านล่างอยู่ไกลจากเพดานนี้มาก */
export const MAX_AREAS = 20

export type Rect = { x: number; y: number; width: number; height: number }

export const LAYOUT_KEYS = ['one', 'two', 'three', 'six'] as const
export type LayoutKey = (typeof LAYOUT_KEYS)[number]

export const asLayoutKey = (raw: string | null | undefined): LayoutKey | null =>
  (LAYOUT_KEYS as readonly string[]).includes(raw ?? '') ? (raw as LayoutKey) : null

export type LayoutOption = { key: LayoutKey; label: string; count: number }

/**
 * ผังสำเร็จรูปสี่แบบ · พิกัดเป็นจำนวนเต็มล้วนและเติมเต็มผืนภาพพอดี ไม่มีช่องว่าง
 * และไม่มีช่องซ้อนกัน — ตัดปัญหา ERR-038 (ผังช่องไม่ถูกต้อง) ตั้งแต่ต้นทาง เพราะ
 * ผู้ตั้งค่าเลือกได้เฉพาะผังจากชุดนี้ ไม่ได้ลากวาดเอง
 */
const LAYOUT_RECTS: Record<LayoutKey, Rect[]> = {
  one: [
    { x: 0, y: 0, width: 2500, height: 1686 },
  ],
  two: [
    { x: 0, y: 0, width: 2500, height: 843 },
    { x: 0, y: 843, width: 2500, height: 843 },
  ],
  three: [
    { x: 0, y: 0, width: 2500, height: 843 },
    { x: 0, y: 843, width: 1250, height: 843 },
    { x: 1250, y: 843, width: 1250, height: 843 },
  ],
  six: [
    { x: 0, y: 0, width: 834, height: 843 },
    { x: 834, y: 0, width: 833, height: 843 },
    { x: 1667, y: 0, width: 833, height: 843 },
    { x: 0, y: 843, width: 834, height: 843 },
    { x: 834, y: 843, width: 833, height: 843 },
    { x: 1667, y: 843, width: 833, height: 843 },
  ],
}

export const LAYOUTS: readonly LayoutOption[] = LAYOUT_KEYS.map((key) => ({
  key,
  label: String(LAYOUT_RECTS[key].length),
  count: LAYOUT_RECTS[key].length,
}))

/** พิกัดของผังหนึ่งแบบ · คืนอาเรย์ใหม่เสมอกันโค้ดเรียกไปแก้ต้นฉบับ */
export function layoutRects(key: LayoutKey): Rect[] {
  return LAYOUT_RECTS[key].map((rect) => ({ ...rect }))
}

/**
 * ผังไหนตรงกับจำนวนช่องที่มีอยู่ · ใช้ตอนโหลดแถวเดิมขึ้นมาวาดปุ่มที่กดอยู่ให้ถูก
 *
 * ไม่ได้เทียบพิกัดทีละช่อง เพราะระบบเป็นคนคำนวณพิกัดเองเสมอ (ไม่มีทางลากวาดเอง)
 * จำนวนช่องจึงบ่งชี้ผังได้ตรงพอ · ค่าที่ไม่ตรงกับผังไหนเลยกลับเป็น 'one' เพื่อให้จอ
 * มีสถานะให้วาดเสมอ แทนที่จะไม่เลือกอะไรเลย
 */
export function identifyLayout(areaCount: number): LayoutKey {
  const found = LAYOUT_KEYS.find((key) => LAYOUT_RECTS[key].length === areaCount)
  return found ?? 'one'
}
