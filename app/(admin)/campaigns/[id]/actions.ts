'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'

/** ต้นแบบกำหนดต่ำสุดไว้ที่นี่ · ต่ำกว่านี้ผู้เล่นกดรัวจนไม่มีอะไรจำกัดอีกต่อไป */
const MIN_DAY_LENGTH_SEC = 10
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

type CurrentRow = {
  status: string
  name: string
  timezone: string
  day_length_sec: number
  start_at: Date
  theme: Record<string, string> | null
}

/**
 * ค่าที่ฟอร์มส่งมาจริงๆ · null แปลว่าไม่ได้ส่งมา ไม่ใช่ส่งมาว่าง
 *
 * A disabled input submits nothing at all, and the two cases mean opposite
 * things: a field that was not submitted must keep whatever the row already
 * holds, while a field submitted empty is someone clearing it on purpose and
 * has to be judged on its own.
 */
function given(formData: FormData, key: string): string | null {
  return formData.has(key) ? String(formData.get(key) ?? '').trim() : null
}

/**
 * บันทึกข้อมูลแคมเปญ · ตรวจสิทธิ์ ตรวจสถานะ แล้วค่อยเขียน
 *
 * A published campaign refuses edits here (BR-05) rather than only in the form.
 * The screen disables its fields, but a disabled field is a drawing on a page
 * that whoever calls this function may never have loaded.
 *
 * Everything the form did not send falls back to the row's current value instead
 * of to a default. Reading an absent field as "use the default" is how a
 * campaign in Asia/Tokyo silently becomes one in Asia/Bangkok the first time
 * somebody fixes a typo in its name.
 */
export async function saveCampaignInfo(id: string, formData: FormData): Promise<void> {
  await requireRole('configurator')
  const sql = db()

  const [current] = await sql<CurrentRow[]>`
    SELECT status, name, timezone, day_length_sec, start_at, theme
      FROM campaign WHERE id = ${id}`
  if (!current) throw new Error('ไม่พบแคมเปญนี้')

  // BR-05 · กติกาที่ส่งขึ้นแล้วห้ามแก้ ต้องสร้าง version ใหม่
  if (current.status === 'published') {
    throw new Error('แคมเปญนี้ส่งขึ้นแล้ว แก้กติกาไม่ได้ — ถอนก่อนแก้ หรือก๊อปเป็นแคมเปญใหม่')
  }

  const name = given(formData, 'name') ?? current.name
  if (!name) throw new Error('ต้องมีชื่อแคมเปญ')

  const endAt = given(formData, 'end_at') ?? ''
  // บังคับมี (BR-29) — เป็นจุดเริ่มนับของสถิติและของการลบข้อมูล
  if (!endAt) throw new Error('ต้องระบุวันจบแคมเปญ')
  if (new Date(endAt).getTime() <= current.start_at.getTime()) {
    throw new Error('วันจบต้องอยู่หลังวันเริ่ม')
  }

  // ช่องนี้อ่านอย่างเดียวในหน้าจอ (BR-04) จึงมักไม่ถูกส่งมา
  const timezone = given(formData, 'timezone') || current.timezone

  const dayLengthRaw = given(formData, 'day_length_sec')
  const dayLengthSec = dayLengthRaw === null ? current.day_length_sec : Number(dayLengthRaw)
  if (
    dayLengthRaw === '' || !Number.isInteger(dayLengthSec) || dayLengthSec < 0
    || (dayLengthSec > 0 && dayLengthSec < MIN_DAY_LENGTH_SEC)
  ) {
    throw new Error(`ความยาวของหนึ่งวันต้องเป็นจำนวนเต็ม ${MIN_DAY_LENGTH_SEC} วินาทีขึ้นไป หรือ 0 เพื่อจำกัดตลอดแคมเปญ`)
  }

  const primary = given(formData, 'theme_primary')
  if (primary !== null && primary !== '' && !HEX_COLOUR.test(primary)) {
    throw new Error('สีธีมต้องเป็นรหัสสีหกหลัก เช่น #17756A')
  }
  // เขียนทับ theme ทั้งก้อน จึงต้องรวมของเดิมเข้าไป ไม่งั้นสีอื่นหายทุกครั้งที่บันทึก
  const theme = primary ? { ...(current.theme ?? {}), primary } : (current.theme ?? {})

  await sql`
    UPDATE campaign SET
      name = ${name},
      timezone = ${timezone},
      day_length_sec = ${dayLengthSec},
      end_at = ${endAt},
      theme = ${sql.json(theme as never)}
     WHERE id = ${id}`

  revalidatePath(`/campaigns/${id}`)
  revalidatePath('/campaigns')
}
