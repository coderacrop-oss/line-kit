import type postgres from 'postgres'
import type { Queryable } from './client'
import type { ImagemapWidth } from '../imagemap/sizes'
import type { TapArea, TapRect } from '../imagemap/regions'
import type { RenderableImagemapVideo } from '../render/card'

/**
 * ชั้น DB ของริชเมสเสจ/ริชวิดีโอ (Rich Message/Rich Video · LINE Imagemap Message
 * ภาพล้วน หรือมีวิดีโอเล่นทับ — render_as = 'imagemap' | 'imagemap_video') — ไม่มี
 * แถวใน `card_imagemap` แปลว่าการ์ดใบนี้ยังไม่เคยอัปโหลดภาพฐานเลย (จอเริ่มจากพื้นเปล่า)
 *
 * พื้นที่กด (`tap_areas`) กับไฟล์วิดีโอ/ลิงก์หลังเล่นจบ (`video_asset_id` ·
 * `video_end_uri` · `video_end_label`) อยู่บนตาราง `card` เอง ไม่ใช่ที่นี่ — L2 §5.2
 * จองคอลัมน์เหล่านั้นไว้ให้เรื่องนี้อยู่แล้ว (ดูหมายเหตุเต็มที่หัว
 * supabase/migrations/0009_card_imagemap.sql และ 0011_card_imagemap_video.sql)
 * ทุกฟังก์ชันที่นี่จึงต้องอัปเดตทั้งสองตารางในธุรกรรมเดียวเมื่อพื้นที่กด/วิดีโอเปลี่ยน
 *
 * ทุกฟังก์ชันตรวจว่า card_id เป็นของ campaignId ที่อ้างมาจริงก่อนเสมอ — เหตุผล
 * เดียวกับทุกฟังก์ชันใน lib/db/richmenu-composition.ts: id มาจาก URL ซึ่งใครก็แก้เองได้
 *
 * ริชวิดีโอ (imagemap_video) ใช้ภาพฐาน + พื้นที่กดชุดเดียวกับริชเมสเสจทุกประการ
 * — ฟังก์ชันเดิมทั้งหมด (loadCardImagemap · setImagemapBaseImage · saveImagemapDraft
 * · markImagemapApplied) จึงรับทั้งสอง render_as ไม่แยกชุดฟังก์ชัน ส่วนที่เพิ่มใหม่
 * เฉพาะวิดีโอ (setImagemapVideoAsset · setImagemapVideoPreview) แยกออกมาเพราะไม่มี
 * ขั้นตอน "ปั้นภาพ" ให้ต้องกด "ใช้" เหมือนภาพฐาน — วิดีโอพร้อมทันทีที่ครบสามอย่าง
 * (ดูหมายเหตุของ 0011_card_imagemap_video.sql)
 */

const IMAGEMAP_RENDER_TYPES = ['imagemap', 'imagemap_video'] as const

export type CardImagemap = {
  cardId: string
  baseAssetId: string | null
  baseImageUrl: string | null
  baseWidth: number | null
  baseHeight: number | null
  altText: string
  actions: TapArea[]
  /** ครบทั้งห้าขนาดเมื่อกด "ใช้" สำเร็จแล้วอย่างน้อยหนึ่งครั้ง · ว่างก่อนหน้านั้น */
  variantUrls: Partial<Record<ImagemapWidth, string>>
  /** ต่อไปนี้มีความหมายเฉพาะการ์ดที่ render_as = 'imagemap_video' — เป็น null/ว่างเสมอสำหรับ imagemap ธรรมดา */
  videoAssetId: string | null
  videoUrl: string | null
  videoPreviewAssetId: string | null
  videoPreviewUrl: string | null
  videoArea: TapRect | null
  videoLinkUri: string
  videoLinkLabel: string
}

