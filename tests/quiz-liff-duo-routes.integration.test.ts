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

const pushMessageMock = vi.fn()
const readChannelSecretMock = vi.fn()

vi.mock('@/lib/line/client', () => ({
  pushMessage: (...args: unknown[]) => pushMessageMock(...args),
}))
vi.mock('@/lib/db/tokens', () => ({
  readChannelSecret: (...args: unknown[]) => readChannelSecretMock(...args),
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

// เลือกคำตอบให้แกนที่ "เด่นที่สุด" (strongestAxis, engine.ts) ของ A กับ B เป็นคนละแกน
// กันโดยตั้งใจ — A: ei=4, sn=-2 → strongest 'ei' · B: ei=-2, sn=4 → strongest 'sn' —
// เพื่อให้ axisMe/axisBuddy ในผลลัพธ์ /duo/match แยกแยะได้จริงว่าใครเป็นใคร ไม่ใช่ค่า
// เดียวกันโดยบังเอิญ (ถ้าตอบ "a" หรือ "b" ล้วนทั้งสามข้อ ei กับ sn จะเท่ากันเป๊ะ tiebreak
// ไปทาง 'ei' เสมอทั้งสองฝั่ง ทำให้เทสต์แยกแยะไม่ออก)
const answersA = [
  { questionId: 'q1', optionId: 'a' },
  { questionId: 'q2', optionId: 'b' },
  { questionId: 'q3', optionId: 'a' },
]
const answersB = [
  { questionId: 'q1', optionId: 'b' },
  { questionId: 'q2', optionId: 'a' },
  { questionId: 'q3', optionId: 'a' },
]

const { POST: postAnswer } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/duo/answer/route')
const { POST: postMatch } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/duo/match/route')
const { GET: getMyPairs } = await import('../app/api/liff/[liffId]/quiz/[activityCode]/duo/my-pairs/route')

let inviterParticipantId: string

describe('duo flow end to end', () => {
  it('A answers, gets a shareUrl containing their own participantId', async () => {
    const request = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(lineUidA), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: answersA }),
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
      body: JSON.stringify({ inviterParticipantId, answers: answersB }),
    })
    const response = await postMatch(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.resultCode).toBe('DUO')
    expect(body.title).toBe('คู่หูควิซ')
    expect(body.body).toBe('บอดี้คู่ DUO')
    expect(body.imageUrl).toBe('https://example.com/duo.png')
    expect(body.axisMe).toBe('sn')
    expect(body.axisBuddy).toBe('ei')
  })

  /**
   * Finding 7 ของรีวิวรอบสุดท้าย · ก่อนแก้ my-pairs คืนแค่ resultCode/title/asA/
   * createdAt (ตามข้อความ plan Task 8 ตรงตัว) — A ไม่มีทางเห็น body/imageUrl/axis
   * เหมือนที่ B เห็นจาก POST .../duo/match เลย ทั้งที่เป็นผลลัพธ์คู่เดียวกัน
   */
  it('A can see the completed pair via GET my-pairs, with the same body/imageUrl/axis B already saw', async () => {
    const request = new Request('https://example.com', { headers: authHeaders(lineUidA) })
    const response = await getMyPairs(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.pairs).toHaveLength(1)
    expect(body.pairs[0].resultCode).toBe('DUO')
    expect(body.pairs[0].title).toBe('คู่หูควิซ')
    expect(body.pairs[0].body).toBe('บอดี้คู่ DUO')
    expect(body.pairs[0].imageUrl).toBe('https://example.com/duo.png')
    expect(body.pairs[0].asA).toBe(true)
    // A's own strongest axis is 'ei' (answersA) · B's is 'sn' (answersB) — ทิศทาง
    // ตรงข้ามกับ axisMe/axisBuddy ที่ B เห็นจาก /duo/match ('sn'/'ei') เพราะฉัน = A แล้ว
    expect(body.pairs[0].axisMe).toBe('ei')
    expect(body.pairs[0].axisBuddy).toBe('sn')
    expect(typeof body.pairs[0].createdAt).toBe('string')
  })

  it('matching against an inviter who never answered returns 404', async () => {
    const request = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(lineUidC), 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviterParticipantId: crypto.randomUUID(), answers: answersB }),
    })
    const response = await postMatch(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  it('matching against yourself returns 400', async () => {
    const request = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(lineUidA), 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviterParticipantId, answers: answersA }),
    })
    const response = await postMatch(request, { params: Promise.resolve({ liffId, activityCode }) })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTruthy()
  })

  it('never attempts a push when the activity has no replies configured', () => {
    expect(pushMessageMock).not.toHaveBeenCalled()
  })
})

