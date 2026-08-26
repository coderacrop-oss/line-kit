import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { followHolder, listActivities, loadActivity } from '../lib/db/activities'
import { testDb } from '../lib/db/client'

/**
 * คำสั่ง SQL ของกิจกรรม บนตารางจริง
 *
 * actions.test.ts drives the same functions against a fake sql, which proves the
 * guards and proves nothing about the statements underneath them. Three things
 * here belong to the database and only the real one can be asked about them:
 * the partial unique index that makes BR-90 true, the campaign_id that has to be
 * in every WHERE clause, and the two LATERAL joins that work out how a player
 * could ever reach an activity — which is the claim the list screen is for and
 * which no column records.
 */
let cookie: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'fsb_email' && cookie ? { value: cookie } : undefined),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db/client')>()),
  db: () => sql,
}))

const { saveActivity, saveEntryRule, saveOutcome } =
  await import('../app/(admin)/campaigns/[id]/activities/actions')

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
const tag = () =>
  `a${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

const campaignCode = () => `at${(unique++).toString(36)}${Math.random().toString(36).slice(2, 10)}`

const aCampaign = async () => {
  const [user] = await sql<{ id: string; email: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`at-${tag()}@example.com`}, 'configurator')
    RETURNING id, email`
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('กิจกรรม', ${campaignCode()}, now(), now() + interval '30 days', ${user.id})
    RETURNING id`
  cookie = user.email
  return { user, campaignId: campaign.id }
}

const anActivity = async (
  campaignId: string,
  patch: { code?: string; input?: string; resolve?: string; trigger?: string } = {},
) => {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, trigger)
    VALUES (${campaignId}, ${patch.code ?? `draw${tag()}`.slice(0, 20)}, 'สุ่มรางวัล',
            ${patch.input ?? 'none'}, ${patch.resolve ?? 'weighted'}, ${patch.trigger ?? 'manual'})
    RETURNING id`
  return row.id
}