type Row = {
  card_id: string
  tap_areas: TapArea[] | null
  base_asset_id: string | null
  base_public_url: string | null
  base_width: number | null
  base_height: number | null
  alt_text: string
  variant_assets: Record<string, string> | null
  video_asset_id: string | null
  video_public_url: string | null
  video_end_uri: string
  video_end_label: string
  video_preview_asset_id: string | null
  video_preview_public_url: string | null
  video_area: TapRect | null
}

async function resolveVariantUrls(
  sql: postgres.Sql, variantAssets: Record<string, string> | null,
): Promise<Partial<Record<ImagemapWidth, string>>> {
  const entries = Object.entries(variantAssets ?? {})
  if (entries.length === 0) return {}

  const ids = entries.map(([, id]) => id)
  const rows = await sql<{ id: string; public_url: string }[]>`
    SELECT id, public_url FROM asset WHERE id = ANY(${sql.array(ids)}::uuid[])`
  const urlById = new Map(rows.map((r) => [r.id, r.public_url]))

  const result: Partial<Record<ImagemapWidth, string>> = {}
  for (const [width, assetId] of entries) {
    const url = urlById.get(assetId)
    if (url) result[Number(width) as ImagemapWidth] = url
  }
  return result
}

function toCardImagemap(row: Row, variantUrls: Partial<Record<ImagemapWidth, string>>): CardImagemap {
  return {
    cardId: row.card_id,
    baseAssetId: row.base_asset_id,
    baseImageUrl: row.base_public_url,
    baseWidth: row.base_width,
    baseHeight: row.base_height,
    altText: row.alt_text,
    actions: row.tap_areas ?? [],
    variantUrls,
    videoAssetId: row.video_asset_id,
    videoUrl: row.video_public_url,
    videoPreviewAssetId: row.video_preview_asset_id,
    videoPreviewUrl: row.video_preview_public_url,
    videoArea: row.video_area,
    videoLinkUri: row.video_end_uri,
    videoLinkLabel: row.video_end_label,
  }
}

/**
 * โหลดสถานะริชเมสเสจของการ์ดหนึ่งใบ — คืน `null` เมื่อการ์ดไม่อยู่ในแคมเปญนี้ หรือ
 * ยังไม่ใช่ `render_as = 'imagemap'`
 *
 * ไม่พบแถวใน `card_imagemap` (ยังไม่เคยอัปโหลดภาพฐานเลย) ไม่ใช่ `null` ทั้งก้อน —
 * ยังคืนโครงว่างเปล่าที่มี `actions` จาก `card.tap_areas` (อาจมีอยู่แล้วถ้าเคยวาด
 * พื้นที่ไว้ก่อนอัปโหลดภาพ) เพื่อให้จอเริ่มจากพื้นเปล่าที่ถูกต้อง ไม่ใช่รายงานว่าการ์ด
 * นี้ไม่มีอยู่จริง
 */
export async function loadCardImagemap(
  sql: postgres.Sql, campaignId: string, cardId: string,
): Promise<CardImagemap | null> {
  const [row] = await sql<Row[]>`
    SELECT c.id AS card_id, c.tap_areas,
           ci.base_asset_id, a.public_url AS base_public_url,
           ci.base_width, ci.base_height,
           coalesce(ci.alt_text, '') AS alt_text, ci.variant_assets,
           c.video_asset_id, va.public_url AS video_public_url,
           coalesce(c.video_end_uri, '') AS video_end_uri,
           coalesce(c.video_end_label, '') AS video_end_label,
           ci.video_preview_asset_id, vpa.public_url AS video_preview_public_url,
           ci.video_area
      FROM card c
      LEFT JOIN card_imagemap ci ON ci.card_id = c.id
      LEFT JOIN asset a ON a.id = ci.base_asset_id
      LEFT JOIN asset va ON va.id = c.video_asset_id
      LEFT JOIN asset vpa ON vpa.id = ci.video_preview_asset_id
     WHERE c.id = ${cardId} AND c.campaign_id = ${campaignId}
       AND c.render_as = ANY(${sql.array(IMAGEMAP_RENDER_TYPES as unknown as string[])})`
  if (!row) return null

  const variantUrls = await resolveVariantUrls(sql, row.variant_assets)
  return toCardImagemap(row, variantUrls)
}

