import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { createCardFromTemplate } from '../lib/cards/create'
import { loadCardEditor } from '../lib/db/cardEditor'
import { configFor, loadPublishScreen } from '../lib/db/publish'
import { DEFAULT_THEME } from '../lib/db/queries'
import { validateForPublish } from '../lib/publish/validate'

/**
 * Server Action ตัวจริง บนตาราง card_block จริง พร้อม CHECK ที่ตารางบังคับเอง
 *
 * actions.test.ts (มี sql ปลอม) พิสูจน์ว่าด่านต่างๆ เรียกถูกลำดับ แต่พิสูจน์ไม่ได้ว่า
 * การล้างธง has_sample_text ไปถึง validateForPublish จริง หรือว่า sort_order ที่
 * เขียนกลับไปยังตารางจริงไล่ต่อเนื่องจากศูนย์จริง — สองข้อนี้ต้องพิสูจน์กับตารางจริง
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

const {
  saveBlockContent, addBlock, deleteBlock, reorderBlocks, moveBlock,
  addShowWhenCondition, removeShowWhenCondition,
} = await import('../app/(admin)/campaigns/[id]/cards/[cardId]/actions')

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
const tag = () =>
  `cb${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

const asUser = async (role: string) => {
  const [user] = await sql<{ id: string; email: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`cb-${tag()}@example.com`}, ${role})
    RETURNING id, email`
  return user
}

type Scene = { userId: string; campaignId: string; cardId: string }

/** แคมเปญ + การ์ดหนึ่งใบจากเทมเพลตจริง (line_buttons มีข้อความตัวอย่างเสมอ) */
async function scene(role = 'configurator'): Promise<Scene> {
  const t = tag()
  const user = await asUser(role)

  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('บล็อกเอดิเตอร์', ${`cbc_${t}`}, now() - interval '1 day', now() + interval '30 days',
            ${user.id})
    RETURNING id`

  const { id: cardId } = await createCardFromTemplate(sql, {
    campaignId: campaign.id, code: `card_${t}`.slice(0, 40), sendType: 'flex_bubble',
    templateCode: 'line_buttons',
  })

  cookie = user.email
  return { userId: user.id, campaignId: campaign.id, cardId }
}

const pickChannel = (
  data: Awaited<ReturnType<typeof loadPublishScreen>>, channelId: string,
) => {
  const channel = data.channels.find((row) => row.id === channelId)
  if (!channel) throw new Error(`channel ${channelId} missing`)
  return channel
}

/** กิจกรรม + คีย์เวิร์ดที่ชี้มาหาการ์ด + บัญชี production เพื่อให้ด่านอื่นเขียวหมด */
async function wireUp(s: Scene): Promise<{ channelId: string }> {
  const t = tag()
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, encrypted_token, encrypted_secret,
                         token_last4, key_version, line_channel_id, created_by)
    VALUES (${`OA ${t}`}, 'production', 'cipher', 'cipher', '1a2b', 1, ${`L-${t}`}, ${s.userId})
    RETURNING id`
  const [activity] = await sql<{ id: string }[]>`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, resolve_config)
    VALUES (${s.campaignId}, ${`act_${t}`.slice(0, 20)}, 'กิจกรรม', 'none', 'fixed',
            ${sql.json({ outcomes: [{ id: 'o1', cardId: s.cardId }] } as never)})
    RETURNING id`
  await sql`
    INSERT INTO keyword_rule (campaign_id, keyword, match_mode, target_activity_id, sort_order)
    VALUES (${s.campaignId}, ${`เล่น${t}`}, 'exact', ${activity.id}, 0)`
  return { channelId: channel.id }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const blocksOf = async (cardId: string) =>
  sql<{ id: string; block_type: string; sort_order: number; content: string | null }[]>`
    SELECT id, block_type, sort_order, content FROM card_block
     WHERE card_id = ${cardId} ORDER BY sort_order`

describe('BR-37 · saveBlockContent (flow จริง) ล้างธง has_sample_text', () => {
  it('การ์ดจากเทมเพลตติดธงไว้ · validateForPublish บล็อกด้วย ERR-034', async () => {
    const s = await scene()
    const { channelId } = await wireUp(s)

    const data = await loadPublishScreen(sql, s.campaignId)
    const problems = validateForPublish(configFor(data.base, pickChannel(data, channelId), true))
    expect(problems.map((p) => p.code)).toContain('ERR-034')
  })

  it('บันทึกผ่าน saveBlockContent จริง (ไม่ใช่ raw UPDATE) แล้วธงหายและด่านปล่อยผ่าน', async () => {
    const s = await scene()
    const { channelId } = await wireUp(s)
    const [titleBlock] = await sql<{ id: string }[]>`
      SELECT id FROM card_block WHERE card_id = ${s.cardId} AND block_type = 'title'`

    await saveBlockContent(s.campaignId, s.cardId, titleBlock.id, form({ content: 'ข้อความของจริง' }))

    const [row] = await sql<{ has_sample_text: boolean }[]>`
      SELECT has_sample_text FROM card WHERE id = ${s.cardId}`
    expect(row.has_sample_text).toBe(false)

    const data = await loadPublishScreen(sql, s.campaignId)
    const problems = validateForPublish(configFor(data.base, pickChannel(data, channelId), true))
    expect(problems.map((p) => p.code)).not.toContain('ERR-034')
  })

  it('ผู้ดูรายงานเรียก saveBlockContent ไม่ได้ · ธงไม่หาย', async () => {
    const s = await scene('reporter')
    const [titleBlock] = await sql<{ id: string }[]>`
      SELECT id FROM card_block WHERE card_id = ${s.cardId} AND block_type = 'title'`

    await expect(saveBlockContent(s.campaignId, s.cardId, titleBlock.id, form({ content: 'x' })))
      .rejects.toThrow('ไม่มีสิทธิ์')

    const [row] = await sql<{ has_sample_text: boolean }[]>`
      SELECT has_sample_text FROM card WHERE id = ${s.cardId}`
    expect(row.has_sample_text).toBe(true)
  })

  it('ผู้ดูแลเนื้อหาแก้ปุ่มไม่ได้ (Permission Matrix) — ตารางจริงยืนยัน role check เอง', async () => {
    const s = await scene('content_editor')
    const [buttonBlock] = await sql<{ id: string }[]>`
      SELECT id FROM card_block WHERE card_id = ${s.cardId} AND block_type = 'button'`

    await expect(
      saveBlockContent(s.campaignId, s.cardId, buttonBlock.id, form({
        content: 'กด', action_kind: 'uri', action_target: 'https://x.test',
      })),
    ).rejects.toThrow('ผู้ดูแลเนื้อหา')
  })
})

describe('BR-92 · reorderBlocks/moveBlock เขียน sort_order ที่ไล่ต่อเนื่องจากศูนย์จริงในตาราง', () => {
  it('reorderBlocks สลับที่จริงในตาราง', async () => {
    const s = await scene()
    const before = await blocksOf(s.cardId)
    const newOrder = [...before].reverse().map((b) => b.id)

    await reorderBlocks(s.campaignId, s.cardId, newOrder)

    const after = await blocksOf(s.cardId)
    expect(after.map((b) => b.id)).toEqual(newOrder)
    expect(after.map((b) => b.sort_order)).toEqual(before.map((_, i) => i))
  })

  it('moveBlock ย้ายบล็อกกลางขึ้นหนึ่งตำแหน่งจริงในตาราง', async () => {
    const s = await scene()
    const before = await blocksOf(s.cardId)
    if (before.length < 2) throw new Error('เทมเพลตต้องมีอย่างน้อยสองบล็อกเพื่อทดสอบข้อนี้')
    const second = before[1]

    await moveBlock(s.campaignId, s.cardId, second.id, 'up')

    const after = await blocksOf(s.cardId)
    expect(after[0].id).toBe(second.id)
    expect(after.map((b) => b.sort_order)).toEqual(after.map((_, i) => i))
  })

  it('ลบบล็อกกลางแล้วบล็อกที่เหลือไล่เลขใหม่ต่อเนื่องจากศูนย์ ไม่เหลือรู', async () => {
    const s = await scene()
    const before = await blocksOf(s.cardId)
    if (before.length < 2) throw new Error('เทมเพลตต้องมีอย่างน้อยสองบล็อกเพื่อทดสอบข้อนี้')

    await deleteBlock(s.campaignId, s.cardId, before[0].id)

    const after = await blocksOf(s.cardId)
    expect(after.map((b) => b.sort_order)).toEqual(after.map((_, i) => i))
    expect(after.find((b) => b.id === before[0].id)).toBeUndefined()
  })
})

describe('BR-66 · เพดาน 10 บล็อก 3 ปุ่ม บังคับจริงผ่าน addBlock', () => {
  it('เติมจนครบ 10 แล้ว addBlock ปฏิเสธ ไม่มีแถวที่ 11 ในตาราง', async () => {
    const s = await scene()
    const before = await blocksOf(s.cardId)
    for (let i = before.length; i < 10; i += 1) {
      await addBlock(s.campaignId, s.cardId, form({ block_type: 'spacer' }))
    }
    expect((await blocksOf(s.cardId)).length).toBe(10)

    await expect(addBlock(s.campaignId, s.cardId, form({ block_type: 'spacer' })))
      .rejects.toThrow('10')
    expect((await blocksOf(s.cardId)).length).toBe(10)
  })

  it('ปฏิเสธชนิดที่วาดไม่ได้ก่อนแตะตาราง card_block เลย', async () => {
    const s = await scene()
    const before = await blocksOf(s.cardId)

    await expect(addBlock(s.campaignId, s.cardId, form({ block_type: 'stamp_grid' })))
      .rejects.toThrow(/วาดภาพ/)

    expect((await blocksOf(s.cardId)).length).toBe(before.length)
  })
})

describe('เงื่อนไขการแสดง (show_when) บันทึกจริงเป็น JSONB ที่ groupBlocks อ่านได้', () => {
  it('เพิ่มแล้วลบเงื่อนไข อ่านกลับมาตรงกับที่ส่งไป', async () => {
    const s = await scene()
    const [block] = await blocksOf(s.cardId)

    await addShowWhenCondition(s.campaignId, s.cardId, block.id, form({
      type: 'not_has_attribute', key: 'redeemed',
    }))

    const [afterAdd] = await sql<{ show_when: unknown }[]>`
      SELECT show_when FROM card_block WHERE id = ${block.id}`
    expect(afterAdd.show_when).toEqual([{ type: 'not_has_attribute', key: 'redeemed' }])

    await removeShowWhenCondition(s.campaignId, s.cardId, block.id, 0)

    const [afterRemove] = await sql<{ show_when: unknown }[]>`
      SELECT show_when FROM card_block WHERE id = ${block.id}`
    expect(afterRemove.show_when).toBeNull()
  })
})

/**
 * Task 13 ทิ้งไว้ว่า loadCardEditor ยังไม่ดึง campaign.theme — Task 14 (จอตัวอย่าง)
 * ต้องเติมมัน และต้องเป็นค่าเดียวกับที่ makePorts (lib/db/queries.ts) ให้ webhook จริง
 * เห็นเป๊ะ ไม่งั้นตัวอย่างจะวาดสีผิดจากของจริงแม้โครงจะตรง
 */
describe('loadCardEditor · campaign.theme', () => {
  it('แคมเปญที่ไม่เคยตั้งธีมเลย ได้ DEFAULT_THEME ครบสามคีย์ — เดียวกับที่ webhook ใช้', async () => {
    const s = await scene()
    const screen = await loadCardEditor(sql, s.campaignId, s.cardId)
    expect(screen?.theme).toEqual(DEFAULT_THEME)
  })

  it('แคมเปญที่ตั้งสีหลักไว้บางส่วน ได้ค่านั้นทับ ส่วนที่เหลือใช้ค่าเริ่มต้น', async () => {
    const s = await scene()
    await sql`UPDATE campaign SET theme = ${sql.json({ primary: '#123456' } as never)}
               WHERE id = ${s.campaignId}`

    const screen = await loadCardEditor(sql, s.campaignId, s.cardId)
    expect(screen?.theme).toEqual({ ...DEFAULT_THEME, primary: '#123456' })
  })
})
