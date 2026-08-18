'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import {
  asRewardType, existingCodeValues, parseCodeBatch, type RewardType,
} from '@/lib/db/rewards'

/** รหัสที่การ์ดเรียกด้วย `{{reward.xxx}}` และผลที่ตามมาอ้างถึงเป็นข้อความ */
const CODE_PATTERN = /^[a-z0-9_]{1,20}$/

const UNIQUE_VIOLATION = '23505'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

/** จำนวนเต็มที่ยอมให้ว่างได้ · null คือไม่ได้กรอก ไม่ใช่ศูนย์ */
function asOptionalInt(raw: string, { min }: { min: number }): number | null | undefined {
  if (raw === '') return null
  if (!/^\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= min ? value : undefined
}

async function requireCampaign(sql: ReturnType<typeof db>, campaignId: string): Promise<void> {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM campaign WHERE id = ${campaignId}`
  if (!row) throw new Error('ไม่พบแคมเปญนี้')
}

type RewardState = {
  code: string
  reward_type: RewardType
  issued_count: number
  has_coupon: boolean
}

async function requireReward(
  sql: ReturnType<typeof db>, campaignId: string, rewardId: string,
): Promise<RewardState> {
  const [row] = await sql<RewardState[]>`
    SELECT r.code, r.reward_type, r.issued_count,
           EXISTS (SELECT 1 FROM coupon c WHERE c.reward_id = r.id) AS has_coupon
      FROM reward r WHERE r.id = ${rewardId} AND r.campaign_id = ${campaignId}`
  if (!row) throw new Error('ไม่พบรางวัลนี้ในแคมเปญนี้')
  return row
}

const MISSING_VALUE_MESSAGE: Record<Exclude<RewardType, 'code'>, string> = {
  link: 'ต้องกรอกลิงก์รางวัล และต้องขึ้นต้นด้วย https://',
  text: 'ต้องกรอกข้อความรางวัล',
  image: 'ต้องเลือกภาพรางวัลจากคลังภาพ',
}

/**
 * ค่าของรางวัลตามชนิดของมัน
 *
 * A code reward carries no value at all — its value lives one per row in
 * reward_code — so accepting one here would store a second answer to the same
 * question, and the two would disagree the first time either was edited.
 *
 * Creating is allowed to leave the value empty; editing is not. The form that
 * creates a reward has only its identity on it, because the field that holds an
 * image is a list of this campaign's images and the field that holds a link is
 * a text box, and a screen with no client state cannot show one of them without
 * showing both. The screen it lands on afterwards knows the type and asks for
 * the right one, and until then the reward carries a warning saying it has
 * nothing in it.
 */
function valueFor(type: RewardType, raw: string, { required }: { required: boolean }): string | null {
  if (type === 'code') return null
  if (raw === '') {
    if (required) throw new Error(MISSING_VALUE_MESSAGE[type])
    return null
  }
  // http:// ผ่านหน้าจอไปได้ แต่ LINE ไม่เปิดให้ · ปฏิเสธตรงนี้ดีกว่าให้รู้จากปุ่มที่กดแล้วเงียบ
  if (type === 'link' && !/^https:\/\/.+/.test(raw)) {
    throw new Error('ลิงก์รางวัลต้องขึ้นต้นด้วย https://')
  }
  return raw
}

/**
 * สร้างหรือแก้รางวัลหนึ่งตัว
 *
 * issued_count is never in the column list. Its owner is the transaction that
 * creates an entitlement, which increments it in the same statement it inserts
 * the row, so a screen that wrote it would produce a number that disagrees with
 * the number of entitlements that exist. Nothing compares the two, so the gap
 * would surface as a client discovering they gave away more than they owned.
 *
 * Lowering the quota below what has already gone out is refused with the real
 * number. The table refuses it too — CHECK (quota IS NULL OR issued_count <=
 * quota) — but a constraint name is not an instruction, and the person reading
 * it needs to know they are 120 entitlements past where they are trying to go.
 */
export async function saveReward(
  campaignId: string, rewardId: string, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireCampaign(sql, campaignId)

  const type = asRewardType(trimmed(formData, 'reward_type'))
  if (!type) throw new Error('ต้องเลือกชนิดรางวัล')

  const value = valueFor(type, trimmed(formData, 'value'), { required: rewardId !== '' })

  const quota = asOptionalInt(trimmed(formData, 'quota'), { min: 0 })
  if (quota === undefined) throw new Error('โควตาต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป หรือเว้นว่าง')

  const validDays = asOptionalInt(trimmed(formData, 'valid_days'), { min: 1 })
  if (validDays === undefined) throw new Error('อายุสิทธิ์ต้องเป็นจำนวนวันตั้งแต่ 1 ขึ้นไป หรือเว้นว่าง')

  const useLimit = asOptionalInt(trimmed(formData, 'use_limit'), { min: 1 })
  if (useLimit === undefined) throw new Error('จำนวนครั้งที่ใช้ได้ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป หรือเว้นว่าง')

  let created: string | null = null

  if (rewardId) {
    const current = await requireReward(sql, campaignId, rewardId)

    if (current.reward_type !== type && current.issued_count > 0) {
      throw new Error(
        `แก้ชนิดรางวัลไม่ได้ — มีคนได้รับไปแล้ว ${current.issued_count} คน`
        + ' สิทธิ์ที่ออกไปชี้มาที่รางวัลนี้ ไม่ได้ถือสำเนาของมันไว้',
      )
    }

    if (quota !== null && quota < current.issued_count) {
      throw new Error(
        `ลดโควตาต่ำกว่าที่แจกไปแล้วไม่ได้ — แจกไปแล้ว ${current.issued_count} สิทธิ์`,
      )
    }

    // BR-55 · คูปองต้องมีวันหมดอายุและจำนวนครั้งเสมอ
    if (current.has_coupon && (validDays === null || useLimit === null)) {
      throw new Error('คูปองต้องมีทั้งอายุสิทธิ์และจำนวนครั้งที่ใช้ได้ (BR-55)')
    }

    await sql`
      UPDATE reward
         SET reward_type = ${type}, value = ${value}, quota = ${quota},
             valid_days = ${validDays}, use_limit = ${useLimit}
       WHERE id = ${rewardId} AND campaign_id = ${campaignId}`
  } else {
    const code = trimmed(formData, 'code')
    if (!CODE_PATTERN.test(code)) {
      throw new Error('รหัสรางวัลใช้ได้แค่ a-z 0-9 และขีดล่าง ยาว 1–20 ตัว')
    }

    try {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO reward (campaign_id, code, reward_type, value, quota, valid_days, use_limit)
        VALUES (${campaignId}, ${code}, ${type}, ${value}, ${quota}, ${validDays}, ${useLimit})
        RETURNING id`
      created = row.id
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new Error(`แคมเปญนี้มีรางวัลรหัส "${code}" อยู่แล้ว — ไปแก้ตัวเดิมแทน`)
      }
      throw error
    }
  }

  revalidatePath(`/campaigns/${campaignId}/rewards`)
  if (created) redirect(`/campaigns/${campaignId}/rewards/${created}`)
}

