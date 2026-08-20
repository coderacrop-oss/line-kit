import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import {
  markImagemapApplied, saveImagemapDraft, setImagemapBaseImage,
  setImagemapVideoAsset, setImagemapVideoPreview,
} from '../lib/db/card-imagemap'
import { testDb } from '../lib/db/client'
import { clearConfigCache, makePorts } from '../lib/db/queries'
import { handleEvent } from '../lib/webhook/handle'
import { seededRng } from '../lib/test-utils/rng'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
const NOW = new Date('2026-08-14T05:00:00Z')

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})
beforeEach(() => clearConfigCache())
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
const uid = () => `${Date.now().toString(36)}${(unique++).toString(36)}`

const say = (text: string) => ({
  type: 'message', replyToken: 'rt', source: { type: 'user', userId: 'U-imagemap' },
  message: { type: 'text', text },
})

/**
 * เส้นทางเต็มของริชเมสเสจ ผ่านฐานข้อมูลจริง ไม่ mock อะไรเลย — พิสูจน์ว่าสิ่งที่บันทึก
 * ไว้ในตัวแก้ไข (card.tap_areas + card_imagemap) ไหลออกไปเป็น LINE imagemap message
 * จริงที่ผู้เล่นได้รับ ไม่ใช่แค่ที่ renderCard() ทดสอบแยกหน่วยผ่าน
 */
async function seedImagemapScene(
  renderAs: 'imagemap' | 'imagemap_video' = 'imagemap',
): Promise<{ lineChannelId: string; cardId: string; assetId: string; campaignId: string; userId: string }> {
  const tag = uid()
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`imw-${tag}@example.com`}, 'configurator') RETURNING id`
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, timezone, start_at, end_at, created_by)
    VALUES ('ริชเมสเสจ webhook', ${`imw_${tag}`}, 'Asia/Bangkok',
            now() - interval '2 days', now() + interval '20 days', ${user.id})
    RETURNING id`
  const [card] = await sql<{ id: string }[]>`
    INSERT INTO card (campaign_id, code, render_as) VALUES (${campaign.id}, ${`promo_${tag}`}, ${renderAs})
    RETURNING id`
  const [asset] = await sql<{ id: string }[]>`
    INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, bytes,
                        width, height, uploaded_by)
    VALUES (${campaign.id}, ${`uploads/${tag}/base.jpg`}, ${`/uploads/${tag}/base.jpg`}, 'image',
            'image/jpeg', 100, 1600, 900, ${user.id})
    RETURNING id`

  await sql`
    INSERT INTO keyword_rule (campaign_id, keyword, match_mode, target_card_id, sort_order)
    VALUES (${campaign.id}, 'โปรโมชัน', 'exact', ${card.id}, 1)`

  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (
      name, channel_type, line_channel_id, encrypted_token, encrypted_secret,
      token_last4, greeting_enabled, created_by)
    VALUES ('imagemap webhook OA', 'test', ${`LINE-${tag}`}, 'enc-token', 'enc-secret', '1234', false, ${user.id})
    RETURNING id`
  await sql`
    INSERT INTO campaign_channel (campaign_id, channel_id, is_published, published_at)
    VALUES (${campaign.id}, ${channel.id}, true, now())`
  await sql`
    INSERT INTO config_version (campaign_id, version_no, snapshot, channel_id, published_by)
    VALUES (${campaign.id}, 1, '{}'::jsonb, ${channel.id}, ${user.id})`

  return {
    lineChannelId: `LINE-${tag}`, cardId: card.id, assetId: asset.id,
    campaignId: campaign.id, userId: user.id,
  }
}

async function makeVariantAssets(campaignId: string, cardId: string, userId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const width of [240, 300, 460, 700, 1040] as const) {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, bytes,
                          width, height, uploaded_by)
      VALUES (${campaignId}, ${`uploads/${cardId}/${width}.jpg`}, ${`/uploads/${cardId}/${width}.jpg`},
              'image', 'image/jpeg', 100, ${width}, ${Math.round(width * 0.5625)}, ${userId})
      RETURNING id`
    out[String(width)] = row.id
  }
  return out
}

