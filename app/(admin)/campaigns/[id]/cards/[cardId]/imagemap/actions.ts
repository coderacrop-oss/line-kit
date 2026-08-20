'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require'
import { probeImage } from '@/lib/assets/probe'
import { assetStore, storagePathFor } from '@/lib/assets/store'
import {
  loadCardImagemap, markImagemapApplied, saveImagemapDraft, setImagemapBaseImage,
  setImagemapVideoAsset, setImagemapVideoPreview,
} from '@/lib/db/card-imagemap'
import { db } from '@/lib/db/client'
import { generateImagemapVariants, IMAGEMAP_WIDTHS, validateImagemapUpload, type ImagemapWidth } from '@/lib/imagemap/sizes'
import {
  validateAltText, validateAltTextDraft, validateTapAreas, validateTapAreasDraft,
  validateVideoArea, validateVideoExternalLink, type TapArea,
} from '@/lib/imagemap/regions'
import { probeMp4, validateImagemapVideoPreviewUpload, validateImagemapVideoUpload } from '@/lib/imagemap/video'

/**
 * Server Actions ของตัวแก้ไขริชเมสเสจ/ริชวิดีโอ — โครงเดียวกับ
 * app/(admin)/campaigns/[id]/richmenu/[menuId]/compose/actions.ts (M4-S02):
 * อัปโหลดภาพ/วิดีโอ (คืนค่าให้ client ใช้ต่อทันที) · บันทึกร่างทุกครั้งที่ทำเจสเจอร์
 * เสร็จหนึ่งครั้ง (autosave) · ปุ่ม "ใช้" ที่ปั้นภาพจริงแล้วมาร์กว่าพร้อมส่ง
 *
 * uploadVideo/uploadVideoPreview ไม่มีขั้นตอน "ใช้" คู่กันเหมือนภาพฐาน — ไม่มีการ
 * แปลงไฟล์วิดีโอในสไลซ์นี้เลย (ดูหมายเหตุของ lib/imagemap/video.ts) ไฟล์ที่อัปโหลด
 * มาแล้วผ่านด่านตรวจก็พร้อมใช้ทันที
 */

const editorPath = (campaignId: string, cardId: string) => `/campaigns/${campaignId}/cards/${cardId}/imagemap`

/**
 * อัปโหลดภาพฐานใหม่ (ครั้งแรก หรือเปลี่ยนภาพ) — เก็บที่ขนาดต้นฉบับ (ไม่ตัด/ย่อ ณ จุด
 * นี้ ต่างจาก M4-S01 ที่ครอบให้เต็มผืนเมนูทันที) ภาพ 5 ขนาดจริงถูกปั้นตอนกด "ใช้"
 * เท่านั้น — ที่นี่แค่คำนวณสัดส่วนไว้ให้จอวาดพื้นที่กดถูกที่ (baseWidth คงที่ 1040
 * เสมอ ตามสัญญาของ LINE)
 */
export async function uploadBaseImage(
  campaignId: string, cardId: string, formData: FormData,
): Promise<{ url: string; baseWidth: number; baseHeight: number }> {
  const session = await requireRole('configurator', 'content_editor')

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) throw new Error('ยังไม่ได้เลือกไฟล์')

  const data = new Uint8Array(await file.arrayBuffer())
  const probed = probeImage(data)
  if (!probed.ok) throw new Error(probed.reason)

  const verdict = validateImagemapUpload({
    mime: probed.meta.mime, bytes: data.byteLength, width: probed.meta.width, height: probed.meta.height,
  })
  if (!verdict.ok) throw new Error(verdict.reason)

  const store = assetStore()
  const storagePath = storagePathFor(campaignId, file.name)
  const stored = await store.put(storagePath, data, probed.meta.mime)

  const sql = db()
  const [asset] = await sql<{ id: string }[]>`
    INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type,
                       bytes, width, height, replaces_asset_id, uploaded_by)
    VALUES (${campaignId}, ${stored.storagePath}, ${stored.publicUrl}, 'image',
            ${probed.meta.mime}, ${data.byteLength}, ${probed.meta.width}, ${probed.meta.height},
            null, ${session.userId})
    RETURNING id`

  const baseWidth = IMAGEMAP_WIDTHS[IMAGEMAP_WIDTHS.length - 1]
  const baseHeight = Math.round(probed.meta.height * (baseWidth / probed.meta.width))

  await setImagemapBaseImage(sql, {
    cardId, campaignId, assetId: asset.id, baseWidth, baseHeight, userId: session.userId,
  })

  revalidatePath(editorPath(campaignId, cardId))
  revalidatePath(`/campaigns/${campaignId}/assets`)
  return { url: stored.publicUrl, baseWidth, baseHeight }
}

