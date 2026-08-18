'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import { asCounterMode, loadCounter, mergeEffects } from '@/lib/db/counters'

/** รหัสที่การ์ดเรียกด้วย `{{counter.xxx}}` และกิจกรรมอ้างถึงเป็นข้อความ */
const CODE_PATTERN = /^[a-z0-9_]{1,20}$/

/** รหัสข้อผิดพลาดของ postgres ตอนชน UNIQUE */
const UNIQUE_VIOLATION = '23505'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

/**
 * จำนวนเต็มบวกจากช่องกรอก · คืน null เมื่อไม่ใช่
 *
 * Number('') is 0 and Number('7 วัน') is NaN, and both of those reaching an
 * INTEGER column produce either a target of zero the CHECK refuses or an error
 * spoken in constraint names. The screen would rather say which field is wrong.
 */
function asPositiveInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 1 ? value : null
}

async function requireCampaign(sql: ReturnType<typeof db>, campaignId: string): Promise<void> {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM campaign WHERE id = ${campaignId}`
  if (!row) throw new Error('ไม่พบแคมเปญนี้')
}

type CounterState = { mode: string; code: string; target: number; participant_count: number }

/**
 * ค่าสะสมที่อ้างถึงต้องอยู่ในแคมเปญที่ผูกมากับ action
 *
 * The counter id arrives in the URL, which anybody can type. Without the
 * campaign in the WHERE, every one of these actions would edit another client's
 * counter as happily as its own.
 */
async function requireCounter(
  sql: ReturnType<typeof db>, campaignId: string, counterId: string,
): Promise<CounterState> {
  const [row] = await sql<CounterState[]>`
    SELECT c.mode, c.code, c.target,
           (SELECT count(*) FROM counter_value v WHERE v.counter_id = c.id)::int
             AS participant_count
      FROM counter c WHERE c.id = ${counterId} AND c.campaign_id = ${campaignId}`
  if (!row) throw new Error('ไม่พบค่าสะสมนี้ในแคมเปญนี้')
  return row
}

/**
 * สร้างหรือแก้ค่าสะสมหนึ่งตัว
 *
 * Only a configurator, unlike the asset library. A counter is the rule that
 * decides what a player has to do to win; changing a target after people have
 * started is changing the deal, which is not a content edit.
 *
 * The code cannot be edited after creation. Activities name the counter they
 * feed by code inside a JSONB effect and nothing enforces that reference, so
 * renaming would leave every one of those effects pointing at a counter that no
 * longer exists — and play_and_apply skips an effect whose counter it cannot
 * find, without an error anywhere. The one thing that would report it is this
 * screen, after the fact.
 *
 * Changing the mode once people have accumulated is refused for the same family
 * of reason: the stored numbers do not carry the mode that produced them, so
 * "7" that meant seven days becomes "7" that means seven units, and nothing in
 * the data says which one it is.
 */
export async function saveCounter(
  campaignId: string, counterId: string, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireCampaign(sql, campaignId)

  const name = trimmed(formData, 'name')
  if (!name) throw new Error('ต้องกรอกชื่อค่าสะสม')
  if (name.length > 100) throw new Error('ชื่อค่าสะสมยาวได้ไม่เกิน 100 ตัวอักษร')

  const mode = asCounterMode(trimmed(formData, 'mode'))
  if (!mode) throw new Error('ต้องเลือกวิธีนับ')

  const target = asPositiveInt(trimmed(formData, 'target'))
  if (target === null) throw new Error('เป้าหมายต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป')

  // ช่องกาถูกที่ไม่ได้ติ๊ก ไม่ถูกส่งมาเลย · ไม่ได้ส่งมาเป็น false
  const requireConsecutive = formData.get('require_consecutive') !== null

  let created: string | null = null

  if (counterId) {
    const current = await requireCounter(sql, campaignId, counterId)
    if (current.mode !== mode && current.participant_count > 0) {
      throw new Error(
        `แก้วิธีนับไม่ได้ — มีผู้เล่นสะสมอยู่แล้ว ${current.participant_count} คน`
        + ' ค่าที่สะสมมาจะถูกตีความคนละแบบ โดยไม่มีอะไรบอกว่าแถวไหนนับมาแบบเก่า',
      )
    }

    await sql`
      UPDATE counter
         SET name = ${name}, mode = ${mode}, target = ${target},
             require_consecutive = ${requireConsecutive}
       WHERE id = ${counterId} AND campaign_id = ${campaignId}`
  } else {
    const code = trimmed(formData, 'code')
    if (!CODE_PATTERN.test(code)) {
      throw new Error('รหัสค่าสะสมใช้ได้แค่ a-z 0-9 และขีดล่าง ยาว 1–20 ตัว')
    }

    try {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO counter (campaign_id, code, name, mode, require_consecutive, target)
        VALUES (${campaignId}, ${code}, ${name}, ${mode}, ${requireConsecutive}, ${target})
        RETURNING id`
      created = row.id
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new Error(`แคมเปญนี้มีค่าสะสมรหัส "${code}" อยู่แล้ว — ไปแก้ตัวเดิมแทน`)
      }
      throw error
    }
  }

  revalidatePath(`/campaigns/${campaignId}/counters`)
  // สร้างเสร็จแล้วพาไปตั้งจุดปลดล็อกต่อ · redirect โยนเพื่อเปลี่ยนหน้า จึงอยู่นอก try
  if (created) redirect(`/campaigns/${campaignId}/counters/${created}`)
}