describe('duo match notify', () => {
  let notifyActivityCode: string
  let notifyCardId: string

  beforeAll(async () => {
    const tag = randomBytes(4).toString('hex')
    const [card] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code, render_as) VALUES (${campaignId}, ${`notifycard${tag}`}, 'text')
      RETURNING id`
    notifyCardId = card.id
    await sql`
      INSERT INTO card_block (card_id, block_type, sort_order, content)
      VALUES (${notifyCardId}, 'body', 1, 'เพื่อนของคุณตอบครบแล้ว!')`

    notifyActivityCode = `quiznotify${tag}`
    await sql`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config)
      VALUES (${campaignId}, ${notifyActivityCode}, 'Personality quiz duo notify', 'personality_quiz', NULL,
        ${sql.json({ ...cfg, replies: { duoMatchNotifyCardId: notifyCardId } } as never)})`
  })

  it('pushes a notification to the inviter when the match completes', async () => {
    pushMessageMock.mockClear()
    readChannelSecretMock.mockClear()
    readChannelSecretMock.mockResolvedValueOnce('fake-access-token')

    const answerReq = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(`${lineUidA}-notify1`), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: answersA }),
    })
    const answerRes = await postAnswer(answerReq, { params: Promise.resolve({ liffId, activityCode: notifyActivityCode }) })
    expect(answerRes.status).toBe(200)
    const { shareUrl } = await answerRes.json()
    const inviterParticipantId = new URL(shareUrl).searchParams.get('inviterParticipantId')!
    const [inviterRow] = await sql<{ line_uid: string }[]>`SELECT line_uid FROM participant WHERE id = ${inviterParticipantId}`

    const matchReq = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(`${lineUidB}-notify1`), 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviterParticipantId, answers: answersB }),
    })
    const matchRes = await postMatch(matchReq, { params: Promise.resolve({ liffId, activityCode: notifyActivityCode }) })
    expect(matchRes.status).toBe(200)

    expect(pushMessageMock).toHaveBeenCalledTimes(1)
    expect(pushMessageMock).toHaveBeenCalledWith('fake-access-token', inviterRow.line_uid, expect.anything())
    expect(readChannelSecretMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ purpose: 'push_notify' }))
  })

  it('still returns the match result to B even when the push fails', async () => {
    pushMessageMock.mockClear()
    readChannelSecretMock.mockClear()
    readChannelSecretMock.mockResolvedValueOnce('fake-access-token')
    pushMessageMock.mockRejectedValueOnce(new Error('LINE push failed: 500'))

    const answerReq = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(`${lineUidA}-notify2`), 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: answersA }),
    })
    const answerRes = await postAnswer(answerReq, { params: Promise.resolve({ liffId, activityCode: notifyActivityCode }) })
    const { shareUrl } = await answerRes.json()
    const inviterParticipantId = new URL(shareUrl).searchParams.get('inviterParticipantId')!

    const matchReq = new Request('https://example.com', {
      method: 'POST', headers: { ...authHeaders(`${lineUidB}-notify2`), 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviterParticipantId, answers: answersB }),
    })
    const matchRes = await postMatch(matchReq, { params: Promise.resolve({ liffId, activityCode: notifyActivityCode }) })
    expect(matchRes.status).toBe(200)
    const body = await matchRes.json()
    expect(body.resultCode).toBeTruthy()
  })
})