/**
 * บันทึกร่าง — พื้นที่กดกับข้อความสำรอง เรียกทุกครั้งที่ทำเจสเจอร์เสร็จหนึ่งครั้ง
 * (autosave) ต้องมีภาพฐานอยู่แล้วก่อน (รู้ baseHeight เพื่อตรวจว่าพื้นที่หลุดขอบ
 * ภาพหรือไม่) — จอฝั่ง client ปิดการวาดพื้นที่ไว้จนกว่าจะอัปโหลดภาพอยู่แล้ว แต่ด่าน
 * นี้ตรวจซ้ำเพราะ payload มาจาก client ที่ใครก็แก้เองได้ก่อนส่งมาถึงนี่
 */
export async function saveDraft(
  campaignId: string, cardId: string,
  raw: { actions: unknown; altText: unknown; videoArea?: unknown; videoLinkUri?: unknown; videoLinkLabel?: unknown },
): Promise<void> {
  const session = await requireRole('configurator', 'content_editor')
  const sql = db()

  const current = await loadCardImagemap(sql, campaignId, cardId)
  if (!current) throw new Error('ไม่พบการ์ดริชเมสเสจนี้ในแคมเปญนี้')
  if (!current.baseHeight) throw new Error('อัปโหลดภาพฐานก่อน ถึงจะวาดพื้นที่กดได้')

  const areasResult = validateTapAreasDraft(raw.actions, current.baseHeight)
  if (!areasResult.ok) throw new Error(areasResult.reason)
  const altTextResult = validateAltTextDraft(raw.altText)
  if (!altTextResult.ok) throw new Error(altTextResult.reason)

  // สองอย่างนี้มีความหมายเฉพาะการ์ดริชวิดีโอ — imagemap ธรรมดาไม่เคยส่ง videoArea/
  // videoLinkUri/videoLinkLabel มาเลย (undefined) ได้ค่าว่างเสมอ ไม่กระทบอะไร
  const videoAreaResult = validateVideoArea(raw.videoArea ?? null, current.baseHeight)
  if (!videoAreaResult.ok) throw new Error(videoAreaResult.reason)
  const videoLinkResult = validateVideoExternalLink(raw.videoLinkUri ?? '', raw.videoLinkLabel ?? '')
  if (!videoLinkResult.ok) throw new Error(videoLinkResult.reason)

  await saveImagemapDraft(sql, {
    cardId, campaignId, actions: areasResult.areas, altText: altTextResult.altText, userId: session.userId,
    videoArea: videoAreaResult.area, videoLinkUri: videoLinkResult.linkUri, videoLinkLabel: videoLinkResult.label,
  })
  revalidatePath(editorPath(campaignId, cardId))
}

/**
 * อัปโหลดไฟล์วิดีโอใหม่ของริชวิดีโอ (ครั้งแรก หรือแทนที่) — ตรวจ container/ความยาว/
 * ขนาดผ่าน probeMp4 + validateImagemapVideoUpload (ดูหมายเหตุของ lib/imagemap/video.ts
 * เรื่องเพดานที่ยังไม่ยืนยันจาก LINE ตรงๆ) ไม่มีการแปลงไฟล์ใดๆ — เก็บไบต์ที่อัปโหลด
 * มาตรงๆ แล้วชี้ card.video_asset_id ไปที่แถวใหม่ (คอลัมน์ที่ L2 §5.2 จองไว้ให้อยู่แล้ว)
 */
export async function uploadVideo(
  campaignId: string, cardId: string, formData: FormData,
): Promise<{ url: string }> {
  const session = await requireRole('configurator', 'content_editor')

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) throw new Error('ยังไม่ได้เลือกไฟล์')

  const data = new Uint8Array(await file.arrayBuffer())
  const probed = probeMp4(data)
  if (!probed.ok) throw new Error(probed.reason)

  const verdict = validateImagemapVideoUpload({
    mime: probed.meta.mime, bytes: data.byteLength, durationSec: probed.meta.durationSec,
  })
  if (!verdict.ok) throw new Error(verdict.reason)

  const store = assetStore()
  const storagePath = storagePathFor(campaignId, file.name)
  const stored = await store.put(storagePath, data, probed.meta.mime)

  const sql = db()
  const [asset] = await sql<{ id: string }[]>`
    INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type,
                       duration_sec, bytes, width, height, replaces_asset_id, uploaded_by)
    VALUES (${campaignId}, ${stored.storagePath}, ${stored.publicUrl}, 'video',
            ${probed.meta.mime}, ${Math.round(probed.meta.durationSec)}, ${data.byteLength},
            ${probed.meta.width}, ${probed.meta.height}, null, ${session.userId})
    RETURNING id`

  await setImagemapVideoAsset(sql, { cardId, campaignId, assetId: asset.id })

  revalidatePath(editorPath(campaignId, cardId))
  revalidatePath(`/campaigns/${campaignId}/assets`)
  return { url: stored.publicUrl }
}

