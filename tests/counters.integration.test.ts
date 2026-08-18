import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { loadCounter, loadCountersScreen } from '../lib/db/counters'
import { testDb } from '../lib/db/client'

/**
 * Server Action ตัวจริง บนตารางจริง พร้อม CHECK และ UNIQUE ที่ตารางบังคับเอง
 *
 * actions.test.ts drives the same four functions against a fake sql, which
 * proves the guards and proves nothing about the constraints underneath them.
 * The rules that matter most here belong to the database — a counter whose
 * values cascade away when it is deleted, two milestones that cannot share a
 * value — and only the real one can be asked whether it holds them.
 */
let cookie: string | undefined
let redirectedTo: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'fsb_email' && cookie ? { value: cookie } : undefined),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: (to: string) => { redirectedTo = to } }))
vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db/client')>()),
  db: () => sql,
}))

const { deleteCounter, deleteMilestone, saveCounter, saveMilestone } =
  await import('../app/(admin)/campaigns/[id]/counters/actions')

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
const tag = () =>
  `c${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** รหัสแคมเปญยาวได้ไม่เกิน 20 ตัวตาม CHECK ของคอลัมน์ */
const campaignCode = () => `ct${(unique++).toString(36)}${Math.random().toString(36).slice(2, 10)}`

const asRole = async (role: string) => {
  const [user] = await sql<{ id: string; email: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`ct-${tag()}@example.com`}, ${role})
    RETURNING id, email`
  return user
}

