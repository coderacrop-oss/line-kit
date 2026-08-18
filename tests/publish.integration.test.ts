import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { configFor, loadPublishScreen, snapshotOf, writePublish } from '../lib/db/publish'
import { validateForPublish } from '../lib/publish/validate'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
/** สุ่มต่อท้ายด้วยเหตุผลเดียวกับ seed() — ไฟล์เทสต์คนละไฟล์อยู่คนละ worker */
const tag = () =>
  `p${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

type Scene = {
  userId: string
  campaignId: string
  cardId: string
  activityId: string
  channelId: string
}

/**
 * แคมเปญที่ผ่านด่านตรวจทุกข้อ พร้อมบัญชีทดสอบที่มีกุญแจครบตาม CHECK ของตาราง
 *
 * ปั้นด้วย SQL ตรงๆ เพราะสิ่งที่เทสต์นี้ตรวจคือฝั่งเขียนกับ index ของฐานข้อมูลจริง
 * ไม่ใช่หน้าจอ · กุญแจเป็นข้อความมั่วได้ เพราะไม่มีขั้นไหนในเทสต์นี้ถอดรหัสมัน
 */
async function scene(): Promise<Scene> {
  const t = tag()

  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`pub-${t}@example.com`}, 'configurator')
    RETURNING id`

  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('ส่งขึ้น', ${`pub_${t}`}, now() - interval '1 day', now() + interval '30 days',
            ${user.id})
    RETURNING id`

  const [card] = await sql<{ id: string }[]>`
    INSERT INTO card (campaign_id, code) VALUES (${campaign.id}, 'win') RETURNING id`
  await sql`
    INSERT INTO card_block (card_id, block_type, sort_order, content)
    VALUES (${card.id}, 'title', 0, 'ยินดีด้วย'), (${card.id}, 'body', 1, 'คุณได้รางวัล')`

  const [activity] = await sql<{ id: string }[]>`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, resolve_config)
    VALUES (${campaign.id}, 'draw', 'สุ่มรางวัล', 'none', 'weighted',
            ${sql.json({ outcomes: [{ id: 'o1', cardId: card.id, weight: 1 }] } as never)})
    RETURNING id`

  await sql`
    INSERT INTO keyword_rule (campaign_id, keyword, match_mode, target_activity_id, sort_order)
    VALUES (${campaign.id}, ${`เล่น${t}`}, 'exact', ${activity.id}, 0)`

  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, encrypted_token, encrypted_secret,
                         token_last4, key_version, line_channel_id, created_by)
    VALUES (${`OA ทดสอบ ${t}`}, 'test', 'cipher', 'cipher', '9f2a', 1, ${`L-${t}`}, ${user.id})
    RETURNING id`

  return {
    userId: user.id,
    campaignId: campaign.id,
    cardId: card.id,
    activityId: activity.id,
    channelId: channel.id,
  }
}

const pick = (data: Awaited<ReturnType<typeof loadPublishScreen>>, channelId: string) => {
  const channel = data.channels.find((row) => row.id === channelId)
  if (!channel) throw new Error(`channel ${channelId} missing from the publish screen`)
  return channel
}

/**
 * ตัวโหลดของจอ วิ่งบน schema จริง
 *
 * ตัวตรวจถูกเทสต์แบบ pure ไว้แล้ว สิ่งที่เหลือให้ตรวจตรงนี้คือครึ่งที่ฟังก์ชัน
 * บริสุทธิ์ตรวจไม่ได้ — ชื่อคอลัมน์มีจริงไหม join หาแถวที่ตั้งใจเจอไหม และ count
 * กลับมาเป็นตัวเลขไม่ใช่สตริงที่ postgres คืนให้ bigint
 */
