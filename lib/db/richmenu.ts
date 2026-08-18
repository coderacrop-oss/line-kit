import type postgres from 'postgres'
import type { AssetStore } from '../assets/store'
import type { Queryable } from './client'
import {
  createRichMenu as lineCreateRichMenu, linkRichMenuBatch, setRichMenuAlias, uploadRichMenuImage,
  validateRichMenuObject, type LineRichMenuPayload,
} from '../line/client'
import { menusNeedingAlias } from '../richmenu/alias'
import { type AreaKind, asAreaKind, buildAreas, countEmpty, type RichMenuArea, toLineArea } from '../richmenu/areas'
import { buildLinkOperations, chunkOperations } from '../richmenu/batch'
import { identifyLayout, type LayoutKey } from '../richmenu/layouts'
import { isValidMenuImageSize } from '../richmenu/image'
import { listActivities } from './activities'
import { listAssets } from './assets'
import { listCards } from './cards'

export type RichMenuRow = {
  id: string
  campaign_id: string
  alias: string
  image_asset_id: string
  areas: RichMenuArea[]
  is_entry: boolean
  line_rich_menu_id: string | null
  chat_bar_text: string
}

export type RichMenuView = {
  id: string
  alias: string
  imageAssetId: string
  imageUrl: string
  imageWidth: number
  imageHeight: number
  areas: RichMenuArea[]
  isEntry: boolean
  lineRichMenuId: string | null
  chatBarText: string
  layout: LayoutKey
  emptyCount: number
  /** true เมื่อภาพที่เลือกไว้ไม่ใช่ 2500×1686 พอดี — ต้นแบบ m.imgBad */
  imageBad: boolean
}

export type RichMenuImageOption = { id: string; label: string; url: string; width: number; height: number }
export type RichMenuActivityOption = { id: string; code: string; name: string }
export type RichMenuCardOption = { id: string; code: string }
export type RichMenuTargetOption = { id: string; alias: string }

export type RichMenuScreenData = {
  menus: RichMenuView[]
  images: RichMenuImageOption[]
  activities: RichMenuActivityOption[]
  cards: RichMenuCardOption[]
}

function toView(row: RichMenuRow, imagesById: Map<string, RichMenuImageOption>): RichMenuView {
  const image = imagesById.get(row.image_asset_id)
  const areas = (row.areas ?? []).map((area) => ({ ...area, kind: asAreaKind(area.kind) }))
  return {
    id: row.id,
    alias: row.alias,
    imageAssetId: row.image_asset_id,
    imageUrl: image?.url ?? '',
    imageWidth: image?.width ?? 0,
    imageHeight: image?.height ?? 0,
    areas,
    isEntry: row.is_entry,
    lineRichMenuId: row.line_rich_menu_id,
    chatBarText: row.chat_bar_text,
    layout: identifyLayout(areas),
    emptyCount: countEmpty(areas),
    imageBad: !(image && isValidMenuImageSize(image.width, image.height)),
  }
}

/**
 * ทุกอย่างที่จอ M4-S01 ต้องใช้ — เมนูของแคมเปญนี้ · ภาพที่เลือกได้จากคลัง ·
 * กิจกรรมกับการ์ดที่ช่องเลือกเป้าหมายต้องใช้
 *
 * `listAssets`/`listActivities`/`listCards` ตัวเดียวกับที่จออื่นใช้ — ด่านที่ตัดสิน
 * ว่าจะยิงของขึ้น LINE หรือไม่ต้องมองเห็นของชุดเดียวกับที่คนตั้งค่ามองเห็นตอนกรอก
 * (เหตุผลเดียวกับ lib/db/publish.ts)
 */
