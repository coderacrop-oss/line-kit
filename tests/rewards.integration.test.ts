import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { playAndApply } from '../lib/db/apply'
import { testDb } from '../lib/db/client'
import { listRewards, loadReward } from '../lib/db/rewards'

/**
 * Server Action ตัวจริง บนตารางจริง พร้อม CHECK และ UNIQUE ที่ตารางบังคับเอง
 *
 * actions.test.ts drives the same four functions against a fake sql, which
 * proves the guards in the action and proves nothing about what stands behind
 * them. The rules that matter most on this screen are written in the table:
 * a quota that cannot fall below what has gone out, a code that cannot be
 * loaded twice, and a code that cannot be handed to a second person. A screen
 * that repeats those rules is only worth the paper it is on if the table agrees
 * — and only the real one can be asked.
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

const { deleteReward, deleteRewardCode, importRewardCodes, saveReward } =
  await import('../app/(admin)/campaigns/[id]/rewards/actions')

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
const tag = () =>
  `r${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** รหัสแคมเปญยาวได้ไม่เกิน 20 ตัวตาม CHECK ของคอลัมน์ */
const campaignCode = () => `rw${(unique++).toString(36)}${Math.random().toString(36).slice(2, 10)}`

const asRole = async (role: string) => {
  const [user] = await sql<{ id: string; email: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`rw-${tag()}@example.com`}, ${role})
    RETURNING id, email`
  return user
}

const aCampaign = async () => {
  const user = await asRole('configurator')
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('รางวัล', ${campaignCode()}, now(), now() + interval '30 days', ${user.id})
    RETURNING id`
  cookie = user.email
  return { user, campaignId: campaign.id }
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const rewardForm = (patch: Record<string, string> = {}) =>
  form({ code: 'discount_100', reward_type: 'link', value: 'https://example.com/c', ...patch })

const rawRewards = (campaignId: string) => sql<{
  id: string
  code: string
  reward_type: string
  value: string | null
  quota: number | null
  issued_count: number
  valid_days: number | null
  use_limit: number | null
}[]>`SELECT id, code, reward_type, value, quota, issued_count, valid_days, use_limit
       FROM reward WHERE campaign_id = ${campaignId} ORDER BY code`

/** รางวัลหนึ่งตัวที่สร้างผ่าน action จริง แล้วอ่านแถวจริงกลับมา */
const aReward = async (patch: Record<string, string> = {}) => {
  const { campaignId, user } = await aCampaign()
  await saveReward(campaignId, '', rewardForm(patch))
  const [row] = await rawRewards(campaignId)
  return { campaignId, user, reward: row }
}