async function requireImagemapCard(
  sql: postgres.Sql | postgres.TransactionSql, campaignId: string, cardId: string,
): Promise<void> {
  const [card] = await sql<{ id: string }[]>`
    SELECT id FROM card WHERE id = ${cardId} AND campaign_id = ${campaignId}
       AND render_as = ANY(${sql.array(IMAGEMAP_RENDER_TYPES as unknown as string[])})`
  if (!card) throw new Error('ไม่พบการ์ดริชเมสเสจนี้ในแคมเปญนี้')
}

/**
 * บันทึกร่าง — พื้นที่กดกับข้อความสำรอง เรียกทุกครั้งที่ทำเจสเจอร์เสร็จหนึ่งครั้ง
 * (ลาก/ปรับขนาด/เพิ่ม/ลบ) เป็น autosave ไปในตัว เหมือน saveComposition ของ Rich Menu
 *
 * เขียนสองตารางในธุรกรรมเดียว — `card.tap_areas` (พื้นที่กด) กับ `card_imagemap`
 * (ข้อความสำรอง) เพราะสองอย่างนี้บันทึกจากฟอร์มเดียวกันพร้อมกันเสมอ ครึ่งเดียวสำเร็จ
 * จะทำให้จอที่โหลดใหม่เห็นพื้นที่กดที่อ้างข้อความสำรองซึ่งไม่ตรงกับที่กรอกไว้จริง
 */
export async function saveImagemapDraft(
  sql: postgres.Sql,
  input: {
    cardId: string; campaignId: string; actions: TapArea[]; altText: string; userId: string
    /** เฉพาะการ์ดริชวิดีโอ — imagemap ธรรมดาไม่ส่งมาเลยและได้ค่าว่างเสมอ */
    videoArea?: TapRect | null; videoLinkUri?: string; videoLinkLabel?: string
  },
): Promise<void> {
  const videoArea = input.videoArea ?? null
  const videoLinkUri = input.videoLinkUri ?? ''
  const videoLinkLabel = input.videoLinkLabel ?? ''

  await sql.begin(async (tx) => {
    await requireImagemapCard(tx, input.campaignId, input.cardId)

    await tx`
      UPDATE card
         SET tap_areas = ${tx.json(input.actions as never)},
             video_end_uri = ${videoLinkUri || null}, video_end_label = ${videoLinkLabel || null}
       WHERE id = ${input.cardId}`

    await tx`
      INSERT INTO card_imagemap (card_id, alt_text, video_area, updated_by)
      VALUES (${input.cardId}, ${input.altText}, ${videoArea ? tx.json(videoArea as never) : null}, ${input.userId})
      ON CONFLICT (card_id) DO UPDATE
         SET alt_text = EXCLUDED.alt_text, video_area = EXCLUDED.video_area,
             updated_by = EXCLUDED.updated_by, updated_at = now()`
  })
}

/**
 * ตั้งภาพฐานใหม่ — อัปโหลดภาพต้นฉบับแล้ว บันทึกก่อนที่จะรู้ภาพ 5 ขนาดจริง (ยังไม่กด
 * "ใช้") เพื่อให้จอวาดพื้นที่กดบนภาพนี้ได้ทันที `baseWidth`/`baseHeight` ที่นี่คือ
 * ขนาดของภาพเมื่อคำนวณกว้าง 1040 แล้ว (ตัวเลขที่ตัวจัดวางต้องใช้กะระยะ) ไม่ใช่ขนาด
 * ไฟล์ต้นฉบับตรงๆ
 *
 * ล้าง variant_assets ทิ้งเสมอ — ภาพฐานเปลี่ยนแล้ว ภาพ 5 ขนาดชุดเดิมไม่ตรงกับภาพใหม่
 * อีกต่อไป การ์ดใบนี้ต้องกด "ใช้" ใหม่ก่อนถึงจะส่งได้จริง (ไฟล์ asset เดิมไม่ถูกลบ —
 * BR-25 — แค่ไม่มีใครชี้มาแล้ว)
 */