/**
 * ลบค่าสะสม · เหตุผลที่ลบไม่ได้ถูกคิดที่เดียวกับที่จอใช้แสดง
 *
 * The check is repeated here rather than trusted from the page because a page
 * can be a minute old, and a minute is long enough for somebody else to point
 * an activity at this counter. The foreign keys will not help: counter_value
 * cascades, so the database's answer to deleting a counter with a thousand
 * players behind it is to delete their progress too, quietly.
 */
export async function deleteCounter(campaignId: string, counterId: string): Promise<void> {
  await requireRole('configurator')
  const sql = db()

  const found = await loadCounter(sql, campaignId, counterId)
  if (!found) throw new Error('ไม่พบค่าสะสมนี้ในแคมเปญนี้')
  if (!found.counter.canDelete) throw new Error(found.counter.deleteBlockedWhy as string)

  await sql`DELETE FROM counter WHERE id = ${counterId} AND campaign_id = ${campaignId}`
  revalidatePath(`/campaigns/${campaignId}/counters`)
}

/**
 * เพิ่มหรือแก้จุดปลดล็อกหนึ่งจุด
 *
 * The effects arrive as a set of checkboxes, and a set of checkboxes can only
 * speak about the effects this screen offers. mergeEffects keeps everything
 * else in the column exactly as it was, so pressing save here is never a way to
 * delete configuration that was never on screen to begin with.
 */
export async function saveMilestone(
  campaignId: string, counterId: string, milestoneId: string, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireCounter(sql, campaignId, counterId)

  const atValue = asPositiveInt(trimmed(formData, 'at_value'))
  if (atValue === null) throw new Error('ค่าที่ปลดล็อกต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป')

  const chosen = formData.getAll('effect').map((entry) => String(entry))

  try {
    if (milestoneId) {
      const [current] = await sql<{ effects: unknown }[]>`
        SELECT effects FROM counter_milestone
         WHERE id = ${milestoneId} AND counter_id = ${counterId}`
      if (!current) throw new Error('ไม่พบจุดปลดล็อกนี้')

      const effects = mergeEffects(current.effects, chosen)
      await sql`
        UPDATE counter_milestone
           SET at_value = ${atValue}, effects = ${sql.json(effects as never)}
         WHERE id = ${milestoneId} AND counter_id = ${counterId}`
    } else {
      const effects = mergeEffects([], chosen)
      await sql`
        INSERT INTO counter_milestone (counter_id, at_value, effects)
        VALUES (${counterId}, ${atValue}, ${sql.json(effects as never)})`
    }
  } catch (error) {
    // UNIQUE (counter_id, at_value) · สองจุดที่ค่าเดียวกันคือจุดที่สองที่ไม่มีใครเห็น
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new Error(`ค่าสะสมนี้มีจุดปลดล็อกที่ค่า ${atValue} อยู่แล้ว — แต่ละจุดต้องเป็นค่าที่ไม่ซ้ำ`)
    }
    throw error
  }

  revalidatePath(`/campaigns/${campaignId}/counters/${counterId}`)
}

export async function deleteMilestone(
  campaignId: string, counterId: string, milestoneId: string,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireCounter(sql, campaignId, counterId)

  await sql`
    DELETE FROM counter_milestone WHERE id = ${milestoneId} AND counter_id = ${counterId}`
  revalidatePath(`/campaigns/${campaignId}/counters/${counterId}`)
}
