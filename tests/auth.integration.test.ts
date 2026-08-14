import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { classify, type UserRow } from '../lib/auth/session'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})
afterAll(async () => { await sql?.end({ timeout: 5 }) })

async function lookup(email: string) {
  const [row] = await sql<UserRow[]>`
    SELECT id, email, role, is_active FROM app_user WHERE lower(email) = lower(${email})`
  return classify(row, email)
}

/**
 * The allowlist against a real table.
 *
 * The pure classify() tests cover the branches; this covers the one thing they
 * cannot — that the query finds the row it is supposed to find, including when
 * the address is typed in a different case from the one stored.
 */
describe('รายชื่อที่อนุญาต · ฐานข้อมูลจริง', () => {
  it('อีเมลที่อยู่ในรายชื่อและเปิดใช้งาน เข้าได้พร้อม role', async () => {
    const tag = `ok-${Date.now()}@example.com`
    await sql`INSERT INTO app_user (email, role) VALUES (${tag}, 'configurator')`
    expect(await lookup(tag)).toMatchObject({ email: tag, role: 'configurator' })
  })

  it('อีเมลที่ไม่มีในรายชื่อ เข้าไม่ได้', async () => {
    expect(await lookup(`ghost-${Date.now()}@example.com`)).toMatchObject({ reason: 'not_on_list' })
  })

  it('อีเมลที่ถูกถอนสิทธิ์ เข้าไม่ได้ และแยกจากคนที่ไม่รู้จัก', async () => {
    const tag = `revoked-${Date.now()}@example.com`
    await sql`INSERT INTO app_user (email, role, is_active) VALUES (${tag}, 'reporter', false)`
    expect(await lookup(tag)).toEqual({ reason: 'revoked', email: tag })
  })

  it('พิมพ์ตัวใหญ่มา ก็ยังเจอแถวเดิม', async () => {
    const tag = `Case-${Date.now()}@Example.com`
    await sql`INSERT INTO app_user (email, role) VALUES (${tag.toLowerCase()}, 'content_editor')`
    expect(await lookup(tag.toUpperCase())).toMatchObject({ role: 'content_editor' })
  })

  it('ถอนสิทธิ์ไม่ลบแถว — ประวัติที่อ้างถึงคนนี้ยังตอบได้', async () => {
    const tag = `keep-${Date.now()}@example.com`
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO app_user (email, role) VALUES (${tag}, 'configurator') RETURNING id`
    await sql`UPDATE app_user SET is_active = false WHERE id = ${user.id}`

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM app_user WHERE id = ${user.id}`
    expect(Number(count)).toBe(1)
  })
})
