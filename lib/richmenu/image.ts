import { MENU_IMAGE_HEIGHT, MENU_IMAGE_WIDTH } from './layouts'

/**
 * ภาพเมนูต้องเป็น 2500×1686 พอดี — ตามต้นแบบ ("ภาพเมนู (บังคับ · 2500×1686)")
 * และตาราง `asset` ของ L2 §5.2 ("ภาพ Rich Menu | 2500×1686 · ไม่เกิน 1MB")
 *
 * L2 §5.2 (ตาราง rich_menu) ยังอ้างค่าทั่วไปของ LINE เอง — JPEG/PNG · กว้าง 800
 * ถึง 2500 · สูงอย่างน้อย 250 · **ขนาดแนะนำ 2500×1686** — เป็นช่วงกว้างที่ LINE
 * ยอมรับได้ทั้งหมด ไม่ใช่กฎของแอปนี้ · แอปนี้เลือกบังคับเฉพาะขนาดแนะนำเป๊ะๆ
 * (ตรงกับที่ต้นแบบวาดไว้และตรงกับตาราง asset) เพื่อไม่ต้องคำนวณพิกัดผังใหม่ทุก
 * ขนาดภาพที่เป็นไปได้ — ดู lib/richmenu/layouts.ts ที่คำนวณพิกัดบนผืน 2500×1686
 * ตัวเดียวเท่านั้น
 */
export function isValidMenuImageSize(width: number, height: number): boolean {
  return width === MENU_IMAGE_WIDTH && height === MENU_IMAGE_HEIGHT
}

/** ข้อความเตือนใต้ตัวเลือกภาพ (`m.imgBadTxt` ในต้นแบบ) เมื่อภาพที่เลือกไม่ผ่าน */
export function menuImageSizeWarning(width: number, height: number): string | null {
  if (isValidMenuImageSize(width, height)) return null
  return `ภาพนี้ขนาด ${width}×${height} — ต้องเป็น ${MENU_IMAGE_WIDTH}×${MENU_IMAGE_HEIGHT} พอดีเท่านั้น`
}
