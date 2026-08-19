import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { loadCardImagemap, markImagemapApplied, saveImagemapDraft, setImagemapBaseImage } from '../lib/db/card-imagemap'
import { testDb } from '../lib/db/client'
import type { TapArea } from '../lib/imagemap/regions'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
const tag = () =>
  `ci${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

type Scene = { userId: string; campaignId: string; cardId: string; assetId: string }

async function scene(renderAs: 'imagemap' | 'text' = 'imagemap'): Promise<Scene> {
  const t = tag()
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`ci-${t}@example.com`}, 'configurator')
    RETURNING id`
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('ริชเมสเสจทดสอบ', ${`ci_${t}`}, now() - interval '1 day', now() + interval '30 days', ${user.id})
    RETURNING id`
  const [card] = await sql<{ id: string }[]>`
    INSERT INTO card (campaign_id, code, render_as) VALUES (${campaign.id}, ${`card_${t}`}, ${renderAs})
    RETURNING id`
  const [asset] = await sql<{ id: string }[]>`
    INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, bytes,
                        width, height, uploaded_by)
    VALUES (${campaign.id}, ${`uploads/${t}/base.jpg`}, ${`/uploads/${t}/base.jpg`}, 'image',
            'image/jpeg', 100, 1600, 900, ${user.id})
    RETURNING id`
  return { userId: user.id, campaignId: campaign.id, cardId: card.id, assetId: asset.id }
}

async function makeVariantAssets(s: Scene): Promise<Record<string, string>> {
  const widths = [240, 300, 460, 700, 1040] as const
  const out: Record<string, string> = {}
  for (const width of widths) {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, bytes,
                          width, height, uploaded_by)
      VALUES (${s.campaignId}, ${`uploads/${s.cardId}/${width}.jpg`}, ${`/uploads/${s.cardId}/${width}.jpg`},
              'image', 'image/jpeg', 100, ${width}, ${Math.round(width * 0.6)}, ${s.userId})
      RETURNING id`
    out[String(width)] = row.id
  }
  return out
}

const area = (patch: Partial<TapArea> = {}): TapArea => ({
  id: 'a1', x: 10, y: 10, width: 200, height: 100, action: { type: 'uri', linkUri: 'https://example.com' },
  ...patch,
})

