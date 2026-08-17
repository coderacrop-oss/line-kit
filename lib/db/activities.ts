import type postgres from 'postgres'
import {
  type InputType, type ResolveMethod, comboProblem, fieldsFor,
  inputTypeName, resolveMethodName,
} from '../activities/wizard'

/**
 * ผลลัพธ์หนึ่งแถว อย่างที่ engine อ่านจริง
 *
 * The key names are the engine's, not the column's: lib/engine/resolve.ts reads
 * `cardId`, `weight`, `rewardCode`, `scoreMin` and `scoreMax` straight off the
 * JSONB, and lib/db/queries.ts hands it `resolve_config.outcomes` untouched. A
 * screen that wrote snake_case here would produce outcomes the engine parses as
 * having no card and no reward, which is a campaign that answers nobody.
 */
export type OutcomeConfig = {
  id: string
  cardId?: string
  weight?: number
  rewardCode?: string
  scoreMin?: number
  scoreMax?: number
  label?: string
}

/** เงื่อนไขการเข้าเล่นหนึ่งข้อ · `cardId` คือการ์ดที่ตอบเมื่อไม่ผ่าน (BR-26) */
export type EntryRuleConfig = { type: string; cardId?: string; [key: string]: unknown }

export const ENTRY_RULE_TYPES = [
  'limit', 'time_window', 'has_attribute', 'not_has_attribute', 'has_entitlement',
  'activity_completed', 'activity_not_completed', 'activity_play_count',
] as const
export type EntryRuleType = (typeof ENTRY_RULE_TYPES)[number]

export const ENTRY_RULE_NAME: Record<EntryRuleType, string> = {
  limit: 'จำกัดจำนวนครั้งต่อรอบ',
  time_window: 'เล่นได้เฉพาะช่วงเวลา',
  has_attribute: 'ต้องมีค่าประจำตัว',
  not_has_attribute: 'ต้องไม่มีค่าประจำตัว',
  has_entitlement: 'ต้องถือสิทธิ์รางวัล',
  activity_completed: 'ต้องเล่นกิจกรรมอื่นจบแล้ว',
  activity_not_completed: 'ต้องยังไม่เล่นกิจกรรมอื่น',
  activity_play_count: 'ต้องเล่นกิจกรรมอื่นครบจำนวน',
}

export const asEntryRuleType = (raw: string | undefined | null): EntryRuleType | null =>
  (ENTRY_RULE_TYPES as readonly string[]).includes(raw ?? '') ? (raw as EntryRuleType) : null

export type ActivityRow = {
  id: string
  code: string
  name: string
  input_type: InputType
  /** ตารางรับ 'lookup' ด้วย · แถวเก่าที่เป็น lookup ยังต้องอ่านขึ้นมาแสดงได้ */
  resolve_method: ResolveMethod | 'lookup'
  input_config: Record<string, unknown>
  resolve_config: { outcomes?: OutcomeConfig[] }
  entry_rules: EntryRuleConfig[]
  effects: Array<Record<string, unknown>>
  fallback_card_id: string | null
  trigger: 'manual' | 'follow'
  is_enabled: boolean
  sort_order: number
  /** ทุกทางที่พาผู้เล่นมาถึงกิจกรรมนี้ · ว่างคือไม่มีทางเข้าถึง */
  reached_by: string[]
  /** ชื่อการ์ดที่ผลลัพธ์ของกิจกรรมนี้พาไป */
  links: string[]
}

export type ActivityView = {
  id: string
  code: string
  name: string
  inputType: InputType
  resolveMethod: ResolveMethod | 'lookup'
  inputName: string
  resolveName: string
  comboName: string
  isEnabled: boolean
  isFollowEntry: boolean
  trigger: 'manual' | 'follow'
  fallbackCardId: string | null
  outcomes: OutcomeConfig[]
  entryRules: EntryRuleConfig[]
  /** ทุกอย่างที่ยังกรอกไม่ครบ · ว่างคือพร้อมส่งขึ้น */
  problems: string[]
  isIncomplete: boolean
  isUnreachable: boolean
  reachedBy: string[]
  conditionText: string
  links: string[]
  sortOrder: number
}

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