describe('loadPublishScreen · ฐานข้อมูลจริง', () => {
  it('อ่านการ์ด กิจกรรม คีย์เวิร์ด และบัญชีของแคมเปญนี้ได้ครบ', async () => {
    const s = await scene()
    const data = await loadPublishScreen(sql, s.campaignId)

    expect(data.base.cards.map((c) => c.code)).toEqual(['win'])
    expect(data.base.activities.map((a) => a.code)).toEqual(['draw'])
    expect(data.base.keywordRules).toHaveLength(1)
    expect(pick(data, s.channelId).name).toContain('OA ทดสอบ')
  })

  it('จำนวนบล็อกเป็นตัวเลข ไม่ใช่สตริงที่ postgres คืนมาสำหรับ bigint', async () => {
    const s = await scene()
    const data = await loadPublishScreen(sql, s.campaignId)

    expect(typeof data.base.cards[0].blocks).toBe('number')
    expect(data.base.cards[0].blocks).toBe(2)
  })

  it('has_sample_text ถูกอ่านขึ้นมาจริง · ค่าเริ่มต้นของคอลัมน์คือ false', async () => {
    const s = await scene()
    expect((await loadPublishScreen(sql, s.campaignId)).base.cards[0].hasSampleText).toBe(false)
  })

  /**
   * ด่าน BR-37 ทำงานได้ ถ้ามีใครเขียนค่าลงไป
   *
   * ตอนนี้ไม่มีโค้ดไหนในระบบเขียนคอลัมน์นี้เลย — จอ M3-S02 ที่เป็นเจ้าของยังไม่ถูก
   * สร้าง (Task 12) · เทสต์นี้เขียนค่าเองด้วย UPDATE เพื่อพิสูจน์ว่าเมื่อวันนั้นมาถึง
   * ด่านจะติดจริง ไม่ใช่ด่านที่ต่อสายไว้ผิดแล้วไม่มีใครรู้
   */
  it('การ์ดที่ถูกตั้งว่าเป็นข้อความตัวอย่าง ทำให้ส่งขึ้นไม่ได้ (BR-37)', async () => {
    const s = await scene()
    await sql`UPDATE card SET has_sample_text = true WHERE id = ${s.cardId}`

    const data = await loadPublishScreen(sql, s.campaignId)
    const problems = validateForPublish(configFor(data.base, pick(data, s.channelId), true))

    expect(problems.map((p) => p.code)).toContain('ERR-034')
  })

  it('แคมเปญที่ครบทุกอย่าง ผ่านด่านตรวจกับข้อมูลจริง', async () => {
    const s = await scene()
    const data = await loadPublishScreen(sql, s.campaignId)

    expect(validateForPublish(configFor(data.base, pick(data, s.channelId), true))).toEqual([])
  })

  it('บัญชี preview ไม่อยู่ในรายการปลายทาง — ชั้นนั้นไม่มีกุญแจตาม CHECK ของตาราง', async () => {
    const s = await scene()
    const [preview] = await sql<{ id: string }[]>`
      INSERT INTO channel (name, channel_type, created_by)
      VALUES (${`ทดลองเล่น ${tag()}`}, 'preview', ${s.userId}) RETURNING id`

    const data = await loadPublishScreen(sql, s.campaignId)
    expect(data.channels.map((row) => row.id)).not.toContain(preview.id)
  })
})

