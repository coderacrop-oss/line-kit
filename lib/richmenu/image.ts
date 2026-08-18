import { MENU_CANVAS } from './layouts'

/**
 * ภาพเมนูต้องเป็นหนึ่งในสองขนาดแนะนำของ LINE พอดี — ผืนใหญ่ 2500×1686 (ต้นแบบเดิม
 * "ภาพเมนู (บังคับ · 2500×1686)" และตาราง `asset` ของ L2 §5.2) หรือผืนเล็ก 2500×843
 * (ชุดผัง small_* ของ lib/richmenu/layouts.ts) — ผังที่เลือกไว้เป็นตัวบอกว่าภาพต้อง
 * เป็นขนาดไหนใน "สอง" ขนาดนี้เป๊ะๆ (ดู canvasFor() ใน layouts.ts และการตรวจคู่กันที่
 * app/(admin)/campaigns/[id]/richmenu/actions.ts) ฟังก์ชันในไฟล์นี้ตรวจแค่ "เป็น
 * ขนาดใดขนาดหนึ่งในสองนี้หรือเปล่า" แบบกว้างๆ ไว้ใช้กับข้อมูลเก่าที่ยังไม่ได้ผูกกับ
 * ผังใดผังหนึ่งโดยตรง (imageBad ของ lib/db/richmenu.ts)
 *
 * L2 §5.2 (ตาราง rich_menu) ยังอ้างค่าทั่วไปของ LINE เอง — JPEG/PNG · กว้าง 800
 * ถึง 2500 · สูงอย่างน้อย 250 · เป็นช่วงกว้างที่ LINE ยอมรับได้ทั้งหมด ไม่ใช่กฎของ
 * แอปนี้ · แอปนี้เลือกบังคับเฉพาะสองขนาดแนะนำเป๊ะๆ เพื่อไม่ต้องคำนวณพิกัดผังใหม่
 * ทุกขนาดภาพที่เป็นไปได้
 */
export function isValidMenuImageSize(width: number, height: number): boolean {
  return Object.values(MENU_CANVAS).some((canvas) => width === canvas.width && height === canvas.height)
}

/** ข้อความเตือนใต้ตัวเลือกภาพ (`m.imgBadTxt` ในต้นแบบ) เมื่อภาพที่เลือกไม่ผ่านขนาดใดขนาดหนึ่งในสองแบบที่รับ */
export function menuImageSizeWarning(width: number, height: number): string | null {
  if (isValidMenuImageSize(width, height)) return null
  const sizes = Object.values(MENU_CANVAS).map((c) => `${c.width}×${c.height}`).join(' หรือ ')
  return `ภาพนี้ขนาด ${width}×${height} — ต้องเป็น ${sizes} พอดีเท่านั้น`
}
