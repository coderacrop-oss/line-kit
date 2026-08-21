/**
 * ผังช่องของ Rich Menu · ล้วนเป็นฟังก์ชันบริสุทธิ์ ไม่แตะ DB ไม่แตะเน็ต
 *
 * L2 §5.2 (v0.30) บังคับว่าพิกัดของ `rich_menu.areas` ต้องเป็นจำนวนเต็มล้วน
 * ไม่มีหน่วยเปอร์เซ็นต์ และ "ระบบต้องคำนวณจากผังช่องเอง" — ต้นแบบวาดเป็นปุ่มเลือก
 * ผังสำเร็จรูป (`m.layouts`) ไม่ใช่ให้ลากวาดเอง ที่นี่คือตัวคำนวณนั้น
 *
 * สิบสองในสิบสี่ผังนี้ลอกมาจากชุด template ที่ LINE Official Account Manager
 * เสนอเองตอนสร้าง Rich Menu จริง — เจ็ดแบบสำหรับผืนภาพใหญ่ (2500×1686) และห้าแบบ
 * สำหรับผืนภาพเล็ก (2500×843) เดิมระบบนี้มีให้เลือกแค่สี่แบบทั้งหมดอยู่บนผืนใหญ่
 * อย่างเดียว (ตัดสินใจของงาน M4-S01 รอบแรก) ผู้ใช้เทียบกับหน้าจริงของ LINE แล้วขอ
 * ให้ตรงกันมากขึ้น — ยังคงเป็นการเลือกจาก template สำเร็จรูปเหมือนเดิม ไม่ใช่
 * ลากวาดเอง (ส่วนอัปโหลดภาพแยกทีละช่องแล้วให้ระบบต่อภาพเองเป็นคนละงาน ถูกพักไว้
 * ต่างหาก)
 *
 * อีกสองผัง (large_8 · ตาราง 2×4, large_9 · hero ใหญ่ + แบนเนอร์ + แถว 3 + แถว 4)
 * ไม่ใช่แบบที่ LINE เสนอเอง — เพิ่มตามคำขอ เพราะ LINE รับพิกัดอะไรก็ได้ที่ถูกต้อง
 * ไม่จำเป็นต้องเป็นหนึ่งในชุด template ของตัวเองเท่านั้น (เพดานจริงคือ
 * MAX_AREAS = 20 ช่อง) large_9 ลอกสัดส่วนคร่าวๆ มาจากริชเมนูจริงของ Starbucks
 * (บล็อกโปรโมทด้านบนสูงกว่าแถวไอคอนด้านล่างชัดเจน ไม่ใช่ตารางสม่ำเสมอ) —
 * `origin: 'custom'` แยกสองผังนี้ออกจากอีกสิบสองแบบให้เห็นชัดว่าไม่ได้ลอกมาจาก
 * LINE ตรงๆ
 */

export type Rect = { x: number; y: number; width: number; height: number }

/** สองขนาดผืนภาพที่ LINE ยอมรับเป็น "ขนาดแนะนำ" (L2 §5.2) — ผังทุกแบบยึดขนาดใดขนาดหนึ่งในนี้เป๊ะๆ */
export type MenuSize = 'large' | 'small'
export const MENU_CANVAS: Record<MenuSize, { width: number; height: number }> = {
  large: { width: 2500, height: 1686 },
  small: { width: 2500, height: 843 },
}

/** ไว้ให้โค้ดเก่าที่อ้างถึงผืนใหญ่ตรงๆ ยังใช้ได้ — ผืนใหญ่คือค่าที่ต้นแบบเดิมอ้างถึง */
export const MENU_IMAGE_WIDTH = MENU_CANVAS.large.width
export const MENU_IMAGE_HEIGHT = MENU_CANVAS.large.height

/** เพดานของ LINE เอง (L1 OI-23 / L2 §5.2) · ผังทุกแบบด้านล่างอยู่ไกลจากเพดานนี้มาก */
export const MAX_AREAS = 20

export const LAYOUT_KEYS = [
  'large_1', 'large_2h', 'large_2v', 'large_3top1', 'large_3top2', 'large_4', 'large_6', 'large_8', 'large_9',
  'small_1', 'small_2', 'small_3', 'small_3left1', 'small_3left2',
] as const
export type LayoutKey = (typeof LAYOUT_KEYS)[number]

export const asLayoutKey = (raw: string | null | undefined): LayoutKey | null =>
  (LAYOUT_KEYS as readonly string[]).includes(raw ?? '') ? (raw as LayoutKey) : null

/** 'line' = ลอกมาจาก template ของ LINE เองตรงๆ · 'custom' = ผังที่ระบบนี้เพิ่มเอง — LINE ไม่ได้เสนอแบบนี้ในหน้าเลือกเทมเพลตของตัวเอง */
export type LayoutOrigin = 'line' | 'custom'

export type LayoutOption = {
  key: LayoutKey; label: string; count: number; size: MenuSize; origin: LayoutOrigin
}

