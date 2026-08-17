import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { duplicateCampaign, TABLES_NEVER_COPIED } from '../lib/campaign/duplicate'
import { testDb } from '../lib/db/client'
import { seed, type Seeded } from './helpers/seed'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
const tag = () =>
  `d${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

const count = async (table: string, campaignId: string): Promise<number> => {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ${sql(table)} WHERE campaign_id = ${campaignId}`
  return row.n
}

/**
 * แคมเปญที่มีของครบทุกตารางที่ก๊อป และมีร่องรอยของคนเล่นจริงอยู่ด้วย
 *
 * seed() ให้บัญชีที่ผูกไว้ · รุ่นที่ส่งขึ้นแล้ว · ผู้ร่วมสนุก · ค่าสะสม · รางวัล
 * ตรงนี้เติมของที่เหลือให้ครบทั้งสิบสามตาราง แล้วเติมข้อมูลผู้เล่นทับลงไป
 * เพื่อให้ BR-24 มีอะไรให้ปฏิเสธจริงๆ ไม่ใช่ผ่านเพราะตารางว่างอยู่แล้ว
 */
async function fullCampaign(): Promise<Seeded & { assetIds: string[]; selectorId: string }> {
  const s = await seed(sql, { participants: 2 })
  const t = tag()

  const assetIds: string[] = []
  for (const name of ['empty', 'filled', 'menu']) {
    const [asset] = await sql<{ id: string }[]>`
      INSERT INTO asset (campaign_id, storage_path, public_url, mime_type, bytes, width, height,
                         used_in, uploaded_by)
      VALUES (${s.campaignId}, ${`uploads/${s.campaignId}/${t}-${name}/x.png`},
              ${`https://cdn.example.com/${t}-${name}.png`}, 'image/png', 1000, 800, 600,
              ${sql.json([{ cardId: s.cardIds.win_a }])}, ${s.userId})
      RETURNING id`
    assetIds.push(asset.id)
  }

  // ภาพที่แทนที่ภาพอื่น · ตัวชี้ภายในคลังที่ต้องถูกต่อใหม่ในแคมเปญปลายทาง
  await sql`UPDATE asset SET replaces_asset_id = ${assetIds[0]} WHERE id = ${assetIds[1]}`

  const [selector] = await sql<{ id: string }[]>`
    INSERT INTO card_selector (campaign_id, name, returns, source_type, source_key, fallback_value)
    VALUES (${s.campaignId}, 'ตามผล', 'text', 'result', 'draw', 'ไม่รู้')
    RETURNING id`

  await sql`
    INSERT INTO card_selector_option (selector_id, match_value, result_value, sort_order)
    VALUES (${selector.id}, 'win', 'ยินดีด้วย', 0)`

  await sql`
    INSERT INTO card_block (card_id, block_type, sort_order, content)
    VALUES (${s.cardIds.win_a}, 'title', 0, 'ผลของคุณ')`
  await sql`
    INSERT INTO card_block (card_id, block_type, sort_order, selector_id)
    VALUES (${s.cardIds.win_a}, 'body', 1, ${selector.id})`

  // การ์ดลูกในแคโรเซล · ตัวชี้ระหว่างการ์ดที่ต้องถูกต่อใหม่เหมือนกัน
  await sql`
    UPDATE card SET parent_card_id = ${s.cardIds.win_a}, sort_in_parent = 0
     WHERE id = ${s.cardIds.win_b}`

  await sql`
    INSERT INTO counter_milestone (counter_id, at_value, effects)
    VALUES (${s.counterId}, 90, '[]'::jsonb)`

  await sql`
    INSERT INTO coupon (reward_id, discount_kind, value_min, value_max)
    VALUES (${s.rewardIds.reward_a}, 'percent', 10, 20)`

  await sql`
    INSERT INTO stamp_card (campaign_id, counter_id, slots, empty_asset_id, filled_asset_id, card_id)
    VALUES (${s.campaignId}, ${s.counterId}, 10, ${assetIds[0]}, ${assetIds[1]}, ${s.cardIds.win_a})`

  await sql`
    INSERT INTO keyword_rule (campaign_id, keyword, match_mode, target_activity_id, sort_order)
    VALUES (${s.campaignId}, 'เล่น', 'exact', ${s.activityId}, 0)`
  await sql`
    INSERT INTO keyword_rule (campaign_id, keyword, match_mode, target_card_id, sort_order)
    VALUES (${s.campaignId}, 'กติกา', 'exact', ${s.cardIds.fallback}, 1)`

  await sql`
    INSERT INTO rich_menu (campaign_id, alias, image_asset_id, is_entry, chat_bar_text,
                           line_rich_menu_id)
    VALUES (${s.campaignId}, 'main', ${assetIds[2]}, true, 'เมนู', 'richmenu-live-on-their-oa')`

  // ---- ร่องรอยของคนเล่นจริง ----
  await sql`
    INSERT INTO counter_value (participant_id, counter_id, value)
    VALUES (${s.participantIds[0]}, ${s.counterId}, 42)`

  await sql`
    INSERT INTO entitlement (participant_id, reward_id, config_version_id)
    VALUES (${s.participantIds[0]}, ${s.rewardIds.reward_a}, ${s.configVersionId})`

  await sql`
    INSERT INTO reward_code (reward_id, code_value, assigned_to)
    VALUES (${s.rewardIds.reward_a}, ${`REAL-${t}`}, ${s.participantIds[0]})`

  // โควตาที่ถูกใช้ไปแล้ว · ตัวเลขที่ห้ามตามไปกับสำเนา
  await sql`UPDATE reward SET issued_count = 4 WHERE id = ${s.rewardIds.reward_a}`

  return { ...s, assetIds, selectorId: selector.id }
}

const duplicateOf = async (source: Seeded, patch: Partial<{ code: string }> = {}) =>
  duplicateCampaign(sql, {
    sourceId: source.campaignId,
    name: 'สำเนาเพื่อทดสอบ',
    code: patch.code ?? `c${tag()}`.slice(0, 20),
    startAt: '2027-01-01T00:00:00Z',
    endAt: '2027-02-01T00:00:00Z',
    actorId: source.userId,
  })

/**
 * ทั้งฟังก์ชันนี้ไม่เคยถูกรันจริงมาก่อน
 *
 * เทสต์ที่เขียนไว้ก่อนหน้านี้วัดรายการชื่อตาราง ซึ่งจับได้ว่ากติกาถูก แต่จับไม่ได้
 * ว่าคำสั่ง INSERT สิบสามชุดเขียนชื่อคอลัมน์ถูกไหม ลำดับ FK ผ่านไหม และแผนที่ id
 * ต่อกันจริงไหม — ความผิดพลาดพวกนี้โผล่ตอนมีข้อมูลรูปร่างพอดีเท่านั้น
 */
describe('duplicateCampaign · ฐานข้อมูลจริง', () => {
  it('แคมเปญใหม่เป็นร่าง วันของตัวเอง และสืบทอดเขตเวลากับธีมของต้นทาง', async () => {
    const source = await fullCampaign()
    await sql`UPDATE campaign SET status = 'published', timezone = 'Asia/Tokyo',
                                  day_length_sec = 3600, theme = '{"primary":"#17756A"}'::jsonb
               WHERE id = ${source.campaignId}`

    const made = await duplicateOf(source)
    const [row] = await sql<{
      status: string; timezone: string; day_length_sec: number; theme: { primary?: string }
      name: string; start_at: Date; end_at: Date; created_by: string
      scheduled_publish_at: Date | null; scheduled_channel_id: string | null
    }[]>`SELECT * FROM campaign WHERE id = ${made.id}`

    expect(row.status).toBe('draft')
    expect(row.timezone).toBe('Asia/Tokyo')
    expect(row.day_length_sec).toBe(3600)
    expect(row.theme.primary).toBe('#17756A')
    expect(row.name).toBe('สำเนาเพื่อทดสอบ')
    expect(row.start_at.toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(row.created_by).toBe(source.userId)
    // นัดส่งขึ้นล่วงหน้าไม่ตามมา · ไม่งั้นสำเนาจะขึ้น OA เองโดยไม่มีใครกด
    expect(row.scheduled_publish_at).toBeNull()
    expect(row.scheduled_channel_id).toBeNull()
  })

  it('ก๊อปครบทุกตารางที่อยู่ใน TABLES_TO_COPY และจำนวนตรงกับที่รายงาน', async () => {
    const source = await fullCampaign()
    const made = await duplicateOf(source)

    expect(made.counts).toMatchObject({
      asset: 3, card: 4, card_selector: 1, card_selector_option: 1, card_block: 2,
      activity: 1, counter: 1, counter_milestone: 2, reward: 2, coupon: 1,
      stamp_card: 1, keyword_rule: 2, rich_menu: 1,
    })

    for (const table of ['asset', 'card', 'card_selector', 'activity', 'counter', 'reward',
      'stamp_card', 'keyword_rule', 'rich_menu']) {
      expect(await count(table, made.id), table).toBe(await count(table, source.campaignId))
    }
  })

  /**
   * BR-24 · บัญชีและกุญแจ
   */
  it('ไม่มีการผูกบัญชีติดมาเลย — สำเนาพูดกับ OA ไหนไม่ได้จนกว่าจะมีคนผูกให้', async () => {
    const source = await fullCampaign()
    const made = await duplicateOf(source)

    expect(await count('campaign_channel', source.campaignId)).toBe(1)
    expect(await count('campaign_channel', made.id)).toBe(0)
    expect(await count('config_version', made.id)).toBe(0)
  })

  it('rich_menu ที่ก๊อปมาไม่ได้พก id ของเมนูที่ลงทะเบียนไว้กับ OA เดิมมาด้วย', async () => {
    const source = await fullCampaign()
    const made = await duplicateOf(source)

    const [copied] = await sql<{ line_rich_menu_id: string | null; alias: string }[]>`
      SELECT line_rich_menu_id, alias FROM rich_menu WHERE campaign_id = ${made.id}`
    expect(copied.alias).toBe('main')
    expect(copied.line_rich_menu_id).toBeNull()
  })

  /**
   * BR-24 · ข้อมูลผู้เล่น
   */
  it('ไม่มีผู้เล่น ค่าสะสม สิทธิ์ หรือรหัสคูปองของใครตามมาเลย', async () => {
    const source = await fullCampaign()
    const made = await duplicateOf(source)

    const [row] = await sql<{ values: number; grants: number; codes: number }[]>`
      SELECT (SELECT count(*)::int FROM counter_value cv
                JOIN counter c ON c.id = cv.counter_id WHERE c.campaign_id = ${made.id}) AS values,
             (SELECT count(*)::int FROM entitlement e
                JOIN reward r ON r.id = e.reward_id WHERE r.campaign_id = ${made.id}) AS grants,
             (SELECT count(*)::int FROM reward_code rc
                JOIN reward r ON r.id = rc.reward_id WHERE r.campaign_id = ${made.id}) AS codes`

    expect(row).toEqual({ values: 0, grants: 0, codes: 0 })
  })

  it('ของเดิมยังอยู่ครบ · ก๊อปไม่ใช่การย้าย', async () => {
    const source = await fullCampaign()
    await duplicateOf(source)

    const [row] = await sql<{ values: number; grants: number; codes: number }[]>`
      SELECT (SELECT count(*)::int FROM counter_value WHERE counter_id = ${source.counterId}) AS values,
             (SELECT count(*)::int FROM entitlement WHERE reward_id = ${source.rewardIds.reward_a}) AS grants,
             (SELECT count(*)::int FROM reward_code WHERE reward_id = ${source.rewardIds.reward_a}) AS codes`
    expect(row).toEqual({ values: 1, grants: 1, codes: 1 })
  })

  it('จำนวนที่แจกไปแล้วเริ่มที่ศูนย์ ไม่ใช่ยอดของแคมเปญเดิม', async () => {
    const source = await fullCampaign()
    const made = await duplicateOf(source)

    const rows = await sql<{ code: string; issued_count: number; quota: number | null }[]>`
      SELECT code, issued_count, quota FROM reward WHERE campaign_id = ${made.id} ORDER BY code`
    expect(rows.map((r) => r.issued_count)).toEqual([0, 0])
    // โควตายังตามมา · สิ่งที่ไม่ตามมาคือยอดที่ถูกใช้ไปแล้ว
    expect(rows.find((r) => r.code === 'reward_a')!.quota).toBe(10)
  })

  it('ที่อยู่ไฟล์ถูกเปลี่ยนเป็นของแคมเปญใหม่ แต่ยังชี้ไฟล์เดิมบน storage', async () => {
    const source = await fullCampaign()
    const made = await duplicateOf(source)

    const copied = await sql<{ storage_path: string; public_url: string }[]>`
      SELECT storage_path, public_url FROM asset WHERE campaign_id = ${made.id} ORDER BY storage_path`
    const original = await sql<{ storage_path: string; public_url: string }[]>`
      SELECT storage_path, public_url FROM asset WHERE campaign_id = ${source.campaignId}
       ORDER BY storage_path`

    for (const row of copied) expect(row.storage_path).toContain(made.id)
    expect(new Set(copied.map((r) => r.public_url)))
      .toEqual(new Set(original.map((r) => r.public_url)))
  })

  it('used_in ไม่ตามมา · มันเก็บ id ของการ์ดในแคมเปญเดิม', async () => {
    const source = await fullCampaign()
    const made = await duplicateOf(source)

    const rows = await sql<{ used_in: unknown[] }[]>`
      SELECT used_in FROM asset WHERE campaign_id = ${made.id}`
    for (const row of rows) expect(row.used_in).toEqual([])
  })

  /**
   * ตัวชี้ทุกเส้นต้องชี้อยู่ในแคมเปญใหม่ · เส้นเดียวที่หลุดกลับไปหาของเดิม
   * แปลว่าแก้แคมเปญหนึ่งแล้วอีกแคมเปญเปลี่ยนตาม
   */
  it('ทุกตัวชี้ถูกต่อใหม่ให้อยู่ในแคมเปญใหม่ ไม่มีเส้นไหนย้อนกลับไปหาต้นทาง', async () => {
    const source = await fullCampaign()
    const made = await duplicateOf(source)

    const [block] = await sql<{ card_campaign: string; sel_campaign: string | null }[]>`
      SELECT c.campaign_id AS card_campaign, s.campaign_id AS sel_campaign
        FROM card_block b
        JOIN card c ON c.id = b.card_id
        LEFT JOIN card_selector s ON s.id = b.selector_id
       WHERE c.campaign_id = ${made.id} AND b.selector_id IS NOT NULL`
    expect(block.card_campaign).toBe(made.id)
    expect(block.sel_campaign).toBe(made.id)

    const [child] = await sql<{ parent_campaign: string }[]>`
      SELECT p.campaign_id AS parent_campaign
        FROM card c JOIN card p ON p.id = c.parent_card_id
       WHERE c.campaign_id = ${made.id}`
    expect(child.parent_campaign).toBe(made.id)

    const [replacement] = await sql<{ target_campaign: string }[]>`
      SELECT t.campaign_id AS target_campaign
        FROM asset a JOIN asset t ON t.id = a.replaces_asset_id
       WHERE a.campaign_id = ${made.id}`
    expect(replacement.target_campaign).toBe(made.id)

    const [stamp] = await sql<{ counter_campaign: string; card_campaign: string; asset_campaign: string }[]>`
      SELECT ct.campaign_id AS counter_campaign, cd.campaign_id AS card_campaign,
             a.campaign_id AS asset_campaign
        FROM stamp_card s
        JOIN counter ct ON ct.id = s.counter_id
        JOIN card cd ON cd.id = s.card_id
        JOIN asset a ON a.id = s.empty_asset_id
       WHERE s.campaign_id = ${made.id}`
    expect(stamp).toEqual({
      counter_campaign: made.id, card_campaign: made.id, asset_campaign: made.id,
    })

    const rules = await sql<{ activity_campaign: string | null; card_campaign: string | null }[]>`
      SELECT ac.campaign_id AS activity_campaign, cd.campaign_id AS card_campaign
        FROM keyword_rule k
        LEFT JOIN activity ac ON ac.id = k.target_activity_id
        LEFT JOIN card cd ON cd.id = k.target_card_id
       WHERE k.campaign_id = ${made.id}`
    expect(rules).toHaveLength(2)
    for (const rule of rules) {
      expect(rule.activity_campaign ?? rule.card_campaign).toBe(made.id)
    }

    const [menu] = await sql<{ image_campaign: string }[]>`
      SELECT a.campaign_id AS image_campaign
        FROM rich_menu m JOIN asset a ON a.id = m.image_asset_id
       WHERE m.campaign_id = ${made.id}`
    expect(menu.image_campaign).toBe(made.id)

    const [activity] = await sql<{ fallback_campaign: string }[]>`
      SELECT c.campaign_id AS fallback_campaign
        FROM activity a JOIN card c ON c.id = a.fallback_card_id
       WHERE a.campaign_id = ${made.id}`
    expect(activity.fallback_campaign).toBe(made.id)
  })

  /**
   * ของที่ชี้ออกไปนอกแคมเปญ ต้องขาดตอน ไม่ใช่ตามไปหาของเดิม
   *
   * `card.video_asset_id` ไม่มี FK เลย และ `rich_menu.image_asset_id` มี FK ไปที่
   * ตาราง asset ทั้งตาราง ไม่ได้บังคับว่าต้องเป็นภาพของแคมเปญเดียวกัน · แถวที่ชี้
   * ออกไปข้างนอกจึงมีอยู่ได้จริง และถ้าสำเนาก๊อป id นั้นตามไปตรงๆ สองแคมเปญจะใช้
   * ภาพก้อนเดียวกันโดยที่แคมเปญใหม่ไม่มีสิทธิ์อะไรกับมัน — ลบภาพในแคมเปญเก่าแล้ว
   * เมนูของแคมเปญใหม่พัง โดยไม่มีอะไรบนจอไหนบอกว่าทำไม
   */
  it('ตัวชี้ที่ออกไปนอกแคมเปญ ถูกตัดทิ้ง ไม่ได้ก๊อป id เดิมตามไป', async () => {
    const source = await fullCampaign()
    const other = await fullCampaign()

    // ภาพของแคมเปญอื่น ถูกอ้างจากแคมเปญต้นทาง
    await sql`UPDATE card SET video_asset_id = ${other.assetIds[0]}
               WHERE id = ${source.cardIds.blocked}`
    await sql`
      INSERT INTO rich_menu (campaign_id, alias, image_asset_id)
      VALUES (${source.campaignId}, 'borrowed', ${other.assetIds[0]})`

    const made = await duplicateOf(source)

    const cards = await sql<{ video_asset_id: string | null }[]>`
      SELECT video_asset_id FROM card WHERE campaign_id = ${made.id}`
    expect(cards.map((row) => row.video_asset_id)).not.toContain(other.assetIds[0])

    const menus = await sql<{ alias: string; campaign_id: string }[]>`
      SELECT m.alias, a.campaign_id FROM rich_menu m JOIN asset a ON a.id = m.image_asset_id
       WHERE m.campaign_id = ${made.id}`
    expect(menus.map((row) => row.alias)).toEqual(['main'])
    for (const menu of menus) expect(menu.campaign_id).toBe(made.id)
  })

  it('ก๊อปแล้วก๊อปอีกจากต้นทางเดิมได้ · ที่อยู่ไฟล์ไม่ชน UNIQUE', async () => {
    const source = await fullCampaign()
    const first = await duplicateOf(source)
    const second = await duplicateOf(source)

    expect(first.id).not.toBe(second.id)
    expect(await count('asset', second.id)).toBe(3)
  })

  it('รหัสซ้ำถูกปฏิเสธด้วยประโยค และไม่ทิ้งแคมเปญค้างไว้', async () => {
    const source = await fullCampaign()
    const code = `c${tag()}`.slice(0, 20)
    await duplicateOf(source, { code })

    const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM campaign`
    await expect(duplicateOf(source, { code })).rejects.toThrow(code)
    const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM campaign`
    expect(after[0].n).toBe(before[0].n)
  })

  it('ต้นทางที่ไม่มีอยู่จริง ไม่สร้างแคมเปญเปล่าทิ้งไว้', async () => {
    const source = await fullCampaign()
    const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM campaign`

    await expect(duplicateCampaign(sql, {
      sourceId: '00000000-0000-0000-0000-000000000000',
      name: 'ผี', code: `g${tag()}`.slice(0, 20),
      startAt: '2027-01-01T00:00:00Z', endAt: '2027-02-01T00:00:00Z',
      actorId: source.userId,
    })).rejects.toThrow('ไม่พบแคมเปญต้นทาง')

    const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM campaign`
    expect(after[0].n).toBe(before[0].n)
  })

  /**
   * รายการที่ห้ามก๊อป ต้องไม่มีแถวไหนโผล่ในแคมเปญใหม่จริงๆ
   *
   * อ่านจาก TABLES_NEVER_COPIED โดยตรง ไม่ใช่จากรายชื่อที่พิมพ์ซ้ำไว้ในเทสต์ —
   * ตารางที่ถูกย้ายไปฝั่งที่ก๊อปจะโผล่ตรงนี้ทันทีโดยไม่ต้องมีใครมาแก้เทสต์ตาม
   */
  it('ทุกตารางใน TABLES_NEVER_COPIED ที่ผูกกับแคมเปญ ไม่มีแถวของแคมเปญใหม่เลย', async () => {
    const source = await fullCampaign()
    const made = await duplicateOf(source)

    const scoped = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'campaign_id'
         AND table_name IN ${sql(TABLES_NEVER_COPIED as string[])}`
    expect(scoped.length).toBeGreaterThan(0)

    for (const { table_name } of scoped) {
      expect(await count(table_name, made.id), table_name).toBe(0)
    }
  })
})