/** ผู้เล่นจริงหนึ่งคน · ต้องมี channel เพราะ participant ผูกกับบัญชี ไม่ใช่กับแคมเปญ */
const aParticipant = async (userId: string) => {
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, created_by)
    VALUES ('รางวัล preview', 'preview', ${userId}) RETURNING id`
  const [participant] = await sql<{ id: string }[]>`
    INSERT INTO participant (channel_id, line_uid) VALUES (${channel.id}, ${`U-${tag()}`})
    RETURNING id`
  return { channelId: channel.id, participantId: participant.id }
}

beforeEach(() => { cookie = undefined; redirectedTo = undefined })

/**
 * CHECK (quota IS NULL OR issued_count <= quota)
 *
 * The action refuses a quota below what has already gone out, and says by how
 * much. This asks whether anything stands behind that refusal — because the
 * action is not the only way a quota gets written, and a rule enforced solely
 * by the screen is a rule that ends the moment somebody opens psql.
 */
describe('reward · CHECK (quota IS NULL OR issued_count <= quota)', () => {
  const issue = (rewardId: string, count: number) =>
    sql`UPDATE reward SET issued_count = ${count} WHERE id = ${rewardId}`

  it('แจกครบโควตาพอดี ตารางรับ', async () => {
    const { reward } = await aReward({ quota: '10' })
    await expect(issue(reward.id, 10)).resolves.toBeDefined()
  })

  it('แจกเกินโควตาไปหนึ่ง ตารางปฏิเสธเอง', async () => {
    const { reward } = await aReward({ quota: '10' })
    await expect(issue(reward.id, 11)).rejects.toThrow(/violates check constraint/i)
  })

  it('ลดโควตาลงต่ำกว่าที่แจกไปแล้ว ตารางปฏิเสธเอง แม้จะเลี่ยง action ไปเขียนตรงๆ', async () => {
    const { reward } = await aReward({ quota: '100' })
    await issue(reward.id, 40)

    await expect(sql`UPDATE reward SET quota = 39 WHERE id = ${reward.id}`)
      .rejects.toThrow(/violates check constraint/i)

    const [after] = await sql<{ quota: number }[]>`SELECT quota FROM reward WHERE id = ${reward.id}`
    expect(after.quota).toBe(100)
  })

  it('ลดโควตาลงมาเท่าที่แจกไปแล้วพอดี ตารางรับ', async () => {
    const { reward } = await aReward({ quota: '100' })
    await issue(reward.id, 40)
    await expect(sql`UPDATE reward SET quota = 40 WHERE id = ${reward.id}`).resolves.toBeDefined()
  })

  /** ไม่จำกัดโควตาคือ NULL ไม่ใช่ศูนย์ · CHECK ปล่อยผ่านทุกจำนวนที่แจกไปแล้ว */
  it('รางวัลที่ไม่จำกัดโควตา แจกไปเท่าไหร่ก็ไม่ชน CHECK', async () => {
    const { reward } = await aReward({ quota: '' })
    expect(reward.quota).toBeNull()
    await expect(issue(reward.id, 99_999)).resolves.toBeDefined()
  })

  it('action ปฏิเสธก่อนถึง CHECK และบอกจำนวนที่แจกไปแล้วจริง', async () => {
    const { campaignId, reward } = await aReward({ quota: '100' })
    await issue(reward.id, 40)

    await expect(saveReward(campaignId, reward.id, rewardForm({ quota: '39' })))
      .rejects.toThrow('แจกไปแล้ว 40 สิทธิ์')

    const [after] = await rawRewards(campaignId)
    expect(after.quota).toBe(100)
  })
})

/**
 * UNIQUE (reward_id, code_value)
 *
 * The importer checks for duplicates before writing, which closes the door for
 * a paste but not for two pastes racing each other. The constraint is what
 * makes "no half import" true rather than likely.
 */
describe('reward_code · UNIQUE (reward_id, code_value)', () => {
  const codeReward = () => aReward({ reward_type: 'code', value: '' })

  it('รหัสเดียวกันสองแถวในรางวัลเดียวกัน ตารางปฏิเสธเอง', async () => {
    const { reward } = await codeReward()
    const add = () => sql`
      INSERT INTO reward_code (reward_id, code_value) VALUES (${reward.id}, 'MELO-A1B2')`

    await add()
    await expect(add()).rejects.toThrow(/duplicate key value|unique constraint/i)
  })

  /** ผูกกับรางวัล ไม่ใช่ผูกกับทั้งระบบ · สองแคมเปญใช้ชุดรหัสชื่อเดียวกันได้ */
  it('รหัสเดียวกันในคนละรางวัล ตารางรับ', async () => {
    const a = await codeReward()
    const b = await codeReward()

    await sql`INSERT INTO reward_code (reward_id, code_value) VALUES (${a.reward.id}, 'MELO-A1B2')`
    await expect(
      sql`INSERT INTO reward_code (reward_id, code_value) VALUES (${b.reward.id}, 'MELO-A1B2')`,
    ).resolves.toBeDefined()
  })

  it('นำเข้าซ้ำกับที่มีอยู่แล้ว ไม่มีแถวไหนเพิ่มเข้ามา', async () => {
    const { campaignId, reward } = await codeReward()
    await importRewardCodes(campaignId, reward.id, form({ codes: 'MELO-A1B2\nMELO-C3D4' }))

    await expect(
      importRewardCodes(campaignId, reward.id, form({ codes: 'MELO-E5F6\nMELO-A1B2' })),
    ).rejects.toThrow('มีอยู่ในคลังแล้ว')

    const rows = await sql`SELECT code_value FROM reward_code WHERE reward_id = ${reward.id}`
    expect(rows.map((row) => row.code_value).sort()).toEqual(['MELO-A1B2', 'MELO-C3D4'])
  })

  /**
   * ชนิดรหัสไม่มีค่าของตัวเอง · ค่าอยู่ในคลัง หนึ่งแถวต่อหนึ่งรหัส
   *
   * Storing one in reward.value as well would be a second answer to the same
   * question, and the two would disagree the first time either was edited.
   */
  it('รางวัลชนิดรหัส คอลัมน์ value เป็น NULL แม้ฟอร์มจะแอบส่งค่ามา', async () => {
    const { campaignId } = await aCampaign()
    await saveReward(campaignId, '', rewardForm({ reward_type: 'code', value: 'MELO-XXXX' }))

    const [row] = await rawRewards(campaignId)
    expect(row.reward_type).toBe('code')
    expect(row.value).toBeNull()
  })

  it('นำเข้าทั้งชุดสำเร็จ ได้แถวจริงครบทุกตัวและยังไม่มีเจ้าของ', async () => {
    const { campaignId, reward } = await codeReward()
    await importRewardCodes(campaignId, reward.id, form({ codes: 'MELO-A1B2\nMELO-C3D4\nMELO-E5F6' }))

    const screen = await loadReward(sql, campaignId, reward.id)
    expect(screen?.reward.codeStock).toEqual({ total: 3, issued: 0, left: 3 })
    expect(screen?.codes.every((code) => code.assigned_at === null)).toBe(true)
  })
})

/**
 * reward_code.assigned_to UNIQUE · รหัสหนึ่งตัวไปถึงคนเดียว
 *
 * The column is what pairs a code with the person holding it, and the constraint
 * is what stops a second person being written over the first. Nothing else
 * records that pairing — entitlement.reward_code_id points at the row, not at
 * the string — so a code claimed twice would leave one of the two holding a
 * coupon somebody else is also holding.
 *
 * The constraint is wider than the comment in 0001_init.sql claims, and the
 * width is not harmless: see the last case in this block.
 */
describe('reward_code.assigned_to · UNIQUE', () => {
  const codeRewardWithCodes = async (codes: string) => {
    const { campaignId, user, reward } = await aReward({ reward_type: 'code', value: '' })
    await importRewardCodes(campaignId, reward.id, form({ codes }))
    const rows = await sql<{ id: string; code_value: string }[]>`
      SELECT id, code_value FROM reward_code WHERE reward_id = ${reward.id} ORDER BY code_value`
    return { campaignId, user, reward, codes: rows }
  }

  const assign = (codeId: string, participantId: string) => sql`
    UPDATE reward_code SET assigned_to = ${participantId}, assigned_at = now()
     WHERE id = ${codeId}`

  it('รหัสที่ยังไม่มีเจ้าของ มีได้หลายแถวพร้อมกัน · NULL ไม่ชนกันเอง', async () => {
    const { reward } = await codeRewardWithCodes('MELO-A1B2\nMELO-C3D4\nMELO-E5F6')
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM reward_code WHERE reward_id = ${reward.id} AND assigned_to IS NULL`
    expect(Number(count)).toBe(3)
  })

  it('รหัสตัวหนึ่งไปถึงคนหนึ่ง แล้วเขียนคนที่สองทับ ตารางยังยอม เพราะเป็นแถวเดียวกัน', async () => {
    // เขียนทับคือการย้ายเจ้าของ ไม่ใช่การมีสองเจ้าของ · สิ่งที่กันการมีสองเจ้าของ
    // จริงๆ คือ assigned_to เป็นคอลัมน์เดียว ไม่ใช่ UNIQUE · เขียนไว้เพราะคอมเมนต์
    // ใน 0001_init.sql อ้างว่า UNIQUE ตัวนี้มีไว้กันเรื่องนั้น ซึ่งไม่ใช่
    const { user, codes } = await codeRewardWithCodes('MELO-A1B2')
    const first = await aParticipant(user.id)
    const second = await aParticipant(user.id)

    await assign(codes[0].id, first.participantId)
    await expect(assign(codes[0].id, second.participantId)).resolves.toBeDefined()
  })

  it('สองรหัสของรางวัลเดียวกัน ไปถึงคนเดียวกันไม่ได้', async () => {
    const { user, codes } = await codeRewardWithCodes('MELO-A1B2\nMELO-C3D4')
    const { participantId } = await aParticipant(user.id)

    await assign(codes[0].id, participantId)
    await expect(assign(codes[1].id, participantId))
      .rejects.toThrow(/duplicate key value|unique constraint/i)
  })

  /**
   * UNIQUE ตัวนี้กว้างกว่าที่คอมเมนต์ของมันบอก · มันคลุมทั้งตาราง ไม่ใช่แค่ในรางวัลเดียว
   *
   * A participant can therefore hold at most one reward_code in the entire
   * database, across every reward of every campaign. play_and_apply assigns a
   * free code inside the same transaction that grants the entitlement, so the
   * second code-type reward a person wins takes the whole play down with a
   * constraint violation rather than being refused politely.
   */
  it('รหัสของคนละรางวัล ก็ยังไปถึงคนเดียวกันไม่ได้ · UNIQUE คลุมทั้งตาราง', async () => {
    const a = await codeRewardWithCodes('MELO-A1B2')
    const b = await codeRewardWithCodes('SECOND-C3D4')
    const { participantId } = await aParticipant(a.user.id)

    await assign(a.codes[0].id, participantId)
    await expect(assign(b.codes[0].id, participantId))
      .rejects.toThrow(/duplicate key value|unique constraint/i)
  })

  it('คนละคนถือคนละรหัสได้ตามปกติ', async () => {
    const { user, codes } = await codeRewardWithCodes('MELO-A1B2\nMELO-C3D4')
    const first = await aParticipant(user.id)
    const second = await aParticipant(user.id)

    await assign(codes[0].id, first.participantId)
    await expect(assign(codes[1].id, second.participantId)).resolves.toBeDefined()
  })

  it('รหัสที่จ่ายไปแล้ว จอลบไม่ได้ และแถวยังอยู่', async () => {
    const { campaignId, user, reward, codes } = await codeRewardWithCodes('MELO-A1B2')
    const { participantId } = await aParticipant(user.id)
    await assign(codes[0].id, participantId)

    await expect(deleteRewardCode(campaignId, reward.id, codes[0].id))
      .rejects.toThrow('ผู้เล่นไปแล้ว')

    const rows = await sql`SELECT id FROM reward_code WHERE id = ${codes[0].id}`
    expect(rows).toHaveLength(1)
  })

  it('รหัสที่ยังไม่มีเจ้าของ ลบได้จริงและหายไปจากคลัง', async () => {
    const { campaignId, reward, codes } = await codeRewardWithCodes('MELO-A1B2\nMELO-C3D4')

    await deleteRewardCode(campaignId, reward.id, codes[0].id)

    const screen = await loadReward(sql, campaignId, reward.id)
    expect(screen?.codes.map((code) => code.code_value)).toEqual(['MELO-C3D4'])
  })
})

