// tests/quiz-groups.integration.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDb } from '../lib/db/client'
import { addPairsToQuizGroup, createQuizGroup, getQuizGroup, joinQuizGroup } from '../lib/db/quizGroups'
import { matchQuizPair } from '../lib/db/quizPairs'
import { saveQuizAnswers } from '../lib/db/quizAnswers'
import type { QuizConfig } from '../lib/quiz/schema'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: Awaited<ReturnType<typeof testDb>>
let channelId: string
let activityId: string
let participantA: string
let participantB: string
let participantC: string

const cfg: QuizConfig = {
  mode: 'solo',
  axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }],
  questions: [{ id: 'q1', text: 'q1', options: [
    { id: 'a', label: 'A', scores: { ei: 3 } },
    { id: 'b', label: 'B', scores: { ei: -3 } },
  ] }],
  results: [{ code: 'E', title: 't', body: 'b' }],
  fallbackResultCode: 'E',
  group: {
    enabled: true, minMembers: 2, maxMembers: 3, resultLocksAt: 0,
    archetypes: [{ code: 'fallback', title: 't', body: 'b', minGroupSize: 2, fallback: true }],
    fallbackArchetype: 'fallback',
  },
}

beforeAll(async () => {
  sql = testDb(url)
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`quizgroup-${randomBytes(4).toString('hex')}@example.com`}, 'configurator')
    RETURNING id`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, created_by) VALUES ('Quiz groups seed', 'preview', ${user.id}) RETURNING id`
  channelId = channel.id
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('Quiz groups seed', ${`qg${randomBytes(4).toString('hex')}`}, now(), now() + interval '30 days', ${user.id})
    RETURNING id`
  const [activity] = await sql<{ id: string }[]>`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method)
    VALUES (${campaign.id}, ${`quizg${randomBytes(4).toString('hex')}`}, 'Group quiz', 'personality_quiz', NULL)
    RETURNING id`
  activityId = activity.id
  const ids: string[] = []
  for (let i = 0; i < 3; i++) {
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO participant (channel_id, line_uid) VALUES (${channelId}, ${`U-${randomBytes(4).toString('hex')}`}) RETURNING id`
    ids.push(p.id)
  }
  ;[participantA, participantB, participantC] = ids
})

afterAll(async () => {
  await sql`DELETE FROM activity WHERE id = ${activityId}`
  await sql`DELETE FROM channel WHERE id = ${channelId}`
  await sql.end()
})

describe('createQuizGroup', () => {
  it('rejects when the creator has not answered yet', async () => {
    await expect(createQuizGroup(sql, cfg, activityId, participantA)).rejects.toThrow('ยังไม่ได้ตอบควิซ')
  })

  it('creates the group with the creator as its first member', async () => {
    await saveQuizAnswers(sql, activityId, participantA, [{ questionId: 'q1', optionId: 'a' }])
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    expect(groupId).toBeTruthy()
    const members = await sql`SELECT participant_id, top_axis FROM quiz_group_member WHERE group_id = ${groupId}`
    expect(members).toHaveLength(1)
    expect(members[0].participant_id).toBe(participantA)
    expect(members[0].top_axis).toBe('ei')
  })
})

describe('joinQuizGroup', () => {
  it('rejects when the joiner has not answered yet', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    await expect(joinQuizGroup(sql, cfg, activityId, groupId, participantB)).rejects.toThrow('ยังไม่ได้ตอบควิซ')
  })

  it('adds a second member', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    await saveQuizAnswers(sql, activityId, participantB, [{ questionId: 'q1', optionId: 'b' }])
    await joinQuizGroup(sql, cfg, activityId, groupId, participantB)
    const members = await sql`SELECT participant_id FROM quiz_group_member WHERE group_id = ${groupId}`
    expect(members).toHaveLength(2)
  })

  it('is idempotent — joining a group you are already in does not duplicate the row', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    await joinQuizGroup(sql, cfg, activityId, groupId, participantA)
    const members = await sql`SELECT participant_id FROM quiz_group_member WHERE group_id = ${groupId}`
    expect(members).toHaveLength(1)
  })

  it('rejects once the group reaches max_members (3, per this test\'s cfg)', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    await joinQuizGroup(sql, cfg, activityId, groupId, participantB)
    await saveQuizAnswers(sql, activityId, participantC, [{ questionId: 'q1', optionId: 'a' }])
    await joinQuizGroup(sql, cfg, activityId, groupId, participantC)
    const [pFourth] = await sql<{ id: string }[]>`
      INSERT INTO participant (channel_id, line_uid) VALUES (${channelId}, ${`U-${randomBytes(4).toString('hex')}`}) RETURNING id`
    await saveQuizAnswers(sql, activityId, pFourth.id, [{ questionId: 'q1', optionId: 'a' }])
    await expect(joinQuizGroup(sql, cfg, activityId, groupId, pFourth.id)).rejects.toThrow('กลุ่มนี้เต็มแล้ว')
  })

  it('holds the max_members cap under real concurrent joins (not just sequential ones)', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    // cfg in this file has maxMembers: 3 — seat 1 is participantA (creator).
    // Create enough fresh participants + saved answers to race for the remaining 2 seats.
    const joiners: string[] = []
    for (let i = 0; i < 5; i++) {
      const [p] = await sql<{ id: string }[]>`
        INSERT INTO participant (channel_id, line_uid) VALUES (${channelId}, ${`U-${randomBytes(4).toString('hex')}`}) RETURNING id`
      await saveQuizAnswers(sql, activityId, p.id, [{ questionId: 'q1', optionId: 'a' }])
      joiners.push(p.id)
    }

    const results = await Promise.allSettled(joiners.map((p) => joinQuizGroup(sql, cfg, activityId, groupId, p)))
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length
    expect(fulfilled).toBe(2) // only 2 more seats available (maxMembers 3 - creator's 1)

    const members = await sql`SELECT participant_id FROM quiz_group_member WHERE group_id = ${groupId}`
    expect(members).toHaveLength(3) // never exceeds maxMembers, even under real concurrency
  })

  it('rejects joining a group that does not exist', async () => {
    await expect(joinQuizGroup(sql, cfg, activityId, crypto.randomUUID(), participantA)).rejects.toThrow('ไม่พบกลุ่มนี้')
  })
})

