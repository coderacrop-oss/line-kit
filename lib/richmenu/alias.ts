import type { AreaKind } from './areas'

/**
 * §4.4 ขั้น 5b (BR-77) · ลงทะเบียน alias ให้ "ทุกเมนูที่มีปุ่มสลับแท็บชี้ถึง"
 *
 * ไม่ใช่ทุกเมนูในแคมเปญ — เมนูที่ไม่มีใครสลับแท็บมาหาไม่จำเป็นต้องมี alias ที่ใช้งาน
 * จริงบน LINE เลยสักครั้ง การลงทะเบียนเฉพาะที่ต้องใช้จริงยังตรงกับเพดานอัตราการเรียก
 * ของ LINE (ลบ/สร้าง alias 100 ครั้ง/ชั่วโมง — L2 §5.2 v0.17) ด้วย
 */

export type AreaLike = { kind: AreaKind; target: string | null }
export type MenuLike = { id: string; alias: string; areas: readonly AreaLike[] }

/** รหัสเมนู (id) ทุกตัวที่ถูกช่องแบบ 'menu' ของเมนูใดก็ตามในแคมเปญนี้ชี้ถึง */
export function menuIdsTargetedBySwitch(menus: readonly MenuLike[]): Set<string> {
  const ids = new Set<string>()
  for (const menu of menus) {
    for (const area of menu.areas) {
      if (area.kind === 'menu' && area.target) ids.add(area.target)
    }
  }
  return ids
}

/** เมนูที่ต้องลงทะเบียน alias ในขั้น 5b — เฉพาะที่มีปุ่มสลับแท็บชี้ถึงจริง */
export function menusNeedingAlias(menus: readonly MenuLike[]): MenuLike[] {
  const targeted = menuIdsTargetedBySwitch(menus)
  return menus.filter((menu) => targeted.has(menu.id))
}

/**
 * ปุ่มสลับแท็บทุกปุ่มต้องชี้ไป alias ที่มีเมนูรองรับจริงในแคมเปญนี้ (เพิ่มใน L2 v0.16)
 *
 * คืนรายการ target (id ของเมนูที่ถูกชี้ถึง) ที่ไม่มีแถวเมนูไหนถืออยู่จริง — ใช้โดย
 * `lib/publish/validate.ts` เพื่อสร้างข้อความ ERR-036 ต่อปุ่ม
 */
export function danglingSwitchTargets(menus: readonly MenuLike[]): string[] {
  const validIds = new Set(menus.map((menu) => menu.id))
  const dangling = new Set<string>()
  for (const menu of menus) {
    for (const area of menu.areas) {
      if (area.kind === 'menu' && area.target && !validIds.has(area.target)) {
        dangling.add(area.target)
      }
    }
  }
  return [...dangling]
}
