'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require'
import { encodeOutcome, type Rejection } from '@/lib/assets/outcome'
import { probeImage } from '@/lib/assets/probe'
import { type AssetStore, assetStore, fileNameOf, storagePathFor } from '@/lib/assets/store'
import { validateUpload } from '@/lib/assets/validate'
import { db } from '@/lib/db/client'

/** มากกว่านี้ในครั้งเดียวคือคนลากทั้งโฟลเดอร์มาวาง ไม่ใช่คนเลือกภาพของแคมเปญ */
const MAX_FILES_PER_BATCH = 20

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

/**
 * ภาพผูกกับแคมเปญนี้เท่านั้น · ไม่ใช่คลังกลาง
 *
 * Checked before anything is written because campaign_id arrives from the URL
 * and the asset table's foreign key would happily accept a campaign this person
 * has nothing to do with. Every other row this action touches is scoped the same
 * way for the same reason.
 */
async function requireCampaign(sql: ReturnType<typeof db>, campaignId: string): Promise<void> {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM campaign WHERE id = ${campaignId}`
  if (!row) throw new Error('ไม่พบแคมเปญนี้')
}

/**
 * ไฟล์หนึ่งไฟล์ · วัดจริง ตรวจจริง เขียนจริง แล้วค่อยบันทึกแถว
 *
 * The order is the whole point. Dimensions are measured from the bytes rather
 * than taken from the form, the ceilings are applied to what was measured, the
 * file is written, and only a file that actually landed gets a row. Inserting
 * first would leave the library listing an image that was never stored, and the
 * first anyone would hear of it is a card rendering a broken picture in a chat.
 */
async function storeOne(
  sql: ReturnType<typeof db>,
  store: AssetStore,
  file: File,
  context: { campaignId: string; userId: string; replacesId: string | null },
): Promise<Rejection | null> {
  const data = new Uint8Array(await file.arrayBuffer())

  const probed = probeImage(data)
  if (!probed.ok) return { file: file.name, why: probed.reason }

  // ขนาดมาจากไบต์จริง ไม่ใช่จาก file.type ที่เบราว์เซอร์เดาจากนามสกุล
  const verdict = validateUpload({
    mime: probed.meta.mime,
    bytes: data.byteLength,
    width: probed.meta.width,
    height: probed.meta.height,
  })
  if (!verdict.ok) return { file: file.name, why: verdict.reason }

  const path = storagePathFor(context.campaignId, file.name)
  const stored = await store.put(path, data)

  await sql`
    INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type,
                       bytes, width, height, replaces_asset_id, uploaded_by)
    VALUES (${context.campaignId}, ${stored.storagePath}, ${stored.publicUrl}, 'image',
            ${probed.meta.mime}, ${data.byteLength}, ${probed.meta.width}, ${probed.meta.height},
            ${context.replacesId}, ${context.userId})`

  return null
}

/**
 * อัปโหลดภาพเข้าคลังของแคมเปญนี้
 *
 * A batch does not fail as a batch (the prototype says so on the screen): files
 * that pass are written and files that do not are named with the number that
 * refused them. Throwing on the first bad one would discard four good uploads to
 * report the fifth.
 *
 * Re-uploading writes a new row pointing back at the old one and never touches
 * the old file (BR-25). A card that has already gone out to a chat still
 * references the file it was built with, and that message cannot be edited by
 * anyone — deleting the file behind it would break it permanently, in a place
 * nobody in this system can see.
 *
 * A failure to store is not caught. There is no object storage bound to this
 * project, so uploads land on the disk of whatever is running the app, and a
 * read-only filesystem has to stop the whole submission loudly. Swallowing it
 * would leave rows in the library whose files were never written.
 */
export async function uploadAssets(campaignId: string, formData: FormData): Promise<void> {
  const session = await requireRole('configurator', 'content_editor')
  const sql = db()
  await requireCampaign(sql, campaignId)

  const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File)
  const chosen = files.filter((file) => file.size > 0)

  if (chosen.length === 0) throw new Error('ยังไม่ได้เลือกไฟล์')
  if (chosen.length > MAX_FILES_PER_BATCH) {
    throw new Error(`อัปโหลดได้ครั้งละไม่เกิน ${MAX_FILES_PER_BATCH} ไฟล์ — แบ่งเป็นหลายรอบ`)
  }

  const mode = trimmed(formData, 'mode')
  const replaceId = trimmed(formData, 'replace_id')
  let replacesId: string | null = null

  if (mode === 'replace') {
    if (!replaceId) throw new Error('เลือกภาพเดิมที่จะแทนที่ก่อน')
    // ผูกกับแคมเปญใน WHERE ด้วย · id มาจากฟอร์ม ซึ่งผู้ส่งแก้เองได้ทั้งใบ
    const [target] = await sql<{ id: string }[]>`
      SELECT id FROM asset WHERE id = ${replaceId} AND campaign_id = ${campaignId}`
    if (!target) throw new Error('ภาพเดิมที่เลือกไม่ได้อยู่ในแคมเปญนี้')
    if (chosen.length > 1) {
      throw new Error('แทนที่ภาพเดิมได้ทีละไฟล์ — ภาพเดิมหนึ่งภาพมีภาพที่มาแทนได้ภาพเดียว')
    }
    replacesId = target.id
  }

  const store = assetStore()
  const rejected: Rejection[] = []
  let uploaded = 0

  for (const file of chosen) {
    const rejection = await storeOne(sql, store, file, {
      campaignId, userId: session.userId, replacesId,
    })
    if (rejection) rejected.push(rejection)
    else uploaded += 1
  }

  revalidatePath(`/campaigns/${campaignId}/assets`)

  const report = encodeOutcome({ uploaded, rejected })
  // ทุกไฟล์ผ่าน = ไปดูผลที่คลัง · มีไฟล์ไม่ผ่าน = อยู่ที่เดิมเพื่ออ่านว่าอันไหนและเพราะอะไร
  redirect(rejected.length === 0
    ? `/campaigns/${campaignId}/assets?${report}`
    : `/campaigns/${campaignId}/assets/upload?${report}`)
}

/**
 * เอาภาพออกจากคลัง · ไฟล์ยังอยู่ที่เดิม
 *
 * The file is never deleted, which makes this narrower than its label and the
 * screen says so. The prototype's version promises to remove the file from
 * storage too, and decides an asset is unused without counting the newer asset
 * that replaced it — together that offers to delete exactly the file BR-25
 * exists to keep. A message already delivered to a chat cannot be edited, and
 * it is still pointing at that URL.
 *
 * The checks are made here in SQL rather than trusted from the page, and the
 * foreign keys refuse underneath in any case: a screen can be out of date by the
 * length of one page load, and that is enough time for somebody else to build a
 * card on the image being deleted.
 */
export async function deleteAsset(campaignId: string, assetId: string): Promise<void> {
  await requireRole('configurator')
  const sql = db()

  const [asset] = await sql<{ storage_path: string }[]>`
    SELECT storage_path FROM asset WHERE id = ${assetId} AND campaign_id = ${campaignId}`
  if (!asset) throw new Error('ไม่พบภาพนี้ในแคมเปญนี้')

  const [newer] = await sql<{ storage_path: string }[]>`
    SELECT storage_path FROM asset WHERE replaces_asset_id = ${assetId} LIMIT 1`
  if (newer) {
    throw new Error(
      `ลบไม่ได้ — ${fileNameOf(newer.storage_path)} อัปโหลดมาแทนภาพนี้`
      + ' การ์ดที่ส่งไปแล้วยังชี้มาที่ภาพนี้อยู่ (BR-25)',
    )
  }

  const users = await sql<{ label: string }[]>`
    SELECT 'การ์ด: ' || c.code AS label FROM card c WHERE c.video_asset_id = ${assetId}
     UNION
    SELECT 'การ์ด: ' || c.code FROM card_block cb JOIN card c ON c.id = cb.card_id
     WHERE c.campaign_id = ${campaignId}
       AND cb.content = (SELECT public_url FROM asset WHERE id = ${assetId})
     UNION
    SELECT 'บัตรแสตมป์' FROM stamp_card s
     WHERE s.empty_asset_id = ${assetId} OR s.filled_asset_id = ${assetId}
     UNION
    SELECT 'Rich Menu: ' || m.alias FROM rich_menu m WHERE m.image_asset_id = ${assetId}
     UNION
    SELECT 'เทมเพลตการ์ด: ' || t.code FROM card_template t WHERE t.preview_asset_id = ${assetId}`
  if (users.length > 0) {
    throw new Error(`ลบไม่ได้ — ${users.map((row) => row.label).join(' · ')} ใช้อยู่`)
  }

  await sql`DELETE FROM asset WHERE id = ${assetId} AND campaign_id = ${campaignId}`
  revalidatePath(`/campaigns/${campaignId}/assets`)
}