/**
 * ธุรกรรมที่เป็นเจ้าของ issued_count · จอนี้อ่านมันอย่างเดียวเพราะที่นี่คือที่ที่มันถูกเขียน
 */
describe('issued_count · เขียนโดยธุรกรรมที่ออกสิทธิ์เท่านั้น', () => {
  const aPlayableReward = async () => {
    const { campaignId, user, reward } = await aReward({ quota: '2' })
    const { channelId, participantId } = await aParticipant(user.id)

    const [card] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code) VALUES (${campaignId}, 'win') RETURNING id`
    const [activity] = await sql<{ id: string }[]>`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, fallback_card_id)
      VALUES (${campaignId}, 'draw', 'สุ่มรางวัล', 'none', 'quota', ${card.id})
      RETURNING id`
    const [version] = await sql<{ id: string }[]>`
      INSERT INTO config_version (campaign_id, version_no, snapshot, channel_id, published_by)
      VALUES (${campaignId}, 1, '{}'::jsonb, ${channelId}, ${user.id})
      RETURNING id`

    return { campaignId, user, reward, participantId, activityId: activity.id,
             cardId: card.id, configVersionId: version.id }
  }

  const play = (ctx: Awaited<ReturnType<typeof aPlayableReward>>, participantId: string) =>
    playAndApply(sql, {
      participantId,
      activityId: ctx.activityId,
      campaignId: ctx.campaignId,
      periodKey: '2026-08-17',
      playToken: `t-${tag()}`,
      configVersionId: ctx.configVersionId,
      ranked: [{ id: 'win', card_id: ctx.cardId,
                 effects: [{ type: 'grant_reward', reward_code: ctx.reward.code }] }],
    })

  it('ฟอร์มที่แอบส่ง issued_count มาตอนสร้าง ไม่ไปถึงคอลัมน์ · แถวใหม่เริ่มที่ศูนย์', async () => {
    const { campaignId } = await aCampaign()
    await saveReward(campaignId, '', rewardForm({ issued_count: '999' }))

    const [row] = await rawRewards(campaignId)
    expect(row.issued_count).toBe(0)
  })

  it('ออกสิทธิ์หนึ่งครั้ง issued_count ขึ้นหนึ่ง พร้อมแถวใน entitlement หนึ่งแถว', async () => {
    const ctx = await aPlayableReward()
    await play(ctx, ctx.participantId)

    const [after] = await rawRewards(ctx.campaignId)
    expect(after.issued_count).toBe(1)

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM entitlement WHERE reward_id = ${ctx.reward.id}`
    expect(Number(count)).toBe(1)
  })

  /** ตัวเลขบนจอกับจำนวนสิทธิ์ที่มีอยู่จริง ต้องเป็นเลขเดียวกันเสมอ */
  it('จอแสดงตัวเลขเดียวกับจำนวนแถวใน entitlement', async () => {
    const ctx = await aPlayableReward()
    await play(ctx, ctx.participantId)

    const [view] = await listRewards(sql, ctx.campaignId)
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM entitlement WHERE reward_id = ${ctx.reward.id}`
    expect(view.issuedCount).toBe(Number(count))
    expect(view.remaining).toBe(1)
  })

  it('กดบันทึกจากจอ ไม่แตะ issued_count ที่ธุรกรรมนั้นเขียนไว้', async () => {
    const ctx = await aPlayableReward()
    await play(ctx, ctx.participantId)

    await saveReward(ctx.campaignId, ctx.reward.id,
      rewardForm({ quota: '500', issued_count: '0', value: 'https://example.com/new' }))

    const [after] = await rawRewards(ctx.campaignId)
    expect(after.issued_count).toBe(1)
    expect(after.quota).toBe(500)
    expect(after.value).toBe('https://example.com/new')
  })

  /**
   * ลบรางวัลที่มีคนถืออยู่ = ลบสิทธิ์ของคนเหล่านั้นทิ้งด้วย
   *
   * entitlement.reward_id cascades. The table's answer to the delete is to
   * remove the only record that anybody was promised anything, and to report
   * success. The action refuses before it gets there.
   */
  it('รางวัลที่มีคนได้รับไปแล้ว ลบไม่ได้ และสิทธิ์ที่ออกไปยังอยู่ครบ', async () => {
    const ctx = await aPlayableReward()
    await play(ctx, ctx.participantId)

    await expect(deleteReward(ctx.campaignId, ctx.reward.id)).rejects.toThrow('CASCADE')

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM entitlement WHERE reward_id = ${ctx.reward.id}`
    expect(Number(count)).toBe(1)
  })

  /**
   * เหตุผลที่จอเขียนไว้ ต้องมาจากสิทธิ์ที่มีอยู่จริง ไม่ใช่จากธงที่ใครตั้งไว้
   *
   * deleteBlockedWhy is what the edit screen prints where the delete button
   * would be, and it is the only place a person is told that removing this
   * reward takes other people's entitlements with it. Naming ON DELETE CASCADE
   * is the part that makes the sentence checkable against the schema instead of
   * being a vague warning.
   */
  it('จอบอกว่าลบไม่ได้ พร้อมจำนวนคนจริงและคำว่า CASCADE', async () => {
    const ctx = await aPlayableReward()
    await play(ctx, ctx.participantId)

    const [view] = await listRewards(sql, ctx.campaignId)
    expect(view.canDelete).toBe(false)
    expect(view.deleteBlockedWhy).toContain('1 คน')
    expect(view.deleteBlockedWhy).toContain('ON DELETE CASCADE')
  })

  it('ลบรางวัลจริงๆ ผ่าน SQL ตรงๆ สิทธิ์หายตามไปด้วย — เหตุผลที่ action ปฏิเสธ', async () => {
    const ctx = await aPlayableReward()
    await play(ctx, ctx.participantId)

    await sql`DELETE FROM reward WHERE id = ${ctx.reward.id}`

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM entitlement WHERE reward_id = ${ctx.reward.id}`
    expect(Number(count)).toBe(0)
  })
})

/**
 * สิ่งที่จออ่านมาจากตารางจริง ไม่ใช่จากคอลัมน์ที่ไม่มีใครกรอก
 */
describe('listRewards · ใครแจกรางวัลนี้ และรางวัลที่ไม่มีทางถูกแจก', () => {
  it('รางวัลที่เพิ่งสร้าง ไม่มีใครชี้มา', async () => {
    const { campaignId } = await aReward()
    const [view] = await listRewards(sql, campaignId)
    expect(view.isOrphan).toBe(true)
    expect(view.usedBy).toEqual([])
  })

  it('ผลลัพธ์ของกิจกรรมที่อ้างรหัสนี้ ทำให้มีคนแจก', async () => {
    const { campaignId, reward } = await aReward()
    const [card] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code) VALUES (${campaignId}, 'win') RETURNING id`
    await sql`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method,
                            fallback_card_id, resolve_config)
      VALUES (${campaignId}, 'draw', 'สุ่มรางวัล', 'none', 'quota', ${card.id},
              ${sql.json({ outcomes: [{ id: 'big', rewardCode: reward.code }] } as never)})`

    const [view] = await listRewards(sql, campaignId)
    expect(view.isOrphan).toBe(false)
    expect(view.usedBy).toEqual(['สุ่มรางวัล · ผลลัพธ์ "big"'])
  })

  it('จุดปลดล็อกของค่าสะสมที่อ้างรหัสนี้ ก็นับว่าแจกอยู่ และลบรางวัลไม่ได้', async () => {
    const { campaignId, reward } = await aReward()
    const [counter] = await sql<{ id: string }[]>`
      INSERT INTO counter (campaign_id, code, name, mode, target)
      VALUES (${campaignId}, 'days', 'วันเช็คอิน', 'daily_unique', 7) RETURNING id`
    await sql`
      INSERT INTO counter_milestone (counter_id, at_value, effects)
      VALUES (${counter.id}, 7,
              ${sql.json([{ type: 'grant_reward', reward_code: reward.code }] as never)})`

    const [view] = await listRewards(sql, campaignId)
    expect(view.usedBy).toEqual(['ค่าสะสม "วันเช็คอิน" · จุดปลดล็อก 7'])
    await expect(deleteReward(campaignId, reward.id)).rejects.toThrow('วันเช็คอิน')
  })

  it('รางวัลของแคมเปญอื่น ไม่โผล่มาในรายการนี้ และอ่านผ่าน id ของแคมเปญนี้ไม่ได้', async () => {
    const theirs = await aReward()
    const mine = await aReward({ code: 'mine_only' })

    expect((await listRewards(sql, mine.campaignId)).map((view) => view.code)).toEqual(['mine_only'])
    expect(await loadReward(sql, mine.campaignId, theirs.reward.id)).toBeNull()
  })
})