describe('writePublish · ฐานข้อมูลจริง', () => {
  it('สร้าง config_version แถวแรกเป็น v1', async () => {
    const s = await scene()
    const data = await loadPublishScreen(sql, s.campaignId)

    const result = await writePublish(sql, {
      campaignId: s.campaignId,
      channelId: s.channelId,
      publishedBy: s.userId,
      snapshot: snapshotOf(data.base, pick(data, s.channelId)),
      runAtLine: async () => {},
    })

    expect(result.versionNo).toBe(1)
  })

  it('ส่งขึ้นซ้ำได้เลขถัดไป ไม่ใช่เลขเดิม', async () => {
    const s = await scene()
    const data = await loadPublishScreen(sql, s.campaignId)
    const channel = pick(data, s.channelId)
    const once = () => writePublish(sql, {
      campaignId: s.campaignId,
      channelId: s.channelId,
      publishedBy: s.userId,
      snapshot: snapshotOf(data.base, channel),
      runAtLine: async () => {},
    })

    expect((await once()).versionNo).toBe(1)
    expect((await once()).versionNo).toBe(2)
    expect((await once()).versionNo).toBe(3)
  })

  it('ผูกบัญชีเข้ากับแคมเปญและตั้งว่าเปิดอยู่', async () => {
    const s = await scene()
    const data = await loadPublishScreen(sql, s.campaignId)
    await writePublish(sql, {
      campaignId: s.campaignId,
      channelId: s.channelId,
      publishedBy: s.userId,
      snapshot: snapshotOf(data.base, pick(data, s.channelId)),
      runAtLine: async () => {},
    })

    const [row] = await sql<{ is_published: boolean; published_at: Date | null }[]>`
      SELECT is_published, published_at FROM campaign_channel
       WHERE campaign_id = ${s.campaignId} AND channel_id = ${s.channelId}`
    expect(row.is_published).toBe(true)
    expect(row.published_at).not.toBeNull()

    const [campaign] = await sql<{ status: string }[]>`
      SELECT status FROM campaign WHERE id = ${s.campaignId}`
    expect(campaign.status).toBe('published')
  })

  /**
   * §4.4 · ล้มที่ขั้นตั้ง webhook ต้องไม่เหลือ version ที่ไม่ได้ใช้
   *
   * นี่คือเหตุผลที่ runAtLine ถูกเรียกอยู่ในธุรกรรม · ถ้าย้ายออกไปเรียกทีหลัง
   * แถวของ config_version จะค้างอยู่ และ campaign_channel จะบอกว่าแคมเปญนี้เปิดอยู่
   * บนบัญชีที่ LINE ยังไม่รู้จักด้วยซ้ำ
   */
  it('LINE ล้ม แล้วไม่เหลือ version และไม่มีการผูกบัญชีค้างไว้', async () => {
    const s = await scene()
    const data = await loadPublishScreen(sql, s.campaignId)

    await expect(writePublish(sql, {
      campaignId: s.campaignId,
      channelId: s.channelId,
      publishedBy: s.userId,
      snapshot: snapshotOf(data.base, pick(data, s.channelId)),
      runAtLine: async () => { throw new Error('เชื่อมต่อ LINE ไม่สำเร็จ') },
    })).rejects.toThrow('LINE')

    const versions = await sql<{ id: string }[]>`
      SELECT id FROM config_version WHERE campaign_id = ${s.campaignId}`
    expect(versions).toEqual([])

    const bindings = await sql<{ campaign_id: string }[]>`
      SELECT campaign_id FROM campaign_channel WHERE campaign_id = ${s.campaignId}`
    expect(bindings).toEqual([])

    const [campaign] = await sql<{ status: string }[]>`
      SELECT status FROM campaign WHERE id = ${s.campaignId}`
    expect(campaign.status).toBe('draft')
  })
})

/**
 * BR-68 · OA หนึ่งบัญชีรันแคมเปญทีละหนึ่ง
 *
 * ตัวบังคับจริงคือ unique index บางส่วน campaign_channel_one_live_per_channel
 * ไม่ใช่การตรวจในโค้ด · เทสต์นี้ยิงตรงไปที่ index เพื่อพิสูจน์ว่ามันยังกันอยู่จริง
 * แล้วค่อยพิสูจน์ว่าจอเห็นการชนก่อนที่ index จะต้องพูด
 */
