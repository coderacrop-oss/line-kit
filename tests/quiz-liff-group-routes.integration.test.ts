// tests/quiz-liff-group-routes.integration.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { createLiffApp } from '../lib/db/liffApps'
import type { QuizConfig } from '../lib/quiz/schema'

let sql: postgres.Sql

vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db/client')>()),
  db: () => sql,
}))

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let channelId: string
let campaignId: string
let liffId: string
let activityCode: string
let lineUidA: string
let lineUidB: string
let lineUidC: string
const apiKey = 'sk_quiz_liff_group_test'

// NOTE: the task brief's fixture config had 1 axis / 1 question / 1 result, which
// fails the real QuizConfig schema built in Task 2 (axes.min(2), questions.min(3),
// results.min(2)). Expanded here to the schema minimums while preserving the same
// test intent (solo mode, group enabled, minMembers/maxMembers 2).
const cfg: QuizConfig = {
  mode: 'solo',
  axes: [{ id: 'ei', label: 'E/I', poles: ['E', 'I'] }, { id: 'sn', label: 'S/N', poles: ['S', 'N'] }],
  questions: [
    { id: 'q1', text: 'q1', options: [
      { id: 'a', label: 'A', scores: { ei: 3 } },
      { id: 'b', label: 'B', scores: { ei: -3 } },
    ] },
    { id: 'q2', text: 'q2', options: [
      { id: 'a', label: 'A', scores: { ei: 3 } },
      { id: 'b', label: 'B', scores: { ei: -3 } },
    ] },
    { id: 'q3', text: 'q3', options: [
      { id: 'a', label: 'A', scores: { sn: 3 } },
      { id: 'b', label: 'B', scores: { sn: -3 } },
    ] },
  ],
  results: [{ code: 'E', title: 't', body: 'b' }, { code: 'I', title: 't', body: 'b' }],
  fallbackResultCode: 'E',
  group: {
    enabled: true, minMembers: 2, maxMembers: 2, resultLocksAt: 0,
    archetypes: [{ code: 'fallback', title: 't', body: 'b', minGroupSize: 2, fallback: true }],
    fallbackArchetype: 'fallback',
  },
}

beforeAll(async () => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  sql = testDb(url)

  const tag = randomBytes(4).toString('hex')
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`quizliffgroup-${tag}@example.com`}, 'configurator')
    RETURNING id`
  const lineChannelId = `9${randomBytes(4).readUInt32BE(0)}`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, line_channel_id, created_by)
    VALUES ('Quiz LIFF group seed', 'preview', ${lineChannelId}, ${user.id}) RETURNING id`
  channelId = channel.id

  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('Quiz LIFF group seed', ${`qliffgrp${tag}`}, now(), now() + interval '30 days', ${user.id})
    RETURNING id`
  campaignId = campaign.id
  await sql`
    INSERT INTO campaign_channel (campaign_id, channel_id, is_published, published_at)
    VALUES (${campaignId}, ${channelId}, true, now())`

  activityCode = `quizgrp${tag}`
  await sql`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
    VALUES (${campaignId}, ${activityCode}, 'Personality quiz group', 'personality_quiz', NULL, ${sql.json(cfg as never)})`

  const app = await createLiffApp(sql, {
    name: 'Quiz LIFF group', liffId: `2012-${tag}`,
    lineLoginChannelId: '2012037337', channelId, apiKey, createdBy: user.id,
  })
  liffId = app.liffId
  lineUidA = `U-quizliffgroup-a-${tag}`
  lineUidB = `U-quizliffgroup-b-${tag}`
  lineUidC = `U-quizliffgroup-c-${tag}`
})

afterAll(async () => {
  await sql`DELETE FROM campaign WHERE id = ${campaignId}`
  await sql`DELETE FROM channel WHERE id = ${channelId}`
  await sql.end()
})

function authHeaders(lineUid: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'X-Line-User-Id': lineUid }
}

const { POST: postSoloAnswer } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/solo/answer/route')
const { POST: postCreate } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/group/create/route')
const { POST: postJoin } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/join/route')

async function answerSolo(lineUid: string): Promise<void> {
  const request = new Request('https://example.com', {
    method: 'POST', headers: { ...authHeaders(lineUid), 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: [
      { questionId: 'q1', optionId: 'a' },
      { questionId: 'q2', optionId: 'a' },
      { questionId: 'q3', optionId: 'a' },
    ] }),
  })
  const response = await postSoloAnswer(request, { params: Promise.resolve({ liffId, activityCode }) })
  expect(response.status).toBe(200)
}

describe('group create + join', () => {
  it('rejects create when the caller never answered', async () => {
    const request = new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidC) })
    const response = await postCreate(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(400)
  })

  it('creates a group and returns a shareUrl containing the groupId', async () => {
    await answerSolo(lineUidA)
    const request = new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) })
    const response = await postCreate(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.groupId).toBeTruthy()
    expect(body.shareUrl).toContain(`https://liff.line.me/${liffId}`)
    expect(body.shareUrl).toContain(`groupId=${body.groupId}`)
  })

  it('B joins via the groupId from the shareUrl', async () => {
    await answerSolo(lineUidA)
    const createRequest = new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) })
    const createResponse = await postCreate(createRequest, { params: Promise.resolve({ liffId, activityCode }) })
    const { groupId } = await createResponse.json()

    await answerSolo(lineUidB)
    const joinRequest = new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidB) })
    const joinResponse = await postJoin(joinRequest, { params: Promise.resolve({ liffId, activityCode, groupId }) })
    expect(joinResponse.status).toBe(200)
    const joinBody = await joinResponse.json()
    expect(joinBody.ok).toBe(true)
  })

  it('join fails with 400 once the group is full (max_members is 2 in this fixture)', async () => {
    await answerSolo(lineUidA)
    const createRequest = new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) })
    const { groupId } = await (await postCreate(createRequest, { params: Promise.resolve({ liffId, activityCode }) })).json()

    await answerSolo(lineUidB)
    await postJoin(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidB) }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )

    await answerSolo(lineUidC)
    const response = await postJoin(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidC) }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    expect(response.status).toBe(400)
  })

  it('join returns 404 for a group id that does not exist', async () => {
    await answerSolo(lineUidC)
    const response = await postJoin(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidC) }),
      { params: Promise.resolve({ liffId, activityCode, groupId: crypto.randomUUID() }) },
    )
    expect(response.status).toBe(404)
  })
})
