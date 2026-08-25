// tests/quiz-groups.integration.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDb } from '../lib/db/client'
import { createQuizGroup, joinQuizGroup } from '../lib/db/quizGroups'
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

  it('rejects joining a group that does not exist', async () => {
    await expect(joinQuizGroup(sql, cfg, activityId, crypto.randomUUID(), participantA)).rejects.toThrow('ไม่พบกลุ่มนี้')
  })
})
