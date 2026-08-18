'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require'
import { probeImage } from '@/lib/assets/probe'
import { assetStore, storagePathFor } from '@/lib/assets/store'
import { validateUpload } from '@/lib/assets/validate'
import { db } from '@/lib/db/client'
import {
  createRichMenu, deleteRichMenu, setAreaTarget, setEntryMenu, setLayout, updateRichMenu,
} from '@/lib/db/richmenu'
import { asAreaKind, type AreaKind, type RichMenuArea } from '@/lib/richmenu/areas'
import { fitImageToCanvas } from '@/lib/richmenu/fit'
import { asLayoutKey, canvasFor, identifyLayout, LAYOUT_KEYS, type LayoutKey } from '@/lib/richmenu/layouts'
import { isValidMenuImageSize, menuImageSizeWarning } from '@/lib/richmenu/image'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

/**
 * ไฟล์หนึ่งไฟล์ กลายเป็นแถวของ asset ที่ใช้กับเมนูนี้ได้ทันที
 *
 * จอนี้ไม่มี "เลือกภาพจากคลัง" อีกต่อไป — อัปโหลดตรงนี้คือการเลือก ภาพเมนูต้องเป็น
 * ขนาดผืนภาพของผังที่กำลังใช้อยู่พอดี (2500×1686 หรือ 2500×843 — canvasFor() ของ
 * lib/richmenu/layouts.ts) เพราะพิกัดของทุกช่องคำนวณจากผืนภาพขนาดนั้นเป๊ะๆ — แต่
 * ภาพที่ไม่ตรงเป๊ะไม่ได้ถูกปฏิเสธทันที · ตัด/ย่อให้พอดีอัตโนมัติก่อน (fitImageToCanvas)
 * เหมือนตัวเลือก "อัปโหลดรูปและนำไปใช้" ของ LINE เอง ซึ่งรับได้หลายขนาดต่อกลุ่ม —
 * ปฏิเสธเฉพาะตอนภาพเล็กเกินไปจนต้องขยายจนเบลอ หรือไฟล์ใหญ่เกินจะประมวลผล เพราะ
 * สองกรณีนี้ไม่มีทางแก้ให้ด้วยการตัด/ย่ออย่างเดียว
 *
 * ภาพที่ขนาดตรงเป๊ะอยู่แล้วไม่ผ่าน fitImageToCanvas เลย — เก็บไฟล์เดิมตรงๆ ไม่ผ่าน
 * การเข้ารหัสซ้ำที่ทำให้คุณภาพลดลงโดยไม่จำเป็น ยังคงผ่านด่านทั่วไปของคลังภาพ
 * (validateUpload) เหมือนเดิมสำหรับกรณีนี้เท่านั้น
 */
async function storeMenuImage(
  campaignId: string, userId: string, file: File, canvas: { width: number; height: number },
): Promise<{ id: string }> {
  const data = new Uint8Array(await file.arrayBuffer())

  const probed = probeImage(data)
  if (!probed.ok) throw new Error(probed.reason)

  let finalData: Uint8Array = data
  let finalMime: string = probed.meta.mime
  let finalWidth = probed.meta.width
  let finalHeight = probed.meta.height

  if (probed.meta.width === canvas.width && probed.meta.height === canvas.height) {
    // ขนาดมาจากไบต์จริง ไม่ใช่จาก file.type ที่เบราว์เซอร์เดาจากนามสกุล
    const verdict = validateUpload({
      mime: probed.meta.mime, bytes: data.byteLength,
      width: probed.meta.width, height: probed.meta.height,
    })
    if (!verdict.ok) throw new Error(verdict.reason)
  } else {
    const fitted = await fitImageToCanvas(data, canvas)
    if (!fitted.ok) throw new Error(`ERR-037 · ${fitted.reason}`)
    finalData = fitted.data
    finalMime = fitted.mime
    finalWidth = canvas.width
    finalHeight = canvas.height
  }

  const store = assetStore()
  const path = storagePathFor(campaignId, file.name)
  const stored = await store.put(path, finalData)

  const sql = db()
  const [asset] = await sql<{ id: string }[]>`
    INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type,
                       bytes, width, height, replaces_asset_id, uploaded_by)
    VALUES (${campaignId}, ${stored.storagePath}, ${stored.publicUrl}, 'image',
            ${finalMime}, ${finalData.byteLength}, ${finalWidth}, ${finalHeight},
            null, ${userId})
    RETURNING id`

  revalidatePath(`/campaigns/${campaignId}/assets`)
  return asset
}

