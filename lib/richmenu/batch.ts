/**
 * §4.4 ขั้น 5c (BR-97) · ย้ายคนที่แขวนเมนูรุ่นก่อนอยู่ ไปเมนูรุ่นใหม่
 *
 * `POST /v2/bot/richmenu/batch { operations:[{type:"link", from:เก่า, to:ใหม่}] }`
 * "ข้ามขั้นนี้ถ้าเป็นการส่งขึ้นครั้งแรก (ยังไม่มีเมนูรุ่นก่อน)" — L2 §4.4 v0.30
 *
 * "ครั้งแรก" ไม่ใช่สถานะที่ต้องเก็บไว้ต่างหาก — มันคือข้อเท็จจริงที่อ่านได้จาก
 * ข้อมูลจริงของแต่ละเมนู: แถว `rich_menu` ที่ยังไม่เคยถูกอัปโหลดขึ้น LINE มาก่อน
 * มี `line_rich_menu_id` เป็น NULL (ตาม §5.2) ก่อนที่รอบ publish นี้จะเขียนทับ
 * ผู้เรียกจึงต้องจับค่าเดิมไว้ก่อนอัปโหลดรุ่นใหม่ แล้วส่งเข้ามาที่นี่เป็น
 * `previousLineRichMenuId` — เมนูที่เดิมเป็น NULL (สร้างใหม่ในรอบนี้ หรือทั้ง
 * แคมเปญยังไม่เคย publish มาก่อนเลย) จะไม่มี operation ของตัวเอง ซึ่งถูกต้องอยู่
 * แล้วเพราะไม่มีใครแขวนเมนูที่ไม่เคยมีตัวตนอยู่ · เมื่อทุกเมนูเป็นแบบนี้พร้อมกัน
 * ผลลัพธ์คืออาเรย์ว่าง เทียบเท่ากับ "ข้ามขั้นนี้" ที่เอกสารพูดถึง โดยไม่ต้องมีเงื่อนไข
 * แยกต่างหาก
 */

export type LinkOperation = { type: 'link'; from: string; to: string }

export type RepublishedMenu = {
  /** line_rich_menu_id ก่อนรอบ publish นี้ — null คือเมนูนี้ยังไม่เคยถูกอัปโหลดขึ้น LINE มาก่อน */
  previousLineRichMenuId: string | null
  /** line_rich_menu_id ใหม่ที่ได้จากการอัปโหลดรอบนี้ */
  newLineRichMenuId: string
}

export function buildLinkOperations(menus: readonly RepublishedMenu[]): LinkOperation[] {
  return menus
    .filter((menu): menu is RepublishedMenu & { previousLineRichMenuId: string } =>
      menu.previousLineRichMenuId !== null)
    .map((menu) => ({ type: 'link', from: menu.previousLineRichMenuId, to: menu.newLineRichMenuId }))
}

/** LINE รับได้ 1000 operation ต่อการเรียกหนึ่งครั้ง (L2 §4.4) */
export const MAX_BATCH_OPERATIONS = 1000

export function chunkOperations(
  operations: readonly LinkOperation[], size: number = MAX_BATCH_OPERATIONS,
): LinkOperation[][] {
  if (size <= 0) throw new Error('ขนาด chunk ต้องมากกว่าศูนย์')
  const chunks: LinkOperation[][] = []
  for (let i = 0; i < operations.length; i += size) chunks.push(operations.slice(i, i + size))
  return chunks
}