describe('ริชเมสเสจ (imagemap) ผ่านเส้นทาง webhook เต็มระบบ', () => {
  it('พิมพ์คีย์เวิร์ดที่ชี้ไปหาการ์ดริชเมสเสจที่กด "ใช้" แล้ว → ได้ LINE imagemap message จริง', async () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://flex.example.com')
    const s = await seedImagemapScene()

    const [{ id: campaignId }] = await sql<{ id: string }[]>`SELECT campaign_id AS id FROM card WHERE id = ${s.cardId}`
    const [{ id: userId }] = await sql<{ id: string }[]>`SELECT uploaded_by AS id FROM asset WHERE id = ${s.assetId}`

    await setImagemapBaseImage(sql, {
      cardId: s.cardId, campaignId, assetId: s.assetId, baseWidth: 1040, baseHeight: 585, userId,
    })
    const variantIds = await makeVariantAssets(campaignId, s.cardId, userId)
    await markImagemapApplied(sql, {
      cardId: s.cardId, campaignId, actions: [
        { id: 'r1', x: 20, y: 20, width: 400, height: 200, action: { type: 'uri', linkUri: 'https://example.com/promo' } },
      ],
      altText: 'โปรโมชันพิเศษ', baseWidth: 1040, baseHeight: 585, variantAssetIds: variantIds as never, userId,
    })
    clearConfigCache()

    const ports = makePorts(sql, s.lineChannelId)
    const out = await handleEvent(say('โปรโมชัน'), s.lineChannelId, ports, NOW, seededRng(1))

    expect(out?.message).toMatchObject({
      type: 'imagemap',
      baseUrl: `https://flex.example.com/api/imagemap/${s.cardId}`,
      altText: 'โปรโมชันพิเศษ',
      baseSize: { width: 1040, height: 585 },
    })
    expect((out?.message as { actions: unknown[] }).actions).toEqual([
      { type: 'uri', area: { x: 20, y: 20, width: 400, height: 200 }, linkUri: 'https://example.com/promo' },
    ])
  })

  it('การ์ดริชเมสเสจที่ยังไม่เคยกด "ใช้" เลย → ตอบข้อความสำรอง ไม่ใช่ imagemap message ที่พัง', async () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://flex.example.com')
    const s = await seedImagemapScene()
    clearConfigCache()

    const ports = makePorts(sql, s.lineChannelId)
    const out = await handleEvent(say('โปรโมชัน'), s.lineChannelId, ports, NOW, seededRng(1))

    expect(out?.message).toMatchObject({ type: 'text' })
  })
})

/**
 * เส้นทางเต็มของริชวิดีโอ (เฟส 2) — เหมือนชุดข้างบนทุกประการ บวกวิดีโอ/ภาพตัวอย่าง/
 * พื้นที่เล่น เพื่อพิสูจน์ว่าสิ่งที่บันทึกไว้ในตัวแก้ไข (card.video_asset_id ·
 * card.video_end_uri/label · card_imagemap.video_preview_asset_id/video_area) ไหล
 * ออกไปเป็นฟิลด์ video ของ LINE imagemap message จริง ผ่านฐานข้อมูลจริงทั้งเส้นทาง
 * ไม่ mock อะไรเลย — เหมือนกันกับที่ชุดริชเมสเสจข้างบนพิสูจน์ไว้ก่อนแล้ว
 */
