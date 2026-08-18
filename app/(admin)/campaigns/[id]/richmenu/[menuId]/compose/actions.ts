'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require'
import { probeImage } from '@/lib/assets/probe'
import { assetStore, storagePathFor } from '@/lib/assets/store'
import { db } from '@/lib/db/client'
import { setMenuImage } from '@/lib/db/richmenu'
import { upsertComposition } from '@/lib/db/richmenu-composition'
import { flattenComposition } from '@/lib/richmenu/compose'
import { validateComposition, validateLayerImageUpload, type Composition } from '@/lib/richmenu/composition'

/**
 * ตรวจว่าทุกชั้นภาพในงานแต่งภาพอ้างถึง asset ของแคมเปญนี้จริง — validateComposition
 * (lib/richmenu/composition.ts) เป็นฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล จึงตรวจได้แค่
 * รูปร่าง ไม่ตรวจความเป็นเจ้าของ ด่านนี้เติมส่วนที่ขาดก่อนจะเชื่อ assetId ที่ส่งมา
 * จากไคลเอนต์ (ใครก็แก้ payload เองได้ก่อนส่งมาถึงที่นี่)
 */
async function assertLayerImagesOwned(sql: ReturnType<typeof db>, composition: Composition, campaignId: string): Promise<void> {
  const assetIds = [...new Set(
    composition.layers.filter((l) => l.type === 'image').map((l) => l.assetId),
  )]
  if (assetIds.length === 0) return

  const owned = await sql<{ id: string }[]>`
    SELECT id FROM asset WHERE id = ANY(${sql.array(assetIds)}) AND campaign_id = ${campaignId}`
  if (owned.length !== assetIds.length) {
    throw new Error('มีภาพบางชั้นไม่ได้อยู่ในคลังของแคมเปญนี้')
  }
}

/**
 * อัปโหลดภาพสำหรับหนึ่งชั้น — คนละเส้นทางจาก storeMenuImage ของ M4-S01 โดยตั้งใจ
 * ภาพชั้นหนึ่งชั้นวางในกล่องขนาดเท่าไหร่ก็ได้ที่ผู้ใช้ลากปรับเอง ไม่ใช่ต้องเต็ม
 * ผืนภาพทั้งใบเหมือนภาพเมนูเดี่ยว จึงไม่ผ่าน fitImageToCanvas (ซึ่งครอบ/ตัดให้
 * เต็มผืนเป้าหมายเสมอ) — เก็บที่ขนาดต้นฉบับ ผ่านแค่ด่านทั่วไปของคลังภาพ
 * (probeImage · validateUpload) เหมือนที่คลังภาพทั่วไปใช้
 *
 * เรียกตรงๆ ไม่ใช่ผ่าน <form action> เพราะผลลัพธ์ (id/url/ขนาด) ต้องกลับมาให้
 * ฝั่งไคลเอนต์ใช้เพิ่มชั้นใหม่ทันที ไม่ใช่แค่ redirect/revalidate
 */
export async function uploadLayerImage(
  campaignId: string, formData: FormData,
): Promise<{ id: string; url: string; width: number; height: number }> {
  const session = await requireRole('configurator', 'content_editor')

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) throw new Error('ยังไม่ได้เลือกไฟล์')

  const data = new Uint8Array(await file.arrayBuffer())
  const probed = probeImage(data)
  if (!probed.ok) throw new Error(probed.reason)

  const verdict = validateLayerImageUpload({
    mime: probed.meta.mime, bytes: data.byteLength, width: probed.meta.width, height: probed.meta.height,
  })
  if (!verdict.ok) throw new Error(verdict.reason)

  const store = assetStore()
  const path = storagePathFor(campaignId, file.name)
  const stored = await store.put(path, data)

  const sql = db()
  const [asset] = await sql<{ id: string }[]>`
    INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type,
                       bytes, width, height, replaces_asset_id, uploaded_by)
    VALUES (${campaignId}, ${stored.storagePath}, ${stored.publicUrl}, 'image',
            ${probed.meta.mime}, ${data.byteLength}, ${probed.meta.width}, ${probed.meta.height},
            null, ${session.userId})
    RETURNING id`

  revalidatePath(`/campaigns/${campaignId}/assets`)
  return { id: asset.id, url: stored.publicUrl, width: probed.meta.width, height: probed.meta.height }
}

