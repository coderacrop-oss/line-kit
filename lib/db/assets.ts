import type postgres from 'postgres'
import { describeBytes } from '../assets/validate'
import { fileNameOf } from '../assets/store'

export type MediaType = 'image' | 'video'

export type AssetRow = {
  id: string
  storage_path: string
  public_url: string
  media_type: MediaType
  mime_type: string
  bytes: number
  width: number
  height: number
  duration_sec: number | null
  replaces_asset_id: string | null
  created_at: Date
  uploaded_by_email: string
  /** ที่อยู่ของภาพที่แถวนี้อัปโหลดมาแทน · null เมื่อเป็นภาพใหม่ */
  replaces_path: string | null
  /** ที่อยู่ของภาพที่มาแทนแถวนี้ทีหลัง · null เมื่อยังไม่มีใครมาแทน */
  replaced_by_path: string | null
  /** ชื่อของทุกสิ่งที่ชี้มาที่ภาพนี้ · ว่างคือไม่มีใครใช้ */
  used_by: string[]
}

export type AssetView = {
  id: string
  fileName: string
  publicUrl: string
  mediaType: MediaType
  mimeType: string
  bytes: number
  width: number
  height: number
  durationSec: number | null
  /** บรรทัดเดียวที่บอกขนาดไฟล์และขนาดภาพ · "188 KB · 1024×678" */
  meta: string
  uploadedAt: Date
  uploadedBy: string
  usedBy: string[]
  isOrphan: boolean
  replacesText: string | null
  replacedByText: string | null
  canDelete: boolean
  /** เหตุผลที่ลบไม่ได้ · null เมื่อลบได้ */
  deleteBlockedWhy: string | null
}

/** บรรทัดกำกับใต้ภาพในต้นแบบ · ขนาดไฟล์ แล้วขนาดภาพ */
export function describeMeta(bytes: number, width: number, height: number): string {
  return `${describeBytes(bytes)} · ${width}×${height}`
}

/**
 * แถวหนึ่งในคลัง อย่างที่จอต้องใช้
 *
 * Two sentences are built here rather than on the screen because both of them
 * are about BR-25 and both of them are easy to write in a way that is almost
 * true. Replacing an image does not replace a file: the old one stays where it
 * is, forever, because a card already sitting in somebody's chat is still
 * pointing at it and nothing can edit a message that has been delivered.
 *
 * "ไม่มีใครใช้" is a claim, so it is made only when every place that can point at
 * an asset says it does not — including the newer asset that replaced this one.
 * The prototype's version of this does not count that last one, which is how a
 * screen ends up offering to delete precisely the file BR-25 protects.
 */
export function summarizeAsset(row: AssetRow): AssetView {
  const usedBy = row.used_by ?? []
  const replacedByFile = row.replaced_by_path ? fileNameOf(row.replaced_by_path) : null

  const deleteBlockedWhy = usedBy.length > 0
    ? `ลบไม่ได้ — ${usedBy.join(' · ')} ใช้อยู่`
    : replacedByFile
      ? `ลบไม่ได้ — ${replacedByFile} อัปโหลดมาแทนภาพนี้ การ์ดที่ส่งไปแล้วยังชี้มาที่ภาพนี้อยู่ (BR-25)`
      : null

  return {
    id: row.id,
    fileName: fileNameOf(row.storage_path),
    publicUrl: row.public_url,
    mediaType: row.media_type,
    mimeType: row.mime_type,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    durationSec: row.duration_sec,
    meta: describeMeta(row.bytes, row.width, row.height),
    uploadedAt: row.created_at,
    uploadedBy: row.uploaded_by_email,
    usedBy,
    isOrphan: usedBy.length === 0,
    replacesText: row.replaces_path
      ? `แทนที่ ${fileNameOf(row.replaces_path)} — ไฟล์เดิมยังอยู่ ไม่ถูกลบ (BR-25)`
      : null,
    replacedByText: replacedByFile
      ? `มี ${replacedByFile} อัปโหลดมาแทนแล้ว — การ์ดที่ส่งไปก่อนหน้านั้นยังเป็นภาพนี้`
      : null,
    canDelete: deleteBlockedWhy === null,
    deleteBlockedWhy,
  }
}

export const ASSET_FILTERS = ['ทั้งหมด', 'ที่ใช้อยู่', 'ที่ไม่มีใครใช้'] as const
export type AssetFilter = (typeof ASSET_FILTERS)[number]

export const asAssetFilter = (raw: string | undefined): AssetFilter =>
  (ASSET_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as AssetFilter) : 'ทั้งหมด'

