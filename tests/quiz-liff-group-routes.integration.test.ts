// tests/quiz-liff-group-routes.integration.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { createLiffApp } from '../lib/db/liffApps'
import { matchQuizPair } from '../lib/db/quizPairs'
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
let activityCodeNoGroup: string
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

// Same activity, but group mode not enabled — covers the 404 gate that both routes
// must apply BEFORE calling into lib/db/quizGroups.ts (checked ahead of any answer
// lookup, independent of whether the caller has answered).
const cfgNoGroup: QuizConfig = { ...cfg, group: undefined }

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

  activityCodeNoGroup = `quizgrpx${tag}`
  await sql`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
    VALUES (${campaignId}, ${activityCodeNoGroup}, 'Personality quiz no group', 'personality_quiz', NULL, ${sql.json(cfgNoGroup as never)})`

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
const { POST: postDuoAnswer } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/duo/answer/route')
const { GET: getGroup } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/route')
const { POST: postAddPairs } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/add-pairs/route')

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

  it('create and join both 404 when group mode is not enabled for the activity', async () => {
    const createResponse = await postCreate(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode: activityCodeNoGroup }) },
    )
    expect(createResponse.status).toBe(404)
    const createBody = await createResponse.json()
    expect(createBody.error).toBe('ควิซนี้ไม่เปิดผลลัพธ์กลุ่ม')

    const joinResponse = await postJoin(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode: activityCodeNoGroup, groupId: crypto.randomUUID() }) },
    )
    expect(joinResponse.status).toBe(404)
    const joinBody = await joinResponse.json()
    expect(joinBody.error).toBe('ควิซนี้ไม่เปิดผลลัพธ์กลุ่ม')
  })
})

describe('group get + add-pairs', () => {
  it('GET reflects live composition, amIMember, and canJoin', async () => {
    await answerSolo(lineUidA)
    const { groupId } = await (await postCreate(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode }) },
    )).json()

    const asCreator = await getGroup(
      new Request('https://example.com', { headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    expect(asCreator.status).toBe(200)
    const creatorBody = await asCreator.json()
    expect(creatorBody.groupId).toBe(groupId)
    expect(creatorBody.totalMembers).toBe(1)
    expect(creatorBody.result).toBeNull() // minMembers is 2
    expect(creatorBody.amIMember).toBe(true)
    expect(creatorBody.canJoin).toBe(false) // already a member

    await answerSolo(lineUidC)
    const asStranger = await getGroup(
      new Request('https://example.com', { headers: authHeaders(lineUidC) }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    const strangerBody = await asStranger.json()
    expect(strangerBody.amIMember).toBe(false)
    expect(strangerBody.canJoin).toBe(true)
  })

  it('GET returns 404 for a group id that does not exist', async () => {
    await answerSolo(lineUidA)
    const response = await getGroup(
      new Request('https://example.com', { headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode, groupId: crypto.randomUUID() }) },
    )
    expect(response.status).toBe(404)
  })

  it('add-pairs by the creator adds a real duo partner, then GET shows 2 members and a result', async () => {
    // reuse the duo flow (Task 6/7 of the original quiz-engine plan) to get a real quiz_pair —
    // this cfg is solo-mode for create/join but duo pairing is orthogonal to it (Global Constraints)
    const duoResponse = await postDuoAnswer(
      new Request('https://example.com', {
        method: 'POST', headers: { ...authHeaders(lineUidA), 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: [{ questionId: 'q1', optionId: 'a' }] }),
      }),
      { params: Promise.resolve({ liffId, activityCode }) },
    )
    // duo/answer requires config.mode === 'duo', but this fixture's cfg.mode is 'solo' — expect
    // a 400 here confirms group and duo really are independent; get a real quiz_pair a different
    // way instead: call matchQuizPair (lib/db/quizPairs.ts) directly. It never checks cfg.mode —
    // duo pairing and this fixture's group config are simply two unrelated features of the same
    // activity — so this produces a real, correctly-computed quiz_pair row without going through
    // a route that only exists for mode: 'duo' activities.
    expect(duoResponse.status).toBe(400)

    await answerSolo(lineUidA)
    await answerSolo(lineUidB)
    const { groupId } = await (await postCreate(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode }) },
    )).json()

    const [activityRow] = await sql<{ id: string }[]>`SELECT id FROM activity WHERE code = ${activityCode} AND campaign_id = ${campaignId}`
    const [participantRowA] = await sql<{ id: string }[]>`SELECT id FROM participant WHERE line_uid = ${lineUidA}`
    const [participantRowB] = await sql<{ id: string }[]>`SELECT id FROM participant WHERE line_uid = ${lineUidB}`
    const { pair } = await matchQuizPair(sql, cfg, activityRow.id, participantRowA.id, participantRowB.id, [{ questionId: 'q1', optionId: 'b' }])

    const addResponse = await postAddPairs(
      new Request('https://example.com', {
        method: 'POST', headers: { ...authHeaders(lineUidA), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairIds: [pair.id] }),
      }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    expect(addResponse.status).toBe(200)
    const addBody = await addResponse.json()
    expect(addBody.added).toBe(1)

    const finalView = await getGroup(
      new Request('https://example.com', { headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    const finalBody = await finalView.json()
    expect(finalBody.totalMembers).toBe(2)
    expect(finalBody.result?.code).toBe('fallback')
  })

  it('add-pairs by a non-creator returns 403', async () => {
    await answerSolo(lineUidA)
    const { groupId } = await (await postCreate(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode }) },
    )).json()

    await answerSolo(lineUidB)
    const response = await postAddPairs(
      new Request('https://example.com', {
        method: 'POST', headers: { ...authHeaders(lineUidB), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairIds: [crypto.randomUUID()] }),
      }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    expect(response.status).toBe(403)
  })

  it('add-pairs returns 422 when pairIds is missing or empty', async () => {
    await answerSolo(lineUidA)
    const { groupId } = await (await postCreate(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode }) },
    )).json()

    const missingResponse = await postAddPairs(
      new Request('https://example.com', {
        method: 'POST', headers: { ...authHeaders(lineUidA), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    expect(missingResponse.status).toBe(422)

    const emptyResponse = await postAddPairs(
      new Request('https://example.com', {
        method: 'POST', headers: { ...authHeaders(lineUidA), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairIds: [] }),
      }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    expect(emptyResponse.status).toBe(422)
  })

  it('add-pairs returns 422 when pairIds is longer than group.maxMembers (2)', async () => {
    await answerSolo(lineUidA)
    const { groupId } = await (await postCreate(
      new Request('https://example.com', { method: 'POST', headers: authHeaders(lineUidA) }),
      { params: Promise.resolve({ liffId, activityCode }) },
    )).json()

    const tooManyResponse = await postAddPairs(
      new Request('https://example.com', {
        method: 'POST', headers: { ...authHeaders(lineUidA), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairIds: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] }),
      }),
      { params: Promise.resolve({ liffId, activityCode, groupId }) },
    )
    expect(tooManyResponse.status).toBe(422)
  })
})