/** ชื่อคู่แกนอย่างที่ป้ายบนหัวจอเขียน · `{{ aeInN }} × {{ aeRsN }}` ของต้นแบบ */
export function comboName(input: InputType, resolve: ResolveMethod | 'lookup'): string {
  const right = resolve === 'lookup' ? 'ค้นจากตาราง' : resolveMethodName(resolve)
  return `${inputTypeName(input)} × ${right}`
}

/**
 * ทุกอย่างที่ทำให้กิจกรรมนี้ยังส่งขึ้นไม่ได้ เรียงจากที่ทำให้พังก่อน
 *
 * Every item is something a player would hit, not something a linter dislikes.
 * An outcome with no card is a tap that answers nothing; an entry rule with no
 * card is a refusal the player is never told about (BR-26); quota with no
 * fallback is the moment the stock runs out and the next person gets silence
 * (BR-31). They are collected rather than thrown one at a time because the
 * person fixing them wants the list, not a sequence of ten reloads.
 */
export function activityProblems(row: ActivityRow): string[] {
  const problems: string[] = []
  const outcomes = asArray<OutcomeConfig>(row.resolve_config?.outcomes)
  const rules = asArray<EntryRuleConfig>(row.entry_rules)

  if (row.resolve_method === 'lookup') {
    problems.push('วิธีตัดสินผล "ค้นจากตาราง" ยังไม่รองรับในรอบนี้ — เลือกวิธีอื่นก่อนส่งขึ้น')
  } else {
    const combo = comboProblem(row.input_type, row.resolve_method)
    if (combo) problems.push(combo)
  }

  if (outcomes.length === 0) {
    problems.push('ยังไม่มีผลลัพธ์สักอัน — กิจกรรมที่ไม่ตอบอะไรเลยไม่มีความหมาย')
  }

  outcomes.forEach((outcome, index) => {
    if (!outcome.cardId) {
      problems.push(`ผลลัพธ์ที่ ${index + 1} ยังไม่ได้เลือกการ์ดที่ตอบ — ผู้เล่นกดแล้วเงียบ`)
    }
  })

  if (row.resolve_method === 'score') {
    outcomes.forEach((outcome, index) => {
      if (outcome.scoreMin === undefined && outcome.scoreMax === undefined) {
        problems.push(`ผลลัพธ์ที่ ${index + 1} ยังไม่ได้ตั้งช่วงคะแนน — ไม่มีคะแนนไหนเข้าช่วงนี้`)
      }
    })
  }

  // BR-31 · การ์ดสำรองบังคับเมื่อของหมดได้
  if (row.resolve_method === 'quota' && !row.fallback_card_id) {
    problems.push(
      'วิธีตัดสินผลแบบโควตาต้องมีการ์ดสำรองเมื่อของหมด (BR-31)'
      + ' — ของหมดแล้วยังมีคนกดเล่น คนนั้นจะไม่ได้รับอะไรเลย',
    )
  }

  // BR-26 · ทุกเงื่อนไขต้องมีการ์ดตอบ
  rules.forEach((rule, index) => {
    if (!rule.cardId) {
      problems.push(
        `เงื่อนไขที่ ${index + 1} ยังไม่ได้เลือกการ์ดที่ตอบเมื่อไม่ผ่าน (BR-26)`
        + ' — ผู้เล่นที่ติดเงื่อนไขนี้กดแล้วเงียบ',
      )
    }
  })

  if (row.input_type === 'pick_one' && asArray(row.input_config?.slots).length === 0) {
    problems.push('อินพุตแบบเลือกหนึ่งช่องยังไม่มีช่องให้เลือกสักช่อง')
  }

  if (row.input_type === 'quiz' && asArray(row.input_config?.questions).length === 0) {
    problems.push('อินพุตแบบตอบคำถามยังไม่มีคำถามสักข้อ')
  }

  return problems
}

