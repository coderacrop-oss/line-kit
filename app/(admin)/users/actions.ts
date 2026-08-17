'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require'
import { getSession } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import {
  ROLE_LABEL, SELF_LOCK, countActiveConfigurators, isRole, lockReason, validateTestLineUid,
} from '@/lib/db/users'
import type { Role } from '@/lib/auth/session'

/** พอจะบอกได้ว่าเป็นอีเมล · การตรวจจริงคือคนนั้นล็อกอิน Google ด้วยที่อยู่นี้ได้ */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

type TargetRow = { id: string; email: string; role: Role; is_active: boolean }

/**
 * อ่านแถวเป้าหมายพร้อมจำนวนผู้ตั้งค่าที่ยังใช้งานได้ ในการอ่านครั้งเดียว
 *
 * The count has to be read in the same breath as the row, because the rule being
 * checked is about the two together: this row is only the last configurator
 * relative to how many others there are right now.
 */
async function loadTarget(id: string) {
  const sql = db()
  const rows = await sql<TargetRow[]>`
    SELECT id, email, role, is_active FROM app_user`
  const target = rows.find((row) => row.id === id)
  if (!target) throw new Error('ไม่พบผู้ใช้คนนี้')
  return { sql, target, activeConfigurators: countActiveConfigurators(rows) }
}

/**
 * เพิ่มคนเข้าทีม · ผู้ตั้งค่าแคมเปญเท่านั้น
 *
 * There is no invitation to send and nothing for the new person to accept. The
 * allowlist is checked on every request (BR-23), so the row being here is the
 * whole of the permission — they sign in with Google next time and they are in.
 *
 * The address is stored lowercased because that is how it will be compared.
 * `resolveUser` matches on `lower(email)`, and a row stored with capitals would
 * be found by the lookup but shown on this screen in a form that does not match
 * what the person types, which is a difference somebody eventually acts on.
 */
export async function addUser(formData: FormData): Promise<void> {
  const session = await requireRole('configurator')
  const sql = db()

  const email = trimmed(formData, 'email').toLowerCase()
  const role = trimmed(formData, 'role')

  if (!EMAIL_PATTERN.test(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง')
  if (!isRole(role)) throw new Error('ต้องเลือกบทบาทให้คนที่เพิ่มเข้ามา')

  const [existing] = await sql<{ role: Role; is_active: boolean }[]>`
    SELECT role, is_active FROM app_user WHERE lower(email) = ${email}`
  if (existing) {
    // แถวที่ถูกถอนสิทธิ์ยังอยู่ตรงนั้น · ทางกลับเข้ามาคือกดคืนสิทธิ์ ไม่ใช่เพิ่มซ้ำ
    throw new Error(existing.is_active
      ? `อีเมลนี้มีอยู่แล้ว · สิทธิ์ปัจจุบัน: ${ROLE_LABEL[existing.role]}`
      : 'อีเมลนี้เคยอยู่ในทีมและถูกถอนสิทธิ์ไว้ — กดคืนสิทธิ์ที่แถวของเขาแทนการเพิ่มใหม่')
  }

  await sql`
    INSERT INTO app_user (email, role, invited_by) VALUES (${email}, ${role}, ${session.userId})`

  revalidatePath('/users')
}

/**
 * เปลี่ยนบทบาท · มีผลทันทีในคำขอถัดไปของคนนั้น
 *
 * Refused for the same two cases as a revocation, because a demotion has the
 * same effect: moving the last configurator to a smaller role leaves nobody who
 * can move them back.
 */
export async function setUserRole(formData: FormData): Promise<void> {
  const session = await requireRole('configurator')

  const id = trimmed(formData, 'id')
  const role = trimmed(formData, 'role')
  if (!isRole(role)) throw new Error('บทบาทนี้ไม่มีอยู่จริง')

  const { sql, target, activeConfigurators } = await loadTarget(id)

  // คนที่เรียกได้ต้องเป็นผู้ตั้งค่าอยู่แล้ว · การเปลี่ยนบทบาทตัวเองจึงเป็นการลดตัวเอง
  // ทุกทาง ไม่ว่าจะเลือกอะไร
  if (target.id === session.userId) throw new Error(SELF_LOCK)

  // ย้ายคนอื่นขึ้นมาเป็นผู้ตั้งค่าไม่ทำให้ใครถูกล็อกออก · ด่านอยู่ที่ขาลง
  if (role !== 'configurator') {
    const locked = lockReason(target, session.userId, activeConfigurators)
    if (locked) throw new Error(locked)
  }

  await sql`UPDATE app_user SET role = ${role} WHERE id = ${target.id}`
  revalidatePath('/users')
}

/**
 * ถอนสิทธิ์ หรือคืนสิทธิ์ · ไม่เคยลบแถว
 *
 * `config_version.published_by` and `export_log.app_user_id` are NOT NULL
 * references to this table, and neither has ON DELETE SET NULL. Deleting a row
 * would either be refused by the database or, if somebody added a cascade to
 * make the refusal go away, would erase the record of who published a version
 * that is still live on somebody's OA. A publish history with a missing name
 * answers nothing — the question it exists to answer is who did this.
 *
 * So the row stays and `is_active` goes false. `getSession` re-reads the
 * allowlist on every request, so the person is out on their next click rather
 * than when their cookie happens to expire.
 */
export async function setUserActive(formData: FormData): Promise<void> {
  const session = await requireRole('configurator')

  const id = trimmed(formData, 'id')
  const active = trimmed(formData, 'active') === 'true'

  const { sql, target, activeConfigurators } = await loadTarget(id)

  // คืนสิทธิ์ไม่ทำให้ใครถูกล็อกออก · ด่านมีไว้กันการปิดประตูบานสุดท้าย
  if (!active) {
    const locked = lockReason(target, session.userId, activeConfigurators)
    if (locked) throw new Error(locked)
  }

  await sql`UPDATE app_user SET is_active = ${active} WHERE id = ${target.id}`
  revalidatePath('/users')
}

/**
 * ตั้ง LINE user id ของตัวเองไว้รับการ์ดทดสอบ
 *
 * Always writes the signed-in person's own row. The id is taken from the session
 * and never from the form, so nobody can point a colleague's test card at their
 * own phone — which would be a way to read a card that is still a secret,
 * silently, from a screen that says nothing happened.
 *
 * Any role may set their own. A test card is sent to the person's own device and
 * carries no permission with it, and the reporter who cannot edit a card is
 * still somebody who might need to look at one.
 */
export async function saveTestLineUid(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session) throw new Error('ต้องเข้าสู่ระบบก่อน')

  const raw = trimmed(formData, 'test_line_uid')
  const invalid = validateTestLineUid(raw)
  if (invalid) throw new Error(invalid)

  await db()`
    UPDATE app_user SET test_line_uid = ${raw === '' ? null : raw} WHERE id = ${session.userId}`

  revalidatePath('/users')
}