/**
 * ผังสำเร็จรูปสิบสองแบบ · พิกัดเป็นจำนวนเต็มล้วนและเติมเต็มผืนภาพของตัวเองพอดี
 * ไม่มีช่องว่างและไม่มีช่องซ้อนกัน — ตัดปัญหา ERR-038 (ผังช่องไม่ถูกต้อง) ตั้งแต่
 * ต้นทาง เพราะผู้ตั้งค่าเลือกได้เฉพาะผังจากชุดนี้ ไม่ได้ลากวาดเอง
 */
const LAYOUT_RECTS: Record<LayoutKey, Rect[]> = {
  // ── ผืนใหญ่ 2500×1686 ──────────────────────────────────────────────────
  large_1: [
    { x: 0, y: 0, width: 2500, height: 1686 },
  ],
  large_2h: [
    { x: 0, y: 0, width: 2500, height: 843 },
    { x: 0, y: 843, width: 2500, height: 843 },
  ],
  large_2v: [
    { x: 0, y: 0, width: 1250, height: 1686 },
    { x: 1250, y: 0, width: 1250, height: 1686 },
  ],
  large_3top1: [
    { x: 0, y: 0, width: 2500, height: 843 },
    { x: 0, y: 843, width: 1250, height: 843 },
    { x: 1250, y: 843, width: 1250, height: 843 },
  ],
  large_3top2: [
    { x: 0, y: 0, width: 1250, height: 843 },
    { x: 1250, y: 0, width: 1250, height: 843 },
    { x: 0, y: 843, width: 2500, height: 843 },
  ],
  large_4: [
    { x: 0, y: 0, width: 1667, height: 1686 },
    { x: 1667, y: 0, width: 833, height: 562 },
    { x: 1667, y: 562, width: 833, height: 562 },
    { x: 1667, y: 1124, width: 833, height: 562 },
  ],
  large_6: [
    { x: 0, y: 0, width: 834, height: 843 },
    { x: 834, y: 0, width: 833, height: 843 },
    { x: 1667, y: 0, width: 833, height: 843 },
    { x: 0, y: 843, width: 834, height: 843 },
    { x: 834, y: 843, width: 833, height: 843 },
    { x: 1667, y: 843, width: 833, height: 843 },
  ],
  // ตาราง 2×4 · ไม่ใช่แบบที่ LINE เสนอเอง (ดูหมายเหตุ origin: 'custom' ด้านบนไฟล์)
  large_8: [
    { x: 0, y: 0, width: 625, height: 843 },
    { x: 625, y: 0, width: 625, height: 843 },
    { x: 1250, y: 0, width: 625, height: 843 },
    { x: 1875, y: 0, width: 625, height: 843 },
    { x: 0, y: 843, width: 625, height: 843 },
    { x: 625, y: 843, width: 625, height: 843 },
    { x: 1250, y: 843, width: 625, height: 843 },
    { x: 1875, y: 843, width: 625, height: 843 },
  ],
  // 9 ช่อง (hero 1 + แบนเนอร์ 1 + แถว 3 + แถว 4) — ไม่ใช่แบบที่ LINE เสนอเอง เหมือน
  // large_8 (ดูหมายเหตุ origin: 'custom' ด้านบนไฟล์) เพิ่มตามคำขอเทียบกับริชเมนู
  // ของ Starbucks ที่มีบล็อกโปรโมทด้านบนสูงกว่าแถวไอคอนด้านล่าง
  large_9: [
    { x: 0, y: 0, width: 2500, height: 674 },
    { x: 0, y: 674, width: 2500, height: 168 },
    { x: 0, y: 842, width: 834, height: 422 },
    { x: 834, y: 842, width: 833, height: 422 },
    { x: 1667, y: 842, width: 833, height: 422 },
    { x: 0, y: 1264, width: 625, height: 422 },
    { x: 625, y: 1264, width: 625, height: 422 },
    { x: 1250, y: 1264, width: 625, height: 422 },
    { x: 1875, y: 1264, width: 625, height: 422 },
  ],
  // ── ผืนเล็ก 2500×843 ───────────────────────────────────────────────────
  small_1: [
    { x: 0, y: 0, width: 2500, height: 843 },
  ],
  small_2: [
    { x: 0, y: 0, width: 1250, height: 843 },
    { x: 1250, y: 0, width: 1250, height: 843 },
  ],
  small_3: [
    { x: 0, y: 0, width: 834, height: 843 },
    { x: 834, y: 0, width: 833, height: 843 },
    { x: 1667, y: 0, width: 833, height: 843 },
  ],
  small_3left1: [
    { x: 0, y: 0, width: 1667, height: 843 },
    { x: 1667, y: 0, width: 833, height: 421 },
    { x: 1667, y: 421, width: 833, height: 422 },
  ],
  small_3left2: [
    { x: 0, y: 0, width: 833, height: 421 },
    { x: 0, y: 421, width: 833, height: 422 },
    { x: 833, y: 0, width: 1667, height: 843 },
  ],
}

