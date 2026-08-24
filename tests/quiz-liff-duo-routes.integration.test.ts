// tests/quiz-liff-duo-routes.integration.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { createLiffApp } from '../lib/db/liffApps'
import type { QuizConfig } from '../lib/quiz/schema'

/**
 * เหมือน tests/quiz-liff-routes.integration.test.ts ทุกอย่าง (mock '@/lib/db/client'
 * ให้ db() คืน pool เดียวกับที่เทสต์นี้ seed ข้อมูลเข้าไป) แต่ fixture เป็นควิซโหมด
 * duo และมีผู้เล่นสองคน (สอง LINE user จริง) — ยิงผ่าน API key ตัวเดียวกัน แยกตัวตน
 * ด้วย header X-Line-User-Id คนละค่า ตามรอย tests/liff-platform-idtoken.integration.test.ts
 * ที่ทดสอบสองทาง auth (ในนี้ใช้ทาง API key ทั้งคู่ เพราะทาง id_token ต้องยิง network
 * จริงไปหา LINE — mock ไว้ต่างหากถ้าจำเป็น)
 */
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
const apiKey = 'sk_quiz_liff_duo_test'

const cfg: QuizConfig = {
  mode: 'duo',
  axes: [
    { id: 'ei', label: 'E/I', poles: ['E', 'I'] },
    { id: 'sn', label: 'S/N', poles: ['S', 'N'] },
  ],
  questions: [
    { id: 'q1', text: 'ข้อ 1', options: [
      { id: 'a', label: 'A', scores: { ei: 3, sn: 0 } },
      { id: 'b', label: 'B', scores: { ei: -3, sn: 0 } },
    ] },
    { id: 'q2', text: 'ข้อ 2', options: [
      { id: 'a', label: 'A', scores: { ei: 0, sn: 3 } },
      { id: 'b', label: 'B', scores: { ei: 0, sn: -3 } },
    ] },
    { id: 'q3', text: 'ข้อ 3', options: [
      { id: 'a', label: 'A', scores: { ei: 1, sn: 1 } },
      { id: 'b', label: 'B', scores: { ei: -1, sn: -1 } },
    ] },
  ],
  // ไม่ใส่ `pair` ในกฎแรกโดยตั้งใจ — matchPair() (engine.ts, Task 3) ถือว่า rule ที่
  // ไม่มี `pair` เป็น catch-all ที่ชนะทันทีไม่ว่า axisA/axisB จะเป็นอะไร ทำให้ผลลัพธ์
  // คาดเดาได้แน่นอน · เทสต์นี้เช็คการเดินสาย route ของ Task 8 ไม่ใช่กฎจับคู่ของ Task 3/6
  // (ซึ่งมีเทสต์ของตัวเองอยู่แล้วใน quiz-pairs.integration.test.ts)
  results: [
    { code: 'DUO', title: 'คู่หูควิซ', body: 'บอดี้คู่ DUO', imageUrl: 'https://example.com/duo.png' },
    { code: 'FALLBACK', title: 'คู่ทั่วไป', body: 'บอดี้ fallback' },
  ],
  fallbackResultCode: 'DUO',
}

beforeAll(async () => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  sql = testDb(url)

  const tag = randomBytes(4).toString('hex')
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`quizliffduo-${tag}@example.com`}, 'configurator')
    RETURNING id`
  const lineChannelId = `9${randomBytes(4).readUInt32BE(0)}`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, line_channel_id, created_by)
    VALUES ('Quiz LIFF duo seed', 'preview', ${lineChannelId}, ${user.id}) RETURNING id`
  channelId = channel.id

  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('Quiz LIFF duo seed', ${`qliffduo${tag}`}, now(), now() + interval '30 days', ${user.id})
    RETURNING id`
  campaignId = campaign.id
  await sql`
    INSERT INTO campaign_channel (campaign_id, channel_id, is_published, published_at)
    VALUES (${campaignId}, ${channelId}, true, now())`

  activityCode = `quizduo${tag}`
  await sql`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
    VALUES (${campaignId}, ${activityCode}, 'Personality quiz duo', 'personality_quiz', NULL, ${sql.json(cfg as never)})`

  const app = await createLiffApp(sql, {
    name: 'Quiz LIFF duo', liffId: `2011-${tag}`,
    lineLoginChannelId: '2011037337', channelId, apiKey, createdBy: user.id,
  })
  liffId = app.liffId
  lineUidA = `U-quizliffduo-a-${tag}`
  lineUidB = `U-quizliffduo-b-${tag}`
  lineUidC = `U-quizliffduo-c-${tag}`
})

afterAll(async () => {
  await sql`DELETE FROM campaign WHERE id = ${campaignId}`
  await sql`DELETE FROM channel WHERE id = ${channelId}`
  await sql.end()
})

function authHeaders(lineUid: string, extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'X-Line-User-Id': lineUid, ...extra }
}

const answersAllA = [
  { questionId: 'q1', optionId: 'a' },
  { questionId: 'q2', optionId: 'a' },
  { questionId: 'q3', optionId: 'a' },
]
const answersAllB = [
  { questionId: 'q1', optionId: 'b' },
  { questionId: 'q2', optionId: 'b' },
  { questionId: 'q3', optionId: 'b' },
]

const { POST: postAnswer } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/duo/answer/route')
const { POST: postMatch } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/duo/match/route')
const { GET: getMyPairs } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/duo/my-pairs/route')

let inviterParticipantId: string

describe('duo flow end to end', () => {
  it('A answers, gets a shareUrl containing their own participantId', async () => {
    const request = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(lineUidA), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: answersAllA }),
    })
    const response = await postAnswer(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.shareUrl).toContain(`https://liff.line.me/${liffId}`)
    expect(body.shareUrl).toContain(`activityCode=${activityCode}`)
    expect(body.shareUrl).toMatch(/inviterParticipantId=([^&]+)/)
    inviterParticipantId = new URL(body.shareUrl).searchParams.get('inviterParticipantId')!
    expect(inviterParticipantId).toBeTruthy()
  })

  it('B matches against A\'s shareUrl and gets a combined result', async () => {
    const request = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(lineUidB), 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviterParticipantId, answers: answersAllB }),
    })
    const response = await postMatch(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.resultCode).toBe('DUO')
    expect(body.title).toBe('คู่หูควิซ')
    expect(body.body).toBe('บอดี้คู่ DUO')
    expect(body.imageUrl).toBe('https://example.com/duo.png')
    expect(body.axisMe).toBe('IN')
    expect(body.axisBuddy).toBe('ES')
  })

  it('A can see the completed pair via GET my-pairs', async () => {
    const request = new Request('https://example.com', { headers: authHeaders(lineUidA) })
    const response = await getMyPairs(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.pairs).toHaveLength(1)
    expect(body.pairs[0].resultCode).toBe('DUO')
    expect(body.pairs[0].title).toBe('คู่หูควิซ')
    expect(body.pairs[0].asA).toBe(true)
    expect(typeof body.pairs[0].createdAt).toBe('string')
  })

  it('matching against an inviter who never answered returns 404', async () => {
    const request = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(lineUidC), 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviterParticipantId: crypto.randomUUID(), answers: answersAllB }),
    })
    const response = await postMatch(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  it('matching against yourself returns 400', async () => {
    const request = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(lineUidA), 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviterParticipantId, answers: answersAllA }),
    })
    const response = await postMatch(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })
})
