import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { findConflicts } from '../lib/campaign/keywords'
import { loadKeywordScreen } from '../lib/db/keywords'
import { testDb } from '../lib/db/client'
import { seed } from './helpers/seed'

/**
 * Server Action ตัวจริง ยิงใส่ตารางจริง
 *
 * actions.test.ts drives these against a fake sql that answers every statement
 * the same way, which proves the guards and proves nothing about the SQL: a
 * column that does not exist, a subquery that will not parse, and an error code
 * that never arrives all pass there. Only the session and the cache are faked
 * here; the allowlist, the constraints and the writes are the real ones.
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

const { deleteKeyword, saveKeyword } = await import('../app/(admin)/campaigns/[id]/keywords/actions')

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
const tag = () =>
  `t${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

const addRule = (campaignId: string, patch: {
  keyword?: string
  matchMode?: string
  activityId?: string | null
  cardId?: string | null
  sortOrder?: number
} = {}) => sql`
  INSERT INTO keyword_rule (campaign_id, keyword, match_mode, target_activity_id, target_card_id, sort_order)
  VALUES (${campaignId}, ${patch.keyword ?? tag()}, ${patch.matchMode ?? 'exact'},
          ${patch.activityId ?? null}, ${patch.cardId ?? null}, ${patch.sortOrder ?? 0})`

/**
 * กติกาที่ตารางบังคับเอง ไม่ใช่ที่หน้าจอบังคับ
 *
 * The action produces a readable sentence for each of these, but the sentence is
 * only a courtesy. These assert that the table refuses regardless of who is
 * writing — a script, a psql session, or a future screen that forgets.
 */
describe('keyword_rule · ข้อบังคับของตาราง', () => {
  it('กติกาที่ไม่พาไปไหนเลย ถูกปฏิเสธ (CHECK)', async () => {
    const s = await seed(sql)
    await expect(addRule(s.campaignId, { keyword: `none-${tag()}` }))
      .rejects.toThrow(/violates check constraint/i)
  })

  it('พาไปกิจกรรมอย่างเดียวก็พอ', async () => {
    const s = await seed(sql)
    await expect(addRule(s.campaignId, { activityId: s.activityId })).resolves.toBeDefined()
  })

  it('ตอบด้วยการ์ดอย่างเดียวก็พอ', async () => {
    const s = await seed(sql)
    await expect(addRule(s.campaignId, { cardId: s.cardIds.fallback })).resolves.toBeDefined()
  })

  it('คำซ้ำในแคมเปญเดียวกัน ถูกปฏิเสธ (UNIQUE)', async () => {
    const s = await seed(sql)
    const keyword = `dup-${tag()}`
    await addRule(s.campaignId, { keyword, activityId: s.activityId })

    await expect(addRule(s.campaignId, { keyword, cardId: s.cardIds.fallback }))
      .rejects.toThrow(/duplicate key value|unique constraint/i)
  })

  // UNIQUE คิดรวมแคมเปญด้วย · สองแคมเปญใช้คำเดียวกันได้ เพราะอยู่คนละ OA กัน
  it('คำเดียวกันในคนละแคมเปญ ตั้งได้', async () => {
    const one = await seed(sql)
    const two = await seed(sql)
    const keyword = `shared-${tag()}`

    await addRule(one.campaignId, { keyword, activityId: one.activityId })
    await expect(addRule(two.campaignId, { keyword, activityId: two.activityId }))
      .resolves.toBeDefined()
  })

  it('โหมดจับคู่นอกเหนือจาก exact และ contains ถูกปฏิเสธ', async () => {
    const s = await seed(sql)
    await expect(addRule(s.campaignId, { matchMode: 'regex', activityId: s.activityId }))
      .rejects.toThrow(/violates check constraint/i)
  })

  /**
   * ลบกิจกรรมแล้วคีย์เวิร์ดที่ชี้ไปหาหายตามไปด้วย (ON DELETE CASCADE)
   *
   * Worth pinning down because it is not what a reader expects from a screen
   * that never mentions keywords: deleting an activity silently removes a way
   * in that somebody printed on a poster.
   */
  it('ลบกิจกรรมปลายทาง กติกาที่ชี้ไปหาถูกลบตามไปด้วย', async () => {
    const s = await seed(sql)
    const keyword = `gone-${tag()}`
    await addRule(s.campaignId, { keyword, activityId: s.activityId })

    await sql`DELETE FROM activity WHERE id = ${s.activityId}`
    const left = await sql`SELECT 1 FROM keyword_rule WHERE campaign_id = ${s.campaignId} AND keyword = ${keyword}`
    expect(left).toHaveLength(0)
  })
})