describe('loadCardImagemap · ฐานข้อมูลจริง', () => {
  it('การ์ดที่ยังไม่เคยอัปโหลดภาพฐานเลย คืนโครงว่างเปล่า ไม่ใช่ null', async () => {
    const s = await scene()
    const loaded = await loadCardImagemap(sql, s.campaignId, s.cardId)
    expect(loaded).not.toBeNull()
    expect(loaded?.baseAssetId).toBeNull()
    expect(loaded?.actions).toEqual([])
    expect(loaded?.variantUrls).toEqual({})
  })

  it('การ์ดที่ไม่ใช่ render_as = imagemap คืน null', async () => {
    const s = await scene('text')
    expect(await loadCardImagemap(sql, s.campaignId, s.cardId)).toBeNull()
  })

  it('การ์ดของแคมเปญอื่น คืน null — กันข้ามแคมเปญเห็นกัน', async () => {
    const s = await scene()
    const other = await scene()
    expect(await loadCardImagemap(sql, other.campaignId, s.cardId)).toBeNull()
  })

  it('id การ์ดที่ไม่มีอยู่จริงเลย คืน null', async () => {
    const s = await scene()
    expect(await loadCardImagemap(sql, s.campaignId, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})

describe('setImagemapBaseImage · ฐานข้อมูลจริง', () => {
  it('ตั้งภาพฐานครั้งแรก แล้วโหลดกลับมาได้ url และขนาดตรงกัน', async () => {
    const s = await scene()
    await setImagemapBaseImage(sql, {
      cardId: s.cardId, campaignId: s.campaignId, assetId: s.assetId,
      baseWidth: 1040, baseHeight: 585, userId: s.userId,
    })
    const loaded = await loadCardImagemap(sql, s.campaignId, s.cardId)
    expect(loaded?.baseAssetId).toBe(s.assetId)
    expect(loaded?.baseImageUrl).toContain('base.jpg')
    expect(loaded?.baseWidth).toBe(1040)
    expect(loaded?.baseHeight).toBe(585)
  })

  it('เปลี่ยนภาพฐานใหม่ ล้าง variant_assets เดิมทิ้ง (ต้องกด "ใช้" ใหม่)', async () => {
    const s = await scene()
    await setImagemapBaseImage(sql, {
      cardId: s.cardId, campaignId: s.campaignId, assetId: s.assetId,
      baseWidth: 1040, baseHeight: 585, userId: s.userId,
    })
    await markImagemapApplied(sql, {
      cardId: s.cardId, campaignId: s.campaignId, actions: [area()], altText: 'ทดสอบ',
      baseWidth: 1040, baseHeight: 585, variantAssetIds: (await makeVariantAssets(s)) as never,
      userId: s.userId,
    })
    expect((await loadCardImagemap(sql, s.campaignId, s.cardId))?.variantUrls[1040]).toBeDefined()

    const [secondAsset] = await sql<{ id: string }[]>`
      INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, bytes,
                          width, height, uploaded_by)
      VALUES (${s.campaignId}, ${`uploads/${s.cardId}/base2.jpg`}, ${`/uploads/${s.cardId}/base2.jpg`},
              'image', 'image/jpeg', 100, 2000, 1000, ${s.userId})
      RETURNING id`
    await setImagemapBaseImage(sql, {
      cardId: s.cardId, campaignId: s.campaignId, assetId: secondAsset.id,
      baseWidth: 1040, baseHeight: 520, userId: s.userId,
    })

    const loaded = await loadCardImagemap(sql, s.campaignId, s.cardId)
    expect(loaded?.baseAssetId).toBe(secondAsset.id)
    expect(loaded?.variantUrls).toEqual({})
  })

  it('การ์ดที่ไม่มีอยู่จริงหรือของแคมเปญอื่น ถูกปฏิเสธ', async () => {
    const s = await scene()
    const other = await scene()
    await expect(setImagemapBaseImage(sql, {
      cardId: s.cardId, campaignId: other.campaignId, assetId: s.assetId,
      baseWidth: 1040, baseHeight: 585, userId: s.userId,
    })).rejects.toThrow('ไม่พบการ์ดริชเมสเสจนี้')
  })
})

describe('saveImagemapDraft · ฐานข้อมูลจริง', () => {
  it('บันทึกพื้นที่กดกับข้อความสำรอง แล้วโหลดกลับมาตรงกันทุกฟิลด์', async () => {
    const s = await scene()
    await saveImagemapDraft(sql, {
      cardId: s.cardId, campaignId: s.campaignId, actions: [area(), area({ id: 'a2', y: 300 })],
      altText: 'โปรโมชันพิเศษ', userId: s.userId,
    })

    const loaded = await loadCardImagemap(sql, s.campaignId, s.cardId)
    expect(loaded?.actions).toHaveLength(2)
    expect(loaded?.actions.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(loaded?.altText).toBe('โปรโมชันพิเศษ')
  })

  it('เรียกซ้ำ (แก้ไขต่อ) เขียนทับแถวเดิม ไม่สร้างแถวใหม่ซ้อน', async () => {
    const s = await scene()
    await saveImagemapDraft(sql, { cardId: s.cardId, campaignId: s.campaignId, actions: [area()], altText: 'v1', userId: s.userId })
    await saveImagemapDraft(sql, { cardId: s.cardId, campaignId: s.campaignId, actions: [], altText: 'v2', userId: s.userId })

    const rows = await sql`SELECT id FROM card_imagemap WHERE card_id = ${s.cardId}`
    expect(rows).toHaveLength(1)
    const loaded = await loadCardImagemap(sql, s.campaignId, s.cardId)
    expect(loaded?.altText).toBe('v2')
    expect(loaded?.actions).toEqual([])
  })

  it('ลำดับของพื้นที่กดในอาเรย์รอดผ่านการบันทึกและโหลดกลับมาโดยไม่สลับที่', async () => {
    const s = await scene()
    const areas = [area({ id: 'bottom' }), area({ id: 'top', y: 300 })]
    await saveImagemapDraft(sql, { cardId: s.cardId, campaignId: s.campaignId, actions: areas, altText: 'x', userId: s.userId })
    const loaded = await loadCardImagemap(sql, s.campaignId, s.cardId)
    expect(loaded?.actions.map((a) => a.id)).toEqual(['bottom', 'top'])
  })

  it('การ์ดที่ไม่มีอยู่จริงหรือของแคมเปญอื่น ถูกปฏิเสธ ไม่เขียนอะไรเลย', async () => {
    const s = await scene()
    const other = await scene()
    await expect(saveImagemapDraft(sql, {
      cardId: s.cardId, campaignId: other.campaignId, actions: [area()], altText: 'x', userId: s.userId,
    })).rejects.toThrow('ไม่พบการ์ดริชเมสเสจนี้')

    const rows = await sql`SELECT id FROM card_imagemap WHERE card_id = ${s.cardId}`
    expect(rows).toEqual([])
  })
})

describe('markImagemapApplied · ฐานข้อมูลจริง', () => {
  it('เติมภาพ 5 ขนาดครบ แล้วโหลดกลับมาได้ url ของทุกขนาด', async () => {
    const s = await scene()
    await setImagemapBaseImage(sql, {
      cardId: s.cardId, campaignId: s.campaignId, assetId: s.assetId, baseWidth: 1040, baseHeight: 585, userId: s.userId,
    })
    const variantIds = await makeVariantAssets(s)
    await markImagemapApplied(sql, {
      cardId: s.cardId, campaignId: s.campaignId, actions: [area()], altText: 'พร้อมส่ง',
      baseWidth: 1040, baseHeight: 585, variantAssetIds: variantIds as never, userId: s.userId,
    })

    const loaded = await loadCardImagemap(sql, s.campaignId, s.cardId)
    expect(loaded?.altText).toBe('พร้อมส่ง')
    expect(Object.keys(loaded?.variantUrls ?? {})).toHaveLength(5)
    expect(loaded?.variantUrls[240]).toBe(`/uploads/${s.cardId}/240.jpg`)
    expect(loaded?.variantUrls[1040]).toBe(`/uploads/${s.cardId}/1040.jpg`)
  })

  it('ลบการ์ดต้นทาง ริชเมสเสจของมันหายไปด้วย (ON DELETE CASCADE)', async () => {
    const s = await scene()
    await saveImagemapDraft(sql, { cardId: s.cardId, campaignId: s.campaignId, actions: [], altText: 'x', userId: s.userId })
    await sql`DELETE FROM card WHERE id = ${s.cardId}`
    const rows = await sql`SELECT id FROM card_imagemap WHERE card_id = ${s.cardId}`
    expect(rows).toEqual([])
  })
})
