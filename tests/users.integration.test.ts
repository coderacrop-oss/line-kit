import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { listUsers, loadTestLineUid, summarizeUsers } from '../lib/db/users'
import { seed } from './helpers/seed'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
const tag = () =>
  `u${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

const makeUser = async (patch: {
  role?: string; isActive?: boolean; googleSub?: string | null; invitedBy?: string | null
} = {}) => {
  const email = `${tag()}@example.com`
  const [row] = await sql<{ id: string; email: string }[]>`
    INSERT INTO app_user (email, role, is_active, google_sub, invited_by)
    VALUES (${email}, ${patch.role ?? 'content_editor'}, ${patch.isActive ?? true},
            ${patch.googleSub ?? null}, ${patch.invitedBy ?? null})
    RETURNING id, email`
  return row
}

const find = (rows: Awaited<ReturnType<typeof listUsers>>, id: string) => {
  const row = rows.find((r) => r.id === id)
  if (!row) throw new Error(`user ${id} missing from the list`)
  return row
}

/**
 * คำถามที่ฟังก์ชันบริสุทธิ์ตอบแทนไม่ได้ · ชื่อคอลัมน์มีจริงไหม และ join หาเจอไหม
 */
describe('listUsers · ฐานข้อมูลจริง', () => {
  it('อ่านครบทุกคอลัมน์ที่จอใช้ รวมคนที่ถูกถอนสิทธิ์ไปแล้ว', async () => {
    const inviter = await makeUser({ role: 'configurator', googleSub: `g-${tag()}` })
    const revoked = await makeUser({ isActive: false, invitedBy: inviter.id })

    const rows = await listUsers(sql)
    const row = find(rows, revoked.id)

    expect(row.email).toBe(revoked.email)
    expect(row.is_active).toBe(false)
    expect(row.invited_by_email).toBe(inviter.email)
    expect(row.test_line_uid).toBeNull()
  })

  it('เคยล็อกอินจริงหรือยัง อ่านจากการมี google_sub ไม่ใช่จากคอลัมน์ที่ไม่มีอยู่', async () => {
    const signedIn = await makeUser({ googleSub: `g-${tag()}` })
    const invitedOnly = await makeUser()

    const rows = await listUsers(sql)
    expect(find(rows, signedIn.id).has_signed_in).toBe(true)
    expect(find(rows, invitedOnly.id).has_signed_in).toBe(false)
  })

  // google_sub เป็นตัวระบุของบัญชี Google ของคน · จอนี้ไม่มีที่ใช้ค่านั้น
  it('ไม่ดึงค่า google_sub ออกมาเลย มีแค่ว่ามีหรือไม่มี', async () => {
    const user = await makeUser({ googleSub: `g-${tag()}` })
    const row = find(await listUsers(sql), user.id) as Record<string, unknown>
    expect(Object.keys(row)).not.toContain('google_sub')
  })

  it('คนที่ยังใช้งานได้อยู่บนก่อน แล้วเรียงตามอีเมล', async () => {
    await makeUser({ isActive: false })
    await makeUser()

    const rows = await listUsers(sql)
    const firstRevoked = rows.findIndex((row) => !row.is_active)
    expect(firstRevoked).toBeGreaterThan(0)
    expect(rows.slice(firstRevoked).every((row) => !row.is_active)).toBe(true)
  })

  it('ค่า test_line_uid ที่บันทึกไว้ ถูกอ่านกลับมาให้จอเติมในช่อง', async () => {
    const uid = `U${'0123456789abcdef'.repeat(2)}`
    const user = await makeUser()
    await sql`UPDATE app_user SET test_line_uid = ${uid} WHERE id = ${user.id}`

    const views = summarizeUsers(await listUsers(sql), user.id, new Date())
    expect(views.find((view) => view.isMe)!.testLineUid).toBe(uid)
  })
})

/**
 * เหตุผลที่ถอนสิทธิ์ต้องเป็น UPDATE · ฐานข้อมูลเป็นคนยืนยันเอง
 *
 * The rule that a user row is never deleted is written down in three places and
 * argued for in comments, but the thing that makes it true is a NOT NULL foreign
 * key from the publish history. This proves that key is still there: if somebody
 * later adds ON DELETE CASCADE to make a delete "work", this test goes red rather
 * than the history quietly losing the name of whoever published a version that is
 * still live on a customer's OA.
 */
describe('ลบผู้ใช้ไม่ได้ · ฐานข้อมูลเป็นคนห้าม', () => {
  it('คนที่เคยส่งรุ่นขึ้น ลบแถวไม่ได้ · ฐานข้อมูลปฏิเสธ', async () => {
    const s = await seed(sql)

    await expect(sql`DELETE FROM app_user WHERE id = ${s.userId}`)
      .rejects.toThrow(/foreign key|violates/i)

    const [still] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM app_user WHERE id = ${s.userId}`
    expect(still.n).toBe(1)
  })

  it('ถอนสิทธิ์แล้วแถวยังอยู่ และประวัติยังชี้มาที่ชื่อเดิม', async () => {
    const s = await seed(sql)
    await sql`UPDATE app_user SET is_active = false WHERE id = ${s.userId}`

    const [row] = await sql<{ email: string; is_active: boolean }[]>`
      SELECT u.email, u.is_active FROM config_version v
        JOIN app_user u ON u.id = v.published_by
       WHERE v.id = ${s.configVersionId}`
    expect(row.is_active).toBe(false)
    expect(row.email).toBeTruthy()
  })

  it('คืนสิทธิ์แล้วกลับมาใช้งานได้ · เป็นทางกลับเข้ามาทางเดียว', async () => {
    const user = await makeUser({ isActive: false })
    await sql`UPDATE app_user SET is_active = true WHERE id = ${user.id}`
    expect(find(await listUsers(sql), user.id).is_active).toBe(true)
  })
})

/**
 * loadTestLineUid · สิ่งที่ปุ่มส่งการ์ดทดสอบของ M3-S02 (Task 14) อ่านก่อนยิงอะไรออกไป
 *
 * ต้องอ่านจาก id ที่ส่งเข้ามาตรงๆ เท่านั้น (BR-62) — ไม่มีทางลัดที่อ่านแถวอื่นได้เลย
 */
describe('loadTestLineUid', () => {
  it('คืนค่าที่ตั้งไว้ของบัญชีนั้น', async () => {
    const user = await makeUser()
    const uid = `U${'a'.repeat(32)}`
    await sql`UPDATE app_user SET test_line_uid = ${uid} WHERE id = ${user.id}`

    expect(await loadTestLineUid(sql, user.id)).toBe(uid)
  })

  it('ยังไม่ได้ตั้ง คืน null', async () => {
    const user = await makeUser()
    expect(await loadTestLineUid(sql, user.id)).toBeNull()
  })

  it('อ่านของบัญชีตัวเอง ไม่ใช่ของคนอื่นที่มีค่าตั้งไว้', async () => {
    const owner = await makeUser()
    const somebodyElse = await makeUser()
    await sql`UPDATE app_user SET test_line_uid = ${`U${'b'.repeat(32)}`} WHERE id = ${somebodyElse.id}`

    expect(await loadTestLineUid(sql, owner.id)).toBeNull()
  })

  it('id ที่ไม่มีอยู่จริง คืน null แทนที่จะโยน', async () => {
    expect(await loadTestLineUid(sql, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})