describe('loadKeywordScreen · ฐานข้อมูลจริง', () => {
  it('อ่านกติกาพร้อมปลายทางทั้งสองแบบ', async () => {
    const s = await seed(sql)
    await addRule(s.campaignId, { keyword: 'เล่นเกม', activityId: s.activityId, sortOrder: 0 })
    await addRule(s.campaignId, { keyword: 'ทักทาย', cardId: s.cardIds.fallback, sortOrder: 1 })

    const data = await loadKeywordScreen(sql, s.campaignId)

    expect(data.rules).toHaveLength(2)
    expect(data.rules[0]).toMatchObject({
      keyword: 'เล่นเกม', matchMode: 'exact', sortOrder: 0,
      targetActivityId: s.activityId, targetCardId: null,
    })
    expect(data.rules[1]).toMatchObject({
      keyword: 'ทักทาย', targetActivityId: null, targetCardId: s.cardIds.fallback,
    })
  })

  it('เรียงตาม sort_order ไม่ใช่ตามที่ฐานข้อมูลคืนมา', async () => {
    const s = await seed(sql)
    await addRule(s.campaignId, { keyword: 'สาม', activityId: s.activityId, sortOrder: 3 })
    await addRule(s.campaignId, { keyword: 'หนึ่ง', cardId: s.cardIds.win_a, sortOrder: 1 })
    await addRule(s.campaignId, { keyword: 'สอง', cardId: s.cardIds.win_b, sortOrder: 2 })

    const data = await loadKeywordScreen(sql, s.campaignId)
    expect(data.rules.map((r) => r.keyword)).toEqual(['หนึ่ง', 'สอง', 'สาม'])
  })

  it('เห็นเฉพาะกติกาของแคมเปญที่ขอ', async () => {
    const mine = await seed(sql)
    const other = await seed(sql)
    await addRule(other.campaignId, { keyword: 'ของคนอื่น', activityId: other.activityId })

    const data = await loadKeywordScreen(sql, mine.campaignId)
    expect(data.rules).toHaveLength(0)
  })

  it('มีรายชื่อกิจกรรมและการ์ดของแคมเปญนี้ให้เลือกเป็นปลายทาง', async () => {
    const s = await seed(sql)
    const data = await loadKeywordScreen(sql, s.campaignId)

    expect(data.activities).toEqual([
      { id: s.activityId, name: 'สุ่มรางวัล', code: 'draw', isEnabled: true },
    ])
    expect(data.cards.map((c) => c.code).sort()).toEqual(['blocked', 'fallback', 'win_a', 'win_b'])
  })

  it('การ์ดที่เป็นของ activity อื่น ไม่โผล่ในรายการให้เลือกเป็นปลายทาง', async () => {
    const s = await seed(sql)
    const [ownedCard] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code, owner_activity_id)
      VALUES (${s.campaignId}, ${`owned_${tag()}`}, ${s.activityId})
      RETURNING id`

    const data = await loadKeywordScreen(sql, s.campaignId)

    expect(data.cards.map((c) => c.id)).not.toContain(ownedCard.id)
  })

  // เครื่องข้ามกิจกรรมที่ปิดอยู่ · หน้าจอต้องรู้ว่าปิด ไม่ใช่ซ่อนจนอธิบายแถวเดิมไม่ได้
  it('กิจกรรมที่ปิดอยู่ยังอยู่ในรายการ พร้อมบอกว่าปิด', async () => {
    const s = await seed(sql)
    await sql`UPDATE activity SET is_enabled = false WHERE id = ${s.activityId}`

    const data = await loadKeywordScreen(sql, s.campaignId)
    expect(data.activities).toEqual([
      { id: s.activityId, name: 'สุ่มรางวัล', code: 'draw', isEnabled: false },
    ])
  })

  it('บัญชีที่ผูกไว้มาพร้อมคีย์เวิร์ดเดิมของลูกค้า ในรูปของอาเรย์', async () => {
    const s = await seed(sql)
    await sql`
      UPDATE channel SET existing_keywords = ${sql.array(['โปรโมชั่น', 'ที่ตั้งสาขา'])}
       WHERE id = ${s.channelId}`

    const data = await loadKeywordScreen(sql, s.campaignId)
    expect(data.channels).toEqual([
      { name: 'Seed preview', existingKeywords: ['โปรโมชั่น', 'ที่ตั้งสาขา'], isPublished: true },
    ])
  })

  it('บัญชีที่ยังไม่ได้กรอกคีย์เวิร์ดเดิม คืนอาเรย์ว่าง ไม่ใช่ null', async () => {
    const s = await seed(sql)
    const data = await loadKeywordScreen(sql, s.campaignId)
    expect(data.channels[0].existingKeywords).toEqual([])
  })

  // ผูกไว้แต่ยังไม่ส่งขึ้นก็ต้องเตือน — วันที่ส่งขึ้นคือวันที่คีย์เวิร์ดเริ่มชนกัน
  it('บัญชีที่ผูกไว้แต่ยังไม่ส่งขึ้น ก็อยู่ในรายการ', async () => {
    const s = await seed(sql)
    const [channel] = await sql<{ id: string }[]>`
      INSERT INTO channel (name, channel_type, existing_keywords, created_by)
      VALUES ('OA ที่ยังไม่ส่งขึ้น', 'preview', ${sql.array(['สาขา'])}, ${s.userId})
      RETURNING id`
    await sql`
      INSERT INTO campaign_channel (campaign_id, channel_id, is_published)
      VALUES (${s.campaignId}, ${channel.id}, false)`

    const data = await loadKeywordScreen(sql, s.campaignId)
    expect(data.channels).toHaveLength(2)
    expect(data.channels.find((c) => c.name === 'OA ที่ยังไม่ส่งขึ้น'))
      .toEqual({ name: 'OA ที่ยังไม่ส่งขึ้น', existingKeywords: ['สาขา'], isPublished: false })
  })

  /**
   * คำเตือนของหน้าจอ ทดสอบกับข้อมูลที่มาจากฐานข้อมูลจริง
   *
   * findConflicts is unit tested against hand-written objects. This is the half
   * that only a database can answer: that a TEXT[] column arrives as an array of
   * strings, and that a keyword stored normalised still matches a client keyword
   * typed with the capitals and spaces a human types.
   */
  it('คีย์เวิร์ดที่เก็บไว้ ชนกับของลูกค้าที่พิมพ์มาดิบๆ แล้วเตือนได้', async () => {
    const s = await seed(sql)
    await sql`
      UPDATE channel SET existing_keywords = ${sql.array(['  PROMO  '])} WHERE id = ${s.channelId}`
    await addRule(s.campaignId, { keyword: 'promo', activityId: s.activityId })

    const data = await loadKeywordScreen(sql, s.campaignId)
    expect(findConflicts(data.rules.map((r) => r.keyword), data.channels))
      .toEqual([{ keyword: 'promo', channelName: 'Seed preview' }])
  })

  it('แคมเปญที่ยังไม่มีคีย์เวิร์ดเลย คืนรายการว่าง ไม่ใช่โยน', async () => {
    const s = await seed(sql)
    const data = await loadKeywordScreen(sql, s.campaignId)
    expect(data.rules).toEqual([])
  })
})

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const signIn = async (userId: string) => {
  const [row] = await sql<{ email: string }[]>`SELECT email FROM app_user WHERE id = ${userId}`
  cookie = row.email
}

const rulesOf = (campaignId: string) => sql<{
  id: string; keyword: string; match_mode: string; sort_order: number
  target_activity_id: string | null; target_card_id: string | null
}[]>`SELECT id, keyword, match_mode, sort_order, target_activity_id, target_card_id
       FROM keyword_rule WHERE campaign_id = ${campaignId} ORDER BY sort_order`

beforeEach(() => { cookie = undefined })

describe('saveKeyword · เขียนลงตารางจริง', () => {
  it('เขียนแถวที่ตารางรับ และเก็บคำในรูปมาตรฐาน', async () => {
    const s = await seed(sql)
    await signIn(s.userId)

    await saveKeyword(s.campaignId, form({
      keyword: '  PLAY  เกม ', match_mode: 'contains', target: `activity:${s.activityId}`,
    }))

    expect(await rulesOf(s.campaignId)).toEqual([{
      id: expect.any(String), keyword: 'play เกม', match_mode: 'contains', sort_order: 0,
      target_activity_id: s.activityId, target_card_id: null,
    }])
  })

  // COALESCE(max(sort_order) + 1, 0) มีจริงแค่ตอนยิงใส่ตารางจริงเท่านั้น
  it('คำถัดไปต่อท้ายลำดับ ไม่ใช่ทับที่เดิม', async () => {
    const s = await seed(sql)
    await signIn(s.userId)

    await saveKeyword(s.campaignId, form({ keyword: 'หนึ่ง', target: `activity:${s.activityId}` }))
    await saveKeyword(s.campaignId, form({ keyword: 'สอง', target: `card:${s.cardIds.fallback}` }))

    expect((await rulesOf(s.campaignId)).map((r) => [r.keyword, r.sort_order]))
      .toEqual([['หนึ่ง', 0], ['สอง', 1]])
  })

  /**
   * รหัส 23505 ที่แปลเป็นประโยค ต้องมาจากข้อบังคับตัวจริง
   *
   * The unit test hands the action a fabricated error carrying that code. This
   * is the half it cannot check: that the constraint fires at all, and that
   * postgres.js surfaces the code on the object the action reads.
   */
  it('คำซ้ำได้ประโยคที่อ่านออก จาก UNIQUE ตัวจริง', async () => {
    const s = await seed(sql)
    await signIn(s.userId)
    await saveKeyword(s.campaignId, form({ keyword: 'ซ้ำ', target: `activity:${s.activityId}` }))

    await expect(saveKeyword(s.campaignId, form({
      keyword: ' ซ้ำ ', target: `card:${s.cardIds.fallback}`,
    }))).rejects.toThrow('มีคำนี้อยู่แล้ว')

    expect(await rulesOf(s.campaignId)).toHaveLength(1)
  })

  it('แก้ของเดิมแล้วเปลี่ยนทั้งคำ โหมด และปลายทาง', async () => {
    const s = await seed(sql)
    await signIn(s.userId)
    await saveKeyword(s.campaignId, form({ keyword: 'เดิม', target: `activity:${s.activityId}` }))
    const [before] = await rulesOf(s.campaignId)

    await saveKeyword(s.campaignId, form({
      id: before.id, keyword: 'ใหม่', match_mode: 'contains', target: `card:${s.cardIds.win_a}`,
    }))

    expect(await rulesOf(s.campaignId)).toEqual([{
      id: before.id, keyword: 'ใหม่', match_mode: 'contains', sort_order: 0,
      target_activity_id: null, target_card_id: s.cardIds.win_a,
    }])
  })

  it('แก้แถวของแคมเปญอื่นไม่ได้ แม้จะรู้ id ของมัน', async () => {
    const mine = await seed(sql)
    const other = await seed(sql)
    await signIn(other.userId)
    await saveKeyword(other.campaignId, form({ keyword: 'ของเขา', target: `activity:${other.activityId}` }))
    const [victim] = await rulesOf(other.campaignId)

    await signIn(mine.userId)
    await saveKeyword(mine.campaignId, form({
      id: victim.id, keyword: 'ยึดมา', target: `activity:${mine.activityId}`,
    }))

    expect((await rulesOf(other.campaignId))[0].keyword).toBe('ของเขา')
  })

  it('ปลายทางของแคมเปญอื่น ถูกปฏิเสธก่อนถึงฐานข้อมูล', async () => {
    const mine = await seed(sql)
    const other = await seed(sql)
    await signIn(mine.userId)

    await expect(saveKeyword(mine.campaignId, form({
      keyword: 'ข้ามแคมเปญ', target: `activity:${other.activityId}`,
    }))).rejects.toThrow('แคมเปญนี้')

    expect(await rulesOf(mine.campaignId)).toHaveLength(0)
  })

  it('ผู้ดูรายงานที่มีอยู่จริงในรายชื่อ ก็ยังเขียนไม่ได้', async () => {
    const s = await seed(sql)
    await sql`UPDATE app_user SET role = 'reporter' WHERE id = ${s.userId}`
    await signIn(s.userId)

    await expect(saveKeyword(s.campaignId, form({
      keyword: 'ห้าม', target: `activity:${s.activityId}`,
    }))).rejects.toThrow('ไม่มีสิทธิ์')

    expect(await rulesOf(s.campaignId)).toHaveLength(0)
  })

  it('บัญชีที่ถูกถอนสิทธิ์ เขียนไม่ได้แม้ยังมีแถวอยู่', async () => {
    const s = await seed(sql)
    await sql`UPDATE app_user SET is_active = false WHERE id = ${s.userId}`
    await signIn(s.userId)

    await expect(saveKeyword(s.campaignId, form({
      keyword: 'ถูกถอน', target: `activity:${s.activityId}`,
    }))).rejects.toThrow('ต้องเข้าสู่ระบบก่อน')
  })
})

describe('deleteKeyword · ลบจากตารางจริง', () => {
  it('ลบแถวของแคมเปญตัวเองได้', async () => {
    const s = await seed(sql)
    await signIn(s.userId)
    await saveKeyword(s.campaignId, form({ keyword: 'ลบฉัน', target: `activity:${s.activityId}` }))
    const [row] = await rulesOf(s.campaignId)

    await deleteKeyword(s.campaignId, row.id)
    expect(await rulesOf(s.campaignId)).toHaveLength(0)
  })

  it('ลบแถวของแคมเปญอื่นไม่ได้ แม้จะรู้ id', async () => {
    const mine = await seed(sql)
    const other = await seed(sql)
    await signIn(other.userId)
    await saveKeyword(other.campaignId, form({ keyword: 'ของเขา', target: `activity:${other.activityId}` }))
    const [victim] = await rulesOf(other.campaignId)

    await signIn(mine.userId)
    await deleteKeyword(mine.campaignId, victim.id)

    expect(await rulesOf(other.campaignId)).toHaveLength(1)
  })
})
