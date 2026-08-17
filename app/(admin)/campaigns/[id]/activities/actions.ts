'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import {
  type EntryRuleConfig, type OutcomeConfig, asEntryRuleType, followHolder,
} from '@/lib/db/activities'
import { asInputType, asResolveMethod, comboProblem } from '@/lib/activities/wizard'

/** รหัสกิจกรรมเดินทางอยู่ในปุ่มที่ส่งออกไปแล้ว · รูปเดียวกับที่ postback เข้ารหัส */
const CODE_PATTERN = /^[a-z0-9_]{1,20}$/

const UNIQUE_VIOLATION = '23505'

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

/** จำนวนเต็มที่ยอมให้ว่างได้ · null คือไม่ได้กรอก ไม่ใช่ศูนย์ */
function asOptionalInt(raw: string, { min }: { min: number }): number | null | undefined {
  if (raw === '') return null
  if (!/^-?\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= min ? value : undefined
}

type CampaignRow = { id: string; status: 'draft' | 'published' | 'closed' }

/**
 * แคมเปญที่ยังแก้กติกาได้ (BR-05)
 *
 * A published campaign's rules are what the people currently playing agreed to,
 * and a closed one has already had its statistics frozen against them. Both
 * refuse edits for the same reason: the config and the record of what happened
 * under it have to keep saying the same thing.
 */
async function requireDraftCampaign(
  sql: ReturnType<typeof db>, campaignId: string,
): Promise<CampaignRow> {
  const [row] = await sql<CampaignRow[]>`
    SELECT id, status FROM campaign WHERE id = ${campaignId}`
  if (!row) throw new Error('ไม่พบแคมเปญนี้')
  if (row.status !== 'draft') {
    throw new Error(
      'แคมเปญนี้ส่งขึ้นแล้ว แก้กิจกรรมไม่ได้ (BR-05)'
      + ' — สร้าง version ใหม่ก่อนแก้ เพื่อไม่ให้กติกาที่คนกำลังเล่นเปลี่ยนกลางทาง',
    )
  }
  return row
}

type ActivityState = {
  id: string
  code: string
  name: string
  input_type: string
  resolve_method: string
  input_config: Record<string, unknown>
  resolve_config: { outcomes?: OutcomeConfig[] }
  entry_rules: EntryRuleConfig[]
  effects: Array<Record<string, unknown>>
  fallback_card_id: string | null
  trigger: 'manual' | 'follow'
}

async function requireActivity(
  sql: ReturnType<typeof db>, campaignId: string, activityId: string,
): Promise<ActivityState> {
  const [row] = await sql<ActivityState[]>`
    SELECT id, code, name, input_type, resolve_method, input_config, resolve_config,
           entry_rules, effects, fallback_card_id, trigger
      FROM activity WHERE id = ${activityId} AND campaign_id = ${campaignId}`
  if (!row) throw new Error('ไม่พบกิจกรรมนี้ในแคมเปญนี้')
  return row
}

/**
 * ทริกเกอร์ "ตอนแอดเป็นเพื่อน" มีได้ตัวเดียวต่อแคมเปญ (BR-90)
 *
 * The partial unique index refuses the second one on its own, so this is not
 * what makes the rule true. What it adds is the name of the activity already
 * holding it and the address to go and change it — a unique-violation error
 * code tells the person nothing they can act on, and the activity they need is
 * not something they can guess from a list of twenty.
 */
async function requireFollowFree(
  sql: ReturnType<typeof db>, campaignId: string, exceptId: string | undefined,
): Promise<void> {
  const holder = await followHolder(sql, campaignId, exceptId)
  if (holder) {
    throw new Error(
      `แคมเปญนี้มีกิจกรรมทักทายอยู่แล้ว — "${holder.name}" (${holder.code}) ถืออยู่ (BR-90)`
      + ` · ปลดที่ /campaigns/${campaignId}/activities/${holder.id} ก่อน แล้วค่อยตั้งตัวนี้แทน`,
    )
  }
}

/**
 * กิจกรรมจะแจกรางวัลได้ ต้องมี grant_reward อยู่ใน effects ของตัวมันเอง
 *
 * planEffects() walks the activity's effect list and, for a grant that names no
 * reward, inherits the reward code of whichever outcome came up. So an outcome
 * carrying a rewardCode grants nothing at all unless the activity also carries
 * the grant — the reward would sit in the config looking configured and never
 * reach a single player. Keeping the two in step here means the screen never
 * produces that pairing, rather than warning about it afterwards.
 *
 * The grant deliberately names no reward of its own. Naming one would put a
 * second answer to "which reward" next to the outcome's, and the two disagree
 * the first time either is edited.
 */
function effectsFor(
  current: Array<Record<string, unknown>>, outcomes: OutcomeConfig[],
): Array<Record<string, unknown>> {
  const others = current.filter((effect) => effect.type !== 'grant_reward')
  const grants = outcomes.some((outcome) => (outcome.rewardCode ?? '') !== '')
  return grants ? [...others, { type: 'grant_reward' }] : others
}

async function writeOutcomes(
  sql: ReturnType<typeof db>, campaignId: string, activity: ActivityState,
  outcomes: OutcomeConfig[],
): Promise<void> {
  await sql`
    UPDATE activity
       SET resolve_config = ${sql.json({ ...activity.resolve_config, outcomes } as never)},
           effects = ${sql.json(effectsFor(activity.effects, outcomes) as never)}
     WHERE id = ${activity.id} AND campaign_id = ${campaignId}`
}

const touch = (campaignId: string, activityId?: string) => {
  revalidatePath(`/campaigns/${campaignId}/activities`)
  if (activityId) revalidatePath(`/campaigns/${campaignId}/activities/${activityId}`)
}

/**
 * สร้างกิจกรรมใหม่ · ถามแค่ตัวตนกับสองแกน
 *
 * The two axes are asked here rather than left to a default because they decide
 * what the setup screen asks next, and a default would have every activity
 * starting as the same kind and being changed immediately.
 */
export async function createActivity(campaignId: string, formData: FormData): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)

  const code = trimmed(formData, 'code')
  if (!CODE_PATTERN.test(code)) {
    throw new Error('รหัสกิจกรรมใช้ได้แค่ a-z 0-9 และขีดล่าง ยาว 1–20 ตัว')
  }

  const name = trimmed(formData, 'name')
  if (!name) throw new Error('ต้องมีชื่อกิจกรรม')

  const inputType = asInputType(trimmed(formData, 'input_type'))
  if (!inputType) throw new Error('ต้องเลือกวิธีรับอินพุต')

  const resolveMethod = asResolveMethod(trimmed(formData, 'resolve_method'))
  if (!resolveMethod) throw new Error('ต้องเลือกวิธีตัดสินผล')

  // BR-36 · คู่ที่ผสมกันไม่ได้ ถูกปฏิเสธตั้งแต่ตอนสร้าง ไม่ใช่ตอนส่งขึ้น
  const combo = comboProblem(inputType, resolveMethod)
  if (combo) throw new Error(combo)

  let created: string
  try {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, sort_order)
      VALUES (${campaignId}, ${code}, ${name}, ${inputType}, ${resolveMethod},
              coalesce((SELECT max(sort_order) + 1 FROM activity
                         WHERE campaign_id = ${campaignId}), 0))
      RETURNING id`
    created = row.id
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new Error(`แคมเปญนี้มีกิจกรรมรหัส "${code}" อยู่แล้ว — ไปแก้ตัวเดิมแทน`)
    }
    throw error
  }

  touch(campaignId)
  redirect(`/campaigns/${campaignId}/activities/${created}`)
}

/**
 * บันทึกตัวตน สองแกน ทริกเกอร์ และการ์ดสำรองของกิจกรรม
 *
 * The code is not in the column list. It travels inside every button already
 * sent to a player — lib/match/postback.ts encodes it as `a=<code>` — so
 * changing it turns every card sitting in somebody's chat into a tap that
 * resolves to nothing.
 */
export async function saveActivity(
  campaignId: string, activityId: string, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)
  const current = await requireActivity(sql, campaignId, activityId)

  const name = trimmed(formData, 'name')
  if (!name) throw new Error('ต้องมีชื่อกิจกรรม')

  const inputType = asInputType(trimmed(formData, 'input_type'))
  if (!inputType) throw new Error('ต้องเลือกวิธีรับอินพุต')

  const resolveMethod = asResolveMethod(trimmed(formData, 'resolve_method'))
  if (!resolveMethod) throw new Error('ต้องเลือกวิธีตัดสินผล')

  // BR-36 · คู่ที่ engine ตัดสินไม่ได้ ห้ามบันทึก
  const combo = comboProblem(inputType, resolveMethod)
  if (combo) throw new Error(combo)

  const fallbackRaw = trimmed(formData, 'fallback_card_id')
  const fallbackCardId = fallbackRaw === '' ? null : fallbackRaw

  // BR-31 · โควตาต้องมีการ์ดสำรอง · บันทึกไม่ผ่านถ้าไม่มี
  if (resolveMethod === 'quota' && !fallbackCardId) {
    throw new Error(
      'วิธีตัดสินผลแบบโควตาต้องเลือกการ์ดสำรองเมื่อของหมด (BR-31)'
      + ' — ของหมดแล้วยังมีคนกดเล่น ถ้าไม่มีการ์ดสำรอง คนนั้นจะไม่ได้รับอะไรเลย',
    )
  }

  if (fallbackCardId) {
    const [card] = await sql<{ id: string }[]>`
      SELECT id FROM card WHERE id = ${fallbackCardId} AND campaign_id = ${campaignId}`
    if (!card) throw new Error('การ์ดสำรองต้องเป็นการ์ดของแคมเปญนี้')
  }

  const trigger = trimmed(formData, 'trigger') === 'follow' ? 'follow' : 'manual'
  // BR-90 · หนึ่งแคมเปญมีกิจกรรมทักทายได้ตัวเดียว
  if (trigger === 'follow' && current.trigger !== 'follow') {
    await requireFollowFree(sql, campaignId, activityId)
  }

  try {
    await sql`
      UPDATE activity
         SET name = ${name}, input_type = ${inputType}, resolve_method = ${resolveMethod},
             fallback_card_id = ${fallbackCardId}, trigger = ${trigger}
       WHERE id = ${activityId} AND campaign_id = ${campaignId}`
  } catch (error) {
    // ดัชนีบางส่วนของตารางเป็นด่านสุดท้าย · สองคนกดพร้อมกันยังมาถึงตรงนี้ได้
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      await requireFollowFree(sql, campaignId, activityId)
      throw error
    }
    throw error
  }

  touch(campaignId, activityId)
}

/** เปิดหรือปิดกิจกรรม · ปิดแล้ว queries.ts จะไม่โหลดมันขึ้น config เลย */
export async function setActivityEnabled(
  campaignId: string, activityId: string, enabled: boolean,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)
  await requireActivity(sql, campaignId, activityId)

  await sql`
    UPDATE activity SET is_enabled = ${enabled}
     WHERE id = ${activityId} AND campaign_id = ${campaignId}`
  touch(campaignId, activityId)
}

/**
 * ลบกิจกรรม · ทำได้เฉพาะตอนที่ยังไม่มีใครเล่นมัน
 *
 * participant_activity cascades from activity, so the database's answer to
 * deleting an activity four hundred people have played is to delete their
 * play records too and report success. Those rows are the only evidence the
 * plays happened, and campaign_stat is counted from them.
 */
export async function deleteActivity(campaignId: string, activityId: string): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)
  await requireActivity(sql, campaignId, activityId)

  const [played] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM participant_activity WHERE activity_id = ${activityId}`
  if (played.count > 0) {
    throw new Error(
      `ลบไม่ได้ — มีคนเล่นไปแล้ว ${played.count} คน`
      + ' · ประวัติการเล่นชี้มาที่กิจกรรมนี้ ลบแล้วประวัติหายตามไปด้วย (ON DELETE CASCADE)'
      + ' · ปิดกิจกรรมแทนถ้าไม่อยากให้เล่นต่อ',
    )
  }

  const pointing = await sql<{ keyword: string }[]>`
    SELECT keyword FROM keyword_rule
     WHERE campaign_id = ${campaignId} AND target_activity_id = ${activityId}`
  if (pointing.length > 0) {
    throw new Error(
      `ลบไม่ได้ — คีย์เวิร์ด ${pointing.map((r) => `"${r.keyword}"`).join(' · ')} พามาที่กิจกรรมนี้`
      + ' · ลบคีย์เวิร์ดหรือชี้ไปที่อื่นก่อน',
    )
  }

  await sql`DELETE FROM activity WHERE id = ${activityId} AND campaign_id = ${campaignId}`
  touch(campaignId)
}

