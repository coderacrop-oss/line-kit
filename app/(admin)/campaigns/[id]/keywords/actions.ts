'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import { normalizeText } from '@/lib/match/keyword'

const MATCH_MODES = ['exact', 'contains'] as const
type MatchMode = (typeof MATCH_MODES)[number]

type Target = { kind: 'activity' | 'card'; id: string }

/** รหัสข้อผิดพลาดของ postgres ตอนชน UNIQUE */
const UNIQUE_VIOLATION = '23505'

/**
 * ปลายทางเดียวต่อหนึ่งคำ · `activity:<id>` หรือ `card:<id>`
 *
 * The table's CHECK is an OR, so a row may hold both — and handle.ts always
 * takes the activity, leaving the card as configuration that can never run. One
 * field means the screen cannot express that at all.
 */
function parseTarget(raw: string): Target {
  const [kind, id] = raw.split(':')
  if ((kind === 'activity' || kind === 'card') && id) return { kind, id }
  throw new Error('ต้องเลือกว่าให้พาไปกิจกรรมไหน หรือตอบด้วยการ์ดใบไหน')
}

/**
 * ตั้งหรือแก้คีย์เวิร์ดหนึ่งคำ
 *
 * The word is stored normalised (BR-48) because matchKeyword normalises the
 * incoming message before comparing: a rule saved with the spacing someone
 * happened to type would never match anything, and nothing would report it.
 *
 * The campaign id is bound to the action; everything else arrives in a FormData
 * and is therefore written by whoever sent it. That is why the chosen target is
 * checked against this campaign rather than trusted — a foreign id passes the
 * foreign key happily and produces a rule that quietly does nothing.
 */
export async function saveKeyword(campaignId: string, formData: FormData): Promise<void> {
  await requireRole('configurator', 'content_editor')
  const sql = db()

  const keyword = normalizeText(String(formData.get('keyword') ?? ''))
  if (!keyword) throw new Error('ต้องมีคำที่จะให้ตอบ')

  const matchMode = String(formData.get('match_mode') ?? 'exact') as MatchMode
  // CHECK ของตารางบังคับอยู่แล้ว · ที่นี่เป็นประโยคที่คนกรอกฟอร์มเอาไปแก้ได้
  if (!MATCH_MODES.includes(matchMode)) throw new Error('โหมดจับคู่ต้องเป็น exact หรือ contains')

  const target = parseTarget(String(formData.get('target') ?? ''))

  const owned = target.kind === 'activity'
    ? await sql`SELECT 1 FROM activity WHERE id = ${target.id} AND campaign_id = ${campaignId}`
    : await sql`SELECT 1 FROM card WHERE id = ${target.id} AND campaign_id = ${campaignId}`
  if (owned.length === 0) throw new Error('ปลายทางที่เลือกไม่ได้อยู่ในแคมเปญนี้')

  const activityId = target.kind === 'activity' ? target.id : null
  const cardId = target.kind === 'card' ? target.id : null
  const id = String(formData.get('id') ?? '')

  try {
    if (id) {
      // ผูก campaign_id ไว้ใน WHERE ด้วย · id ในฟอร์มเป็นของที่ผู้ส่งแก้เองได้
      await sql`
        UPDATE keyword_rule
           SET keyword = ${keyword}, match_mode = ${matchMode},
               target_activity_id = ${activityId}, target_card_id = ${cardId}
         WHERE id = ${id} AND campaign_id = ${campaignId}`
    } else {
      await sql`
        INSERT INTO keyword_rule
               (campaign_id, keyword, match_mode, target_activity_id, target_card_id, sort_order)
        VALUES (${campaignId}, ${keyword}, ${matchMode}, ${activityId}, ${cardId},
                COALESCE((SELECT max(sort_order) + 1 FROM keyword_rule
                           WHERE campaign_id = ${campaignId}), 0))`
    }
  } catch (error) {
    // UNIQUE (campaign_id, keyword) · สองแถวที่คำเดียวกันจะทำให้แถวหลังไม่มีวันถูกเรียก
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new Error(`แคมเปญนี้มีคำนี้อยู่แล้ว — “${keyword}” ตั้งได้ครั้งเดียว ให้ไปแก้ของเดิมแทน`)
    }
    throw error
  }

  revalidatePath(`/campaigns/${campaignId}/keywords`)
}

/**
 * ลบคีย์เวิร์ด · ผู้ตั้งค่าแคมเปญเท่านั้น
 *
 * Scoped by campaign_id as well as by id for the same reason the update is: the
 * row id comes from the page, and a page is not a place where secrets live.
 */
export async function deleteKeyword(campaignId: string, id: string): Promise<void> {
  await requireRole('configurator')
  await db()`DELETE FROM keyword_rule WHERE id = ${id} AND campaign_id = ${campaignId}`
  revalidatePath(`/campaigns/${campaignId}/keywords`)
}
