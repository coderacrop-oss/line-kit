import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'

/**
 * Server Action ตัวจริง บนตาราง card จริง พร้อม used_by ที่อ่านจากตารางจริงทั้งหมด
 *
 * actions.test.ts (มี sql ปลอมที่ปลอมคำตอบของ loadCard เองด้วย) พิสูจน์แค่ว่า
 * deleteCard เรียกด่านถูกลำดับ แต่พิสูจน์ไม่ได้ว่า used_by ของ lib/db/cards.ts อ่านทั้ง
 * FK และ JSONB ครบจริงกับตารางจริง — โดยเฉพาะ rich_menu.areas ที่ไม่มี FK ผูกไว้เลย
 * (ดู comment ของ selectCards) เทสต์กลุ่มนี้จึงเป็นด่านถดถอยของ used_by ด้วยในตัว
 * ไม่ใช่แค่ของ deleteCard
 */

let cookie: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'fsb_email' && cookie ? { value: cookie } : undefined),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db/client')>()),
  db: () => sql,
}))

const { deleteCard } = await import('../app/(admin)/campaigns/[id]/cards/actions')

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
const tag = () =>
  `cd${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

type Scene = { userId: string; campaignId: string }

/** แคมเปญ + ผู้ใช้หนึ่งคน · cookie ถูกตั้งให้ล็อกอินเป็นคนนั้นทันทีที่ scene() คืนค่า */
async function scene(role = 'configurator'): Promise<Scene> {
  const t = tag()
  const [user] = await sql<{ id: string; email: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`cd-${t}@example.com`}, ${role})
    RETURNING id, email`
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('ลบการ์ด', ${`cd_${t}`}, now() - interval '1 day', now() + interval '30 days', ${user.id})
    RETURNING id`
  cookie = user.email
  return { userId: user.id, campaignId: campaign.id }
}

/** การ์ดเปล่าที่สุดที่ schema ยอมรับ — deleteCard ไม่แตะบล็อกของการ์ดเลย ไม่ต้องมีบล็อกจริง */
async function aCard(campaignId: string): Promise<string> {
  const [card] = await sql<{ id: string }[]>`
    INSERT INTO card (campaign_id, code) VALUES (${campaignId}, ${`card_${tag()}`})
    RETURNING id`
  return card.id
}

const cardExists = async (id: string): Promise<boolean> => {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM card WHERE id = ${id}`
  return row !== undefined
}

