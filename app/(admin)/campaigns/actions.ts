'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'

/** รหัสสั้นที่แนบไปกับ postback ทุกปุ่ม (BR-33) — ตัวพิมพ์เล็กและขีดล่าง ไม่เกิน 20 */
const CODE_PATTERN = /^[a-z0-9_]{1,20}$/

/**
 * สร้างแคมเปญร่าง · ตรวจสิทธิ์เองก่อนทำอย่างอื่นเสมอ
 *
 * The screen hides the form from anyone who is not a configurator, but the form
 * is not the door — this function is, and it is reachable by anyone who can name
 * it. The owner is taken from the session for the same reason: every field of a
 * FormData is written by whoever sent it.
 *
 * The code is checked here as well as by the table's CHECK constraint. The
 * constraint is what guarantees it; this is what turns a violation into a
 * sentence the person filling in the form can act on.
 */
export async function createCampaign(formData: FormData): Promise<void> {
  const session = await requireRole('configurator')

  const name = String(formData.get('name') ?? '').trim()
  const code = String(formData.get('code') ?? '').trim()
  const endAt = String(formData.get('end_at') ?? '')

  if (!name) throw new Error('ต้องมีชื่อแคมเปญ')
  if (!CODE_PATTERN.test(code)) throw new Error('รหัสใช้ได้แค่ a-z 0-9 และขีดล่าง ยาวไม่เกิน 20 ตัว')
  // บังคับมี (BR-29) — เป็นจุดเริ่มนับของสถิติและของการลบข้อมูล ไม่มีค่าเริ่มต้นให้เดา
  if (!endAt) throw new Error('ต้องระบุวันจบแคมเปญ')

  await db()`
    INSERT INTO campaign (name, code, start_at, end_at, created_by)
    VALUES (${name}, ${code}, now(), ${endAt}, ${session.userId})`

  revalidatePath('/campaigns')
}