/** ผลลัพธ์ว่างหนึ่งแถว · id ของผลลัพธ์คือสิ่งที่ fixed ใช้จับคู่กับช่องที่ผู้เล่นกด */
export async function addOutcome(campaignId: string, activityId: string): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)
  const activity = await requireActivity(sql, campaignId, activityId)

  const outcomes = asArray<OutcomeConfig>(activity.resolve_config?.outcomes)
  const taken = new Set(outcomes.map((outcome) => outcome.id))
  let next = outcomes.length + 1
  while (taken.has(`o${next}`)) next += 1

  await writeOutcomes(sql, campaignId, activity, [...outcomes, { id: `o${next}` }])
  touch(campaignId, activityId)
}

export async function saveOutcome(
  campaignId: string, activityId: string, index: number, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)
  const activity = await requireActivity(sql, campaignId, activityId)

  const outcomes = asArray<OutcomeConfig>(activity.resolve_config?.outcomes)
  const current = outcomes[index]
  if (!current) throw new Error('ไม่พบผลลัพธ์แถวนี้ — หน้าจออาจค้างอยู่กับข้อมูลเก่า')

  const cardRaw = trimmed(formData, 'card_id')
  if (cardRaw) {
    const [card] = await sql<{ id: string }[]>`
      SELECT id FROM card WHERE id = ${cardRaw} AND campaign_id = ${campaignId}`
    if (!card) throw new Error('การ์ดที่ตอบต้องเป็นการ์ดของแคมเปญนี้')
  }

  const rewardRaw = trimmed(formData, 'reward_code')
  if (rewardRaw) {
    const [reward] = await sql<{ code: string }[]>`
      SELECT code FROM reward WHERE campaign_id = ${campaignId} AND code = ${rewardRaw}`
    if (!reward) throw new Error('รางวัลที่เลือกไม่ได้อยู่ในแคมเปญนี้')
  }

  const weight = asOptionalInt(trimmed(formData, 'weight'), { min: 0 })
  if (weight === undefined) throw new Error('น้ำหนักต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป หรือเว้นว่าง')

  const scoreMin = asOptionalInt(trimmed(formData, 'score_min'), { min: 0 })
  const scoreMax = asOptionalInt(trimmed(formData, 'score_max'), { min: 0 })
  if (scoreMin === undefined || scoreMax === undefined) {
    throw new Error('ช่วงคะแนนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป หรือเว้นว่าง')
  }
  if (scoreMin !== null && scoreMax !== null && scoreMin > scoreMax) {
    throw new Error('คะแนนต่ำสุดต้องไม่มากกว่าคะแนนสูงสุด — ช่วงแบบนี้ไม่มีคะแนนไหนเข้าได้')
  }

  // เขียนคีย์ตามที่ lib/engine/resolve.ts อ่าน · ช่องที่เว้นว่างถูกถอดออก
  // ไม่ใช่เก็บเป็น null เพราะ engine ใช้ `?? -Infinity` แยกไม่ออกระหว่างสองอย่าง
  const next: OutcomeConfig = { id: current.id }
  const label = trimmed(formData, 'label')
  if (label) next.label = label
  if (cardRaw) next.cardId = cardRaw
  if (rewardRaw) next.rewardCode = rewardRaw
  if (weight !== null) next.weight = weight
  if (scoreMin !== null) next.scoreMin = scoreMin
  if (scoreMax !== null) next.scoreMax = scoreMax

  const updated = outcomes.map((outcome, at) => (at === index ? next : outcome))
  await writeOutcomes(sql, campaignId, activity, updated)
  touch(campaignId, activityId)
}