/**
 * บันทึกสถานะงานแต่งภาพ — เรียกทุกครั้งที่ทำเจสเจอร์เสร็จหนึ่งครั้ง (ลาก/ปรับขนาด/
 * เพิ่ม/ลบ/จัดแนว) ทำหน้าที่เป็น autosave ไปในตัว ไม่ต้องมีปุ่ม "บันทึกร่าง" แยก
 */
export async function saveComposition(campaignId: string, menuId: string, raw: unknown): Promise<void> {
  const session = await requireRole('configurator', 'content_editor')
  const verdict = validateComposition(raw)
  if (!verdict.ok) throw new Error(verdict.reason)

  const sql = db()
  await assertLayerImagesOwned(sql, verdict.composition, campaignId)
  await upsertComposition(sql, {
    richMenuId: menuId, campaignId, composition: verdict.composition, userId: session.userId,
  })
  revalidatePath(`/campaigns/${campaignId}/richmenu/${menuId}/compose`)
}

/**
 * ปุ่ม "ใช้" — บันทึกสถานะล่าสุดก่อน (กันฐานข้อมูลกับภาพที่ flatten ออกมาไม่ตรงกัน
 * ถ้าขั้นตอนหลังจากนี้ล้มกลางทาง) แล้วรวมทุกชั้นเป็นภาพเดียว เก็บเป็น asset แถวใหม่
 * แล้วตั้งให้เป็นภาพของเมนู — ปลายทางเดียวกับที่ storeMenuImage ของ M4-S01 จบลง
 */
export async function applyComposition(
  campaignId: string, menuId: string, raw: unknown,
): Promise<{ id: string }> {
  const session = await requireRole('configurator', 'content_editor')
  const verdict = validateComposition(raw)
  if (!verdict.ok) throw new Error(verdict.reason)

  const sql = db()
  await assertLayerImagesOwned(sql, verdict.composition, campaignId)

  await upsertComposition(sql, {
    richMenuId: menuId, campaignId, composition: verdict.composition, userId: session.userId,
  })

  const assetIds = [...new Set(verdict.composition.layers.filter((l) => l.type === 'image').map((l) => l.assetId))]
  const assetRows = assetIds.length === 0 ? [] : await sql<{ id: string; storage_path: string }[]>`
    SELECT id, storage_path FROM asset WHERE id = ANY(${sql.array(assetIds)}) AND campaign_id = ${campaignId}`
  const pathById = new Map(assetRows.map((row) => [row.id, row.storage_path]))

  const store = assetStore()
  const flattened = await flattenComposition(verdict.composition, async (assetId) => {
    const path = pathById.get(assetId)
    if (!path) throw new Error('ไม่พบภาพของชั้นนี้ในคลัง')
    return store.get(path)
  })

  const path = storagePathFor(campaignId, `compose-${menuId}.jpg`)
  const stored = await store.put(path, flattened.data)

  const [asset] = await sql<{ id: string }[]>`
    INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type,
                       bytes, width, height, replaces_asset_id, uploaded_by)
    VALUES (${campaignId}, ${stored.storagePath}, ${stored.publicUrl}, 'image',
            ${flattened.mime}, ${flattened.data.byteLength}, ${flattened.width}, ${flattened.height},
            null, ${session.userId})
    RETURNING id`

  await setMenuImage(sql, { id: menuId, campaignId, imageAssetId: asset.id })

  revalidatePath(`/campaigns/${campaignId}/assets`)
  revalidatePath(`/campaigns/${campaignId}/richmenu`)
  revalidatePath(`/campaigns/${campaignId}/richmenu/${menuId}/compose`)
  return { id: asset.id }
}