/**
 * ภาพเดิมของเมนูที่ไม่ได้ถูกแทนที่รอบนี้ — ต้องยังผ่านด่านขนาดเหมือนภาพที่เพิ่ง
 * อัปโหลดใหม่ ไม่งั้นเมนูที่เคยมีภาพผิดขนาดติดมาจากรุ่นก่อนจะบันทึกอย่างอื่น (เช่น
 * เปลี่ยนชื่อเรียก) ผ่านไปได้โดยไม่มีใครรู้ว่าภาพยังพังอยู่
 */
async function assertExistingImageValid(campaignId: string, imageAssetId: string): Promise<void> {
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

/** ไฟล์ที่ผู้ใช้เลือกจริง — input ที่ไม่ได้แตะเลยก็ยังส่ง File ว่างขนาดศูนย์มาด้วย */
function chosenFile(formData: FormData, key: string): File | null {
  const file = formData.get(key)
  return file instanceof File && file.size > 0 ? file : null
}

/**
 * สร้างเมนูใหม่ · ต้องกรอกชื่อเรียก อัปโหลดภาพ และเลือกผังตั้งแต่ตอนสร้าง
 *
 * ต่างจากต้นแบบที่วาดการ์ดว่างให้กรอกทีละช่องหลังจากกด "+ เพิ่มเมนู" — schema
 * บังคับ `image_asset_id NOT NULL` แถวที่ยังไม่มีภาพจึงไม่มีทางถูกสร้างขึ้นมาได้เลย
 * (ดูรายงานของงาน M4-S01 สำหรับเหตุผลเต็ม)
 */
export async function createMenu(campaignId: string, formData: FormData): Promise<void> {
  const session = await requireRole('configurator', 'content_editor')

  const alias = trimmed(formData, 'alias')
  if (!alias) throw new Error('ต้องตั้งชื่อเรียกเมนู (alias) ก่อน')

  const layout = parseLayout(formData)

  const file = chosenFile(formData, 'image_file')
  if (!file) throw new Error('ต้องอัปโหลดภาพเมนูก่อน (ขนาดตามผังที่เลือกไว้)')
  const { id: imageAssetId } = await storeMenuImage(campaignId, session.userId, file, canvasFor(layout))

  // DuplicateAliasError (UNIQUE campaign_id+alias) มีข้อความที่อ่านรู้เรื่องอยู่แล้ว
  // จากชั้น lib/db/richmenu.ts — ปล่อยให้หลุดขึ้นไปตรงๆ ไม่ต้องห่อซ้ำ
  await createRichMenu(db(), { campaignId, alias, imageAssetId, layout })

  revalidatePath(`/campaigns/${campaignId}/richmenu`)
}

/**
 * บันทึกเมนู · alias · ภาพ · และปลายทางของทุกช่องพร้อมกัน (ปุ่ม "บันทึกเมนู" ของต้นแบบ)
 *
 * ภาพเป็นช่องเลือกได้ว่าจะแตะหรือไม่ — เว้น input ไฟล์ไว้ = ใช้ภาพเดิมต่อ (ค่าเดิม
 * มากับ hidden field `image_asset_id` ที่จอฝังไว้) เลือกไฟล์ใหม่ = แทนที่ทันที
 * เหมือนโหมด "แทนที่ภาพเดิม" ของคลังภาพ (BR-25) — ไฟล์เก่าไม่ถูกลบ การ์ด/เมนูที่
 * เคยส่งขึ้นไปแล้วยังอ้างถึง URL เดิม
 *
 * ผังช่อง (จำนวนช่องกับพิกัด) แก้แยกผ่าน `changeLayout` ไม่ใช่ที่นี่ — สลับผังต้อง
 * เห็นจำนวนช่องใหม่ทันทีก่อนจะกรอกปลายทางของช่องเหล่านั้น ปุ่มนี้บันทึก "เนื้อหา"
 * ของผังที่เลือกไว้แล้วเท่านั้น ไม่ใช่ตัวผังเอง
 */
export async function saveMenu(campaignId: string, menuId: string, formData: FormData): Promise<void> {
  const session = await requireRole('configurator', 'content_editor')

  const alias = trimmed(formData, 'alias')
  if (!alias) throw new Error('ต้องตั้งชื่อเรียกเมนู (alias) ก่อน')

  const newFile = chosenFile(formData, 'image_file')
  let imageAssetId: string
  if (newFile) {
    // ผังของเมนูนี้ไม่ได้เปลี่ยนในแอ็กชันนี้ (สลับผังแยกอยู่ที่ changeLayout) — ภาพ
    // ใหม่จึงต้องขนาดตรงกับผังปัจจุบันที่หาได้จากช่องที่มีอยู่จริง ไม่ใช่เชื่อค่าจาก
    // ฟอร์มตรงๆ (ผังปัจจุบันคำนวณจากพิกัดช่องจริงเหมือนที่จอ M4-S01 ใช้แสดงผล)
    const sql = db()
    const [current] = await sql<{ areas: RichMenuArea[] }[]>`
      SELECT areas FROM rich_menu WHERE id = ${menuId} AND campaign_id = ${campaignId}`
    if (!current) throw new Error('ไม่พบเมนูนี้ในแคมเปญนี้')
    const canvas = canvasFor(identifyLayout(current.areas ?? []))

    imageAssetId = (await storeMenuImage(campaignId, session.userId, newFile, canvas)).id
  } else {
    imageAssetId = trimmed(formData, 'image_asset_id')
    if (!imageAssetId) throw new Error('ต้องมีภาพเมนูก่อน')
    await assertExistingImageValid(campaignId, imageAssetId)
  }

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

/**
 * ปุ่มเลือกผัง — มีผลทันที ไม่ต้องรอกด "บันทึกเมนู" (เหมือนปุ่ม "+ เพิ่มเงื่อนไข" ของ BlockForm)
 *
 * สลับได้เฉพาะผังที่ใช้ผืนภาพขนาดเดียวกับภาพที่เมนูนี้ใช้อยู่ตอนนี้ — จอกรองปุ่ม
 * ให้เหลือแต่ผังกลุ่มเดียวกับภาพปัจจุบันอยู่แล้ว แต่ยังตรวจซ้ำที่นี่เผื่อฟอร์มที่
 * แต่งเองข้ามการกรองนั้นมา สลับข้ามขนาดผืนภาพได้ทางเดียวคือแทนที่ภาพผ่าน "บันทึก
 * เมนู" ซึ่งอัปโหลดภาพกับผังคู่กันเสมอ (ดู storeMenuImage)
 */
export async function changeLayout(campaignId: string, menuId: string, layout: string): Promise<void> {
  await requireRole('configurator', 'content_editor')
  const key = asLayoutKey(layout)
  if (!key) throw new Error(`ผังช่องไม่ถูกต้อง — ต้องเป็นหนึ่งใน ${LAYOUT_KEYS.join(', ')}`)

  const sql = db()
  const [current] = await sql<{ width: number; height: number }[]>`
    SELECT a.width, a.height FROM rich_menu rm JOIN asset a ON a.id = rm.image_asset_id
     WHERE rm.id = ${menuId} AND rm.campaign_id = ${campaignId}`
  if (!current) throw new Error('ไม่พบเมนูนี้ในแคมเปญนี้')

  const canvas = canvasFor(key)
  if (current.width !== canvas.width || current.height !== canvas.height) {
    throw new Error(
      `ผังนี้ใช้กับภาพขนาด ${canvas.width}×${canvas.height} — ภาพปัจจุบันของเมนูนี้คือ `
      + `${current.width}×${current.height} เปลี่ยนภาพก่อนถึงจะสลับไปผังกลุ่มนี้ได้`,
    )
  }

  await setLayout(sql, { id: menuId, campaignId, layout: key })
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
