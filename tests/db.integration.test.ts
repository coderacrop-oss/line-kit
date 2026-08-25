import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { buildRanked, playAndApply, toSqlEffect } from '../lib/db/apply'
import { testDb } from '../lib/db/client'
import { seed } from './helpers/seed'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

const candidate = (id: string, cardId: string, rewardCode?: string) => ({
  id,
  card_id: cardId,
  effects: [
    { type: 'add_units', counter_code: 'food', amount: 25 },
    ...(rewardCode ? [{ type: 'grant_reward', reward_code: rewardCode }] : []),
  ],
})

describe('play_and_apply', () => {
  it('เล่นครั้งแรกได้ผลลัพธ์อันดับหนึ่ง และลง effect ครบ', async () => {
    const s = await seed(sql)
    const out = await playAndApply(sql, {
      participantId: s.participantIds[0], activityId: s.activityId, campaignId: s.campaignId,
      periodKey: '2026-08-14', playToken: `t-${Date.now()}`, configVersionId: s.configVersionId,
      ranked: [candidate('a', s.cardIds.win_a, 'reward_a')],
    })

    expect(out.replayed).toBe(false)
    if ('exhausted' in out) throw new Error('should not be exhausted')
    expect(out.result.outcome_id).toBe('a')

    const [counter] = await sql<{ value: number }[]>`
      SELECT value FROM counter_value WHERE participant_id = ${s.participantIds[0]}`
    expect(counter.value).toBe(25)

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM entitlement WHERE participant_id = ${s.participantIds[0]}`
    expect(Number(count)).toBe(1)
  })

  it('กดซ้ำได้ผลเดิม ไม่แจกซ้ำ ไม่บวกซ้ำ', async () => {
    const s = await seed(sql)
    const args = {
      participantId: s.participantIds[0], activityId: s.activityId, campaignId: s.campaignId,
      periodKey: '2026-08-14', playToken: `t-${Date.now()}-x`, configVersionId: s.configVersionId,
      ranked: [candidate('a', s.cardIds.win_a, 'reward_a')],
    }
    const first = await playAndApply(sql, args)
    if ('exhausted' in first) throw new Error('unexpected')

    for (let i = 0; i < 4; i++) {
      const again = await playAndApply(sql, { ...args, playToken: `t-${Date.now()}-${i}` })
      expect(again.replayed).toBe(true)
      if ('exhausted' in again) throw new Error('unexpected')
      expect(again.result.outcome_id).toBe(first.result.outcome_id)
    }

    const [counter] = await sql<{ value: number }[]>`
      SELECT value FROM counter_value WHERE participant_id = ${s.participantIds[0]}`
    expect(counter.value).toBe(25)

    const [reward] = await sql<{ issued_count: number }[]>`
      SELECT issued_count FROM reward WHERE id = ${s.rewardIds.reward_a}`
    expect(reward.issued_count).toBe(1)
  })

  it('โควตาหมดแล้วตกไปใช้ผลลัพธ์อันดับถัดไป', async () => {
    const s = await seed(sql, { participants: 2, quotaA: 0 })
    const out = await playAndApply(sql, {
      participantId: s.participantIds[0], activityId: s.activityId, campaignId: s.campaignId,
      periodKey: '2026-08-14', playToken: `t-${Date.now()}-q`, configVersionId: s.configVersionId,
      ranked: [candidate('a', s.cardIds.win_a, 'reward_a'), candidate('b', s.cardIds.win_b, 'reward_b')],
    })
    if ('exhausted' in out) throw new Error('unexpected')
    expect(out.result.outcome_id).toBe('b')
  })

  it('หมดทุกตัว คืน exhausted และไม่กินสิทธิ์เล่นของวันนั้น', async () => {
    const s = await seed(sql, { quotaA: 0, quotaB: 0 })
    const args = {
      participantId: s.participantIds[0], activityId: s.activityId, campaignId: s.campaignId,
      periodKey: '2026-08-14', playToken: `t-${Date.now()}-e`, configVersionId: s.configVersionId,
      ranked: [candidate('a', s.cardIds.win_a, 'reward_a'), candidate('b', s.cardIds.win_b, 'reward_b')],
    }
    const out = await playAndApply(sql, args)
    expect(out).toMatchObject({ exhausted: true })

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM play_lock WHERE participant_id = ${s.participantIds[0]}`
    expect(Number(count)).toBe(0)
  })

  it('ยิง 50 คำขอพร้อมกันบนโควตา 10 → ออกพอดี 10 ใบ', async () => {
    const s = await seed(sql, { participants: 50, quotaA: 10, quotaB: 0 })

    const results = await Promise.all(
      s.participantIds.map((pid, i) =>
        playAndApply(sql, {
          participantId: pid, activityId: s.activityId, campaignId: s.campaignId,
          periodKey: '2026-08-14', playToken: `race-${Date.now()}-${i}`,
          configVersionId: s.configVersionId,
          ranked: [candidate('a', s.cardIds.win_a, 'reward_a')],
        }),
      ),
    )

    const won = results.filter((r) => !('exhausted' in r)).length
    const missed = results.filter((r) => 'exhausted' in r).length

    expect(won).toBe(10)
    expect(missed).toBe(40)

    const [reward] = await sql<{ issued_count: number; quota: number }[]>`
      SELECT issued_count, quota FROM reward WHERE id = ${s.rewardIds.reward_a}`
    expect(reward.issued_count).toBe(10)
    expect(reward.issued_count).toBeLessThanOrEqual(reward.quota)

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM entitlement WHERE reward_id = ${s.rewardIds.reward_a}`
    expect(Number(count)).toBe(10)
  })

  it('จุดปลดล็อกถูกรายงานกลับในรอบเดียวกับที่ค่าสะสมข้ามเส้น', async () => {
    const s = await seed(sql)
    const args = {
      participantId: s.participantIds[0], activityId: s.activityId, campaignId: s.campaignId,
      playToken: '', configVersionId: s.configVersionId,
      ranked: [candidate('a', s.cardIds.win_a)],
    }
    // 25 → 50 ข้ามจุด 50 ในรอบที่สอง
    const first = await playAndApply(sql, { ...args, periodKey: 'd1', playToken: `m1-${Date.now()}` })
    const second = await playAndApply(sql, { ...args, periodKey: 'd2', playToken: `m2-${Date.now()}` })

    if ('exhausted' in first || 'exhausted' in second) throw new Error('unexpected')
    expect(first.result.granted).toEqual([])
    expect(second.result.granted).toEqual([{ milestone: 50, effects: [] }])
  })

  it('นับจำนวนครั้งที่เล่นสะสมข้ามวัน', async () => {
    const s = await seed(sql)
    for (const day of ['d1', 'd2', 'd3']) {
      await playAndApply(sql, {
        participantId: s.participantIds[0], activityId: s.activityId, campaignId: s.campaignId,
        periodKey: day, playToken: `p-${day}-${Date.now()}`, configVersionId: s.configVersionId,
        ranked: [candidate('a', s.cardIds.win_a)],
      })
    }
    const [row] = await sql<{ play_count: number }[]>`
      SELECT play_count FROM participant_activity
       WHERE participant_id = ${s.participantIds[0]} AND activity_id = ${s.activityId}`
    expect(row.play_count).toBe(3)
  })
})

describe('toSqlEffect · buildRanked', () => {
  it('แปลงชื่อช่องเป็น snake_case ให้ตรงกับที่ SQL อ่าน', () => {
    expect(toSqlEffect({ type: 'add_units', counterCode: 'food', amount: 2 }))
      .toEqual({ type: 'add_units', counter_code: 'food', amount: 2 })
    expect(toSqlEffect({ type: 'grant_reward', rewardCode: 'x' }))
      .toEqual({ type: 'grant_reward', reward_code: 'x' })
  })

  it('ทุกผลลัพธ์พา effect ของตัวเองไปด้วย', () => {
    const built = buildRanked(
      [{ id: 'a', cardId: 'c1', rewardCode: 'ra' }, { id: 'b', cardId: 'c2', rewardCode: 'rb' }],
      (o) => [{ type: 'grant_reward', rewardCode: o.rewardCode! }],
    )
    expect(built[0].effects).toEqual([{ type: 'grant_reward', reward_code: 'ra' }])
    expect(built[1].effects).toEqual([{ type: 'grant_reward', reward_code: 'rb' }])
  })
})

describe('quiz engine schema', () => {
  it('personality_quiz activity with resolve_method=NULL succeeds', async () => {
    const s = await seed(sql)
    const [activity] = await sql<{ id: string }[]>`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, fallback_card_id)
      VALUES (${s.campaignId}, 'personality_q', 'Personality Quiz', 'personality_quiz', NULL, ${s.cardIds.fallback})
      RETURNING id`
    expect(activity.id).toBeDefined()
  })

  it('personality_quiz activity with resolve_method set fails CHECK', async () => {
    const s = await seed(sql)
    let error: Error | null = null
    try {
      await sql`
        INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, fallback_card_id)
        VALUES (${s.campaignId}, 'personality_q2', 'Personality Quiz', 'personality_quiz', 'fixed', ${s.cardIds.fallback})`
    } catch (e) {
      error = e as Error
    }
    expect(error).toBeDefined()
    expect(error?.message).toContain('new row for relation "activity" violates check constraint')
  })

  it('quiz_pair with participant_a = participant_b fails CHECK', async () => {
    const s = await seed(sql)
    let error: Error | null = null
    try {
      await sql`
        INSERT INTO quiz_pair (activity_id, participant_a, participant_b, result_code, scores)
        VALUES (${s.activityId}, ${s.participantIds[0]}, ${s.participantIds[0]}, 'tie', '{"a":0,"b":0}'::jsonb)`
    } catch (e) {
      error = e as Error
    }
    expect(error).toBeDefined()
    expect(error?.message).toContain('new row for relation "quiz_pair" violates check constraint')
  })

  it('quiz_group_member round-trips a frozen snapshot', async () => {
    const s = await seed(sql)
    const [group] = await sql<{ id: string }[]>`
      INSERT INTO quiz_group (activity_id, created_by) VALUES (${s.activityId}, ${s.participantIds[0]})
      RETURNING id`
    await sql`
      INSERT INTO quiz_group_member (group_id, participant_id, top_axis, axis_scores)
      VALUES (${group.id}, ${s.participantIds[0]}, 'ei', '{"ei":3,"sn":-1}'::jsonb)`
    const [member] = await sql<{ top_axis: string; axis_scores: Record<string, number> }[]>`
      SELECT top_axis, axis_scores FROM quiz_group_member WHERE group_id = ${group.id}`
    expect(member.top_axis).toBe('ei')
    expect(member.axis_scores).toEqual({ ei: 3, sn: -1 })
  })
})
