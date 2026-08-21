import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDb } from './client'
import { ensureParticipantByChannelId } from './participants'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: Awaited<ReturnType<typeof testDb>>
let channelId: string

beforeAll(async () => {
  sql = testDb(url)
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`participants-${randomBytes(4).toString('hex')}@example.com`}, 'configurator')
    RETURNING id`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, created_by) VALUES ('Seed', 'preview', ${user.id}) RETURNING id`
  channelId = channel.id
})

afterAll(async () => { await sql.end() })

describe('ensureParticipantByChannelId', () => {
  it('creates a participant on first contact', async () => {
    const id = await ensureParticipantByChannelId(sql, channelId, 'U-first')
    const [row] = await sql`SELECT channel_id, line_uid FROM participant WHERE id = ${id}`
    expect(row.channel_id).toBe(channelId)
    expect(row.line_uid).toBe('U-first')
  })

  it('returns the same participant id on repeat contact from the same line_uid', async () => {
    const first = await ensureParticipantByChannelId(sql, channelId, 'U-repeat')
    const second = await ensureParticipantByChannelId(sql, channelId, 'U-repeat')
    expect(second).toBe(first)
  })

  it('bumps last_seen_at on repeat contact', async () => {
    const id = await ensureParticipantByChannelId(sql, channelId, 'U-seen')
    const [before] = await sql`SELECT last_seen_at FROM participant WHERE id = ${id}`
    await new Promise((r) => setTimeout(r, 10))
    await ensureParticipantByChannelId(sql, channelId, 'U-seen')
    const [after] = await sql`SELECT last_seen_at FROM participant WHERE id = ${id}`
    expect(new Date(after.last_seen_at).getTime()).toBeGreaterThan(new Date(before.last_seen_at).getTime())
  })
})
