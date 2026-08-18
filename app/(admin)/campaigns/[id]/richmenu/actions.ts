'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import {
  createRichMenu, deleteRichMenu, setAreaTarget, setEntryMenu, setLayout, updateRichMenu,
} from '@/lib/db/richmenu'
import { asAreaKind, type AreaKind } from '@/lib/richmenu/areas'
import { asLayoutKey, LAYOUT_KEYS, type LayoutKey } from '@/lib/richmenu/layouts'
import { isValidMenuImageSize, menuImageSizeWarning } from '@/lib/richmenu/image'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

/**
 * ต้องเลือกภาพก่อนเสมอ เพราะ `rich_menu.image_asset_id` เป็น NOT NULL (L2 §5.2)
 * และภาพต้องขนาด 2500×1686 พอดี — "ต้องตรวจตั้งแต่ตอนอัปโหลดในหน้า M4-S01 ไม่ใช่
 * ปล่อยให้ LINE ปฏิเสธตอน publish" (L2 §5.2 v0.16) จึงบล็อกตรงนี้ตั้งแต่ตอนบันทึก
 * ต่างจากช่องที่ไม่ชี้ไปไหน (BR-01) ซึ่งบันทึกได้แล้วไปบล็อกตอน publish แทน — สอง
 * กฎนี้คนละเรื่องกัน ภาพผิดขนาดคือของที่ผิดตั้งแต่ต้น ไม่ใช่สถานะที่ยังกรอกไม่ครบ
 */
async function assertValidImage(campaignId: string, imageAssetId: string): Promise<void> {
  if (!imageAssetId) throw new Error('ต้องเลือกภาพเมนูจากคลังก่อน (บังคับ · 2500×1686)')

  const sql = db()
  const [asset] = await sql<{ width: number; height: number }[]>`
    SELECT width, height FROM asset WHERE id = ${imageAssetId} AND campaign_id = ${campaignId}`
  if (!asset) throw new Error('ไม่พบภาพนี้ในคลังของแคมเปญนี้')

  if (!isValidMenuImageSize(asset.width, asset.height)) {
    throw new Error(`ERR-037 · ${menuImageSizeWarning(asset.width, asset.height)}`)
  }
}

function parseLayout(formData: FormData): LayoutKey {
  const raw = trimmed(formData, 'layout')
  const layout = asLayoutKey(raw)
  if (!layout) throw new Error(`ผังช่องไม่ถูกต้อง — ต้องเป็นหนึ่งใน ${LAYOUT_KEYS.join(', ')}`)
  return layout
}

/**
 * ค่าจากช่อง select ของแต่ละพื้นที่ · `""` = ไม่ชี้ไปไหน · `"url"` = อ่านจากช่อง
 * ข้อความคู่กัน (`area_url_N`) · อย่างอื่น = `kind:targetId`
 *
 * ไม่ตรวจว่า targetId มีอยู่ในแคมเปญจริงหรือไม่ที่นี่ — จอสร้างตัวเลือกมาจากรายการ
 * ที่มีอยู่แล้วเท่านั้น (`<select>`) การกรอกรหัสที่ไม่มีอยู่ต้องมาจากฟอร์มที่แต่งเอง
 * ซึ่งเป็นเรื่องเดียวกับที่ webhook/publish ยังตรวจซ้ำอีกชั้นอยู่ดี (ERR-036 · ERR-020)
 */
function parseAreaValue(
  raw: string, urlValue: string,
): { kind: AreaKind; target: string | null } {
  if (raw === '') return { kind: 'none', target: null }
  if (raw === 'url') {
    const url = urlValue.trim()
    if (!url) throw new Error('เลือก "ไปลิงก์" แล้วต้องกรอก URL ด้วย')
    return { kind: 'url', target: url }
  }
  const [kindRaw, ...rest] = raw.split(':')
  const id = rest.join(':')
  const kind = asAreaKind(kindRaw)
  if (kind === 'none' || !id) throw new Error(`ค่าปลายทางของช่องไม่ถูกต้อง: "${raw}"`)
  return { kind, target: id }
}

/** จำนวนช่องของผังที่กำลังบันทึกอยู่ · มาจาก `area_count` ที่จอฝังไว้ในฟอร์ม */
function areaCountOf(formData: FormData): number {
  const n = Number(trimmed(formData, 'area_count'))
  return Number.isInteger(n) && n >= 0 ? n : 0
}

/**
 * สร้างเมนูใหม่ · ต้องกรอกชื่อเรียก ภาพ และผังตั้งแต่ตอนสร้าง
 *
 * ต่างจากต้นแบบที่วาดการ์ดว่างให้กรอกทีละช่องหลังจากกด "+ เพิ่มเมนู" — schema
 * บังคับ `image_asset_id NOT NULL` แถวที่ยังไม่มีภาพจึงไม่มีทางถูกสร้างขึ้นมาได้เลย
 * (ดูรายงานของงาน M4-S01 สำหรับเหตุผลเต็ม)
 */
