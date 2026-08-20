import type postgres from 'postgres'
import type { Queryable } from './client'
import type { ImagemapWidth } from '../imagemap/sizes'
import type { TapArea } from '../imagemap/regions'

/**
 * ชั้น DB ของริชเมสเสจ (Rich Message · LINE Imagemap Message ภาพล้วน) — ไม่มีแถวใน
 * `card_imagemap` แปลว่าการ์ดใบนี้ยังไม่เคยอัปโหลดภาพฐานเลย (จอเริ่มจากพื้นเปล่า)
 *
 * พื้นที่กด (`tap_areas`) อยู่บนตาราง `card` เอง ไม่ใช่ที่นี่ — L2 §5.2 จองคอลัมน์นั้น
 * ไว้ให้เรื่องนี้อยู่แล้ว (ดูหมายเหตุเต็มที่หัว supabase/migrations/0009_card_imagemap.sql)
 * ทุกฟังก์ชันที่นี่จึงต้องอัปเดตทั้งสองตารางในธุรกรรมเดียวเมื่อพื้นที่กดเปลี่ยน
 *
 * ทุกฟังก์ชันตรวจว่า card_id เป็นของ campaignId ที่อ้างมาจริงก่อนเสมอ — เหตุผล
 * เดียวกับทุกฟังก์ชันใน lib/db/richmenu-composition.ts: id มาจาก URL ซึ่งใครก็แก้เองได้
 */

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
           coalesce(ci.alt_text, '') AS alt_text, ci.variant_assets
      FROM card c
      LEFT JOIN card_imagemap ci ON ci.card_id = c.id
      LEFT JOIN asset a ON a.id = ci.base_asset_id
     WHERE c.id = ${cardId} AND c.campaign_id = ${campaignId} AND c.render_as = 'imagemap'`
  if (!row) return null

  const variantUrls = await resolveVariantUrls(sql, row.variant_assets)
  return toCardImagemap(row, variantUrls)
}

async function requireImagemapCard(
  sql: postgres.Sql | postgres.TransactionSql, campaignId: string, cardId: string,
): Promise<void> {
  const [card] = await sql<{ id: string }[]>`
    SELECT id FROM card WHERE id = ${cardId} AND campaign_id = ${campaignId} AND render_as = 'imagemap'`
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
  input: { cardId: string; campaignId: string; actions: TapArea[]; altText: string; userId: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    await requireImagemapCard(tx, input.campaignId, input.cardId)

    await tx`UPDATE card SET tap_areas = ${tx.json(input.actions as never)} WHERE id = ${input.cardId}`

    await tx`
      INSERT INTO card_imagemap (card_id, alt_text, updated_by)
      VALUES (${input.cardId}, ${input.altText}, ${input.userId})
      ON CONFLICT (card_id) DO UPDATE
         SET alt_text = EXCLUDED.alt_text, updated_by = EXCLUDED.updated_by, updated_at = now()`
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

export type ReadyImagemap = { baseWidth: number; baseHeight: number; altText: string; actions: TapArea[] }

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
  const rows = await sql<{ card_id: string; tap_areas: TapArea[] | null; alt_text: string; base_width: number; base_height: number }[]>`
    SELECT c.id AS card_id, c.tap_areas, ci.alt_text, ci.base_width, ci.base_height
      FROM card c
      JOIN card_imagemap ci ON ci.card_id = c.id
     WHERE c.campaign_id = ${campaignId} AND c.render_as = 'imagemap'
       AND ci.variant_assets <> '{}'::jsonb`

  const result: Record<string, ReadyImagemap> = {}
  for (const row of rows) {
    result[row.card_id] = {
      baseWidth: row.base_width, baseHeight: row.base_height,
      altText: row.alt_text, actions: row.tap_areas ?? [],
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