const aCampaign = async () => {
  const user = await asRole('configurator')
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('ค่าสะสม', ${campaignCode()}, now(), now() + interval '30 days', ${user.id})
    RETURNING id`
  cookie = user.email
  return { user, campaignId: campaign.id }
}

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(key, one)
  }
  return data
}

const counterForm = (patch: Record<string, string> = {}) =>
  form({ code: 'streak', name: 'วันติดกัน', mode: 'daily_unique', target: '7', ...patch })

const rawCounters = (campaignId: string) => sql<{
  id: string
  code: string
  name: string
  mode: string
  require_consecutive: boolean
  target: number
}[]>`SELECT id, code, name, mode, require_consecutive, target
       FROM counter WHERE campaign_id = ${campaignId} ORDER BY code`

const rawMilestones = (counterId: string) => sql<{
  id: string; at_value: number; effects: unknown
}[]>`SELECT id, at_value, effects FROM counter_milestone
      WHERE counter_id = ${counterId} ORDER BY at_value`

/** แคมเปญที่มีค่าสะสมหนึ่งตัวพร้อมใช้งาน */
const withCounter = async (patch: Record<string, string> = {}) => {
  const made = await aCampaign()
  await saveCounter(made.campaignId, '', counterForm(patch))
  const [counter] = await rawCounters(made.campaignId)
  return { ...made, counterId: counter.id }
}

/** ทุกอย่างที่ foreign key ของบัตรแสตมป์ต้องการ ยกเว้นจำนวนช่อง */
const stampCardArgs = async (made: { campaignId: string; counterId: string; user: { id: string } }) => {
  const [asset] = await sql<{ id: string }[]>`
    INSERT INTO asset (campaign_id, storage_path, public_url, mime_type, bytes, width, height,
                       uploaded_by)
    VALUES (${made.campaignId}, ${`uploads/${tag()}/a.png`}, '/a.png', 'image/png', 1, 1, 1,
            ${made.user.id})
    RETURNING id`
  const [card] = await sql<{ id: string }[]>`
    INSERT INTO card (campaign_id, code) VALUES (${made.campaignId}, ${`stamp${tag()}`})
    RETURNING id`
  return { campaignId: made.campaignId, counterId: made.counterId, assetId: asset.id, cardId: card.id }
}

const insertStampCard = (
  args: { campaignId: string; counterId: string; assetId: string; cardId: string },
  slots: number,
) => sql`
  INSERT INTO stamp_card (campaign_id, counter_id, slots, empty_asset_id, filled_asset_id, card_id)
  VALUES (${args.campaignId}, ${args.counterId}, ${slots}, ${args.assetId}, ${args.assetId},
          ${args.cardId})`

beforeEach(() => { cookie = undefined; redirectedTo = undefined })

describe('saveCounter · แถวจริงในตารางจริง', () => {
  it('สร้างแล้วได้แถวที่มีค่าครบทุกคอลัมน์ที่จอส่งมา', async () => {
    const { campaignId } = await aCampaign()
    await saveCounter(campaignId, '', counterForm({ require_consecutive: 'on', target: '60' }))

    expect((await rawCounters(campaignId))[0]).toMatchObject({
      code: 'streak', name: 'วันติดกัน', mode: 'daily_unique',
      require_consecutive: true, target: 60,
    })
  })

  /**
   * เป้า 60 วันติด · เพดาน 30 เป็นของช่องบนบัตร ไม่ใช่ของการนับ
   *
   * The rule moved onto counter in v0.22 for exactly this: while it sat on
   * stamp_card, every streak was capped at the card's 30 slots by a constraint
   * that was only ever about drawing.
   */
  it('เป้า 60 วันติดกัน ตารางรับ · เพดาน 30 อยู่ที่ stamp_card.slots ไม่ใช่ที่นี่', async () => {
    const made = await withCounter({ target: '60', require_consecutive: 'on' })

    const [counter] = await rawCounters(made.campaignId)
    expect(counter.target).toBe(60)
    expect(counter.require_consecutive).toBe(true)

    // ช่องบนบัตรยังจำกัดที่ 30 อยู่ · เป็นคนละเรื่องกับเป้าของการนับ · แถวนี้มีทุกอย่าง
    // ที่ foreign key ต้องการครบ จึงเหลือ CHECK ของ slots อย่างเดียวที่จะปฏิเสธได้
    const stamp = await stampCardArgs(made)
    await expect(insertStampCard(stamp, 60)).rejects.toThrow(/violates check constraint/i)
    await expect(insertStampCard(stamp, 30)).resolves.toBeDefined()
  })

  it('สวิตช์ต้องกดติดกันอยู่ที่ counter ตารางเดียว ไม่ใช่ที่ stamp_card', async () => {
    const { campaignId } = await withCounter({ require_consecutive: 'on' })

    const columns = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns
       WHERE column_name = 'require_consecutive' AND table_schema = 'public'
       ORDER BY table_name`
    expect(columns.map((row) => row.table_name)).toEqual(['counter'])
    expect((await rawCounters(campaignId))[0].require_consecutive).toBe(true)
  })

  it('รหัสซ้ำในแคมเปญเดียวกัน ถูกปฏิเสธด้วยประโยค ไม่ใช่ด้วยชื่อ constraint', async () => {
    const { campaignId } = await withCounter()
    await expect(saveCounter(campaignId, '', counterForm()))
      .rejects.toThrow('มีค่าสะสมรหัส "streak" อยู่แล้ว')
    expect(await rawCounters(campaignId)).toHaveLength(1)
  })

  it('รหัสเดียวกันในคนละแคมเปญ อยู่ร่วมกันได้', async () => {
    const first = await withCounter()
    const second = await aCampaign()
    await saveCounter(second.campaignId, '', counterForm())

    expect(await rawCounters(first.campaignId)).toHaveLength(1)
    expect(await rawCounters(second.campaignId)).toHaveLength(1)
  })

  it('สร้างเสร็จพาไปหน้าของค่าสะสมตัวที่เพิ่งสร้าง', async () => {
    const { campaignId } = await aCampaign()
    await saveCounter(campaignId, '', counterForm())
    const [counter] = await rawCounters(campaignId)
    expect(redirectedTo).toBe(`/campaigns/${campaignId}/counters/${counter.id}`)
  })

  it('ค่าสะสมของแคมเปญอื่น แก้ผ่าน id ของแคมเปญนี้ไม่ได้', async () => {
    const theirs = await withCounter()
    const mine = await aCampaign()

    await expect(saveCounter(mine.campaignId, theirs.counterId, counterForm({ name: 'ยึดมา' })))
      .rejects.toThrow('ไม่พบค่าสะสมนี้ในแคมเปญนี้')
    expect((await rawCounters(theirs.campaignId))[0].name).toBe('วันติดกัน')
  })

  it('เปลี่ยนวิธีนับตอนมีคนสะสมแล้ว ถูกปฏิเสธ และแถวไม่ถูกแตะ', async () => {
    const { campaignId, counterId } = await withCounter()
    const [channel] = await sql<{ id: string }[]>`
      INSERT INTO channel (name, channel_type, created_by)
      VALUES ('preview', 'preview', ${(await asRole('configurator')).id}) RETURNING id`
    const [participant] = await sql<{ id: string }[]>`
      INSERT INTO participant (channel_id, line_uid) VALUES (${channel.id}, ${`U-${tag()}`})
      RETURNING id`
    await sql`
      INSERT INTO counter_value (participant_id, counter_id, value)
      VALUES (${participant.id}, ${counterId}, 3)`

    await expect(saveCounter(campaignId, counterId, counterForm({ mode: 'accumulate' })))
      .rejects.toThrow('แก้วิธีนับไม่ได้')
    expect((await rawCounters(campaignId))[0].mode).toBe('daily_unique')
  })
})