export async function createMenu(campaignId: string, formData: FormData): Promise<void> {
  await requireRole('configurator', 'content_editor')

  const alias = trimmed(formData, 'alias')
  if (!alias) throw new Error('ต้องตั้งชื่อเรียกเมนู (alias) ก่อน')

  const imageAssetId = trimmed(formData, 'image_asset_id')
  await assertValidImage(campaignId, imageAssetId)
  const layout = parseLayout(formData)

  // DuplicateAliasError (UNIQUE campaign_id+alias) มีข้อความที่อ่านรู้เรื่องอยู่แล้ว
  // จากชั้น lib/db/richmenu.ts — ปล่อยให้หลุดขึ้นไปตรงๆ ไม่ต้องห่อซ้ำ
  await createRichMenu(db(), { campaignId, alias, imageAssetId, layout })

  revalidatePath(`/campaigns/${campaignId}/richmenu`)
}

/**
 * บันทึกเมนู · alias · ภาพ · และปลายทางของทุกช่องพร้อมกัน (ปุ่ม "บันทึกเมนู" ของต้นแบบ)
 *
 * ผังช่อง (จำนวนช่องกับพิกัด) แก้แยกผ่าน `changeLayout` ไม่ใช่ที่นี่ — สลับผังต้อง
 * เห็นจำนวนช่องใหม่ทันทีก่อนจะกรอกปลายทางของช่องเหล่านั้น ปุ่มนี้บันทึก "เนื้อหา"
 * ของผังที่เลือกไว้แล้วเท่านั้น ไม่ใช่ตัวผังเอง
 */
export async function saveMenu(campaignId: string, menuId: string, formData: FormData): Promise<void> {
  await requireRole('configurator', 'content_editor')

  const alias = trimmed(formData, 'alias')
  if (!alias) throw new Error('ต้องตั้งชื่อเรียกเมนู (alias) ก่อน')

  const imageAssetId = trimmed(formData, 'image_asset_id')
  await assertValidImage(campaignId, imageAssetId)

  await updateRichMenu(db(), { id: menuId, campaignId, alias, imageAssetId })

  const count = areaCountOf(formData)
  for (let i = 0; i < count; i++) {
    const raw = trimmed(formData, `area_target_${i}`)
    const urlValue = String(formData.get(`area_url_${i}`) ?? '')
    const { kind, target } = parseAreaValue(raw, urlValue)
    await setAreaTarget(db(), { id: menuId, campaignId, index: i, kind, target })
  }

  revalidatePath(`/campaigns/${campaignId}/richmenu`)
}

/** ปุ่มเลือกผัง — มีผลทันที ไม่ต้องรอกด "บันทึกเมนู" (เหมือนปุ่ม "+ เพิ่มเงื่อนไข" ของ BlockForm) */
export async function changeLayout(campaignId: string, menuId: string, layout: string): Promise<void> {
  await requireRole('configurator', 'content_editor')
  const key = asLayoutKey(layout)
  if (!key) throw new Error(`ผังช่องไม่ถูกต้อง — ต้องเป็นหนึ่งใน ${LAYOUT_KEYS.join(', ')}`)

  await setLayout(db(), { id: menuId, campaignId, layout: key })
  revalidatePath(`/campaigns/${campaignId}/richmenu`)
}

/**
 * "แขวนเมนูนี้ตอนเข้าร่วม" (BR-78) — มีผลทันที ตัวเก่าหลุดอัตโนมัติในธุรกรรมเดียว
 * (`setEntryMenu`) จอไม่ต้องรอผู้ตั้งค่ากด "บันทึกเมนู" เพื่อให้ค่านี้เป็นความจริง
 * เดียวข้ามการ์ดหลายใบพร้อมกัน
 */
export async function setEntry(campaignId: string, menuId: string): Promise<void> {
  await requireRole('configurator', 'content_editor')
  await setEntryMenu(db(), { campaignId, id: menuId })
  revalidatePath(`/campaigns/${campaignId}/richmenu`)
}

/** ลบเมนู · ผู้ตั้งค่าแคมเปญเท่านั้น เหมือนการลบคีย์เวิร์ด */
export async function deleteMenu(campaignId: string, menuId: string): Promise<void> {
  await requireRole('configurator')
  // RichMenuInUseError (channel.base_richmenu_id ยังชี้อยู่) มีข้อความอ่านรู้เรื่องแล้ว
  await deleteRichMenu(db(), { id: menuId, campaignId })
  revalidatePath(`/campaigns/${campaignId}/richmenu`)
}