/**
 * อัปโหลดภาพตัวอย่างก่อนเล่น (previewImageUrl ของ LINE) — ใช้ validateImagemapVideoPreviewUpload
 * (lib/imagemap/video.ts) ไม่ใช่ validateUpload ทั่วไปของคลังภาพ และไม่ใช่ validateImagemapUpload
 * ของภาพฐานริชเมสเสจ — ทั้งสองฟังก์ชันนั้นบังคับกว้างอย่างน้อย 800px/1040px ตามลำดับ
 * ซึ่งเป็นกติกาของภาพที่ขยายเต็มความกว้างแชท/เต็มผืนริชเมสเสจ ไม่ใช่ของภาพตัวอย่าง
 * เล็กๆ ที่เติมแค่พื้นที่เล่นวิดีโอหนึ่งกล่อง (ดูหมายเหตุเต็มที่ฟังก์ชันนั้น)
 */
export async function uploadVideoPreview(
  campaignId: string, cardId: string, formData: FormData,
): Promise<{ url: string }> {
  const session = await requireRole('configurator', 'content_editor')

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) throw new Error('ยังไม่ได้เลือกไฟล์')

  const data = new Uint8Array(await file.arrayBuffer())
  const probed = probeImage(data)
  if (!probed.ok) throw new Error(probed.reason)

  const verdict = validateImagemapVideoPreviewUpload({
    mime: probed.meta.mime, bytes: data.byteLength, width: probed.meta.width, height: probed.meta.height,
  })
  if (!verdict.ok) throw new Error(verdict.reason)

  const store = assetStore()
  const storagePath = storagePathFor(campaignId, file.name)
  const stored = await store.put(storagePath, data, probed.meta.mime)

  const sql = db()
  const [asset] = await sql<{ id: string }[]>`
    INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type,
                       bytes, width, height, replaces_asset_id, uploaded_by)
    VALUES (${campaignId}, ${stored.storagePath}, ${stored.publicUrl}, 'image',
            ${probed.meta.mime}, ${data.byteLength}, ${probed.meta.width}, ${probed.meta.height},
            null, ${session.userId})
    RETURNING id`

  await setImagemapVideoPreview(sql, { cardId, campaignId, assetId: asset.id, userId: session.userId })

  revalidatePath(editorPath(campaignId, cardId))
  revalidatePath(`/campaigns/${campaignId}/assets`)
  return { url: stored.publicUrl }
}

/**
 * ปุ่ม "ใช้" — บันทึกร่างล่าสุดก่อน แล้วปั้นภาพ 5 ขนาดจริงจากภาพฐาน เก็บเป็น asset
 * แถวใหม่ห้าแถว แล้วมาร์กว่าการ์ดใบนี้พร้อมส่งจริง (renderCard เริ่มเห็น `imagemap`
 * ตั้งแต่นาทีนี้ — ดู lib/db/card-imagemap.ts:loadReadyImagemaps)
 */
export async function applyImagemap(
  campaignId: string, cardId: string, raw: { actions: unknown; altText: unknown },
): Promise<void> {
  const session = await requireRole('configurator', 'content_editor')
  const sql = db()

  const current = await loadCardImagemap(sql, campaignId, cardId)
  if (!current) throw new Error('ไม่พบการ์ดริชเมสเสจนี้ในแคมเปญนี้')
  if (!current.baseAssetId || !current.baseHeight) throw new Error('อัปโหลดภาพฐานก่อน ถึงจะกด "ใช้" ได้')

  const areasResult = validateTapAreas(raw.actions, current.baseHeight)
  if (!areasResult.ok) throw new Error(areasResult.reason)
  const altTextResult = validateAltText(raw.altText)
  if (!altTextResult.ok) throw new Error(altTextResult.reason)

  const [baseAsset] = await sql<{ storage_path: string }[]>`
    SELECT storage_path FROM asset WHERE id = ${current.baseAssetId} AND campaign_id = ${campaignId}`
  if (!baseAsset) throw new Error('ไม่พบภาพฐานในคลังของแคมเปญนี้')

  const store = assetStore()
  const sourceBytes = await store.get(baseAsset.storage_path)
  const generated = await generateImagemapVariants(sourceBytes)
  if (!generated.ok) throw new Error(generated.reason)

  const variantAssetIds = {} as Record<ImagemapWidth, string>
  for (const width of IMAGEMAP_WIDTHS) {
    const variant = generated.variants[width]
    const variantPath = storagePathFor(campaignId, `imagemap-${width}.jpg`)
    const stored = await store.put(variantPath, variant.data, variant.mime)

    const [asset] = await sql<{ id: string }[]>`
      INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type,
                         bytes, width, height, replaces_asset_id, uploaded_by)
      VALUES (${campaignId}, ${stored.storagePath}, ${stored.publicUrl}, 'image',
              ${variant.mime}, ${variant.data.byteLength}, ${variant.width}, ${variant.height},
              null, ${session.userId})
      RETURNING id`
    variantAssetIds[width] = asset.id
  }

  await markImagemapApplied(sql, {
    cardId, campaignId, actions: areasResult.areas as TapArea[], altText: altTextResult.altText,
    baseWidth: generated.baseWidth, baseHeight: generated.baseHeight,
    variantAssetIds, userId: session.userId,
  })

  revalidatePath(editorPath(campaignId, cardId))
  revalidatePath(`/campaigns/${campaignId}/assets`)
  revalidatePath(`/campaigns/${campaignId}/cards`)
}