/**
 * ลบรางวัล · ทำได้เฉพาะตอนที่ยังไม่มีใครได้รับและยังไม่มีใครแจกมัน
 *
 * entitlement cascades from reward, so the database's answer to deleting a
 * reward eight hundred people already hold is to delete their entitlements too
 * and report success. Those rows are the only record that anybody was promised
 * anything.
 */
export async function deleteReward(campaignId: string, rewardId: string): Promise<void> {
  await requireRole('configurator')
  const sql = db()

  const reward = await requireReward(sql, campaignId, rewardId)
  if (reward.issued_count > 0) {
    throw new Error(
      `ลบไม่ได้ — มีคนได้รับไปแล้ว ${reward.issued_count} คน`
      + ' · สิทธิ์ที่ออกไปชี้มาที่รางวัลนี้ ลบแล้วสิทธิ์เหล่านั้นหายตามไปด้วย (ON DELETE CASCADE)',
    )
  }

  const users = await sql<{ label: string }[]>`
    SELECT a.name || ' · ผลที่ตามมาของกิจกรรม' AS label
      FROM activity a
     WHERE a.campaign_id = ${campaignId}
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.effects) e
                    WHERE e->>'type' = 'grant_reward' AND e->>'reward_code' = ${reward.code})
     UNION
    SELECT a.name || ' · ผลลัพธ์'
      FROM activity a, jsonb_array_elements(coalesce(a.resolve_config->'outcomes', '[]'::jsonb)) o
     WHERE a.campaign_id = ${campaignId} AND o->>'rewardCode' = ${reward.code}
     UNION
    SELECT 'ค่าสะสม "' || c.name || '" · จุดปลดล็อก ' || m.at_value
      FROM counter c
      JOIN counter_milestone m ON m.counter_id = c.id
     WHERE c.campaign_id = ${campaignId}
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.effects) e
                    WHERE e->>'type' = 'grant_reward' AND e->>'reward_code' = ${reward.code})`
  if (users.length > 0) {
    throw new Error(`ลบไม่ได้ — ${users.map((row) => row.label).join(' · ')} แจกรางวัลนี้อยู่`)
  }

  await sql`DELETE FROM reward WHERE id = ${rewardId} AND campaign_id = ${campaignId}`
  revalidatePath(`/campaigns/${campaignId}/rewards`)
}