/**
 * กติกาที่ตารางบังคับเอง ไม่ใช่ที่หน้าจอบังคับ
 */
describe('counter และ counter_milestone · CHECK และ UNIQUE ของตารางจริง', () => {
  it('เป้าที่เป็นศูนย์หรือติดลบ ตารางปฏิเสธเอง', async () => {
    const { campaignId } = await aCampaign()
    for (const target of [0, -1]) {
      await expect(sql`
        INSERT INTO counter (campaign_id, code, name, mode, target)
        VALUES (${campaignId}, ${`t${tag()}`}, 'x', 'accumulate', ${target})`, String(target))
        .rejects.toThrow(/violates check constraint/i)
    }
  })

  it('วิธีนับที่ไม่ได้อยู่ในสามแบบ ตารางปฏิเสธเอง', async () => {
    const { campaignId } = await aCampaign()
    for (const mode of ['weekly', 'ACCUMULATE', '']) {
      await expect(sql`
        INSERT INTO counter (campaign_id, code, name, mode, target)
        VALUES (${campaignId}, ${`t${tag()}`}, 'x', ${mode}, 7)`, mode)
        .rejects.toThrow(/violates check constraint/i)
    }
  })

  it('รหัสซ้ำในแคมเปญเดียวกัน ตารางปฏิเสธเองด้วย UNIQUE (campaign_id, code)', async () => {
    const { campaignId } = await aCampaign()
    const add = () => sql`
      INSERT INTO counter (campaign_id, code, name, mode, target)
      VALUES (${campaignId}, 'twice', 'x', 'accumulate', 7)`
    await add()
    await expect(add()).rejects.toThrow(/duplicate key value|unique constraint/i)
  })

  /**
   * UNIQUE (counter_id, at_value)
   *
   * Two milestones at the same value are two rows the engine walks in an order
   * nothing defines, and whichever it applies second is configuration nobody
   * can see the effect of.
   */
  it('จุดปลดล็อกสองจุดที่ค่าเดียวกัน ตารางปฏิเสธเอง', async () => {
    const { counterId } = await withCounter()
    const add = () => sql`
      INSERT INTO counter_milestone (counter_id, at_value) VALUES (${counterId}, 3)`
    await add()
    await expect(add()).rejects.toThrow(/duplicate key value|unique constraint/i)
  })

  it('ค่าเดียวกันแต่คนละค่าสะสม อยู่ร่วมกันได้', async () => {
    const first = await withCounter()
    const second = await withCounter({ code: 'other' })
    await sql`INSERT INTO counter_milestone (counter_id, at_value) VALUES (${first.counterId}, 3)`
    await expect(sql`
      INSERT INTO counter_milestone (counter_id, at_value) VALUES (${second.counterId}, 3)`)
      .resolves.toBeDefined()
  })

  it('จุดปลดล็อกที่ค่าเป็นศูนย์ ตารางปฏิเสธเอง', async () => {
    const { counterId } = await withCounter()
    await expect(sql`
      INSERT INTO counter_milestone (counter_id, at_value) VALUES (${counterId}, 0)`)
      .rejects.toThrow(/violates check constraint/i)
  })

  /** เป้าเป็นตัวเลขไว้วัดความคืบหน้า ไม่ใช่เพดานของการนับ */
  it('ค่าที่ผู้เล่นสะสมได้ เลยเป้าไปได้ ตารางไม่มีเพดานที่เป้า', async () => {
    const { counterId } = await withCounter({ target: '7' })
    const [channel] = await sql<{ id: string }[]>`
      INSERT INTO channel (name, channel_type, created_by)
      VALUES ('preview', 'preview', ${(await asRole('configurator')).id}) RETURNING id`
    const [participant] = await sql<{ id: string }[]>`
      INSERT INTO participant (channel_id, line_uid) VALUES (${channel.id}, ${`U-${tag()}`})
      RETURNING id`

    await expect(sql`
      INSERT INTO counter_value (participant_id, counter_id, value)
      VALUES (${participant.id}, ${counterId}, 99)`).resolves.toBeDefined()
  })

  it('ลบแคมเปญแล้วค่าสะสมของมันหายตามไปด้วย', async () => {
    const { campaignId } = await withCounter()
    await sql`DELETE FROM campaign WHERE id = ${campaignId}`
    expect(await rawCounters(campaignId)).toEqual([])
  })
})