export async function setImagemapBaseImage(
  sql: postgres.Sql,
  input: {
    cardId: string; campaignId: string; assetId: string; baseWidth: number; baseHeight: number
    userId: string
  },
): Promise<void> {
  await requireImagemapCard(sql, input.campaignId, input.cardId)

  await sql`
    INSERT INTO card_imagemap (card_id, base_asset_id, base_width, base_height, updated_by)
    VALUES (${input.cardId}, ${input.assetId}, ${input.baseWidth}, ${input.baseHeight}, ${input.userId})
    ON CONFLICT (card_id) DO UPDATE
       SET base_asset_id = EXCLUDED.base_asset_id, base_width = EXCLUDED.base_width,
           base_height = EXCLUDED.base_height, variant_assets = '{}',
           updated_by = EXCLUDED.updated_by, updated_at = now()`
}

/**
 * ตั้งไฟล์วิดีโอใหม่ของริชวิดีโอ (imagemap_video) — เขียนที่ `card.video_asset_id`
 * ซึ่ง L2 §5.2 จองคอลัมน์นี้ไว้ให้เรื่องนี้อยู่แล้วตั้งแต่ 0001_init.sql (พร้อม FK
 * card_video_asset_fkey) เหมือนที่ tap_areas ถูกจองไว้ให้พื้นที่กดของริชเมสเสจ —
 * ไม่เปิดคอลัมน์ใหม่ซ้ำความหมายเดิมในตารางนี้
 *
 * ต่างจาก setImagemapBaseImage ตรงที่ไม่มี "ล้างของเดิมทิ้ง" ใดๆ — ไม่มีขั้นตอน
 * ปั้นภาพจากวิดีโอ (ไม่มีการแปลงไฟล์ในสไลซ์นี้เลย) เปลี่ยนวิดีโอแล้ววิดีโอใหม่พร้อม
 * ส่งได้ทันทีถ้าพื้นที่เล่น/ภาพตัวอย่างยังตั้งไว้ครบจากรอบก่อนอยู่แล้ว
 */
export async function setImagemapVideoAsset(
  sql: postgres.Sql,
  input: { cardId: string; campaignId: string; assetId: string },
): Promise<void> {
  const [card] = await sql<{ id: string }[]>`
    SELECT id FROM card WHERE id = ${input.cardId} AND campaign_id = ${input.campaignId} AND render_as = 'imagemap_video'`
  if (!card) throw new Error('ไม่พบการ์ดริชวิดีโอนี้ในแคมเปญนี้')

  await sql`UPDATE card SET video_asset_id = ${input.assetId} WHERE id = ${input.cardId}`
}

/**
 * ตั้งภาพตัวอย่างก่อนเล่น (previewImageUrl ของ LINE) — คนละไฟล์จากภาพฐานของริชเมสเสจ
 * (baseUrl) เก็บที่ `card_imagemap.video_preview_asset_id` เพราะเอกสารยังไม่มี
 * คอลัมน์จองไว้ให้ (ดูหมายเหตุหัว supabase/migrations/0011_card_imagemap_video.sql)
 */
export async function setImagemapVideoPreview(
  sql: postgres.Sql,
  input: { cardId: string; campaignId: string; assetId: string; userId: string },
): Promise<void> {
  await requireImagemapCard(sql, input.campaignId, input.cardId)

  await sql`
    INSERT INTO card_imagemap (card_id, video_preview_asset_id, updated_by)
    VALUES (${input.cardId}, ${input.assetId}, ${input.userId})
    ON CONFLICT (card_id) DO UPDATE
       SET video_preview_asset_id = EXCLUDED.video_preview_asset_id,
           updated_by = EXCLUDED.updated_by, updated_at = now()`
}