/** ประโยคสรุปเงื่อนไขที่แถวในรายการแสดง · ไม่มีเงื่อนไขก็บอกตรงๆ ว่าเล่นได้เสมอ */
export function conditionText(rules: EntryRuleConfig[]): string {
  if (rules.length === 0) return 'ไม่มีเงื่อนไข — ผู้เล่นกดเล่นได้เสมอ'
  return rules
    .map((rule) => ENTRY_RULE_NAME[rule.type as EntryRuleType] ?? `เงื่อนไขที่ระบบไม่รู้จัก (${rule.type})`)
    .join(' · ')
}

/**
 * แถวหนึ่งของกิจกรรม อย่างที่จอต้องใช้
 *
 * `isUnreachable` is the claim worth opening the screen for. An activity with
 * no keyword pointing at it, no button carrying its code, and no follow trigger
 * cannot be started by anybody — it is configuration that will never run, and
 * nothing else in the system says so. It is derived from where the entrances
 * actually live rather than from a column, because no column records it.
 */
export function summarizeActivity(row: ActivityRow): ActivityView {
  const problems = activityProblems(row)
  const rules = asArray<EntryRuleConfig>(row.entry_rules)
  const reachedBy = row.reached_by ?? []

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    inputType: row.input_type,
    resolveMethod: row.resolve_method,
    inputName: inputTypeName(row.input_type),
    resolveName: row.resolve_method === 'lookup' ? 'ค้นจากตาราง' : resolveMethodName(row.resolve_method),
    comboName: comboName(row.input_type, row.resolve_method),
    isEnabled: row.is_enabled,
    isFollowEntry: row.trigger === 'follow',
    trigger: row.trigger,
    fallbackCardId: row.fallback_card_id,
    outcomes: asArray<OutcomeConfig>(row.resolve_config?.outcomes),
    entryRules: rules,
    problems,
    isIncomplete: problems.length > 0,
    // กิจกรรมทักทายมีทางเข้าอยู่ในตัวมันเอง · ไม่ต้องมีคีย์เวิร์ดหรือปุ่มชี้มา
    isUnreachable: row.trigger !== 'follow' && reachedBy.length === 0,
    reachedBy,
    conditionText: conditionText(rules),
    links: row.links ?? [],
    sortOrder: row.sort_order,
  }
}

/** ช่องที่ฟอร์มของกิจกรรมนี้ต้องถาม · lookup ยังไม่มีฟอร์มของตัวเองในรอบนี้ */
export const fieldsForActivity = (view: ActivityView) =>
  view.resolveMethod === 'lookup' ? [] : fieldsFor(view.inputType, view.resolveMethod)

/**
 * ทุกทางเข้าที่พาผู้เล่นมาถึงกิจกรรม ตามที่ schema เขียนไว้จริง
 *
 * Three of them, and none is a column saying so. A keyword rule names the
 * activity by id; a button on a card carries its code inside the postback that
 * lib/match/postback.ts encodes as `a=<code>`; and the follow trigger is an
 * entrance the activity carries itself. Matching the postback as text is what
 * the payload actually is — the encoder writes `c=…&a=…&d=…` into one string,
 * so there is no key to read out of the JSON.
 */
