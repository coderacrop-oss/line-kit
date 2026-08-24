import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { createLiffApp } from '../lib/db/liffApps'
import { makePorts } from '../lib/db/queries'

/**
 * แยกไฟล์จาก tests/liff-platform.integration.test.ts เพราะ vi.doMock() กลางไฟล์ +
 * dynamic re-import ใช้ไม่ได้ผลจริง — resolveLiffParticipant ถูก import แบบ static
 * ไปแล้วตอนต้นไฟล์นั้น ทำให้กราฟโมดูลของ verifyLiffIdToken ถูกโหลดคงค้างไปแล้วก่อน
 * mock จะมีผล การ mock ที่ scope ของโมดูล (เหมือน lib/liff/auth.test.ts) เท่านั้นที่
 * รับประกันว่าจะไม่มีการยิง network จริงไปหา LINE แต่ทุกอย่างอื่นในเทสต์นี้ยังคง
 * ผ่าน Postgres จริงเหมือนไฟล์พี่น้องของมัน
 */
vi.mock('../lib/line/liffVerify', () => ({ verifyLiffIdToken: vi.fn() }))

const { verifyLiffIdToken } = await import('../lib/line/liffVerify')
const { resolveLiffParticipant } = await import('../lib/liff/auth')

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: postgres.Sql
let channelId: string
let lineChannelId: string
let liffId: string

beforeAll(async () => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  sql = testDb(url)

  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`liffplatform-${randomBytes(4).toString('hex')}@example.com`}, 'configurator')
    RETURNING id`
  lineChannelId = `9${randomBytes(4).readUInt32BE(0)}`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, line_channel_id, created_by)
    VALUES ('Seed', 'preview', ${lineChannelId}, ${user.id}) RETURNING id`
  channelId = channel.id

  const app = await createLiffApp(sql, {
    name: 'Integration', liffId: `2011-${randomBytes(4).toString('hex')}`,
    lineLoginChannelId: '2011037337', channelId, apiKey: 'sk_integration_test_idtoken', createdBy: user.id,
  })
  liffId = app.liffId
})

afterAll(async () => { await sql.end() })

describe('LIFF platform · shared participant identity (id_token path)', () => {
  it('the id_token path resolves to the same participant too, given the same verified LINE userId', async () => {
    const lineUid = `U-shared2-${randomBytes(4).toString('hex')}`
    const webhookParticipantId = await makePorts(sql).ensureParticipant(lineChannelId, lineUid)

    vi.mocked(verifyLiffIdToken).mockResolvedValue({ ok: true, lineUserId: lineUid })

    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer not-the-api-key' } })
    const auth = await resolveLiffParticipant(sql, liffId, request)

    expect(auth.ok).toBe(true)
    if (!auth.ok) return
    expect(auth.participantId).toBe(webhookParticipantId)
  })
})