describe('BR-68 · กันชนบัญชี', () => {
  it('แคมเปญที่สองบนบัญชีเดียวกันถูกฐานข้อมูลปฏิเสธ', async () => {
    const a = await scene()
    const b = await scene()
    const dataA = await loadPublishScreen(sql, a.campaignId)

    await writePublish(sql, {
      campaignId: a.campaignId,
      channelId: a.channelId,
      publishedBy: a.userId,
      snapshot: snapshotOf(dataA.base, pick(dataA, a.channelId)),
      runAtLine: async () => {},
    })

    const dataB = await loadPublishScreen(sql, b.campaignId)
    await expect(writePublish(sql, {
      campaignId: b.campaignId,
      channelId: a.channelId,
      publishedBy: b.userId,
      snapshot: snapshotOf(dataB.base, pick(dataB, a.channelId)),
      runAtLine: async () => {},
    })).rejects.toThrow(/campaign_channel_one_live_per_channel/)
  })

  it('จอของแคมเปญที่สองเห็นชื่อแคมเปญที่ครองบัญชีอยู่ ก่อนจะไปชน index', async () => {
    const a = await scene()
    const b = await scene()
    const dataA = await loadPublishScreen(sql, a.campaignId)

    await writePublish(sql, {
      campaignId: a.campaignId,
      channelId: a.channelId,
      publishedBy: a.userId,
      snapshot: snapshotOf(dataA.base, pick(dataA, a.channelId)),
      runAtLine: async () => {},
    })

    const dataB = await loadPublishScreen(sql, b.campaignId)
    const seen = pick(dataB, a.channelId)
    expect(seen.liveCampaign?.id).toBe(a.campaignId)
    expect(seen.liveCampaign?.name).toBe('ส่งขึ้น')
  })

  it('ส่งขึ้นซ้ำบนบัญชีเดิมด้วยแคมเปญเดิม ไม่ถือว่าชนตัวเอง', async () => {
    const s = await scene()
    const data = await loadPublishScreen(sql, s.campaignId)
    const once = () => writePublish(sql, {
      campaignId: s.campaignId,
      channelId: s.channelId,
      publishedBy: s.userId,
      snapshot: snapshotOf(data.base, pick(data, s.channelId)),
      runAtLine: async () => {},
    })

    await once()
    await expect(once()).resolves.toBeDefined()

    const after = await loadPublishScreen(sql, s.campaignId)
    expect(pick(after, s.channelId).liveCampaign?.id).toBe(s.campaignId)
  })

  /**
   * ⚠️ ช่องโหว่ที่ index ปิดไม่ได้ · `channel.line_channel_id` ยังไม่มีหน้าจอกรอก
   *
   * UNIQUE ของคอลัมน์นั้นกันไม่ให้สองแถวถือรหัส OA เดียวกัน แต่ค่านั้นเป็น NULL ได้
   * และ NULL ไม่ชนกันเองใน postgres · แถวที่ยังไม่มีรหัสจึงมีกี่แถวก็ได้ และทั้งหมด
   * อาจเป็น OA ตัวเดียวกันในโลกจริง ซึ่ง BR-68 มองไม่เห็น · เทสต์นี้บันทึกสภาพที่
   * เป็นอยู่ไว้ ไม่ใช่รับรองว่ามันถูก — วันที่มีจอกรอกรหัส เทสต์นี้คือที่ที่ต้องแก้
   */
  it('สองบัญชีที่ยังไม่มีรหัสช่อง ถูกสร้างซ้อนกันได้ · BR-68 ยังมองไม่เห็นการชนนี้', async () => {
    const s = await scene()
    const rows = await sql<{ id: string }[]>`
      INSERT INTO channel (name, channel_type, encrypted_token, encrypted_secret,
                           token_last4, key_version, created_by)
      VALUES (${`ไม่มีรหัส ก ${tag()}`}, 'test', 'c', 'c', '0001', 1, ${s.userId}),
             (${`ไม่มีรหัส ข ${tag()}`}, 'test', 'c', 'c', '0002', 1, ${s.userId})
      RETURNING id`

    expect(rows).toHaveLength(2)

    const data = await loadPublishScreen(sql, s.campaignId)
    for (const row of rows) {
      expect(pick(data, row.id).lineChannelId).toBeNull()
    }
  })

  it('รหัสช่องที่ซ้ำกันจริงๆ ยังถูกฐานข้อมูลปฏิเสธ', async () => {
    const s = await scene()
    const shared = `L-dup-${tag()}`

    await sql`
      INSERT INTO channel (name, channel_type, encrypted_token, encrypted_secret,
                           token_last4, key_version, line_channel_id, created_by)
      VALUES (${`ซ้ำ ก ${tag()}`}, 'test', 'c', 'c', '0003', 1, ${shared}, ${s.userId})`

    await expect(sql`
      INSERT INTO channel (name, channel_type, encrypted_token, encrypted_secret,
                           token_last4, key_version, line_channel_id, created_by)
      VALUES (${`ซ้ำ ข ${tag()}`}, 'test', 'c', 'c', '0004', 1, ${shared}, ${s.userId})`)
      .rejects.toThrow(/line_channel_id/)
  })
})