export async function loadRichMenuScreen(sql: postgres.Sql, campaignId: string): Promise<RichMenuScreenData> {
  const [rows, assets, activities, cards] = await Promise.all([
    sql<RichMenuRow[]>`
      SELECT id, campaign_id, alias, image_asset_id, areas, is_entry, line_rich_menu_id, chat_bar_text
        FROM rich_menu WHERE campaign_id = ${campaignId} ORDER BY created_at, alias`,
    listAssets(sql, campaignId),
    listActivities(sql, campaignId),
    listCards(sql, campaignId),
  ])

  const images = assets
    .filter((asset) => asset.mediaType === 'image')
    .map((asset) => ({
      id: asset.id, label: asset.fileName, url: asset.publicUrl, width: asset.width, height: asset.height,
    }))
  const imagesById = new Map(images.map((image) => [image.id, image]))

  return {
    menus: rows.map((row) => toView(row, imagesById)),
    images,
    activities: activities.map((a) => ({ id: a.id, code: a.code, name: a.name })),
    cards: cards.map((c) => ({ id: c.id, code: c.code })),
  }
}

/** ป้ายเรียกทุกเมนูของแคมเปญนี้ · ใช้เป็นตัวเลือกปลายทาง "ไปเมนูอีกชุด" ของช่องอื่น */
export async function listRichMenuTargets(sql: postgres.Sql, campaignId: string): Promise<RichMenuTargetOption[]> {
  const rows = await sql<{ id: string; alias: string }[]>`
    SELECT id, alias FROM rich_menu WHERE campaign_id = ${campaignId} ORDER BY alias`
  return rows
}

/** UNIQUE (campaign_id, alias) ของตาราง */
const UNIQUE_VIOLATION = '23505'
/** ลบเมนูที่ยังมี channel.base_richmenu_id ชี้อยู่ */
const FOREIGN_KEY_VIOLATION = '23503'

export class DuplicateAliasError extends Error {}
export class RichMenuInUseError extends Error {}

/**
 * สร้างเมนูใหม่ · ต้องเลือกภาพตั้งแต่ตอนสร้าง เพราะ `image_asset_id` เป็น
 * NOT NULL (L2 §5.2) — ต่างจากต้นแบบที่วาดการ์ดว่างให้กรอกทีละช่องได้ก่อน แต่แถว
 * ที่ยังไม่มีภาพไม่มีทางบันทึกลง schema นี้ได้เลย จึงรวมภาพเข้าไปในฟอร์ม "+ เพิ่ม
 * เมนู" ตั้งแต่ต้น (ดูเหตุผลเต็มในรายงานของงาน M4-S01)
 */
