// tests/quiz-answers.integration.test.ts
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDb } from '../lib/db/client'
import { loadQuizAnswers, saveQuizAnswers } from '../lib/db/quizAnswers'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: Awaited<ReturnType<typeof testDb>>
let channelId: string
let campaignId: string
let activityId: string
let participantId: string

beforeAll(async () => {
  sql = testDb(url)
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`quiz-${randomBytes(4).toString('hex')}@example.com`}, 'configurator')
    RETURNING id`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, created_by) VALUES ('Quiz answers seed', 'preview', ${user.id}) RETURNING id`
  channelId = channel.id
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('Quiz answers seed', ${`qa${randomBytes(4).toString('hex')}`}, now(), now() + interval '30 days', ${user.id})
    RETURNING id`
  campaignId = campaign.id
  const [activity] = await sql<{ id: string }[]>`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method)
    VALUES (${campaignId}, ${`quiz${randomBytes(4).toString('hex')}`}, 'Personality quiz', 'personality_quiz', NULL)
    RETURNING id`
  activityId = activity.id
  const [participant] = await sql<{ id: string }[]>`
    INSERT INTO participant (channel_id, line_uid) VALUES (${channelId}, ${`U-${randomBytes(4).toString('hex')}`}) RETURNING id`
  participantId = participant.id
})

afterAll(async () => {
  await sql`DELETE FROM activity WHERE id = ${activityId}`
  await sql`DELETE FROM channel WHERE id = ${channelId}`
  await sql.end()
})

describe('saveQuizAnswers / loadQuizAnswers', () => {
  it('round-trips answers', async () => {
    await saveQuizAnswers(sql, activityId, participantId, [
      { questionId: 'q1', optionId: 'a' },
      { questionId: 'q2', optionId: 'b' },
    ])
    const loaded = await loadQuizAnswers(sql, activityId, participantId)
    expect(loaded).toHaveLength(2)
    expect(loaded).toContainEqual({ questionId: 'q1', optionId: 'a' })
  })

  it('re-saving overwrites the previous answer for the same question (no completion lock)', async () => {
    await saveQuizAnswers(sql, activityId, participantId, [{ questionId: 'q1', optionId: 'a' }])
    await saveQuizAnswers(sql, activityId, participantId, [{ questionId: 'q1', optionId: 'b' }])
    const loaded = await loadQuizAnswers(sql, activityId, participantId)
    expect(loaded.filter((a) => a.questionId === 'q1')).toEqual([{ questionId: 'q1', optionId: 'b' }])
  })

  it('returns an empty array for a participant who never answered', async () => {
    const loaded = await loadQuizAnswers(sql, activityId, randomUUID())
    expect(loaded).toEqual([])
  })
})
