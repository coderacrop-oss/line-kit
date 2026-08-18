import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { createRichMenu } from '../lib/db/richmenu'
import { loadComposition, upsertComposition } from '../lib/db/richmenu-composition'
import { emptyComposition, type Composition } from '../lib/richmenu/composition'
import { MENU_CANVAS } from '../lib/richmenu/layouts'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
const tag = () =>
  `rc${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

type Scene = { userId: string; campaignId: string; richMenuId: string; assetId: string }

async function scene(): Promise<Scene> {
  const t = tag()
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`rc-${t}@example.com`}, 'configurator')
    RETURNING id`
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('งานแต่งภาพ', ${`rc_${t}`}, now() - interval '1 day', now() + interval '30 days', ${user.id})
    RETURNING id`
  const [asset] = await sql<{ id: string }[]>`
    INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, bytes,
                        width, height, uploaded_by)
    VALUES (${campaign.id}, ${`uploads/${t}/a.png`}, ${`/uploads/${t}/a.png`}, 'image',
            'image/png', 100, 2500, 1686, ${user.id})
    RETURNING id`
  const { id: richMenuId } = await createRichMenu(sql, {
    campaignId: campaign.id, alias: `main-${t}`, imageAssetId: asset.id, layout: 'large_1',
  })
  return { userId: user.id, campaignId: campaign.id, richMenuId, assetId: asset.id }
}

const composed = (patch: Partial<Composition> = {}): Composition => ({
  ...emptyComposition(MENU_CANVAS.large),
  ...patch,
})

describe('loadComposition · ฐานข้อมูลจริง', () => {
  it('เมนูที่ยังไม่เคยเปิดตัวจัดวางเลย คืน null ไม่ใช่ error', async () => {
    const s = await scene()
    expect(await loadComposition(sql, s.richMenuId, s.campaignId)).toBeNull()
  })

  it('เมนูของแคมเปญอื่น คืน null เหมือนไม่มี — กันข้ามแคมเปญเห็นงานแต่งภาพของกันและกัน', async () => {
    const s = await scene()
    const other = await scene()
    await upsertComposition(sql, {
      richMenuId: s.richMenuId, campaignId: s.campaignId, composition: composed(), userId: s.userId,
    })
    expect(await loadComposition(sql, s.richMenuId, other.campaignId)).toBeNull()
  })
})

describe('upsertComposition · ฐานข้อมูลจริง', () => {
  it('สร้างแถวใหม่แล้วโหลดกลับมาได้ค่าเดิมทุกฟิลด์', async () => {
    const s = await scene()
    const composition = composed({
      background: { type: 'color', color: '#3366CC' },
      layers: [
        { id: 'l1', type: 'image', assetId: s.assetId, fit: 'cover', x: 10, y: 20, width: 300, height: 200 },
      ],
    })
    await upsertComposition(sql, { richMenuId: s.richMenuId, campaignId: s.campaignId, composition, userId: s.userId })

    const loaded = await loadComposition(sql, s.richMenuId, s.campaignId)
    expect(loaded).toEqual(composition)
  })

  it('เรียกซ้ำ (แก้ไขต่อ) เขียนทับแถวเดิม ไม่สร้างแถวใหม่ซ้อน', async () => {
    const s = await scene()
    await upsertComposition(sql, {
      richMenuId: s.richMenuId, campaignId: s.campaignId, composition: composed(), userId: s.userId,
    })
    await upsertComposition(sql, {
      richMenuId: s.richMenuId, campaignId: s.campaignId,
      composition: composed({ background: { type: 'color', color: '#000000' } }), userId: s.userId,
    })

    const rows = await sql`SELECT id FROM rich_menu_composition WHERE rich_menu_id = ${s.richMenuId}`
    expect(rows).toHaveLength(1)
    const loaded = await loadComposition(sql, s.richMenuId, s.campaignId)
    expect(loaded?.background.color).toBe('#000000')
  })

  it('ลำดับของชั้นในอาเรย์รอดผ่านการบันทึกและโหลดกลับมาโดยไม่สลับที่', async () => {
    const s = await scene()
    const composition = composed({
      layers: [
        { id: 'bottom', type: 'text', text: 'ล่าง', fontSize: 20, color: '#000000', align: 'left', bold: false, x: 0, y: 0, width: 100, height: 30 },
        { id: 'top', type: 'text', text: 'บน', fontSize: 20, color: '#000000', align: 'left', bold: false, x: 0, y: 0, width: 100, height: 30 },
      ],
    })
    await upsertComposition(sql, { richMenuId: s.richMenuId, campaignId: s.campaignId, composition, userId: s.userId })
    const loaded = await loadComposition(sql, s.richMenuId, s.campaignId)
    expect(loaded?.layers.map((l) => l.id)).toEqual(['bottom', 'top'])
  })

  it('เมนูที่ไม่มีอยู่จริง หรือของแคมเปญอื่น ถูกปฏิเสธ ไม่เขียนอะไรเลย', async () => {
    const s = await scene()
    const other = await scene()
    await expect(upsertComposition(sql, {
      richMenuId: s.richMenuId, campaignId: other.campaignId, composition: composed(), userId: s.userId,
    })).rejects.toThrow('ไม่พบเมนูนี้')

    const rows = await sql`SELECT id FROM rich_menu_composition WHERE rich_menu_id = ${s.richMenuId}`
    expect(rows).toEqual([])
  })

  it('ลบเมนูต้นทาง งานแต่งภาพของมันหายไปด้วย (ON DELETE CASCADE)', async () => {
    const s = await scene()
    await upsertComposition(sql, {
      richMenuId: s.richMenuId, campaignId: s.campaignId, composition: composed(), userId: s.userId,
    })
    await sql`DELETE FROM rich_menu WHERE id = ${s.richMenuId}`
    const rows = await sql`SELECT id FROM rich_menu_composition WHERE rich_menu_id = ${s.richMenuId}`
    expect(rows).toEqual([])
  })
})
