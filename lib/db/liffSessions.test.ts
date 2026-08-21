// lib/db/liffSessions.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDb } from './client'
import { createLiffApp } from './liffApps'
import {
  findLiffSessionByKey, listLiffSessionsForParticipant, upsertLiffSession,
} from './liffSessions'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: Awaited<ReturnType<typeof testDb>>
let liffAppId: string
let participantA: string
let participantB: string

beforeAll(async () => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  sql = testDb(url)
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`sessions-${randomBytes(4).toString('hex')}@example.com`}, 'configurator')
    RETURNING id`
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, created_by) VALUES ('Seed', 'preview', ${user.id}) RETURNING id`
  const [pA] = await sql<{ id: string }[]>`
    INSERT INTO participant (channel_id, line_uid) VALUES (${channel.id}, 'U-a') RETURNING id`
  const [pB] = await sql<{ id: string }[]>`
    INSERT INTO participant (channel_id, line_uid) VALUES (${channel.id}, 'U-b') RETURNING id`
  participantA = pA.id
  participantB = pB.id
  const app = await createLiffApp(sql, {
    name: 'Sessions test', liffId: `2011-${randomBytes(4).toString('hex')}`,
    lineLoginChannelId: '2011037337', channelId: channel.id, apiKey: 'sk_x', createdBy: user.id,
  })
  liffAppId = app.id
})

afterAll(async () => { await sql.end() })

describe('upsertLiffSession / listLiffSessionsForParticipant', () => {
  it('creates a new row scoped to the given participant when no externalKey exists yet', async () => {
    const created = await upsertLiffSession(sql, {
      liffAppId, participantId: participantA, externalKey: null, data: { score: 1 },
    })
    expect(created.participantId).toBe(participantA)
    expect(created.data).toEqual({ score: 1 })

    const rows = await listLiffSessionsForParticipant(sql, liffAppId, participantA)
    expect(rows.map((r) => r.id)).toContain(created.id)
  })

  it('updates the same row in place when externalKey matches an existing one for this liff_app', async () => {
    const first = await upsertLiffSession(sql, {
      liffAppId, participantId: participantA, externalKey: 'profile', data: { score: 1 },
    })
    const second = await upsertLiffSession(sql, {
      liffAppId, participantId: participantA, externalKey: 'profile', data: { score: 2 },
    })
    expect(second.id).toBe(first.id)
    expect(second.data).toEqual({ score: 2 })
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime())
  })

  it('the same externalKey under a different liff_app is a different row (scoped per app)', async () => {
    const otherApp = await createLiffApp(sql, {
      name: 'Other app', liffId: `2011-${randomBytes(4).toString('hex')}`,
      lineLoginChannelId: '2011037337', channelId: (await sql<{ channel_id: string }[]>`SELECT channel_id FROM liff_app WHERE id = ${liffAppId}`)[0].channel_id,
      apiKey: 'sk_y', createdBy: (await sql<{ created_by: string }[]>`SELECT created_by FROM liff_app WHERE id = ${liffAppId}`)[0].created_by,
    })
    const mine = await upsertLiffSession(sql, {
      liffAppId, participantId: participantA, externalKey: 'shared-key', data: { who: 'first app' },
    })
    const theirs = await upsertLiffSession(sql, {
      liffAppId: otherApp.id, participantId: participantA, externalKey: 'shared-key', data: { who: 'other app' },
    })
    expect(theirs.id).not.toBe(mine.id)
  })
})

describe('findLiffSessionByKey', () => {
  it('finds a row by externalKey regardless of which participant created it', async () => {
    const created = await upsertLiffSession(sql, {
      liffAppId, participantId: participantA, externalKey: 'invite-xyz', data: { from: 'A' },
    })
    const found = await findLiffSessionByKey(sql, liffAppId, 'invite-xyz')
    expect(found?.id).toBe(created.id)
    expect(found?.participantId).toBe(participantA) // B can read it, but it still records A as the owner
  })

  it('returns null for an unknown key rather than throwing', async () => {
    expect(await findLiffSessionByKey(sql, liffAppId, 'never-existed')).toBeNull()
  })
})