describe('ริชวิดีโอ (imagemap_video) ผ่านเส้นทาง webhook เต็มระบบ', () => {
  it('ครบทั้งภาพฐาน วิดีโอ ภาพตัวอย่าง และพื้นที่เล่น → ได้ LINE imagemap message ที่มีฟิลด์ video จริง', async () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://flex.example.com')
    const s = await seedImagemapScene('imagemap_video')

    await setImagemapBaseImage(sql, {
      cardId: s.cardId, campaignId: s.campaignId, assetId: s.assetId, baseWidth: 1040, baseHeight: 585, userId: s.userId,
    })
    const variantIds = await makeVariantAssets(s.campaignId, s.cardId, s.userId)
    await markImagemapApplied(sql, {
      cardId: s.cardId, campaignId: s.campaignId, actions: [],
      altText: 'ริชวิดีโอ', baseWidth: 1040, baseHeight: 585, variantAssetIds: variantIds as never, userId: s.userId,
    })

    const [videoAsset] = await sql<{ id: string }[]>`
      INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, duration_sec,
                          bytes, width, height, uploaded_by)
      VALUES (${s.campaignId}, ${`uploads/${s.cardId}/video.mp4`}, ${`/uploads/${s.cardId}/video.mp4`},
              'video', 'video/mp4', 10, 1024, 640, 360, ${s.userId})
      RETURNING id`
    await setImagemapVideoAsset(sql, { cardId: s.cardId, campaignId: s.campaignId, assetId: videoAsset.id })

    const [previewAsset] = await sql<{ id: string }[]>`
      INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, bytes, width, height, uploaded_by)
      VALUES (${s.campaignId}, ${`uploads/${s.cardId}/preview.jpg`}, ${`/uploads/${s.cardId}/preview.jpg`},
              'image', 'image/jpeg', 100, 400, 225, ${s.userId})
      RETURNING id`
    await setImagemapVideoPreview(sql, { cardId: s.cardId, campaignId: s.campaignId, assetId: previewAsset.id, userId: s.userId })

    await saveImagemapDraft(sql, {
      cardId: s.cardId, campaignId: s.campaignId, actions: [], altText: 'ริชวิดีโอ', userId: s.userId,
      videoArea: { x: 10, y: 10, width: 400, height: 225 },
      videoLinkUri: 'https://example.com/more', videoLinkLabel: 'ดูเพิ่ม',
    })
    clearConfigCache()

    const ports = makePorts(sql, s.lineChannelId)
    const out = await handleEvent(say('โปรโมชัน'), s.lineChannelId, ports, NOW, seededRng(1))

    expect(out?.message).toMatchObject({
      type: 'imagemap',
      baseUrl: `https://flex.example.com/api/imagemap/${s.cardId}`,
      video: {
        originalContentUrl: '/uploads/' + s.cardId + '/video.mp4',
        previewImageUrl: '/uploads/' + s.cardId + '/preview.jpg',
        area: { x: 10, y: 10, width: 400, height: 225 },
        externalLink: { linkUri: 'https://example.com/more', label: 'ดูเพิ่ม' },
      },
    })
  })

  it('มีภาพฐานพร้อมแล้วแต่ยังไม่ได้อัปโหลดวิดีโอเลย → ตอบข้อความสำรอง ไม่ส่งภาพเต็มใบไม่มีวิดีโอ (BR-01)', async () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://flex.example.com')
    const s = await seedImagemapScene('imagemap_video')

    await setImagemapBaseImage(sql, {
      cardId: s.cardId, campaignId: s.campaignId, assetId: s.assetId, baseWidth: 1040, baseHeight: 585, userId: s.userId,
    })
    const variantIds = await makeVariantAssets(s.campaignId, s.cardId, s.userId)
    await markImagemapApplied(sql, {
      cardId: s.cardId, campaignId: s.campaignId, actions: [],
      altText: 'ริชวิดีโอ', baseWidth: 1040, baseHeight: 585, variantAssetIds: variantIds as never, userId: s.userId,
    })
    clearConfigCache()

    const ports = makePorts(sql, s.lineChannelId)
    const out = await handleEvent(say('โปรโมชัน'), s.lineChannelId, ports, NOW, seededRng(1))

    expect(out?.message).toMatchObject({ type: 'text' })
  })
})