export type ReadyImagemapVideo = {
  url: string
  previewUrl: string
  area: TapRect
  externalLink: { linkUri: string; label?: string } | null
}

export type ReadyImagemap = {
  baseWidth: number; baseHeight: number; altText: string; actions: TapArea[]
  /** null เมื่อยังไม่ครบสามอย่าง (วิดีโอ · ภาพตัวอย่าง · พื้นที่เล่น) — renderCard() ตกไปเป็นข้อความสำรองเอง (BR-01) */
  video: ReadyImagemapVideo | null
}

/**
 * ReadyImagemapVideo (externalLink: ...|null) → RenderableImagemapVideo ของ
 * lib/render/card.ts (externalLink?: ...) — สองที่ที่ประกอบ RenderableCard.imagemap.video
 * (lib/db/queries.ts:loadCards ให้ผู้เล่นจริง กับ preview-actions.ts ปุ่มส่งทดสอบ
 * BR-62) ใช้ตัวแปลงเดียวกันนี้ แทนที่จะเขียน null→undefined ซ้ำสองที่
 */
export function toRenderableVideo(video: ReadyImagemapVideo): RenderableImagemapVideo {
  return {
    url: video.url, previewUrl: video.previewUrl, area: video.area,
    ...(video.externalLink ? { externalLink: video.externalLink } : {}),
  }
}

/**
 * ริชเมสเสจที่ "พร้อมส่ง" ของทุกการ์ดในแคมเปญนี้ในทีเดียว — ใช้ตอนโหลด config ทั้งชุด
 * ให้ webhook จริง (lib/db/queries.ts:loadCards) แทนที่จะยิง loadCardImagemap ทีละ
 * ใบ (N+1) เหมือนที่ loadCards เองก็โหลดบล็อกของทุกการ์ดในคำสั่งเดียวอยู่แล้ว
 *
 * "พร้อมส่ง" หมายถึงเคยกด "ใช้" สำเร็จแล้วอย่างน้อยหนึ่งครั้ง (variant_assets ไม่ว่าง)
 * — markImagemapApplied เขียนครบทั้งห้าขนาดในธุรกรรมเดียวเสมอ ไม่มีทางเขียนแค่
 * บางขนาด จึง "ไม่ว่าง" กับ "ครบห้าขนาด" เป็นเงื่อนไขเดียวกัน การ์ดที่ยังไม่เคยกด
 * "ใช้" ไม่อยู่ใน Record ที่คืนออกไปเลย — renderCard() ตกไปเป็นข้อความสำรองเอง (BR-01)
 */
export async function loadReadyImagemaps(
  sql: Queryable, campaignId: string,
): Promise<Record<string, ReadyImagemap>> {
  const rows = await sql<{
    card_id: string; render_as: 'imagemap' | 'imagemap_video'
    tap_areas: TapArea[] | null; alt_text: string; base_width: number; base_height: number
    video_url: string | null; video_end_uri: string | null; video_end_label: string | null
    video_preview_url: string | null; video_area: TapRect | null
  }[]>`
    SELECT c.id AS card_id, c.render_as, c.tap_areas, ci.alt_text, ci.base_width, ci.base_height,
           va.public_url AS video_url, c.video_end_uri, c.video_end_label,
           vpa.public_url AS video_preview_url, ci.video_area
      FROM card c
      JOIN card_imagemap ci ON ci.card_id = c.id
      LEFT JOIN asset va ON va.id = c.video_asset_id
      LEFT JOIN asset vpa ON vpa.id = ci.video_preview_asset_id
     WHERE c.campaign_id = ${campaignId} AND c.render_as IN ('imagemap', 'imagemap_video')
       AND ci.variant_assets <> '{}'::jsonb`

  const result: Record<string, ReadyImagemap> = {}
  for (const row of rows) {
    // วิดีโอ "พร้อม" ก็ต่อเมื่อครบทั้งสามอย่าง — ไม่มีขั้นตอนปั้น/แปลงไฟล์ที่ต้องกด
    // "ใช้" แยกต่างหากเหมือนภาพฐาน (ดูหมายเหตุของ 0011_card_imagemap_video.sql)
    // ขาดอย่างใดอย่างหนึ่ง renderCard() ตกไปเป็นข้อความสำรองเอง (BR-01)
    const video: ReadyImagemapVideo | null =
      row.render_as === 'imagemap_video' && row.video_url && row.video_preview_url && row.video_area
        ? {
            url: row.video_url, previewUrl: row.video_preview_url, area: row.video_area,
            externalLink: row.video_end_uri
              ? { linkUri: row.video_end_uri, ...(row.video_end_label ? { label: row.video_end_label } : {}) }
              : null,
          }
        : null

    result[row.card_id] = {
      baseWidth: row.base_width, baseHeight: row.base_height,
      altText: row.alt_text, actions: row.tap_areas ?? [], video,
    }
  }
  return result
}