/**
 * ค้นและกรองในฝั่งเซิร์ฟเวอร์ · หน้านี้ไม่มี state ฝั่ง client
 *
 * The search is on the filename because that is the only thing the person typed
 * themselves; everything else on a card is derived. Matching is
 * case-insensitive so a file exported as PROMO.PNG is found by typing promo,
 * which is what anyone would type.
 */
export function filterAssets(
  assets: readonly AssetView[],
  { query = '', filter = 'ทั้งหมด' }: { query?: string; filter?: AssetFilter } = {},
): AssetView[] {
  const needle = query.trim().toLowerCase()
  return assets.filter((asset) => {
    if (filter === 'ที่ใช้อยู่' && asset.isOrphan) return false
    if (filter === 'ที่ไม่มีใครใช้' && !asset.isOrphan) return false
    return needle === '' || asset.fileName.toLowerCase().includes(needle)
  })
}

/**
 * ทุกที่ที่ชี้มาหาภาพหนึ่งภาพได้ ตามที่ schema เขียนไว้จริง
 *
 * Derived from the foreign keys rather than from asset.used_in. That column is a
 * cache and nothing in this codebase writes it, so reading it would report every
 * asset as unused no matter how many cards were built on it. A cache nobody
 * fills is worse than a join: the join is slower and correct, and the pill it
 * feeds is an invitation to delete something.
 *
 * card_block holds an image by URL in a TEXT column rather than by id, so that
 * one is matched on public_url. reward and card_selector hold TEXT that could be
 * either an id or a URL — no screen writes them yet, so both are matched, which
 * errs towards calling an asset used. Being wrong in that direction leaves a
 * file on disk; being wrong in the other direction deletes one.
 */
function selectAssets(sql: postgres.Sql, where: postgres.PendingQuery<AssetRow[]>) {
  return sql<AssetRow[]>`
    SELECT a.id, a.storage_path, a.public_url, a.media_type, a.mime_type,
           a.bytes, a.width, a.height, a.duration_sec, a.replaces_asset_id, a.created_at,
           u.email AS uploaded_by_email,
           old.storage_path AS replaces_path,
           (SELECT newer.storage_path FROM asset newer
             WHERE newer.replaces_asset_id = a.id
             ORDER BY newer.created_at LIMIT 1) AS replaced_by_path,
           used.labels AS used_by
      FROM asset a
      JOIN app_user u ON u.id = a.uploaded_by
      LEFT JOIN asset old ON old.id = a.replaces_asset_id
      CROSS JOIN LATERAL (
        SELECT coalesce(array_agg(label ORDER BY label), ARRAY[]::text[]) AS labels
          FROM (
            SELECT 'การ์ด: ' || c.code AS label FROM card c WHERE c.video_asset_id = a.id
             UNION
            SELECT 'การ์ด: ' || c.code FROM card_block cb JOIN card c ON c.id = cb.card_id
             WHERE c.campaign_id = a.campaign_id AND cb.content = a.public_url
             UNION
            SELECT 'บัตรแสตมป์' FROM stamp_card s
             WHERE s.empty_asset_id = a.id OR s.filled_asset_id = a.id
             UNION
            SELECT 'Rich Menu: ' || m.alias FROM rich_menu m WHERE m.image_asset_id = a.id
             UNION
            SELECT 'เทมเพลตการ์ด: ' || t.code FROM card_template t WHERE t.preview_asset_id = a.id
             UNION
            SELECT 'รางวัล: ' || r.code FROM reward r
             WHERE r.campaign_id = a.campaign_id AND r.reward_type = 'image'
               AND r.value IN (a.id::text, a.public_url)
             UNION
            SELECT 'ชุดเนื้อหา: ' || sel.name FROM card_selector sel
             WHERE sel.campaign_id = a.campaign_id AND sel.returns = 'asset'
               AND (sel.fallback_value IN (a.id::text, a.public_url)
                 OR EXISTS (SELECT 1 FROM card_selector_option o
                             WHERE o.selector_id = sel.id
                               AND o.result_value IN (a.id::text, a.public_url)))
          ) refs
      ) used
     ${where}
     ORDER BY a.created_at DESC, a.storage_path`
}

export async function listAssets(sql: postgres.Sql, campaignId: string): Promise<AssetView[]> {
  const rows = await selectAssets(sql, sql<AssetRow[]>`WHERE a.campaign_id = ${campaignId}`)
  return rows.map(summarizeAsset)
}

export async function loadAsset(
  sql: postgres.Sql, campaignId: string, id: string,
): Promise<AssetView | null> {
  const [row] = await selectAssets(
    sql, sql<AssetRow[]>`WHERE a.campaign_id = ${campaignId} AND a.id = ${id}`,
  )
  return row ? summarizeAsset(row) : null
}