describe('saveMilestone · บนตารางจริง', () => {
  it('เพิ่มจุดปลดล็อกพร้อมผลที่ตามมา ในรูปที่ play_and_apply อ่านได้', async () => {
    const { campaignId, counterId } = await withCounter()
    await sql`
      INSERT INTO reward (campaign_id, code, reward_type, value)
      VALUES (${campaignId}, 'sticker', 'link', 'https://example.com/s')`

    await saveMilestone(campaignId, counterId, '', form({ at_value: '3', effect: 'reward:sticker' }))

    const [milestone] = await rawMilestones(counterId)
    expect(milestone.at_value).toBe(3)
    expect(milestone.effects).toEqual([{ type: 'grant_reward', reward_code: 'sticker' }])
  })

  it('ผลที่ตามมาที่บันทึกไว้ ถูกอ่านกลับด้วยรูปคีย์ที่ SQL ของการเล่นใช้จริง', async () => {
    const { campaignId, counterId } = await withCounter()
    await saveMilestone(campaignId, counterId, '', form({ at_value: '3', effect: 'counter:streak' }))

    // v_effect->>'counter_code' คือสิ่งที่ 0002_play_and_apply.sql อ่าน
    const [row] = await sql<{ counter_code: string; amount: string }[]>`
      SELECT e->>'counter_code' AS counter_code, e->>'amount' AS amount
        FROM counter_milestone m, jsonb_array_elements(m.effects) e
       WHERE m.counter_id = ${counterId}`
    expect(row.counter_code).toBe('streak')
    expect(row.amount).toBe('1')
  })

  it('ค่าที่ซ้ำกับจุดเดิม ถูกปฏิเสธด้วยประโยค และไม่มีแถวที่สอง', async () => {
    const { campaignId, counterId } = await withCounter()
    await saveMilestone(campaignId, counterId, '', form({ at_value: '3' }))

    await expect(saveMilestone(campaignId, counterId, '', form({ at_value: '3' })))
      .rejects.toThrow('จุดปลดล็อกที่ค่า 3 อยู่แล้ว')
    expect(await rawMilestones(counterId)).toHaveLength(1)
  })

  it('แก้จุดเดิม เก็บผลที่จอไม่มีช่องให้ติ๊กไว้ครบ', async () => {
    const { campaignId, counterId } = await withCounter()
    const [milestone] = await sql<{ id: string }[]>`
      INSERT INTO counter_milestone (counter_id, at_value, effects)
      VALUES (${counterId}, 3, ${sql.json([
        { type: 'set_attribute', key: 'tier', value: 'gold' },
      ] as never)})
      RETURNING id`

    await saveMilestone(campaignId, counterId, milestone.id, form({ at_value: '5' }))

    const [after] = await rawMilestones(counterId)
    expect(after.at_value).toBe(5)
    expect(after.effects).toEqual([{ type: 'set_attribute', key: 'tier', value: 'gold' }])
  })

  it('จุดปลดล็อกของค่าสะสมอื่น แก้ผ่าน id ของตัวนี้ไม่ได้', async () => {
    const theirs = await withCounter()
    const [milestone] = await sql<{ id: string }[]>`
      INSERT INTO counter_milestone (counter_id, at_value) VALUES (${theirs.counterId}, 3)
      RETURNING id`

    const mine = await withCounter({ code: 'mine' })
    await expect(saveMilestone(mine.campaignId, mine.counterId, milestone.id, form({ at_value: '9' })))
      .rejects.toThrow('ไม่พบจุดปลดล็อกนี้')
    expect((await rawMilestones(theirs.counterId))[0].at_value).toBe(3)
  })

  it('ลบจุดปลดล็อกของค่าสะสมอื่นไม่ได้ แม้จะรู้ id', async () => {
    const theirs = await withCounter()
    const [milestone] = await sql<{ id: string }[]>`
      INSERT INTO counter_milestone (counter_id, at_value) VALUES (${theirs.counterId}, 3)
      RETURNING id`

    const mine = await withCounter({ code: 'mine' })
    await deleteMilestone(mine.campaignId, mine.counterId, milestone.id)
    expect(await rawMilestones(theirs.counterId)).toHaveLength(1)
  })
})