/**
 * นำเข้ารหัสทั้งชุด · ผิดแถวเดียวคือไม่นำเข้าเลยสักแถว
 *
 * The whole paste is written by one statement, which is what makes a half
 * import impossible rather than merely unlikely: a duplicate that slipped in
 * between the check and the write takes the statement down with it, and no
 * subset of the rows survives. Reporting "imported 400 of 500" would be worse
 * than refusing, because nobody can tell which 400 without reading the table.
 */
export async function importRewardCodes(
  campaignId: string, rewardId: string, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()

  const reward = await requireReward(sql, campaignId, rewardId)
  if (reward.reward_type !== 'code') {
    throw new Error('รางวัลชนิดนี้ไม่ได้จ่ายรหัสจากคลัง — เปลี่ยนชนิดเป็น "รหัสจากคลัง" ก่อน')
  }

  const batch = parseCodeBatch(
    String(formData.get('codes') ?? ''),
    await existingCodeValues(sql, rewardId),
  )
  if (!batch.ok) {
    throw new Error(`ไม่นำเข้าเลยสักแถว — ${batch.problems.join(' · ')}`)
  }

  try {
    await sql`
      INSERT INTO reward_code (reward_id, code_value)
      SELECT ${rewardId}, unnest(${sql.array(batch.codes as never)}::text[])`
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new Error('ไม่นำเข้าเลยสักแถว — มีรหัสซ้ำกับที่มีอยู่แล้วในคลัง ลองโหลดหน้านี้ใหม่')
    }
    throw error
  }

  revalidatePath(`/campaigns/${campaignId}/rewards/${rewardId}`)
}

/**
 * เอารหัสที่ยังไม่ได้จ่ายออกจากคลัง
 *
 * Only an unassigned one. A code somebody is holding is the thing they were
 * given; deleting the row would leave their entitlement pointing at nothing,
 * and reward_code_id is the only place that pairing is written down.
 */
export async function deleteRewardCode(
  campaignId: string, rewardId: string, codeId: string,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireReward(sql, campaignId, rewardId)

  const removed = await sql`
    DELETE FROM reward_code
     WHERE id = ${codeId} AND reward_id = ${rewardId} AND assigned_to IS NULL
     RETURNING id`
  if (removed.length === 0) {
    throw new Error('ลบรหัสนี้ไม่ได้ — รหัสที่จ่ายให้ผู้เล่นไปแล้วเป็นของที่เขาถืออยู่')
  }

  revalidatePath(`/campaigns/${campaignId}/rewards/${rewardId}`)
}
