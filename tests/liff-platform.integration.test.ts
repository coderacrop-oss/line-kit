import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { createLiffApp } from '../lib/db/liffApps'
import { makePorts } from '../lib/db/queries'
import { resolveLiffParticipant } from '../lib/liff/auth'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: postgres.Sql
let channelId: string
let lineChannelId: string
let liffId: string
const apiKey = 'sk_integration_test'

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
    lineLoginChannelId: '2011037337', channelId, apiKey, createdBy: user.id,
  })
  liffId = app.liffId
})

afterAll(async () => { await sql.end() })

describe('LIFF platform · shared participant identity', () => {
  it('a player reached via the LIFF API-key path and the same player reached via the webhook path resolve to the same participant', async () => {
    const lineUid = `U-shared-${randomBytes(4).toString('hex')}`

    // เส้นทาง webhook — ผ่าน makePorts().ensureParticipant() ตัวเดียวกับที่ route.ts จริงเรียก
    const webhookParticipantId = await makePorts(sql).ensureParticipant(lineChannelId, lineUid)

    // เส้นทาง LIFF — ผ่าน resolveLiffParticipant() ทาง API key
    const request = new Request('https://example.com', { headers: { Authorization: `Bearer ${apiKey}` } })
    const auth = await resolveLiffParticipant(sql, liffId, request, { lineUserId: lineUid })

    expect(auth.ok).toBe(true)
    if (!auth.ok) return
    expect(auth.participantId).toBe(webhookParticipantId)
  })
})