export async function removeOutcome(
  campaignId: string, activityId: string, index: number,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)
  const activity = await requireActivity(sql, campaignId, activityId)

  const outcomes = asArray<OutcomeConfig>(activity.resolve_config?.outcomes)
  if (!outcomes[index]) throw new Error('ไม่พบผลลัพธ์แถวนี้ — หน้าจออาจค้างอยู่กับข้อมูลเก่า')

  await writeOutcomes(sql, campaignId, activity, outcomes.filter((_, at) => at !== index))
  touch(campaignId, activityId)
}

/** เงื่อนไขว่างหนึ่งข้อ · ลำดับคือลำดับที่ engine ตรวจ และผู้เล่นเห็นเหตุผลแรกที่ไม่ผ่าน */
export async function addEntryRule(
  campaignId: string, activityId: string, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)
  const activity = await requireActivity(sql, campaignId, activityId)

  const type = asEntryRuleType(trimmed(formData, 'type'))
  if (!type) throw new Error('ต้องเลือกชนิดเงื่อนไข')

  const rules = [...asArray<EntryRuleConfig>(activity.entry_rules), { type }]
  await sql`
    UPDATE activity SET entry_rules = ${sql.json(rules as never)}
     WHERE id = ${activityId} AND campaign_id = ${campaignId}`
  touch(campaignId, activityId)
}