describe('getQuizGroup', () => {
  it('returns null for a group that does not exist', async () => {
    expect(await getQuizGroup(sql, cfg, activityId, crypto.randomUUID())).toBeNull()
  })

  it('result is null until minMembers is reached, then reflects live composition', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    const soloView = await getQuizGroup(sql, cfg, activityId, groupId)
    expect(soloView?.totalMembers).toBe(1)
    expect(soloView?.result).toBeNull() // minMembers is 2

    await saveQuizAnswers(sql, activityId, participantB, [{ questionId: 'q1', optionId: 'a' }])
    await joinQuizGroup(sql, cfg, activityId, groupId, participantB)
    const pairView = await getQuizGroup(sql, cfg, activityId, groupId)
    expect(pairView?.totalMembers).toBe(2)
    expect(pairView?.result?.code).toBe('fallback')
    expect(pairView?.isLocked).toBe(false)
  })

  it('locks the result once resultLocksAt is reached, and stops recomputing after', async () => {
    const lockingCfg: QuizConfig = { ...cfg, group: { ...cfg.group!, minMembers: 2, resultLocksAt: 2 } }
    const { groupId } = await createQuizGroup(sql, lockingCfg, activityId, participantA)
    await saveQuizAnswers(sql, activityId, participantC, [{ questionId: 'q1', optionId: 'a' }])
    await joinQuizGroup(sql, lockingCfg, activityId, groupId, participantC)

    const locked = await getQuizGroup(sql, lockingCfg, activityId, groupId)
    expect(locked?.isLocked).toBe(true)
    expect(locked?.result?.code).toBe('fallback')

    const [row] = await sql<{ locked_archetype_code: string }[]>`
      SELECT locked_archetype_code FROM quiz_group WHERE id = ${groupId}`
    expect(row.locked_archetype_code).toBe('fallback')
  })
})

describe('addPairsToQuizGroup', () => {
  it('rejects when the caller is not the group creator', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    await expect(addPairsToQuizGroup(sql, cfg, activityId, groupId, participantB, ['whatever']))
      .rejects.toThrow('ไม่ใช่ผู้สร้างกลุ่มนี้')
  })

  it('adds the duo partner (not the creator) from a real quiz_pair, computing topAxis via strongestAxis', async () => {
    const duoCfg: QuizConfig = { ...cfg, mode: 'duo', results: [{ code: 'PAIR', title: 't', body: 'b' }], fallbackResultCode: 'PAIR' }
    const pair = await matchQuizPair(sql, duoCfg, activityId, participantA, participantB, [{ questionId: 'q1', optionId: 'b' }])

    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    const result = await addPairsToQuizGroup(sql, cfg, activityId, groupId, participantA, [pair.id])
    expect(result.added).toBe(1)
    const members = await sql`SELECT participant_id FROM quiz_group_member WHERE group_id = ${groupId} AND participant_id = ${participantB}`
    expect(members).toHaveLength(1)
  })

  it('silently skips a pairId that does not belong to this activity/creator', async () => {
    const { groupId } = await createQuizGroup(sql, cfg, activityId, participantA)
    const result = await addPairsToQuizGroup(sql, cfg, activityId, groupId, participantA, [crypto.randomUUID()])
    expect(result.added).toBe(0)
  })
})
