/**
 * BR-78 · แคมเปญที่ใช้เมนูต้องมีเมนูตัวเข้า (`is_entry`) พอดีหนึ่งอัน
 *
 * ตัวบังคับจริงคือ unique index บางส่วน `rich_menu_one_entry_per_campaign`
 * (`supabase/migrations/0001_init.sql`) — ฟังก์ชันที่นี่เป็นฝั่งจอ/ฝั่ง config
 * ที่ต้องพูดเรื่องเดียวกันโดยไม่ต้องพึ่งฐานข้อมูล เพื่อให้เห็นสถานะได้ก่อนกดบันทึก
 */

export type EntryCandidate = { id: string; isEntry: boolean }

/** จำนวนเมนูที่ตั้งเป็นตัวเข้าอยู่ตอนนี้ */
export function countEntries(menus: readonly EntryCandidate[]): number {
  return menus.filter((menu) => menu.isEntry).length
}

/** พอดีหนึ่งอันเท่านั้นที่ถือว่าถูกต้องตาม BR-78 */
export function hasSingleEntry(menus: readonly EntryCandidate[]): boolean {
  return countEntries(menus) === 1
}

/**
 * ตั้งเมนูหนึ่งตัวเป็นตัวเข้า แล้วตัวเก่าหลุดอัตโนมัติ
 *
 * นี่คือตรรกะเบื้องหลังปุ่ม "แขวนเมนูนี้ตอนเข้าร่วม" — radio ที่เลือกได้ทีละตัว
 * เขียนเป็นฟังก์ชันบริสุทธิ์แยกจาก DB เพื่อให้ทั้งจอ (แสดงสถานะก่อนกด) และ
 * `lib/db/richmenu.ts` (เขียนจริงในธุรกรรมเดียว) เห็นกฎเดียวกัน
 */
export function pickSingleEntry<T extends EntryCandidate>(menus: readonly T[], targetId: string): T[] {
  return menus.map((menu) => ({ ...menu, isEntry: menu.id === targetId }))
}