describe('deleteCounter · บนตารางจริง', () => {
  it('ค่าสะสมที่ไม่มีใครใช้ ลบได้', async () => {
    const { campaignId, counterId } = await withCounter()
    await deleteCounter(campaignId, counterId)
    expect(await rawCounters(campaignId)).toEqual([])
  })

  it('ลบค่าสะสมแล้วจุดปลดล็อกของมันหายตามไปด้วย', async () => {
    const { campaignId, counterId } = await withCounter()
    await saveMilestone(campaignId, counterId, '', form({ at_value: '3' }))

    await deleteCounter(campaignId, counterId)
    expect(await rawMilestones(counterId)).toEqual([])
  })

  /**
   * counter_value ห้อยอยู่กับ ON DELETE CASCADE · ฐานข้อมูลไม่ได้กันให้
   *
   * Deleting a counter that people have accumulated into would succeed and take
   * their progress with it. This is the test that says the guard is the only
   * thing standing there.
   */
  it('มีคนสะสมอยู่แล้ว ลบไม่ได้ และค่าที่สะสมไว้ยังอยู่ครบ', async () => {
    const { campaignId, counterId } = await withCounter()
    const [channel] = await sql<{ id: string }[]>`
      INSERT INTO channel (name, channel_type, created_by)
      VALUES ('preview', 'preview', ${(await asRole('configurator')).id}) RETURNING id`
    const [participant] = await sql<{ id: string }[]>`
      INSERT INTO participant (channel_id, line_uid) VALUES (${channel.id}, ${`U-${tag()}`})
      RETURNING id`
    await sql`
      INSERT INTO counter_value (participant_id, counter_id, value)
      VALUES (${participant.id}, ${counterId}, 5)`

    await expect(deleteCounter(campaignId, counterId)).rejects.toThrow('CASCADE')

    const values = await sql`SELECT value FROM counter_value WHERE counter_id = ${counterId}`
    expect(values).toHaveLength(1)
  })

  it('มีกิจกรรมเขียนค่าเข้ามา ลบไม่ได้ และบอกชื่อกิจกรรมนั้น', async () => {
    const { campaignId, counterId } = await withCounter()
    await sql`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, effects)
      VALUES (${campaignId}, 'checkin', 'เช็คอินรายวัน', 'none', 'fixed',
              ${sql.json([{ type: 'add_units', counter_code: 'streak', amount: 1 }] as never)})`

    await expect(deleteCounter(campaignId, counterId)).rejects.toThrow('เช็คอินรายวัน')
    expect(await rawCounters(campaignId)).toHaveLength(1)
  })

  it('กิจกรรมที่บวกค่าให้ค่าสะสมตัวอื่น ไม่ได้กันตัวนี้ไว้', async () => {
    const { campaignId, counterId } = await withCounter()
    await sql`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, effects)
      VALUES (${campaignId}, 'other', 'อีกกิจกรรม', 'none', 'fixed',
              ${sql.json([{ type: 'add_units', counter_code: 'ไม่ใช่ตัวนี้', amount: 1 }] as never)})`

    await deleteCounter(campaignId, counterId)
    expect(await rawCounters(campaignId)).toEqual([])
  })

  it('ค่าสะสมของแคมเปญอื่น ลบผ่าน id ของแคมเปญนี้ไม่ได้', async () => {
    const theirs = await withCounter()
    const mine = await aCampaign()

    await expect(deleteCounter(mine.campaignId, theirs.counterId))
      .rejects.toThrow('ไม่พบค่าสะสมนี้ในแคมเปญนี้')
    expect(await rawCounters(theirs.campaignId)).toHaveLength(1)
  })
})

