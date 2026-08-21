// lib/db/liffApps.test.ts
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDb } from './client'
import { createLiffApp, listLiffApps, loadLiffAppByLiffId, verifyLiffApiKey } from './liffApps'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: Awaited<ReturnType<typeof testDb>>
let userId: string
let channelId: string

beforeAll(async () => {
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  sql = testDb(url)
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`liffapps-${randomBytes(4).toString('hex')}@example.com`}, 'configurator')
    RETURNING id`
  userId = user.id
  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (name, channel_type, created_by) VALUES ('Seed', 'preview', ${user.id}) RETURNING id`
  channelId = channel.id
})

afterAll(async () => { await sql.end() })

describe('createLiffApp / loadLiffAppByLiffId', () => {
  it('round-trips a created app, never exposing the api key in the returned shape', async () => {
    const created = await createLiffApp(sql, {
      name: 'ทดสอบ', liffId: `2011-${randomBytes(4).toString('hex')}`,
      lineLoginChannelId: '2011037337', channelId, apiKey: 'sk_test_abc123', createdBy: userId,
    })
    expect(created.apiKeyLast4).toBe('c123')
    expect(Object.keys(created).some((k) => /apiKey$|secret|cipher/i.test(k))).toBe(false)

    const loaded = await loadLiffAppByLiffId(sql, created.liffId)
    expect(loaded).toMatchObject({ id: created.id, name: 'ทดสอบ', channelId })
  })

  it('unknown liffId returns null, not a throw', async () => {
    expect(await loadLiffAppByLiffId(sql, 'no-such-liff-id')).toBeNull()
  })
})

describe('listLiffApps', () => {
  it('includes every created app', async () => {
    const created = await createLiffApp(sql, {
      name: 'รายการ', liffId: `2011-${randomBytes(4).toString('hex')}`,
      lineLoginChannelId: '2011037337', channelId, apiKey: 'sk_test_xyz', createdBy: userId,
    })
    const all = await listLiffApps(sql)
    expect(all.map((a) => a.id)).toContain(created.id)
  })
})

describe('verifyLiffApiKey', () => {
  it('accepts the exact key that was set at creation', async () => {
    const created = await createLiffApp(sql, {
      name: 'กุญแจ', liffId: `2011-${randomBytes(4).toString('hex')}`,
      lineLoginChannelId: '2011037337', channelId, apiKey: 'sk_correct', createdBy: userId,
    })
    expect(await verifyLiffApiKey(sql, created.id, 'sk_correct')).toBe(true)
  })

  it('rejects a wrong key', async () => {
    const created = await createLiffApp(sql, {
      name: 'กุญแจผิด', liffId: `2011-${randomBytes(4).toString('hex')}`,
      lineLoginChannelId: '2011037337', channelId, apiKey: 'sk_correct', createdBy: userId,
    })
    expect(await verifyLiffApiKey(sql, created.id, 'sk_wrong')).toBe(false)
  })

  it('rejects for an unknown liffAppId rather than throwing', async () => {
    expect(await verifyLiffApiKey(sql, '00000000-0000-0000-0000-000000000000', 'anything')).toBe(false)
  })
})
