import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Role } from '../auth/session'
import {
  LAST_CONFIGURATOR_LOCK, ROLE_LABEL, ROLE_ORDER, ROLE_PERMISSIONS, SELF_LOCK,
  countActiveConfigurators, describeLastLogin, isRole, lockReason,
  summarizeUsers, validateTestLineUid, type UserRow,
} from './users'

const NOW = new Date('2026-08-17T09:00:00Z')

const aUser = (patch: Partial<UserRow> = {}): UserRow => ({
  id: 'u1',
  email: 'someone@example.com',
  role: 'content_editor',
  is_active: true,
  test_line_uid: null,
  last_login_at: null,
  has_signed_in: true,
  invited_by_email: 'boss@example.com',
  ...patch,
})

/**
 * บทบาทในโค้ดต้องเป็นชุดเดียวกับที่ CHECK ของคอลัมน์ยอมรับ
 *
 * A role this screen offers that the column refuses is a picker that saves fine
 * until somebody chooses the fourth option; a role the column accepts that this
 * screen does not list is a person whose row cannot be edited from here at all.
 */
describe('บทบาททั้งสาม', () => {
  it('ตรงกับ CHECK ของคอลัมน์ role ใน schema', () => {
    const schema = readFileSync('supabase/migrations/0001_init.sql', 'utf8')
    const match = schema.match(/role\s+TEXT NOT NULL CHECK \(role IN \(([^)]+)\)\)/)
    expect(match, 'หา CHECK ของคอลัมน์ role ไม่เจอ').not.toBeNull()

    const allowed = [...match![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    expect([...ROLE_ORDER].sort()).toEqual(allowed)
  })

  it('ทุกบทบาทมีชื่อไทยและมีบรรทัดบอกว่าทำอะไรได้', () => {
    for (const role of ROLE_ORDER) {
      expect(ROLE_LABEL[role], role).toBeTruthy()
      expect(ROLE_PERMISSIONS.find((row) => row.role === role), `${role} ไม่มีในตารางสิทธิ์`)
        .toBeDefined()
    }
    expect(ROLE_PERMISSIONS).toHaveLength(ROLE_ORDER.length)
  })

  it('isRole ปฏิเสธค่าที่ไม่ใช่บทบาท', () => {
    for (const value of ['', 'admin', 'CONFIGURATOR', 'configurator ', 'owner']) {
      expect(isRole(value), value).toBe(false)
    }
    for (const value of ROLE_ORDER) expect(isRole(value), value).toBe(true)
  })
})

/**
 * สองประตูที่ล็อกตัวเองไว้ไม่ให้ปิดจากข้างใน
 *
 * Both end in a system nobody can administer, which no screen here can climb
 * back out of.
 */
describe('lockReason', () => {
  it('ตัวเองถอนสิทธิ์ตัวเองไม่ได้', () => {
    expect(lockReason(aUser({ id: 'me', role: 'configurator' }), 'me', 5)).toBe(SELF_LOCK)
  })

  it('ตัวเองถอนไม่ได้ แม้จะไม่ใช่ผู้ตั้งค่า', () => {
    expect(lockReason(aUser({ id: 'me', role: 'reporter' }), 'me', 5)).toBe(SELF_LOCK)
  })

  it('ผู้ตั้งค่าคนสุดท้ายถอนไม่ได้', () => {
    expect(lockReason(aUser({ id: 'other', role: 'configurator' }), 'me', 1))
      .toBe(LAST_CONFIGURATOR_LOCK)
  })

  it('ผู้ตั้งค่าคนสุดท้ายที่ถูกถอนไปแล้ว คืนสิทธิ์ได้ ไม่ติดล็อก', () => {
    // แถวที่ถูกถอนแล้วไม่ได้นับเป็นผู้ตั้งค่าที่ยังใช้งานได้ · ปุ่มของมันคือ "คืนสิทธิ์"
    // ซึ่งเป็นทางเดียวที่ระบบที่ไม่เหลือผู้ตั้งค่าเลยจะกลับมามีคนดูแลได้
    expect(lockReason(aUser({ id: 'other', role: 'configurator', is_active: false }), 'me', 0))
      .toBeNull()
  })

  it('มีผู้ตั้งค่าสองคน ถอนคนหนึ่งได้', () => {
    expect(lockReason(aUser({ id: 'other', role: 'configurator' }), 'me', 2)).toBeNull()
  })

  it('คนที่ไม่ใช่ผู้ตั้งค่า ถอนได้แม้จะเหลือผู้ตั้งค่าคนเดียว', () => {
    expect(lockReason(aUser({ id: 'other', role: 'content_editor' }), 'me', 1)).toBeNull()
  })

  it('เหตุผลทั้งสองพูดถึงการลดบทบาทด้วย ไม่ใช่แค่การถอนสิทธิ์', () => {
    // กฎเดียวกันคุมสองปุ่ม · ย้ายผู้ตั้งค่าคนสุดท้ายไปเป็นผู้ดูรายงาน
    // ล็อกระบบได้เท่ากับการถอนสิทธิ์เขา
    for (const reason of [SELF_LOCK, LAST_CONFIGURATOR_LOCK]) {
      expect(reason).toContain('ลดบทบาท')
    }
  })
})

describe('countActiveConfigurators', () => {
  it('นับเฉพาะผู้ตั้งค่าที่ยังใช้งานได้', () => {
    expect(countActiveConfigurators([
      { role: 'configurator', is_active: true },
      { role: 'configurator', is_active: false },
      { role: 'content_editor', is_active: true },
      { role: 'configurator', is_active: true },
    ])).toBe(2)
  })

  it('ไม่มีใครเลย ได้ศูนย์', () => {
    expect(countActiveConfigurators([])).toBe(0)
  })
})

describe('summarizeUsers', () => {
  it('นับผู้ตั้งค่าจากทั้งรายการ ไม่ใช่จากแถวที่กำลังดูอยู่', () => {
    const views = summarizeUsers([
      aUser({ id: 'a', email: 'a@example.com', role: 'configurator' }),
      aUser({ id: 'b', email: 'b@example.com', role: 'configurator' }),
    ], 'zz', NOW)

    expect(views.map((view) => view.lockedReason)).toEqual([null, null])
  })

  it('เหลือผู้ตั้งค่าคนเดียวในรายการ แถวนั้นติดล็อก', () => {
    const views = summarizeUsers([
      aUser({ id: 'a', email: 'a@example.com', role: 'configurator' }),
      aUser({ id: 'b', email: 'b@example.com', role: 'content_editor' }),
    ], 'zz', NOW)

    expect(views[0].lockedReason).toBe(LAST_CONFIGURATOR_LOCK)
    expect(views[1].lockedReason).toBeNull()
  })

  it('แถวของคนที่กำลังดูอยู่ ถูกทำเครื่องหมายว่าเป็นตัวเอง', () => {
    const views = summarizeUsers([aUser({ id: 'me' }), aUser({ id: 'other' })], 'me', NOW)
    expect(views.map((view) => view.isMe)).toEqual([true, false])
  })

  it('เพิ่มอีเมลไว้แต่ยังไม่เคยล็อกอิน ถูกทำเครื่องหมายไว้', () => {
    const views = summarizeUsers([
      aUser({ id: 'a', has_signed_in: false }),
      aUser({ id: 'b', has_signed_in: true }),
    ], 'me', NOW)
    expect(views.map((view) => view.neverSignedIn)).toEqual([true, false])
  })

  it('สถานะเขียนเป็นคำ ไม่ใช่ค่าจริงเท็จ', () => {
    const views = summarizeUsers([
      aUser({ id: 'a', is_active: true }),
      aUser({ id: 'b', is_active: false }),
    ], 'me', NOW)
    expect(views.map((view) => view.statusLabel)).toEqual(['ใช้งานได้', 'ถูกถอนสิทธิ์'])
  })

  it('แถวที่ไม่มีคนเชิญ บอกว่ามาจากตอนติดตั้ง ไม่ใช่ช่องว่าง', () => {
    const [view] = summarizeUsers([aUser({ invited_by_email: null })], 'me', NOW)
    expect(view.invitedByText).toBe('ตั้งไว้ตอนติดตั้งระบบ')
  })
})

describe('describeLastLogin', () => {
  it('ไม่เคยเข้าเลย', () => {
    expect(describeLastLogin(null, NOW)).toBe('ยังไม่เคยเข้าระบบ')
  })

  it('วันนี้ เมื่อวาน และนับวัน', () => {
    expect(describeLastLogin(new Date('2026-08-17T01:00:00Z'), NOW)).toBe('วันนี้')
    expect(describeLastLogin(new Date('2026-08-16T01:00:00Z'), NOW)).toBe('เมื่อวาน')
    expect(describeLastLogin(new Date('2026-08-10T09:00:00Z'), NOW)).toBe('7 วันก่อน')
  })

  it('เกินหนึ่งเดือนบอกเป็นวันที่ เพราะนับวันแล้วนึกไม่ออก', () => {
    expect(describeLastLogin(new Date('2026-01-05T09:00:00Z'), NOW)).toBe('2026-01-05')
  })

  it('เวลาในอนาคตอ่านว่าวันนี้ ไม่ใช่จำนวนวันติดลบ', () => {
    expect(describeLastLogin(new Date('2026-09-01T09:00:00Z'), NOW)).toBe('วันนี้')
  })
})

/**
 * ค่าที่กรอกผิดรูปแบบทำให้การ์ดทดสอบหายไปเงียบๆ
 */
describe('validateTestLineUid', () => {
  const VALID = `U${'0123456789abcdef'.repeat(2)}`

  it('ค่าที่ถูกต้องผ่าน', () => {
    expect(VALID).toHaveLength(33)
    expect(validateTestLineUid(VALID)).toBeNull()
  })

  it('ช่องว่างเปล่าผ่าน · เป็นช่องที่ไม่บังคับ', () => {
    expect(validateTestLineUid('')).toBeNull()
    expect(validateTestLineUid('   ')).toBeNull()
  })

  it('ตัดช่องว่างหัวท้ายก่อนตรวจ · การก๊อปจาก Console มักติดมาด้วย', () => {
    expect(validateTestLineUid(`  ${VALID}\n`)).toBeNull()
  })

  it('รูปแบบที่ไม่ใช่ ไม่ผ่าน', () => {
    for (const value of [
      'U123',                       // สั้นไป
      `${VALID}0`,                  // ยาวไป
      `X${'0123456789abcdef'.repeat(2)}`, // ไม่ได้ขึ้นต้นด้วย U
      `U${'0123456789ABCDEF'.repeat(2)}`, // ตัวพิมพ์ใหญ่
      `U${'0123456789abcdeg'.repeat(2)}`, // มีตัวอักษรนอก a-f
      'someone@example.com',
    ]) {
      expect(validateTestLineUid(value), value).toContain('LINE user id')
    }
  })
})