describe('loadCountersScreen · สิ่งที่จออ่านได้จริง', () => {
  it('กิจกรรมที่บวกค่าเข้ามา ติดมากับแถว', async () => {
    const { campaignId } = await withCounter()
    await sql`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, effects)
      VALUES (${campaignId}, 'checkin', 'เช็คอินรายวัน', 'none', 'fixed',
              ${sql.json([{ type: 'add_units', counter_code: 'streak', amount: 1 }] as never)})`

    const { counters } = await loadCountersScreen(sql, campaignId)
    expect(counters[0].writers).toEqual(['เช็คอินรายวัน'])
    expect(counters[0].hasWriter).toBe(true)
  })

  it('ยังไม่มีกิจกรรมไหนบวกค่าเข้ามา คือค่าสะสมที่ไม่มีวันเพิ่ม', async () => {
    const { campaignId } = await withCounter()
    expect((await loadCountersScreen(sql, campaignId)).counters[0].hasWriter).toBe(false)
  })

  it('บัญชีที่ปรับเป้าทับ ติดมาพร้อมเป้าของบัญชีนั้น (DD-06)', async () => {
    const { campaignId, counterId, user } = await withCounter()
    const [channel] = await sql<{ id: string }[]>`
      INSERT INTO channel (name, channel_type, created_by)
      VALUES ('OA Melo Milk', 'preview', ${user.id}) RETURNING id`
    await sql`
      INSERT INTO campaign_channel (campaign_id, channel_id) VALUES (${campaignId}, ${channel.id})`
    await sql`
      INSERT INTO campaign_channel_counter_target (campaign_id, channel_id, counter_id, target)
      VALUES (${campaignId}, ${channel.id}, ${counterId}, 14)`

    const { counters } = await loadCountersScreen(sql, campaignId)
    expect(counters[0].overrides).toEqual(['OA Melo Milk → เป้า 14'])
  })

  it('บัตรแสตมป์ที่ผูกอยู่ ทำให้ลบไม่ได้', async () => {
    const { campaignId, counterId, user } = await withCounter()
    const [asset] = await sql<{ id: string }[]>`
      INSERT INTO asset (campaign_id, storage_path, public_url, mime_type, bytes, width, height,
                         uploaded_by)
      VALUES (${campaignId}, ${`uploads/${tag()}/a.png`}, '/a.png', 'image/png', 1, 1, 1,
              ${user.id})
      RETURNING id`
    const [card] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code) VALUES (${campaignId}, 'stamp') RETURNING id`
    await sql`
      INSERT INTO stamp_card (campaign_id, counter_id, slots, empty_asset_id, filled_asset_id, card_id)
      VALUES (${campaignId}, ${counterId}, 7, ${asset.id}, ${asset.id}, ${card.id})`

    const found = await loadCounter(sql, campaignId, counterId)
    expect(found?.counter.canDelete).toBe(false)
    await expect(deleteCounter(campaignId, counterId)).rejects.toThrow('บัตรแสตมป์')
  })

  it('รางวัลของแคมเปญนี้กลายเป็นตัวเลือกของจุดปลดล็อก', async () => {
    const { campaignId } = await withCounter()
    await sql`
      INSERT INTO reward (campaign_id, code, reward_type, value)
      VALUES (${campaignId}, 'sticker', 'link', 'https://example.com/s')`

    const { catalogue } = await loadCountersScreen(sql, campaignId)
    expect(catalogue.rewardCodes).toEqual(['sticker'])
  })

  it('ค่าสะสมของแคมเปญอื่นไม่โผล่มาในจอนี้', async () => {
    const theirs = await withCounter()
    const mine = await aCampaign()
    await saveCounter(mine.campaignId, '', counterForm({ code: 'mine' }))

    const { counters } = await loadCountersScreen(sql, mine.campaignId)
    expect(counters.map((c) => c.code)).toEqual(['mine'])
    expect(await loadCounter(sql, mine.campaignId, theirs.counterId)).toBeNull()
  })
})

describe('สิทธิ์บนรายชื่อจริง', () => {
  it('ผู้ดูแลเนื้อหาแก้ค่าสะสมไม่ได้ · นี่เป็นกติกา ไม่ใช่เนื้อหา', async () => {
    const { campaignId, counterId } = await withCounter()
    cookie = (await asRole('content_editor')).email

    await expect(saveCounter(campaignId, counterId, counterForm({ name: 'ชื่อใหม่' })))
      .rejects.toThrow('ไม่มีสิทธิ์')
    await expect(deleteCounter(campaignId, counterId)).rejects.toThrow('ไม่มีสิทธิ์')
    expect((await rawCounters(campaignId))[0].name).toBe('วันติดกัน')
  })

  it('ผู้ดูรายงานแก้ไม่ได้', async () => {
    const { campaignId, counterId } = await withCounter()
    cookie = (await asRole('reporter')).email

    await expect(saveMilestone(campaignId, counterId, '', form({ at_value: '3' })))
      .rejects.toThrow('ไม่มีสิทธิ์')
    expect(await rawMilestones(counterId)).toEqual([])
  })

  it('บัญชีที่ถูกถอนสิทธิ์ แก้ไม่ได้แม้ยังมีแถวอยู่', async () => {
    const { campaignId, counterId, user } = await withCounter()
    await sql`UPDATE app_user SET is_active = false WHERE id = ${user.id}`

    await expect(saveCounter(campaignId, counterId, counterForm({ name: 'ชื่อใหม่' })))
      .rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect((await rawCounters(campaignId))[0].name).toBe('วันติดกัน')
  })

  it('ไม่มี cookie เลย แก้ไม่ได้', async () => {
    const { campaignId, counterId } = await withCounter()
    cookie = undefined

    await expect(deleteCounter(campaignId, counterId)).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
    expect(await rawCounters(campaignId)).toHaveLength(1)
  })
})