export async function saveEntryRule(
  campaignId: string, activityId: string, index: number, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)
  const activity = await requireActivity(sql, campaignId, activityId)

  const rules = asArray<EntryRuleConfig>(activity.entry_rules)
  if (!rules[index]) throw new Error('ไม่พบเงื่อนไขข้อนี้ — หน้าจออาจค้างอยู่กับข้อมูลเก่า')

  const type = asEntryRuleType(trimmed(formData, 'type'))
  if (!type) throw new Error('ต้องเลือกชนิดเงื่อนไข')

  const cardRaw = trimmed(formData, 'card_id')
  if (cardRaw) {
    const [card] = await sql<{ id: string }[]>`
      SELECT id FROM card WHERE id = ${cardRaw} AND campaign_id = ${campaignId}`
    if (!card) throw new Error('การ์ดที่ตอบเมื่อไม่ผ่านต้องเป็นการ์ดของแคมเปญนี้')
  }

  const next: EntryRuleConfig = { type }
  if (cardRaw) next.cardId = cardRaw

  if (type === 'limit' || type === 'activity_play_count') {
    const count = asOptionalInt(trimmed(formData, 'count'), { min: 1 })
    if (count === undefined) throw new Error('จำนวนครั้งต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป')
    next.count = count ?? 1
  }

  const key = trimmed(formData, 'key')
  if (key) next.key = key
  const value = trimmed(formData, 'value')
  if (value) next.value = value

  const updated = rules.map((rule, at) => (at === index ? next : rule))
  await sql`
    UPDATE activity SET entry_rules = ${sql.json(updated as never)}
     WHERE id = ${activityId} AND campaign_id = ${campaignId}`
  touch(campaignId, activityId)
}

export async function removeEntryRule(
  campaignId: string, activityId: string, index: number,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)
  const activity = await requireActivity(sql, campaignId, activityId)

  const rules = asArray<EntryRuleConfig>(activity.entry_rules)
  if (!rules[index]) throw new Error('ไม่พบเงื่อนไขข้อนี้ — หน้าจออาจค้างอยู่กับข้อมูลเก่า')

  await sql`
    UPDATE activity SET entry_rules = ${sql.json(rules.filter((_, at) => at !== index) as never)}
     WHERE id = ${activityId} AND campaign_id = ${campaignId}`
  touch(campaignId, activityId)
}
