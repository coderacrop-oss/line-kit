// tests/quiz-liff-routes.integration.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { createLiffApp } from '../lib/db/liffApps'
import type { QuizConfig } from '../lib/quiz/schema'

/**
 * ยิงใส่ route handler ตัวจริงของ Task 7 (app/api/liff/[liffId]/quiz/...) ผ่าน
 * ฐานข้อมูลจริง — ตามรอย tests/webhook-multichannel.integration.test.ts: mock
 * '@/lib/db/client' ให้ db() คืน pool เดียวกับที่เทสต์นี้ seed ข้อมูลเข้าไป (route
 * เรียก db() เอง อ่าน DATABASE_URL ซึ่งเป็นคนละฐานข้อมูลกับ TEST_DATABASE_URL ในเครื่องนี้
 * ถ้าไม่ mock จุดนี้ route จะมองไม่เห็นข้อมูลที่เทสต์เพิ่งสร้าง)
 *
 * fixture (channel + campaign ที่พับลิชแล้ว + liff_app ผูกกับ channel) ตามรอย
 * tests/liff-platform.integration.test.ts ทุกอย่าง ยกเว้นเพิ่มแถว activity
 * (input_type='personality_quiz') แบบเดียวกับ tests/quiz-answers.integration.test.ts
 * / tests/quiz-pairs.integration.test.ts
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
let lineUid: string
const apiKey = 'sk_quiz_liff_test'

const cfg: QuizConfig = {
  mode: 'solo',
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
  results: [
    { code: 'ES', title: 'นักผจญภัย', body: 'บอดี้ ES', imageUrl: 'https://example.com/es.png' },
    { code: 'IN', title: 'นักคิด', body: 'บอดี้ IN' },
  ],
  fallbackResultCode: 'ES',
}

beforeAll(async () => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  sql = testDb(url)

  const tag = randomBytes(4).toString('hex')
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`quizliff-${tag}@example.com`}, 'configurator')
    RETURNING id`
  const lineChannelId = `9${randomBytes(4).readUInt32BE(0)}`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, line_channel_id, created_by)
    VALUES ('Quiz LIFF seed', 'preview', ${lineChannelId}, ${user.id}) RETURNING id`
  channelId = channel.id

  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES ('Quiz LIFF seed', ${`qliff${tag}`}, now(), now() + interval '30 days', ${user.id})
    RETURNING id`
  campaignId = campaign.id
  await sql`
    INSERT INTO campaign_channel (campaign_id, channel_id, is_published, published_at)
    VALUES (${campaignId}, ${channelId}, true, now())`

  activityCode = `quiz${tag}`
  await sql`
    INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
    VALUES (${campaignId}, ${activityCode}, 'Personality quiz', 'personality_quiz', NULL, ${sql.json(cfg as never)})`

  const app = await createLiffApp(sql, {
    name: 'Quiz LIFF', liffId: `2011-${tag}`,
    lineLoginChannelId: '2011037337', channelId, apiKey, createdBy: user.id,
  })
  liffId = app.liffId
  lineUid = `U-quizliff-${tag}`
})

afterAll(async () => {
  await sql`DELETE FROM campaign WHERE id = ${campaignId}`
  await sql`DELETE FROM channel WHERE id = ${channelId}`
  await sql.end()
})

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'X-Line-User-Id': lineUid, ...extra }
}

const { GET } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/route')
const { POST } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/solo/answer/route')

describe('GET /api/liff/[liffId]/quiz/[activityCode]', () => {
  it('returns the public config with no answer key', async () => {
    const request = new Request('https://example.com', { headers: authHeaders() })
    const response = await GET(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.config.mode).toBe('solo')
    expect(body.config).not.toHaveProperty('results')
    expect(body.config).not.toHaveProperty('fallbackResultCode')
    for (const axis of body.config.axes) expect(axis).not.toHaveProperty('poles')
    for (const question of body.config.questions) {
      for (const option of question.options) expect(option).not.toHaveProperty('scores')
    }
  })

  it('returns 404 for an activityCode that does not exist in the channel\'s live campaign', async () => {
    const request = new Request('https://example.com', { headers: authHeaders() })
    const response = await GET(request, { params: Promise.resolve({ liffId, activityCode: 'no-such-quiz' }) })
    expect(response.status).toBe(404)
  })
})

describe('POST .../solo/answer', () => {
  it('returns a computed result for a complete answer set', async () => {
    const request = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [
        { questionId: 'q1', optionId: 'a' },
        { questionId: 'q2', optionId: 'a' },
        { questionId: 'q3', optionId: 'a' },
      ] }),
    })
    const response = await POST(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.resultCode).toBe('ES')
    expect(body.title).toBe('นักผจญภัย')
    expect(body.body).toBe('บอดี้ ES')
    expect(body.imageUrl).toBe('https://example.com/es.png')
    expect(body.axisScores).toEqual({ ei: 4, sn: 4 })
  })

  it('returns 422 for an incomplete answer set', async () => {
    const request = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [{ questionId: 'q1', optionId: 'a' }] }),
    })
    const response = await POST(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 401 with no Authorization header', async () => {
    const request = new Request('https://example.com', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [] }),
    })
    const response = await POST(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(401)
  })
})