describe('deleteCard · ฐานข้อมูลจริง', () => {
  it('การ์ดที่ไม่มีใครใช้เลย ลบสำเร็จ และแถวหายไปจริง', async () => {
    const s = await scene()
    const cardId = await aCard(s.campaignId)

    const result = await deleteCard(s.campaignId, cardId)

    expect(result).toEqual({ ok: true })
    expect(await cardExists(cardId)).toBe(false)
  })

  it('คีย์เวิร์ดยังชี้มาหาการ์ดนี้อยู่ (target_card_id) — ปฏิเสธ และแถวยังอยู่', async () => {
    const s = await scene()
    const cardId = await aCard(s.campaignId)
    await sql`
      INSERT INTO keyword_rule (campaign_id, keyword, match_mode, target_card_id, sort_order)
      VALUES (${s.campaignId}, ${`เล่น${tag()}`}, 'exact', ${cardId}, 0)`

    const result = await deleteCard(s.campaignId, cardId)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('คีย์เวิร์ด')
    expect(await cardExists(cardId)).toBe(true)
  })

  /**
   * ตัวถดถอยของช่องโหว่ที่พบระหว่างตรวจสอบก่อนเปิดปุ่มลบ (ดู comment ของ selectCards
   * ใน lib/db/cards.ts) — rich_menu.areas เป็น JSONB ไม่มี FK ผูกกลับมาที่การ์ดเลย
   * ก่อนหน้านี้ used_by ไม่มีสาขาอ่านคอลัมน์นี้ การ์ดที่ปุ่มบนเมนูยังชี้อยู่จึงขึ้นป้าย
   * "ไม่มีใครใช้" ทั้งที่เมนูที่รันอยู่จริงยังส่งผู้เล่นมาการ์ดใบนี้ได้เสมอ
   */
  it('rich_menu.areas ยังชี้มาหาการ์ดนี้ (kind: card) — ปฏิเสธ ไม่ใช่ป้ายว่าไม่มีใครใช้', async () => {
    const s = await scene()
    const cardId = await aCard(s.campaignId)
    const [asset] = await sql<{ id: string }[]>`
      INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, bytes,
                          width, height, uploaded_by)
      VALUES (${s.campaignId}, ${`uploads/${tag()}/a.png`}, ${`/uploads/${tag()}/a.png`}, 'image',
              'image/png', 100, 2500, 1686, ${s.userId})
      RETURNING id`
    await sql`
      INSERT INTO rich_menu (campaign_id, alias, image_asset_id, areas)
      VALUES (${s.campaignId}, ${`menu_${tag()}`}, ${asset.id},
              ${sql.json([
                { x: 0, y: 0, width: 2500, height: 1686, kind: 'card', target: cardId },
              ] as never)})`

    const result = await deleteCard(s.campaignId, cardId)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('ริชเมนู')
    expect(await cardExists(cardId)).toBe(true)
  })

  it('ไม่พบการ์ดนี้ในแคมเปญนี้ ปฏิเสธก่อนแตะแถวไหนเลย', async () => {
    const s = await scene()
    const result = await deleteCard(s.campaignId, '00000000-0000-0000-0000-000000000000')
    expect(result).toEqual({ ok: false, message: 'ไม่พบการ์ดนี้ในแคมเปญนี้' })
  })

  it('บทบาทที่ไม่ใช่ผู้ตั้งค่าแคมเปญลบไม่ได้ แม้การ์ดจะไม่มีใครใช้อยู่จริง', async () => {
    const s = await scene('content_editor')
    const cardId = await aCard(s.campaignId)

    const result = await deleteCard(s.campaignId, cardId)

    expect(result.ok).toBe(false)
    expect(await cardExists(cardId)).toBe(true)
  })
})

describe('card.owner_activity_id · cascade ลบ (migration 0017)', () => {
  it('ลบ activity ที่เป็นเจ้าของการ์ด → การ์ดถูกลบตามไปด้วย', async () => {
    const s = await scene()
    const [activity] = await sql<{ id: string }[]>`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
      VALUES (${s.campaignId}, ${`quiz_${tag()}`}, 'ควิซทดสอบ', 'personality_quiz', NULL,
              ${sql.json({
                mode: 'duo', axes: [], questions: [], results: [], fallbackResultCode: '',
              } as never)})
      RETURNING id`
    const [card] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code, owner_activity_id)
      VALUES (${s.campaignId}, ${`owned_${tag()}`}, ${activity.id})
      RETURNING id`

    await sql`DELETE FROM activity WHERE id = ${activity.id}`

    expect(await cardExists(card.id)).toBe(false)
  })

  it('การ์ดทั่วไป (owner_activity_id เป็น NULL) ไม่ถูกลบตอนลบ activity อื่น', async () => {
    const s = await scene()
    const cardId = await aCard(s.campaignId)
    const [activity] = await sql<{ id: string }[]>`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
      VALUES (${s.campaignId}, ${`quiz_${tag()}`}, 'ควิซทดสอบ', 'personality_quiz', NULL,
              ${sql.json({
                mode: 'duo', axes: [], questions: [], results: [], fallbackResultCode: '',
              } as never)})
      RETURNING id`

    await sql`DELETE FROM activity WHERE id = ${activity.id}`

    expect(await cardExists(cardId)).toBe(true)
  })
})