export async function createRichMenu(
  sql: postgres.Sql,
  input: { campaignId: string; alias: string; imageAssetId: string; layout: LayoutKey },
): Promise<{ id: string }> {
  const areas = buildAreas(input.layout)
  try {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO rich_menu (campaign_id, alias, image_asset_id, areas)
      VALUES (${input.campaignId}, ${input.alias}, ${input.imageAssetId}, ${sql.json(areas as never)})
      RETURNING id`
    return row
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new DuplicateAliasError(`แคมเปญนี้มีชื่อเรียกเมนู "${input.alias}" อยู่แล้ว — ตั้งชื่ออื่น`)
    }
    throw error
  }
}

/** แก้ชื่อเรียกและภาพของเมนู — สองช่องนี้อยู่ในฟอร์มบันทึกหลักของการ์ดตามต้นแบบ */
export async function updateRichMenu(
  sql: postgres.Sql,
  input: { id: string; campaignId: string; alias: string; imageAssetId: string },
): Promise<void> {
  try {
    await sql`
      UPDATE rich_menu SET alias = ${input.alias}, image_asset_id = ${input.imageAssetId}
       WHERE id = ${input.id} AND campaign_id = ${input.campaignId}`
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new DuplicateAliasError(`แคมเปญนี้มีชื่อเรียกเมนู "${input.alias}" อยู่แล้ว — ตั้งชื่ออื่น`)
    }
    throw error
  }
}

/**
 * แก้เฉพาะภาพของเมนู ไม่แตะชื่อเรียก — ใช้ตอนกด "ใช้" บนตัวจัดวางภาพหลายชั้น
 * (M4-S02) ซึ่งจอนั้นไม่มีช่องแก้ชื่อเรียกเลย ต่างจาก updateRichMenu ที่มาจากฟอร์ม
 * บันทึกหลักของ M4-S01 ซึ่งแก้สองอย่างพร้อมกันเสมอตามแบบของจอนั้น
 */
export async function setMenuImage(
  sql: postgres.Sql, input: { id: string; campaignId: string; imageAssetId: string },
): Promise<void> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM rich_menu WHERE id = ${input.id} AND campaign_id = ${input.campaignId}`
  if (!row) throw new Error('ไม่พบเมนูนี้ในแคมเปญนี้')
  await sql`UPDATE rich_menu SET image_asset_id = ${input.imageAssetId} WHERE id = ${input.id}`
}

/** เปลี่ยนผังช่อง — เก็บปลายทางเดิมไว้ตามตำแหน่งเท่าที่ยังมีช่องเหลือ (buildAreas) */
export async function setLayout(
  sql: postgres.Sql, input: { id: string; campaignId: string; layout: LayoutKey },
): Promise<void> {
  const [row] = await sql<{ areas: RichMenuArea[] }[]>`
    SELECT areas FROM rich_menu WHERE id = ${input.id} AND campaign_id = ${input.campaignId}`
  if (!row) throw new Error('ไม่พบเมนูนี้ในแคมเปญนี้')
  const next = buildAreas(input.layout, row.areas ?? [])
  await sql`UPDATE rich_menu SET areas = ${sql.json(next as never)} WHERE id = ${input.id}`
}

/** แก้ปลายทางของช่องเดียว */
export async function setAreaTarget(
  sql: postgres.Sql,
  input: { id: string; campaignId: string; index: number; kind: AreaKind; target: string | null },
): Promise<void> {
  const [row] = await sql<{ areas: RichMenuArea[] }[]>`
    SELECT areas FROM rich_menu WHERE id = ${input.id} AND campaign_id = ${input.campaignId}`
  if (!row) throw new Error('ไม่พบเมนูนี้ในแคมเปญนี้')
  const areas = row.areas ?? []
  if (input.index < 0 || input.index >= areas.length) throw new Error('ช่องนี้ไม่มีอยู่ในผังปัจจุบัน')
  const next = areas.map((area, i) => (
    i === input.index
      ? { ...area, kind: input.kind, target: input.kind === 'none' ? null : input.target }
      : area
  ))
  await sql`UPDATE rich_menu SET areas = ${sql.json(next as never)} WHERE id = ${input.id}`
}

/**
 * ตั้งเมนูหนึ่งตัวเป็นตัวเข้า (BR-78) · ตัวเก่าหลุดอัตโนมัติในธุรกรรมเดียว
 *
 * เขียนเป็นสองคำสั่งในธุรกรรมเดียวกันโดยตั้งใจ ไม่ใช่คำสั่งเดียวที่คำนวณทุกแถวพร้อม
 * กัน — unique index บางส่วนของ postgres ตรวจทันทีที่แต่ละแถวถูกเขียน ไม่รอจบทั้ง
 * คำสั่ง การล้างของเก่าก่อนแล้วค่อยตั้งของใหม่จึงไม่มีจังหวะที่สองแถวเป็น true
 * พร้อมกันแม้แค่ชั่วครู่ ซึ่งเป็นจังหวะเดียวที่ index จะปฏิเสธ
 */
export async function setEntryMenu(
  sql: postgres.Sql, input: { campaignId: string; id: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      UPDATE rich_menu SET is_entry = false
       WHERE campaign_id = ${input.campaignId} AND is_entry = true AND id <> ${input.id}`
    await tx`
      UPDATE rich_menu SET is_entry = true
       WHERE id = ${input.id} AND campaign_id = ${input.campaignId}`
  })
}

export async function deleteRichMenu(
  sql: postgres.Sql, input: { id: string; campaignId: string },
): Promise<void> {
  try {
    await sql`DELETE FROM rich_menu WHERE id = ${input.id} AND campaign_id = ${input.campaignId}`
  } catch (error) {
    if ((error as { code?: string }).code === FOREIGN_KEY_VIOLATION) {
      throw new RichMenuInUseError('ลบไม่ได้ — บัญชี LINE ตั้งเมนูนี้เป็นเมนูเริ่มต้นอยู่ ถอดออกจากบัญชีก่อน')
    }
    throw error
  }
}

/**
 * §4.4 ขั้น 4b · 5 · 5b · 5c ทั้งชุด — เรียกจากข้างใน `sql.begin()` เดียวกับที่
 * `lib/db/publish.ts` ใช้อยู่แล้ว (`writePublish` → `runAtLine`) ไม่ใช่ธุรกรรมแยก
 *
 * ไม่ทำอะไรเลยเมื่อแคมเปญนี้ไม่มีเมนูสักใบ — แคมเปญที่ไม่ใช้ Rich Menu ต้องส่งขึ้น
 * ได้เหมือนก่อนมีงานนี้ (ตัดสินใจข้อ 5 ของงาน M4-S01)
 *
 * ลำดับในฟังก์ชันนี้คือลำดับของ §4.4 เป๊ะ: ตรวจโครงกับ LINE ก่อนสร้างจริงทีละใบ
 * (4b) → สร้างแล้วอัปโหลดภาพทีละใบ (5) → ลงทะเบียน alias เฉพาะเมนูที่มีปุ่มสลับ
 * แท็บชี้ถึงจริง (5b) → ย้ายคนจากเมนูรุ่นก่อนไปรุ่นใหม่ทีเดียว ข้ามได้ถ้าไม่มีใคร
 * เคยอัปโหลดมาก่อนเลย (5c) — ทุกขั้นอยู่ในธุรกรรมเดียวกับผู้เรียก ขั้นไหนโยน error
 * ธุรกรรมทั้งก้อนย้อนกลับหมดโดยอัตโนมัติ ไม่มีเมนูค้างครึ่งๆ กลางๆ
 */
export async function publishRichMenus(
  tx: Queryable,
  input: { campaignId: string; campaignCode: string; accessToken: string; store: AssetStore },
): Promise<void> {
  const rows = await tx<Array<RichMenuRow & {
    storage_path: string; mime_type: string; width: number; height: number
  }>>`
    SELECT rm.id, rm.campaign_id, rm.alias, rm.image_asset_id, rm.areas, rm.is_entry,
           rm.line_rich_menu_id, rm.chat_bar_text, a.storage_path, a.mime_type, a.width, a.height
      FROM rich_menu rm JOIN asset a ON a.id = rm.image_asset_id
     WHERE rm.campaign_id = ${input.campaignId}
     ORDER BY rm.created_at`

  if (rows.length === 0) return

  // คิวรีตรงๆ แทนการเรียก listActivities() — ฟังก์ชันนั้นรับเฉพาะ postgres.Sql
  // แต่ตรงนี้ต้องวิ่งอยู่ใน tx ของ §4.4 (postgres.TransactionSql) และสิ่งที่
  // ต้องใช้จริงมีแค่ id → code เท่านั้น ไม่คุ้มจะขยาย signature ของฟังก์ชันที่ใช้
  // ร่วมกับทั้งระบบเพื่อกรณีนี้กรณีเดียว
  const activities = await tx<{ id: string; code: string }[]>`
    SELECT id, code FROM activity WHERE campaign_id = ${input.campaignId}`
  const activityCodeById = Object.fromEntries(activities.map((a) => [a.id, a.code]))
  const aliasByMenuId = Object.fromEntries(rows.map((r) => [r.id, r.alias]))

  type Uploaded = {
    id: string
    alias: string
    areas: RichMenuArea[]
    previousLineRichMenuId: string | null
    newLineRichMenuId: string
  }
  const uploaded: Uploaded[] = []

  for (const row of rows) {
    const areas = (row.areas ?? []).map((area) => ({ ...area, kind: asAreaKind(area.kind) }))
    const lineAreas = areas.map((area) => toLineArea(area, {
      aliasByMenuId, activityCodeById, campaignCode: input.campaignCode,
    }))

    const payload: LineRichMenuPayload = {
      // ผืนใหญ่ (2500×1686) หรือผืนเล็ก (2500×843) — มาจากภาพจริงที่เลือกไว้ ไม่ใช่
      // ค่าคงที่ เพราะตอนนี้เมนูหนึ่งใบเลือกได้สองขนาด ไม่ใช่ผืนใหญ่อย่างเดียวแล้ว
      size: { width: row.width, height: row.height },
      // ไม่ผูกกับ is_entry (BR-78) โดยตั้งใจ — `selected` ของ LINE คือ "เมนู
      // เริ่มต้นของทั้งบัญชี" ซึ่งเป็นกลไกคนละตัวกับเมนูตัวเข้าของแคมเปญนี้
      // (BR-71 · channel.set_default_menu ปิดไว้เป็นค่าเริ่มต้นอยู่แล้ว) การผูก
      // สองอย่างนี้เข้าด้วยกันจะทำให้เมนูของแคมเปญทับเมนูของแบรนด์ให้คนที่ไม่ได้
      // เข้าร่วมด้วย ซึ่งเป็นสิ่งที่ BR-71 ป้องกันไว้
      selected: false,
      name: row.alias,
      chatBarText: row.chat_bar_text,
      areas: lineAreas,
    }

    // 4b · BR-96 · ERR-044 — ต้องผ่านทั้งด่านนี้และด่านของเรา (lib/publish/validate.ts)
    // ไม่ใช่ใช้แทนกัน · ข้อความของ LINE ต้องขึ้นตรงๆ ห้ามแปลหรือย่อ (L2 §7)
    try {
      await validateRichMenuObject(input.accessToken, payload)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`ERR-044 · เมนู "${row.alias}" ส่งให้ LINE ตรวจแล้วไม่ผ่าน — ${detail}`)
    }

    // 5 — สร้างแล้วอัปโหลดภาพทันที · วาดไม่ครบ (อัปโหลดล้ม) ต้องถือว่า publish ล้มทั้งก้อน
    const { richMenuId } = await lineCreateRichMenu(input.accessToken, payload)
    const bytes = await input.store.get(row.storage_path)
    await uploadRichMenuImage(input.accessToken, richMenuId, { bytes, contentType: row.mime_type })

    await tx`UPDATE rich_menu SET line_rich_menu_id = ${richMenuId} WHERE id = ${row.id}`

    uploaded.push({
      id: row.id,
      alias: row.alias,
      areas,
      previousLineRichMenuId: row.line_rich_menu_id,
      newLineRichMenuId: richMenuId,
    })
  }

  // 5b · BR-77 — เฉพาะเมนูที่มีปุ่มสลับแท็บชี้ถึงจริง ไม่ใช่ทุกเมนู
  const needAlias = menusNeedingAlias(uploaded.map((m) => ({ id: m.id, alias: m.alias, areas: m.areas })))
  for (const menu of needAlias) {
    const newId = uploaded.find((m) => m.id === menu.id)?.newLineRichMenuId
    if (!newId) continue
    await setRichMenuAlias(input.accessToken, { richMenuAliasId: menu.alias, richMenuId: newId })
  }

  // 5c · BR-97 · ERR-045 — ว่างเปล่าเองโดยธรรมชาติเมื่อเป็นการส่งขึ้นครั้งแรก (ดู lib/richmenu/batch.ts)
  const operations = buildLinkOperations(uploaded.map((m) => ({
    previousLineRichMenuId: m.previousLineRichMenuId,
    newLineRichMenuId: m.newLineRichMenuId,
  })))
  try {
    for (const chunk of chunkOperations(operations)) {
      await linkRichMenuBatch(input.accessToken, chunk)
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`ERR-045 · ย้ายผู้ใช้จากเมนูรุ่นก่อนไปรุ่นใหม่ไม่สำเร็จ — ${detail}`)
  }
}

