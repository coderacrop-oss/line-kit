'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import {
  ENTRY_RULE_FIELDS, type EntryRuleConfig, type OutcomeConfig,
  asEntryRuleType, followHolder,
} from '@/lib/db/activities'
import {
  asInputType, asResolveMethod, comboProblem, inputConfigFields, type ResolveMethod,
} from '@/lib/activities/wizard'

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
 * รหัสกิจกรรมจากชื่อ · ผู้ตั้งค่าไม่ต้องรู้จักกฎ a-z 0-9 ขีดล่างอีกต่อไป
 *
 * The form used to ask for this directly, with the exact CODE_PATTERN spelled
 * out as a hint. That was a second identity for something that already has a
 * name, and asking a person typing "สุ่มรางวัลประจำวัน" to also invent
 * "daily_draw" was asking them to do the computer's job. Truncated to 14
 * characters rather than the full 20 CODE_PATTERN allows, so a collision retry
 * still has room to append `_` and four digits without exceeding it.
 *
 * async even though the computation itself is not — this file is `'use server'`,
 * and every export from it has to be a Server Action, which Next.js only
 * accepts as an async function.
 */
export async function slugifyActivityName(name: string): Promise<string> {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 14)
  return base || 'activity'
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

  const name = trimmed(formData, 'name')
  if (!name) throw new Error('ต้องมีชื่อกิจกรรม')

  const inputType = asInputType(trimmed(formData, 'input_type'))
  if (!inputType) throw new Error('ต้องเลือกวิธีรับอินพุต')

  /**
   * ควิซบุคลิกภาพไม่มี resolve_method เลย · แกน 2 ทั้งแกนถูกแทนที่ด้วยโหมด
   *
   * 0014_quiz_engine.sql บังคับด้วย CHECK ว่า resolve_method เป็น NULL ได้ก็ต่อเมื่อ
   * input_type เป็น personality_quiz เท่านั้น — ไม่ใช่แค่ "ผสมกับบางวิธีไม่ได้" แบบที่
   * comboProblem() ปฏิเสธบางคู่ของสี่ชนิดที่เหลือ แต่คือไม่มีวิธีตัดสินผลให้ผสมด้วยเลย
   * สักตัว จึงข้ามทั้ง asResolveMethod() และ comboProblem() ไปเลยสำหรับชนิดนี้ (เข้าคู่กับ
   * lib/activities/wizard.ts ที่ตั้งใจไม่รู้จักควิซบุคลิกภาพในแง่นี้เหมือนกัน) แล้วอ่านโหมด
   * แทน — axes/questions/results ค่อยกรอกที่จอตั้งค่าควิซของ Task 11 ทีหลัง
   */
  let resolveMethod: ResolveMethod | null = null
  let inputConfig: Record<string, unknown> = {}

  if (inputType === 'personality_quiz') {
    const quizMode = trimmed(formData, 'quiz_mode')
    if (quizMode !== 'solo' && quizMode !== 'duo') {
      throw new Error('ต้องเลือกโหมดของควิซบุคลิกภาพ — เดี่ยวหรือคู่')
    }
    inputConfig = { mode: quizMode }
  } else {
    resolveMethod = asResolveMethod(trimmed(formData, 'resolve_method'))
    if (!resolveMethod) throw new Error('ต้องเลือกวิธีตัดสินผล')

    // BR-36 · คู่ที่ผสมกันไม่ได้ ถูกปฏิเสธตั้งแต่ตอนสร้าง ไม่ใช่ตอนส่งขึ้น
    const combo = comboProblem(inputType, resolveMethod)
    if (combo) throw new Error(combo)
  }

  const code = await slugifyActivityName(name)
  if (!CODE_PATTERN.test(code)) {
    // ป้องกันตัวเอง — slugifyActivityName() คำนวณให้ตรงรูปแบบนี้เสมอ ฟอร์มไม่มีช่อง
    // ให้กรอกรหัสเองอีกต่อไป ถ้าไม่ตรงคือมันมีบั๊ก ไม่ใช่ผู้ใช้กรอกผิด
    throw new Error('สร้างรหัสกิจกรรมจากชื่อไม่สำเร็จ — ลองตั้งชื่ออื่นดู')
  }

  const insertActivity = async (attemptCode: string) => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO activity (campaign_id, code, name, input_type, resolve_method, input_config, sort_order)
      VALUES (${campaignId}, ${attemptCode}, ${name}, ${inputType}, ${resolveMethod},
              ${sql.json(inputConfig as never)},
              coalesce((SELECT max(sort_order) + 1 FROM activity
                         WHERE campaign_id = ${campaignId}), 0))
      RETURNING id`
    return row.id
  }

  let created: string
  try {
    created = await insertActivity(code)
  } catch (error) {
    if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error
    // รหัสที่สร้างจากชื่อชนกับกิจกรรมอื่นในแคมเปญเดียวกัน — คนตั้งชื่อซ้ำกันไม่ควร
    // ต้องรู้จัก slug หรือมาแก้เอง ต่อเลขสุ่มสี่หลักแล้วลองอีกครั้งเดียวก็พอ
    const retryCode = `${code}_${Math.floor(Math.random() * 9000 + 1000)}`
    try {
      created = await insertActivity(retryCode)
    } catch (retryError) {
      if ((retryError as { code?: string }).code !== UNIQUE_VIOLATION) throw retryError
      throw new Error(`แคมเปญนี้มีกิจกรรมรหัส "${code}" อยู่แล้ว — ไปแก้ตัวเดิมแทน`)
    }
  }

  touch(campaignId)

  /**
   * ควิซบุคลิกภาพพาไปจอตั้งค่าควิซของ Task 11 ตรง ๆ ไม่ใช่จอ M7-S02 เดิม
   *
   * M7-S02 (ActivitySetup.tsx → fieldsForActivity → fieldsFor()) throw TypeError
   * ทันทีที่เจอ resolve_method เป็น NULL — BY_RESOLVE[null] เป็น undefined แล้ว
   * spread ...undefined ก็ throw โดยไม่มี error boundary ไหนรับไว้เลยในระบบนี้
   * ก่อนหน้านี้ทุกกิจกรรม personality_quiz ที่สร้างเสร็จจะโดนพาไปหน้าที่พังทันที —
   * ตอนนี้แก้แล้วด้วยการพาไปคนละจอ (fieldsForActivity เองก็กันไว้อีกชั้นแล้วเผื่อ
   * ใครกด URL เก่าตรงเข้ามาเอง)
   *
   * if/else จริง ไม่ใช่สอง redirect() เรียงกัน — redirect() ของจริงโยน NEXT_REDIRECT
   * ทันทีเพื่อตัดการทำงานที่เหลือ แต่ mock ของเทสต์ในระบบนี้ (ดู actions.test.ts)
   * แค่จด path ไว้เฉยๆ ไม่โยน ถ้าเขียนเป็นสองบรรทัดเรียงกันแบบไม่มี else เทสต์จะเห็น
   * redirect ตัวที่สองทับตัวแรกเงียบๆ ทั้งที่โปรดักชันจริงไม่มีวันไปถึงบรรทัดนั้น
   */
  if (inputType === 'personality_quiz') {
    redirect(`/campaigns/${campaignId}/activities/${created}/quiz`)
  } else {
    redirect(`/campaigns/${campaignId}/activities/${created}`)
  }
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

/**
 * บันทึกช่องของบล็อก 2 ที่เก็บอยู่ใน input_config (BR-87)
 *
 * The keys this will write are asked of inputConfigFields(), not listed here.
 * That is the write half of the same rule the screen obeys: an activity that
 * does not ask for slots cannot be made to store slots by anyone who edits the
 * request, and a new input type is a new entry in lib/activities/wizard.ts
 * rather than another branch in this file.
 *
 * Keys the current pair does not ask for are left alone rather than cleared.
 * Somebody switching an activity from ตอบคำถาม to ให้เลือกจากตาราง to see the
 * difference should not come back to find their questions deleted.
 */
export async function saveInputConfig(
  campaignId: string, activityId: string, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)
  const activity = await requireActivity(sql, campaignId, activityId)

  const inputType = asInputType(activity.input_type)
  const resolveMethod = asResolveMethod(activity.resolve_method)
  const fields = inputType && resolveMethod ? inputConfigFields(inputType, resolveMethod) : []

  const config: Record<string, unknown> = { ...activity.input_config }
  for (const field of fields) {
    if (field.control === 'toggle') {
      config[field.key] = trimmed(formData, field.key) !== ''
      continue
    }
    if (field.control === 'lines') {
      config[field.key] = String(formData.get(field.key) ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
      continue
    }
    config[field.key] = trimmed(formData, field.key)
  }

  await sql`
    UPDATE activity SET input_config = ${sql.json(config as never)}
     WHERE id = ${activityId} AND campaign_id = ${campaignId}`
  touch(campaignId, activityId)
}

/**
 * ค่าสะสมที่กิจกรรมนี้บวกให้เมื่อเล่นจบ
 *
 * planEffects() reads the *activity's* effect list, not the outcome's, and
 * play_and_apply walks whatever comes out of it. Until an add_units effect sits
 * here, a counter has nothing writing into it — which is exactly what the
 * counter screen sends people over here to fix.
 *
 * The key is `counterCode`, because lib/db/apply.ts converts it to the SQL
 * function's `counter_code` on the way out. Writing snake_case in the column
 * would survive the round trip perfectly and mean nothing to toSqlEffect, and
 * the counter would sit there never moving.
 *
 * Only counters that exist in this campaign can be named, and the list comes
 * from the table rather than the form — a request naming somebody else's
 * counter has nothing to match and is dropped rather than refused, because it
 * cannot come from the screen at all.
 */
export async function saveEffects(
  campaignId: string, activityId: string, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)
  const activity = await requireActivity(sql, campaignId, activityId)

  const counters = await sql<{ code: string }[]>`
    SELECT code FROM counter WHERE campaign_id = ${campaignId} ORDER BY code`

  const added: Array<Record<string, unknown>> = []
  for (const { code } of counters) {
    const raw = trimmed(formData, `units_${code}`)
    if (raw === '') continue

    const amount = asOptionalInt(raw, { min: 1 })
    if (amount === undefined) {
      throw new Error(`จำนวนที่บวกให้ค่าสะสม "${code}" ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป หรือเว้นว่าง`)
    }
    if (amount !== null) added.push({ type: 'add_units', counterCode: code, amount })
  }

  // grant_reward เป็นของ saveOutcome · บันทึกบล็อกนี้ต้องไม่ไปถอดมันทิ้ง
  const kept = asArray<Record<string, unknown>>(activity.effects)
    .filter((effect) => effect.type !== 'add_units')

  await sql`
    UPDATE activity SET effects = ${sql.json([...kept, ...added] as never)}
     WHERE id = ${activityId} AND campaign_id = ${campaignId}`
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

/**
 * id ของผลลัพธ์ที่ยังไม่มีใครใช้
 *
 * It is not decoration: resolve('fixed', …) matches the slot the player tapped
 * against this id, so reusing one would make two outcomes indistinguishable to
 * the engine and hand the player whichever came first in the list.
 */
function nextOutcomeId(outcomes: OutcomeConfig[]): string {
  const taken = new Set(outcomes.map((outcome) => outcome.id))
  let next = outcomes.length + 1
  while (taken.has(`o${next}`)) next += 1
  return `o${next}`
}

/**
 * บันทึกผลลัพธ์หนึ่งแถว · `index` ติดลบคือแถวใหม่ต่อท้าย
 *
 * One action rather than an add followed by a save, because an add of its own
 * writes a row with no card into a live column — which is exactly the shape
 * activityProblems() calls "ผู้เล่นกดแล้วเงียบ". The row is created and filled
 * in the same write, so it never exists in that state.
 */
export async function saveOutcome(
  campaignId: string, activityId: string, index: number, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)
  const activity = await requireActivity(sql, campaignId, activityId)

  const outcomes = asArray<OutcomeConfig>(activity.resolve_config?.outcomes)
  const isNew = index < 0
  const current = isNew ? { id: nextOutcomeId(outcomes) } : outcomes[index]
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

  const updated = isNew
    ? [...outcomes, next]
    : outcomes.map((outcome, at) => (at === index ? next : outcome))
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

/** ชั่วโมงของ time_window · คั่นด้วยจุลภาค และต้องเป็นชั่วโมงที่มีอยู่จริงบนนาฬิกา */
function asHours(raw: string): number[] {
  if (raw === '') return []
  return raw.split(',').map((part) => {
    const hour = Number(part.trim())
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new Error(
        `"${part.trim()}" ไม่ใช่ชั่วโมงที่มีอยู่ — กรอกเป็นตัวเลข 0 ถึง 23 คั่นด้วยจุลภาค`,
      )
    }
    return hour
  })
}

/**
 * แปลงค่าที่กรอกของเงื่อนไขหนึ่งข้อ ตามช่องที่ชนิดนั้นประกาศไว้
 *
 * The field list is read from ENTRY_RULE_FIELDS rather than written out here,
 * for the same reason the activity form is read from fieldsFor(): the key names
 * are what lib/state.ts and lib/engine/entry.ts actually look up, and a second
 * copy of them in the write path is a copy that can drift. Anything the current
 * type did not declare is dropped, so a request carrying a rewardCode for a
 * not_has_attribute rule stores an attribute rule and nothing else.
 */
function readEntryRule(type: EntryRuleConfig['type'], formData: FormData): EntryRuleConfig {
  const rule: EntryRuleConfig = { type }

  for (const field of ENTRY_RULE_FIELDS[type as keyof typeof ENTRY_RULE_FIELDS] ?? []) {
    const raw = trimmed(formData, field.key)
    if (raw === '') continue

    if (field.control === 'number') {
      const value = asOptionalInt(raw, { min: 1 })
      if (value === undefined) {
        throw new Error(`"${field.label}" ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`)
      }
      rule[field.key] = value
      continue
    }

    if (field.control === 'hours') {
      rule[field.key] = asHours(raw)
      continue
    }

    if (field.control === 'op') {
      if (raw !== 'lt' && raw !== 'gte') {
        throw new Error('วิธีเทียบจำนวนครั้งต้องเป็น "ครบแล้วอย่างน้อย" หรือ "ยังไม่ถึง" เท่านั้น')
      }
      rule[field.key] = raw
      continue
    }

    rule[field.key] = raw
  }

  return rule
}

/**
 * บันทึกเงื่อนไขการเข้าเล่นหนึ่งข้อ · `index` ติดลบคือข้อใหม่ต่อท้าย
 *
 * ลำดับคือลำดับที่ engine ตรวจ และผู้เล่นเห็นเหตุผลแรกที่ไม่ผ่าน (BR-26)
 */
export async function saveEntryRule(
  campaignId: string, activityId: string, index: number, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireDraftCampaign(sql, campaignId)
  const activity = await requireActivity(sql, campaignId, activityId)

  const rules = asArray<EntryRuleConfig>(activity.entry_rules)
  const isNew = index < 0
  if (!isNew && !rules[index]) {
    throw new Error('ไม่พบเงื่อนไขข้อนี้ — หน้าจออาจค้างอยู่กับข้อมูลเก่า')
  }

  const type = asEntryRuleType(trimmed(formData, 'type'))
  if (!type) throw new Error('ต้องเลือกชนิดเงื่อนไขที่ engine ตรวจได้')

  const cardRaw = trimmed(formData, 'card_id')
  if (cardRaw) {
    const [card] = await sql<{ id: string }[]>`
      SELECT id FROM card WHERE id = ${cardRaw} AND campaign_id = ${campaignId}`
    if (!card) throw new Error('การ์ดที่ตอบเมื่อไม่ผ่านต้องเป็นการ์ดของแคมเปญนี้')
  }

  const next = readEntryRule(type, formData)
  if (cardRaw) next.cardId = cardRaw

  const updated = isNew
    ? [...rules, next]
    : rules.map((rule, at) => (at === index ? next : rule))
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
