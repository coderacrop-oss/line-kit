// tests/quiz-pairs.integration.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDb } from '../lib/db/client'
import { findQuizPair, listQuizPairsForParticipant, matchQuizPair } from '../lib/db/quizPairs'
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
  mode: 'duo',
  axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }],
  questions: [{ id: 'q1', text: 'q1', options: [
    { id: 'a', label: 'A', scores: { ei: 3 } },
    { id: 'b', label: 'B', scores: { ei: -3 } },
  ] }],
  results: [{ code: 'EE', title: 't', body: 'b', pair: ['ei', 'ei'] }],
  fallbackResultCode: 'EE',
}

beforeAll(async () => {
  sql = testDb(url)
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`quizpair-${randomBytes(4).toString('hex')}@example.com`}, 'configurator')
    RETURNING id`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, created_by) VALUES ('Quiz pairs seed', 'preview', ${user.id}) RETURNING id`
  channelId = channel.id
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('Quiz pairs seed', ${`qp${randomBytes(4).toString('hex')}`}, now(), now() + interval '30 days', ${user.id})
    RETURNING id`
  const [activity] = await sql<{ id: string }[]>`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method)
    VALUES (${campaign.id}, ${`quizp${randomBytes(4).toString('hex')}`}, 'Duo quiz', 'personality_quiz', NULL)
    RETURNING id`
  activityId = activity.id
  const [pA] = await sql<{ id: string }[]>`
    INSERT INTO participant (channel_id, line_uid) VALUES (${channelId}, ${`U-${randomBytes(4).toString('hex')}`}) RETURNING id`
  const [pB] = await sql<{ id: string }[]>`
    INSERT INTO participant (channel_id, line_uid) VALUES (${channelId}, ${`U-${randomBytes(4).toString('hex')}`}) RETURNING id`
  const [pC] = await sql<{ id: string }[]>`
    INSERT INTO participant (channel_id, line_uid) VALUES (${channelId}, ${`U-${randomBytes(4).toString('hex')}`}) RETURNING id`
  participantA = pA.id
  participantB = pB.id
  participantC = pC.id
})

afterAll(async () => {
  await sql`DELETE FROM activity WHERE id = ${activityId}`
  await sql`DELETE FROM channel WHERE id = ${channelId}`
  await sql.end()
})

describe('matchQuizPair', () => {
  it('rejects when the inviter has not answered yet', async () => {
    await expect(matchQuizPair(sql, cfg, activityId, participantA, participantB, [
      { questionId: 'q1', optionId: 'a' },
    ])).rejects.toThrow()
  })

  it('rejects self-pairing', async () => {
    await saveQuizAnswers(sql, activityId, participantA, [{ questionId: 'q1', optionId: 'a' }])
    await expect(matchQuizPair(sql, cfg, activityId, participantA, participantA, [
      { questionId: 'q1', optionId: 'a' },
    ])).rejects.toThrow()
  })

  it('creates the pair, saves B\'s answers, and returns the computed result', async () => {
    const pair = await matchQuizPair(sql, cfg, activityId, participantA, participantB, [
      { questionId: 'q1', optionId: 'a' },
    ])
    expect(pair.resultCode).toBe('EE')
    expect(pair.participantA).toBe(participantA)
    expect(pair.participantB).toBe(participantB)

    const found = await findQuizPair(sql, activityId, participantA, participantB)
    expect(found?.id).toBe(pair.id)
  })

  it('is idempotent — matching the same pair again returns the same row, no duplicate', async () => {
    const first = await matchQuizPair(sql, cfg, activityId, participantA, participantB, [
      { questionId: 'q1', optionId: 'a' },
    ])
    const second = await matchQuizPair(sql, cfg, activityId, participantA, participantB, [
      { questionId: 'q1', optionId: 'a' },
    ])
    expect(second.id).toBe(first.id)
  })

  // ใช้ participantC ที่ไม่เคยจับคู่กับ A มาก่อน — ถ้าใช้ participantB ตามที่ทดสอบ
  // ไว้ก่อนหน้า แถว quiz_pair ของ (A,B) มีอยู่แล้ว ทำให้เช็ค findQuizPair ก่อนเปิด
  // transaction (idempotency pre-check) ดักคืนค่าได้เลยทั้งสอง request โดยไม่มี
  // ฝั่งไหนเข้าไปแข่ง INSERT ในธุรกรรมจริงเลย ซึ่งจะทำให้เทสต์นี้ผ่านได้แม้
  // implementation ที่ไม่ได้ห่อ transaction จริงก็ตาม — เสียจุดประสงค์ของเทสต์นี้
  it('two concurrent match attempts for a brand-new pair produce exactly one quiz_pair row', async () => {
    const [r1, r2] = await Promise.allSettled([
      matchQuizPair(sql, cfg, activityId, participantA, participantC, [{ questionId: 'q1', optionId: 'a' }]),
      matchQuizPair(sql, cfg, activityId, participantA, participantC, [{ questionId: 'q1', optionId: 'a' }]),
    ])
    expect(r1.status).toBe('fulfilled')
    expect(r2.status).toBe('fulfilled')
    const rows = await sql`SELECT id FROM quiz_pair WHERE activity_id = ${activityId}
      AND participant_a = ${participantA} AND participant_b = ${participantC}`
    expect(rows).toHaveLength(1)
  })
})

describe('listQuizPairsForParticipant', () => {
  it('finds a pair whether the participant is side A or side B', async () => {
    const asA = await listQuizPairsForParticipant(sql, activityId, participantA)
    const asB = await listQuizPairsForParticipant(sql, activityId, participantB)
    expect(asA.length).toBeGreaterThan(0)
    expect(asB.length).toBeGreaterThan(0)
  })
})