const aCard = async (campaignId: string, code = `card${tag()}`.slice(0, 20)) => {
  const [row] = await sql<{ id: string; code: string }[]>`
    INSERT INTO card (campaign_id, code) VALUES (${campaignId}, ${code}) RETURNING id, code`
  return row
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const saveForm = (patch: Record<string, string> = {}) =>
  form({ name: 'สุ่มรางวัล', input_type: 'none', resolve_method: 'weighted', ...patch })

beforeEach(() => { cookie = undefined })

/**
 * BR-90 · ดัชนีบางส่วนของตารางเป็นด่านสุดท้าย
 *
 * The screen and the action both refuse the second follow activity earlier and
 * with a better sentence, but neither of them is what makes the rule true — two
 * people saving at the same moment reach the table with both checks passed.
 */
describe('BR-90 · กิจกรรมทักทายตัวเดียวต่อแคมเปญ', () => {
  it('ตารางปฏิเสธตัวที่สองเอง แม้ไม่มีใครตรวจก่อน', async () => {
    const { campaignId } = await aCampaign()
    await anActivity(campaignId, { trigger: 'follow' })

    await expect(anActivity(campaignId, { trigger: 'follow' })).rejects.toMatchObject({
      code: '23505',
    })
  })

  it('คนละแคมเปญมีกิจกรรมทักทายของตัวเองได้', async () => {
    const first = await aCampaign()
    const second = await aCampaign()
    await anActivity(first.campaignId, { trigger: 'follow' })
    await expect(anActivity(second.campaignId, { trigger: 'follow' })).resolves.toBeTruthy()
  })

  it('followHolder บอกตัวที่ถืออยู่ · และเห็นเฉพาะของแคมเปญตัวเอง', async () => {
    const mine = await aCampaign()
    const other = await aCampaign()
    const held = await anActivity(mine.campaignId, { code: 'hello', trigger: 'follow' })
    await anActivity(other.campaignId, { code: 'hello2', trigger: 'follow' })

    expect(await followHolder(sql, mine.campaignId)).toMatchObject({ id: held, code: 'hello' })
  })

  it('ยกเว้นตัวเองแล้ว ไม่มีใครถือ — ตัวที่ถืออยู่บันทึกทับตัวเองได้', async () => {
    const { campaignId } = await aCampaign()
    const held = await anActivity(campaignId, { trigger: 'follow' })
    expect(await followHolder(sql, campaignId, held)).toBeNull()
  })

  it('ยังไม่มีใครถือ คืน null ไม่ใช่ระเบิด', async () => {
    const { campaignId } = await aCampaign()
    await anActivity(campaignId)
    expect(await followHolder(sql, campaignId)).toBeNull()
  })

  it('saveActivity ปฏิเสธตัวที่สองพร้อมชื่อของตัวที่ถืออยู่ ก่อนถึงดัชนี', async () => {
    const { campaignId } = await aCampaign()
    await anActivity(campaignId, { code: 'greeting', trigger: 'follow' })
    const second = await anActivity(campaignId)

    await expect(saveActivity(campaignId, second, saveForm({ trigger: 'follow' })))
      .rejects.toThrow('greeting')
  })
})

/**
 * ทางเข้าถึงกิจกรรม · สองอันมาจาก LATERAL join ไม่ใช่จากคอลัมน์
 *
 * A keyword rule naming the activity by id, and a button on a card carrying its
 * code inside the postback that lib/match/postback.ts encodes as `a=<code>`. The
 * second one is matched as text because the payload really is one string.
 */
describe('ทางเข้าถึงที่อ่านจากของจริง', () => {
  it('ไม่มีคีย์เวิร์ดและไม่มีปุ่มชี้มา คือไม่มีทางเข้าถึง', async () => {
    const { campaignId } = await aCampaign()
    await anActivity(campaignId)

    const [view] = await listActivities(sql, campaignId)
    expect(view.isUnreachable).toBe(true)
    expect(view.reachedBy).toEqual([])
  })

  it('คีย์เวิร์ดที่ชี้มา ทำให้เข้าถึงได้ และถูกเอ่ยชื่อ', async () => {
    const { campaignId } = await aCampaign()
    const activityId = await anActivity(campaignId)
    await sql`
      INSERT INTO keyword_rule (campaign_id, keyword, target_activity_id)
      VALUES (${campaignId}, 'เล่น', ${activityId})`

    const [view] = await listActivities(sql, campaignId)
    expect(view.isUnreachable).toBe(false)
    expect(view.reachedBy.join()).toContain('เล่น')
  })

  it('ปุ่มบนการ์ดที่แนบรหัสกิจกรรมมาใน postback ก็เป็นทางเข้า', async () => {
    const { campaignId } = await aCampaign()
    await anActivity(campaignId, { code: 'spin' })
    const card = await aCard(campaignId)
    await sql`
      INSERT INTO card_block (card_id, block_type, sort_order, options)
      VALUES (${card.id}, 'button', 0,
              ${sql.json({ action: { type: 'postback', data: 'c=x&a=spin&d=2026-08-17' } } as never)})`

    const [view] = await listActivities(sql, campaignId)
    expect(view.isUnreachable).toBe(false)
    expect(view.reachedBy.join()).toContain(card.code)
  })

  /** รหัสที่เป็นส่วนหนึ่งของรหัสอื่นต้องไม่นับเป็นทางเข้า */
  it('ปุ่มที่แนบรหัสของกิจกรรมอื่นซึ่งขึ้นต้นเหมือนกัน ไม่นับเป็นทางเข้า', async () => {
    const { campaignId } = await aCampaign()
    await anActivity(campaignId, { code: 'spin' })
    const card = await aCard(campaignId)
    await sql`
      INSERT INTO card_block (card_id, block_type, sort_order, options)
      VALUES (${card.id}, 'button', 0,
              ${sql.json({ action: { type: 'postback', data: 'c=x&a=spinner&d=2026-08-17' } } as never)})`

    const [view] = await listActivities(sql, campaignId)
    expect(view.isUnreachable).toBe(true)
  })

  it('คีย์เวิร์ดของแคมเปญอื่นไม่ทำให้กิจกรรมนี้เข้าถึงได้', async () => {
    const mine = await aCampaign()
    const other = await aCampaign()
    const activityId = await anActivity(mine.campaignId)
    await sql`
      INSERT INTO keyword_rule (campaign_id, keyword, target_activity_id)
      VALUES (${other.campaignId}, 'เล่น', ${activityId})`

    const [view] = await listActivities(sql, mine.campaignId)
    expect(view.isUnreachable).toBe(true)
  })

  it('การ์ดที่ผลลัพธ์พาไป ถูกอ่านออกมาเป็นชื่อการ์ดจริง', async () => {
    const { campaignId } = await aCampaign()
    const activityId = await anActivity(campaignId)
    const card = await aCard(campaignId)
    await saveOutcome(campaignId, activityId, -1, form({ card_id: card.id }))

    const [view] = await listActivities(sql, campaignId)
    expect(view.links).toEqual([card.code])
  })
})

describe('ขอบเขตของแคมเปญอยู่ในทุกคำสั่ง', () => {
  it('listActivities เห็นเฉพาะกิจกรรมของแคมเปญที่ถาม', async () => {
    const mine = await aCampaign()
    const other = await aCampaign()
    await anActivity(mine.campaignId, { code: 'mine' })
    await anActivity(other.campaignId, { code: 'theirs' })

    expect((await listActivities(sql, mine.campaignId)).map((v) => v.code)).toEqual(['mine'])
  })

  /**
   * เปิดกิจกรรมของแคมเปญอื่นด้วย id ของแคมเปญนี้ไม่ได้
   *
   * The id is in the URL, so this is the difference between a screen and a way
   * to read another customer's campaign by pasting a uuid.
   */
  it('loadActivity ไม่คืนกิจกรรมของแคมเปญอื่น แม้จะรู้ id ของมัน', async () => {
    const mine = await aCampaign()
    const other = await aCampaign()
    const theirs = await anActivity(other.campaignId)

    expect(await loadActivity(sql, mine.campaignId, theirs)).toBeNull()
  })

  it('loadActivity คืนของแคมเปญตัวเองพร้อมรายการที่จอต้องใช้', async () => {
    const { campaignId } = await aCampaign()
    const activityId = await anActivity(campaignId, { code: 'draw' })
    const card = await aCard(campaignId)
    await sql`INSERT INTO reward (campaign_id, code, reward_type, value)
              VALUES (${campaignId}, 'mug', 'text', 'แก้ว')`
    await anActivity(campaignId, { code: 'other' })

    const screen = await loadActivity(sql, campaignId, activityId)
    expect(screen?.activity.code).toBe('draw')
    expect(screen?.cards.map((c) => c.id)).toContain(card.id)
    expect(screen?.rewardCodes).toEqual(['mug'])
    expect(screen?.siblings.map((s) => s.code)).toEqual(['other'])
    // ตัวมันเองไม่อยู่ในรายการกิจกรรมอื่น · เงื่อนไขที่อ้างตัวเองไม่มีวันผ่าน
    expect(screen?.siblings.map((s) => s.id)).not.toContain(activityId)
  })

  it('การ์ดของแคมเปญอื่นไม่โผล่ในรายการให้เลือก', async () => {
    const mine = await aCampaign()
    const other = await aCampaign()
    const activityId = await anActivity(mine.campaignId)
    const theirCard = await aCard(other.campaignId)

    const screen = await loadActivity(sql, mine.campaignId, activityId)
    expect(screen?.cards.map((c) => c.id)).not.toContain(theirCard.id)
  })

  it('การ์ดที่เป็นของ activity อื่นในแคมเปญเดียวกัน ไม่โผล่ในรายการให้เลือก', async () => {
    const mine = await aCampaign()
    const activityId = await anActivity(mine.campaignId)
    const otherActivityId = await anActivity(mine.campaignId)
    const [ownedCard] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code, owner_activity_id)
      VALUES (${mine.campaignId}, ${`owned_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`},
              ${otherActivityId})
      RETURNING id`

    const screen = await loadActivity(sql, mine.campaignId, activityId)

    expect(screen?.cards.map((c) => c.id)).not.toContain(ownedCard.id)
  })
})

/**
 * ค่าที่จอเขียนลง JSONB ต้องอ่านกลับขึ้นมาได้เหมือนเดิม
 *
 * postgres.js hands JSONB back as parsed JSON, so a key written in snake_case
 * survives the round trip perfectly and still means nothing to the engine. The
 * check that matters is the shape, not the survival.
 */
describe('ค่าที่เขียนลง JSONB อ่านกลับมาเป็นรูปที่ engine อ่านได้', () => {
  it('ผลลัพธ์เก็บคีย์แบบ camelCase ตามที่ resolve.ts อ่าน', async () => {
    const { campaignId } = await aCampaign()
    const activityId = await anActivity(campaignId)
    const card = await aCard(campaignId)
    await sql`INSERT INTO reward (campaign_id, code, reward_type, value)
              VALUES (${campaignId}, 'mug', 'text', 'แก้ว')`

    await saveOutcome(campaignId, activityId, -1,
      form({ card_id: card.id, reward_code: 'mug', weight: '3', label: 'แก้ว' }))

    const [row] = await sql<{ resolve_config: { outcomes: Array<Record<string, unknown>> } }[]>`
      SELECT resolve_config FROM activity WHERE id = ${activityId}`
    expect(row.resolve_config.outcomes[0]).toMatchObject({
      cardId: card.id, rewardCode: 'mug', weight: 3,
    })
  })

  it('เงื่อนไขเก็บคีย์ที่ evaluate() อ่าน ไม่ใช่ key/value ลอยๆ', async () => {
    const { campaignId } = await aCampaign()
    const activityId = await anActivity(campaignId)
    const card = await aCard(campaignId)
    await sql`INSERT INTO reward (campaign_id, code, reward_type, value)
              VALUES (${campaignId}, 'mug', 'text', 'แก้ว')`

    await saveEntryRule(campaignId, activityId, -1,
      form({ type: 'has_entitlement', rewardCode: 'mug', card_id: card.id }))

    const [row] = await sql<{ entry_rules: Array<Record<string, unknown>> }[]>`
      SELECT entry_rules FROM activity WHERE id = ${activityId}`
    expect(row.entry_rules[0]).toEqual({
      type: 'has_entitlement', rewardCode: 'mug', cardId: card.id,
    })
  })

  /** BR-31 · การ์ดสำรองเป็นคอลัมน์จริงที่มี foreign key ตามหลัง */
  it('การ์ดสำรองที่ไม่ใช่การ์ดของแคมเปญนี้ ถูกปฏิเสธก่อนถึง foreign key', async () => {
    const mine = await aCampaign()
    const other = await aCampaign()
    const activityId = await anActivity(mine.campaignId)
    const theirCard = await aCard(other.campaignId)

    await expect(saveActivity(mine.campaignId, activityId,
      saveForm({ resolve_method: 'quota', fallback_card_id: theirCard.id })))
      .rejects.toThrow('การ์ดของแคมเปญนี้')
  })

  it('โควตาที่มีการ์ดสำรองของแคมเปญตัวเอง บันทึกลงคอลัมน์จริง', async () => {
    const { campaignId } = await aCampaign()
    const activityId = await anActivity(campaignId)
    const card = await aCard(campaignId)

    await saveActivity(campaignId, activityId,
      saveForm({ resolve_method: 'quota', fallback_card_id: card.id }))

    const [row] = await sql<{ fallback_card_id: string }[]>`
      SELECT fallback_card_id FROM activity WHERE id = ${activityId}`
    expect(row.fallback_card_id).toBe(card.id)
  })
})