/**
 * หาไฟล์ของขนาดหนึ่งขนาดสำหรับเส้นทางเสิร์ฟภาพ (app/api/imagemap/[cardId]/[width])
 *
 * ไม่ตรวจ campaignId เลย — เส้นทางนี้ถูกเรียกจากเซิร์ฟเวอร์ของ LINE เอง (ไม่มี
 * session ผู้ดูแลแนบมาด้วย) ตาม `baseUrl` ที่ฝังไปกับข้อความ ซึ่งมีแค่ cardId ไม่มี
 * campaignId — เหมือนกับที่ asset.public_url ทุกไฟล์ในคลังก็เข้าถึงได้แบบสาธารณะ
 * อยู่แล้วโดยไม่มีด่านสิทธิ์ (LINE เองก็ต้องดึงภาพแบบไม่ล็อกอินได้) cardId เป็น UUID
 * เดาไม่ได้อยู่แล้วในตัว
 */
export async function resolveImagemapVariantAsset(
  sql: postgres.Sql, cardId: string, width: ImagemapWidth,
): Promise<{ storagePath: string; mimeType: string } | null> {
  const [row] = await sql<{ storage_path: string; mime_type: string }[]>`
    SELECT a.storage_path, a.mime_type
      FROM card_imagemap ci
      JOIN asset a ON a.id = (ci.variant_assets ->> ${String(width)})::uuid
     WHERE ci.card_id = ${cardId}`
  return row ? { storagePath: row.storage_path, mimeType: row.mime_type } : null
}

/**
 * ปุ่ม "ใช้" — บันทึกร่างล่าสุดก่อน (กันฐานข้อมูลกับภาพที่ปั้นออกมาไม่ตรงกันถ้าขั้น
 * ถัดไปล้มกลางทาง) แล้วเติม `variant_assets` ด้วยภาพ 5 ขนาดที่เพิ่งปั้นเสร็จ
 *
 * `variantAssetIds` มาจากผู้เรียก (Server Action) เสมอ — ไฟล์นี้ไม่แตะ assetStore()
 * หรือ @napi-rs/canvas เลย เหมือนที่ upsertComposition ไม่รู้จัก flattenComposition
 */
export async function markImagemapApplied(
  sql: postgres.Sql,
  input: {
    cardId: string; campaignId: string; actions: TapArea[]; altText: string
    baseWidth: number; baseHeight: number
    variantAssetIds: Record<ImagemapWidth, string>
    userId: string
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    await requireImagemapCard(tx, input.campaignId, input.cardId)

    await tx`UPDATE card SET tap_areas = ${tx.json(input.actions as never)} WHERE id = ${input.cardId}`

    await tx`
      UPDATE card_imagemap
         SET alt_text = ${input.altText}, base_width = ${input.baseWidth}, base_height = ${input.baseHeight},
             variant_assets = ${tx.json(input.variantAssetIds as never)},
             updated_by = ${input.userId}, updated_at = now()
       WHERE card_id = ${input.cardId}`
  })
}