/** ป้ายบนปุ่มเลือกผัง — บอกทั้งจำนวนช่องและลักษณะการแบ่ง เพราะจำนวนอย่างเดียวไม่พอแยกผังที่นับช่องเท่ากัน */
const LAYOUT_LABELS: Record<LayoutKey, string> = {
  large_1: 'เต็มภาพ',
  large_2h: '2 ช่อง (บน–ล่าง)',
  large_2v: '2 ช่อง (ซ้าย–ขวา)',
  large_3top1: '3 ช่อง (บน 1 ใหญ่ + ล่าง 2)',
  large_3top2: '3 ช่อง (บน 2 + ล่าง 1 ใหญ่)',
  large_4: '4 ช่อง (ซ้าย 1 ใหญ่ + ขวา 3)',
  large_6: '6 ช่อง (ตาราง 2×3)',
  large_8: '8 ช่อง (ตาราง 2×4)',
  large_9: '9 ช่อง (บนสุด 1 ใหญ่ + แบนเนอร์ 1 + แถว 3 + แถว 4)',
  small_1: 'เต็มภาพ',
  small_2: '2 ช่อง (ซ้าย–ขวา)',
  small_3: '3 ช่อง (แนวตั้ง 3 คอลัมน์)',
  small_3left1: '3 ช่อง (ซ้าย 1 ใหญ่ + ขวา 2)',
  small_3left2: '3 ช่อง (ซ้าย 2 + ขวา 1 ใหญ่)',
}

const sizeOfKey = (key: LayoutKey): MenuSize => (key.startsWith('small') ? 'small' : 'large')

/** สองผังที่ไม่ได้ลอกมาจาก LINE ตรงๆ — ที่เหลือทั้งหมดมาจากหน้าเลือกเทมเพลตของ LINE เอง */
const CUSTOM_LAYOUTS: ReadonlySet<LayoutKey> = new Set(['large_8', 'large_9'])
const originOfKey = (key: LayoutKey): LayoutOrigin => (CUSTOM_LAYOUTS.has(key) ? 'custom' : 'line')

export const LAYOUTS: readonly LayoutOption[] = LAYOUT_KEYS.map((key) => ({
  key,
  label: LAYOUT_LABELS[key],
  count: LAYOUT_RECTS[key].length,
  size: sizeOfKey(key),
  origin: originOfKey(key),
}))

/** ผังทั้งหมดของขนาดผืนภาพหนึ่งขนาด — จอใช้จัดกลุ่ม "ภาพใหญ่"/"ภาพเล็ก" แยกกัน */
export function layoutsOfSize(size: MenuSize): LayoutOption[] {
  return LAYOUTS.filter((option) => option.size === size)
}

/** ขนาดผืนภาพที่ผังนี้ต้องใช้เป๊ะๆ — เลือกผังแล้วภาพต้องเป็นขนาดนี้พอดี ไม่งั้นครึ่งภาพจะไม่มีช่องให้กด */
export function canvasFor(key: LayoutKey): { width: number; height: number } {
  return MENU_CANVAS[sizeOfKey(key)]
}

/** พิกัดของผังหนึ่งแบบ · คืนอาเรย์ใหม่เสมอกันโค้ดเรียกไปแก้ต้นฉบับ */
export function layoutRects(key: LayoutKey): Rect[] {
  return LAYOUT_RECTS[key].map((rect) => ({ ...rect }))
}

/** ลายเซ็นของชุดสี่เหลี่ยม · ไม่สนลำดับ ใช้เทียบว่าสองชุดเป็นผังเดียวกันหรือไม่ */
function rectSetSignature(rects: readonly Rect[]): string {
  return rects
    .map((r) => `${r.x},${r.y},${r.width},${r.height}`)
    .sort()
    .join('|')
}

/**
 * ผังไหนตรงกับช่องที่มีอยู่จริง · ใช้ตอนโหลดแถวเดิมขึ้นมาวาดปุ่มที่กดอยู่ให้ถูก
 *
 * เทียบเป็นชุดพิกัดจริง ไม่ใช่แค่จำนวนช่อง เพราะตอนนี้มีมากกว่าหนึ่งผังที่นับช่อง
 * เท่ากันแต่แบ่งพื้นที่คนละแบบ (เช่น 2 ช่องบน-ล่าง กับ 2 ช่องซ้าย-ขวา) — จำนวนช่อง
 * อย่างเดียวจึงแยกไม่ออกอีกต่อไป · ค่าที่ไม่ตรงผังไหนเลยกลับเป็น large_1 เพื่อให้จอ
 * มีสถานะให้วาดเสมอ แทนที่จะไม่เลือกอะไรเลย
 */
export function identifyLayout(areas: readonly Rect[]): LayoutKey {
  const target = rectSetSignature(areas)
  const found = LAYOUT_KEYS.find((key) => rectSetSignature(LAYOUT_RECTS[key]) === target)
  return found ?? 'large_1'
}