function selectActivities(sql: postgres.Sql, where: postgres.PendingQuery<ActivityRow[]>) {
  return sql<ActivityRow[]>`
    SELECT a.id, a.code, a.name, a.input_type, a.resolve_method,
           a.input_config, a.resolve_config, a.entry_rules, a.effects,
           a.fallback_card_id, a.trigger, a.is_enabled, a.sort_order,
           reached.labels AS reached_by,
           linked.labels AS links
      FROM activity a
      CROSS JOIN LATERAL (
        SELECT coalesce(array_agg(label ORDER BY label), ARRAY[]::text[]) AS labels
          FROM (
            SELECT 'คีย์เวิร์ด "' || k.keyword || '"' AS label
              FROM keyword_rule k
             WHERE k.campaign_id = a.campaign_id AND k.target_activity_id = a.id
             UNION
            SELECT 'ปุ่มบนการ์ด "' || c.code || '"'
              FROM card c JOIN card_block b ON b.card_id = c.id
             WHERE c.campaign_id = a.campaign_id AND b.block_type = 'button'
               AND coalesce(b.options->'action'->>'data', '') ~ ('(^|&)a=' || a.code || '($|&)')
          ) entrances
      ) reached
      CROSS JOIN LATERAL (
        SELECT coalesce(array_agg(DISTINCT c.code), ARRAY[]::text[]) AS labels
          FROM jsonb_array_elements(coalesce(a.resolve_config->'outcomes', '[]'::jsonb)) o
          JOIN card c ON c.id = (o->>'cardId')::uuid AND c.campaign_id = a.campaign_id
      ) linked
     ${where}
     ORDER BY a.sort_order, a.code`
}

export async function listActivities(
  sql: postgres.Sql, campaignId: string,
): Promise<ActivityView[]> {
  const rows = await selectActivities(sql, sql<ActivityRow[]>`WHERE a.campaign_id = ${campaignId}`)
  return rows.map(summarizeActivity)
}

export type CardOption = { id: string; code: string; name: string }

export type ActivityScreen = {
  activity: ActivityView
  cards: CardOption[]
  rewardCodes: string[]
  counterCodes: string[]
  /** กิจกรรมอื่นในแคมเปญ · เงื่อนไขที่อ้างกิจกรรมเลือกจากรายการนี้ */
  siblings: Array<{ id: string; code: string; name: string }>
}

export async function loadActivity(
  sql: postgres.Sql, campaignId: string, id: string,
): Promise<ActivityScreen | null> {
  const [row] = await selectActivities(
    sql, sql<ActivityRow[]>`WHERE a.campaign_id = ${campaignId} AND a.id = ${id}`,
  )
  if (!row) return null

  const [cards, rewards, counters, siblings] = await Promise.all([
    sql<CardOption[]>`
      SELECT id, code, coalesce(name, code) AS name FROM card
       WHERE campaign_id = ${campaignId} ORDER BY code`,
    sql<{ code: string }[]>`
      SELECT code FROM reward WHERE campaign_id = ${campaignId} ORDER BY code`,
    sql<{ code: string }[]>`
      SELECT code FROM counter WHERE campaign_id = ${campaignId} ORDER BY code`,
    sql<{ id: string; code: string; name: string }[]>`
      SELECT id, code, name FROM activity
       WHERE campaign_id = ${campaignId} AND id <> ${id} ORDER BY sort_order, code`,
  ])

  return {
    activity: summarizeActivity(row),
    cards,
    rewardCodes: rewards.map((r) => r.code),
    counterCodes: counters.map((c) => c.code),
    siblings,
  }
}

/**
 * กิจกรรมที่ถือทริกเกอร์ "ตอนแอดเป็นเพื่อน" อยู่ (BR-90)
 *
 * The partial unique index refuses the second one, and a constraint name is not
 * something the person on the screen can act on. Knowing which activity holds
 * it — and being able to click through and take it away — is the difference
 * between a refusal and an instruction.
 */
export async function followHolder(
  sql: postgres.Sql, campaignId: string, exceptId?: string,
): Promise<{ id: string; code: string; name: string } | null> {
  const [row] = await sql<{ id: string; code: string; name: string }[]>`
    SELECT id, code, name FROM activity
     WHERE campaign_id = ${campaignId} AND trigger = 'follow'
       AND (${exceptId ?? null}::uuid IS NULL OR id <> ${exceptId ?? null}::uuid)
     LIMIT 1`
  return row ?? null
}