/**
 * รางวัลที่สร้างแล้วยังไม่มีค่าอยู่ในตัว · ผลของฟอร์มสร้างที่ถามแค่ตัวตน
 */
describe('รางวัลที่ยังไม่ได้ตั้งค่าของรางวัล', () => {
  it('สร้างโดยไม่ใส่ค่าได้ · คอลัมน์เป็น NULL และจอติดคำเตือนไว้', async () => {
    const { campaignId } = await aCampaign()
    await saveReward(campaignId, '', form({ code: 'no_value_yet', reward_type: 'text' }))

    const [row] = await rawRewards(campaignId)
    expect(row.value).toBeNull()

    const [view] = await listRewards(sql, campaignId)
    expect(view.valueMissingText).toContain('ยังไม่ได้ตั้งค่าของรางวัล')
    expect(redirectedTo).toBe(`/campaigns/${campaignId}/rewards/${row.id}`)
  })

  it('แก้ให้กลับไปว่างอีกครั้ง ถูกปฏิเสธ และค่าเดิมยังอยู่', async () => {
    const { campaignId, reward } = await aReward({ reward_type: 'text', value: 'ยินดีด้วย' })

    await expect(saveReward(campaignId, reward.id, rewardForm({ reward_type: 'text', value: '' })))
      .rejects.toThrow('ข้อความรางวัล')

    const [after] = await rawRewards(campaignId)
    expect(after.value).toBe('ยินดีด้วย')
  })

  it('ใส่ค่าแล้ว คำเตือนหายไป', async () => {
    const { campaignId } = await aCampaign()
    await saveReward(campaignId, '', form({ code: 'no_value_yet', reward_type: 'text' }))
    const [row] = await rawRewards(campaignId)

    await saveReward(campaignId, row.id, form({ reward_type: 'text', value: 'ยินดีด้วย' }))

    expect((await listRewards(sql, campaignId))[0].valueMissingText).toBeNull()
  })
})
