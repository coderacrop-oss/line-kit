import type postgres from 'postgres'
import {
  type InputType, type ResolveMethod, comboProblem, fieldsFor,
  inputTypeName, resolveMethodName,
} from '../activities/wizard'
import { QuizConfig } from '../quiz/schema'

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

/** ตัวควบคุมที่จอวาดให้ช่องของเงื่อนไข · จอมีตัวละหนึ่งแบบ */
export const ENTRY_RULE_CONTROLS = ['number', 'text', 'reward', 'activity', 'op', 'hours'] as const
export type EntryRuleControl = (typeof ENTRY_RULE_CONTROLS)[number]

export type EntryRuleField = {
  /** คีย์ที่ engine อ่านจาก JSONB · เป็นชื่อของช่องในฟอร์มด้วย จะได้ไม่มีตารางแปลงชื่อ */
  key: string
  label: string
  control: EntryRuleControl
  required: boolean
  hint?: string
}

/**
 * ช่องของเงื่อนไขแต่ละชนิด ถอดจากสิ่งที่ evaluate() กับ passes() อ่านจริง
 *
 * The key names are not a convention, they are the read side written down:
 * lib/state.ts asks a has_entitlement condition for `rewardCode` and the three
 * activity conditions for `activityCode`, and lib/engine/entry.ts asks limit for
 * `count`. Storing a generic key/value pair instead — which is what this screen
 * did before — produces a rule that is false for every player forever. Nothing
 * reports it, because from the engine's side the condition simply did not hold,
 * and the campaign quietly refuses everybody at the door.
 *
 * Required means the engine has nothing to compare without it. `value` on
 * has_attribute is the one honest optional: evaluate() treats a missing value as
 * "holding this key at all is enough", which is a condition people really write.
 */
export const ENTRY_RULE_FIELDS: Record<EntryRuleType, EntryRuleField[]> = {
  limit: [
    {
      key: 'count',
      label: 'เล่นได้กี่ครั้งต่อรอบ',
      control: 'number',
      required: false,
      hint: 'ไม่กรอก = 1 ครั้ง · รอบหนึ่งคือหนึ่งวันของแคมเปญตามความยาววันที่ตั้งไว้',
    },
  ],
  time_window: [
    {
      key: 'hoursOfDay',
      label: 'ชั่วโมงที่เล่นได้',
      control: 'hours',
      required: false,
      hint: 'คั่นด้วยจุลภาค เช่น 9,10,11 · เว้นว่าง = เล่นได้ทั้งวันตลอดช่วงแคมเปญ',
    },
    {
      key: 'timezone',
      label: 'เขตเวลาที่ใช้นับชั่วโมง',
      control: 'text',
      required: false,
      hint: 'เว้นว่าง = UTC ซึ่งเร็วกว่าเวลาไทย 7 ชั่วโมง · กรอก Asia/Bangkok ถ้าหมายถึงเวลาไทย',
    },
  ],
  has_attribute: [
    { key: 'key', label: 'ชื่อค่าประจำตัว', control: 'text', required: true },
    {
      key: 'value',
      label: 'ต้องเท่ากับ',
      control: 'text',
      required: false,
      hint: 'เว้นว่าง = มีค่าประจำตัวนี้อยู่ก็พอ ไม่สนว่าค่าเป็นอะไร',
    },
  ],
  not_has_attribute: [
    { key: 'key', label: 'ชื่อค่าประจำตัว', control: 'text', required: true },
  ],
  has_entitlement: [
    { key: 'rewardCode', label: 'รางวัลที่ต้องถืออยู่', control: 'reward', required: true },
  ],
  activity_completed: [
    { key: 'activityCode', label: 'กิจกรรมที่ต้องเล่นจบแล้ว', control: 'activity', required: true },
  ],
  activity_not_completed: [
    { key: 'activityCode', label: 'กิจกรรมที่ต้องยังไม่เล่น', control: 'activity', required: true },
  ],
  activity_play_count: [
    { key: 'activityCode', label: 'กิจกรรมที่นับจำนวนครั้ง', control: 'activity', required: true },
    { key: 'op', label: 'เทียบแบบไหน', control: 'op', required: true },
    { key: 'count', label: 'จำนวนครั้ง', control: 'number', required: true },
  ],
}

/** ตัวเลือกของ `op` ใน activity_play_count · ตรงกับ Condition ใน lib/state.ts */
export const PLAY_COUNT_OPS: Array<{ value: 'lt' | 'gte'; label: string }> = [
  { value: 'gte', label: 'ครบแล้วอย่างน้อย' },
  { value: 'lt', label: 'ยังไม่ถึง' },
]

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
  /** ค่าของบล็อก 2 อย่างที่เก็บไว้ · จอเติมกลับเข้าช่องจากตรงนี้ */
  inputConfig: Record<string, unknown>
  /** รหัสค่าสะสม → จำนวนที่กิจกรรมนี้บวกให้เมื่อเล่นจบ · ถอดจาก effects */
  counterUnits: Record<string, number>
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
  const rules = asArray<EntryRuleConfig>(row.entry_rules)

  /**
   * personality_quiz ไม่มี resolve_config.outcomes เลย — เนื้อหาทั้งชุด (แกน/คำถาม/
   * ผลลัพธ์) อยู่ใน input_config แทน (ดู lib/quiz/schema.ts) ก่อนแก้ตรงนี้ ด่านข้างล่าง
   * (ยังไม่มีผลลัพธ์สักอัน · BR-31 · comboProblem) จะติดกับกิจกรรมชนิดนี้เสมอเพราะ
   * outcomes ว่างเป็นค่าเริ่มต้นที่ไม่มีวันถูกเติม — แคมเปญที่มีควิซจึง publish ไม่ได้
   * เลยสักครั้ง (Finding 1 ของรีวิวรอบสุดท้าย) เช็คด้วย QuizConfig.safeParse() แทน
   */
  if (row.input_type === 'personality_quiz') {
    if (!QuizConfig.safeParse(row.input_config).success) {
      problems.push('ควิซยังตั้งค่าไม่ครบ — ไปตั้งแกน/คำถาม/ผลลัพธ์ให้ครบที่จอตั้งค่าควิซก่อนส่งขึ้น')
    }
  } else {
    const outcomes = asArray<OutcomeConfig>(row.resolve_config?.outcomes)

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
  }

  // BR-26 · ทุกเงื่อนไขต้องมีการ์ดตอบ
  rules.forEach((rule, index) => {
    if (!rule.cardId) {
      problems.push(
        `เงื่อนไขที่ ${index + 1} ยังไม่ได้เลือกการ์ดที่ตอบเมื่อไม่ผ่าน (BR-26)`
        + ' — ผู้เล่นที่ติดเงื่อนไขนี้กดแล้วเงียบ',
      )
    }

    // ค่าที่ engine ต้องอ่านแต่ไม่มี · เงื่อนไขนั้นเป็นเท็จกับทุกคนตลอดไป
    // และไม่มี error ที่ไหนบอก เพราะฝั่ง engine มันแค่ "ไม่ผ่าน" เฉยๆ
    for (const field of ENTRY_RULE_FIELDS[rule.type as EntryRuleType] ?? []) {
      const value = rule[field.key]
      if (field.required && (value === undefined || value === null || value === '')) {
        problems.push(
          `เงื่อนไขที่ ${index + 1} ยังไม่ได้กรอก "${field.label}"`
          + ' — ค่าที่ขาดทำให้เงื่อนไขนี้เป็นเท็จกับทุกคน แคมเปญจะกันผู้เล่นออกทั้งหมดโดยไม่มีอะไรฟ้อง',
        )
      }
    }
  })

  if (row.input_type === 'pick_one' && asArray(row.input_config?.slots).length === 0) {
    problems.push('อินพุตแบบให้เลือกจากตารางยังไม่มีช่องให้เลือกสักช่อง')
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
 * ค่าสะสมที่กิจกรรมนี้บวกให้ · อ่านจาก effects ของกิจกรรม ไม่ใช่ของผลลัพธ์
 *
 * planEffects() walks the activity's list, and lib/db/apply.ts turns
 * `counterCode` into the SQL function's `counter_code` on the way out. Reading
 * the same key back is what lets the screen show what is actually configured
 * rather than an empty box beside a counter that is already being written to.
 */
function counterUnits(effects: unknown): Record<string, number> {
  const units: Record<string, number> = {}
  for (const effect of asArray<Record<string, unknown>>(effects)) {
    if (effect.type !== 'add_units') continue
    const code = effect.counterCode
    if (typeof code !== 'string' || code === '') continue
    units[code] = Number(effect.amount ?? 1)
  }
  return units
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
    inputConfig: row.input_config ?? {},
    counterUnits: counterUnits(row.effects),
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

/**
 * ช่องที่ฟอร์มของกิจกรรมนี้ต้องถาม · lookup ยังไม่มีฟอร์มของตัวเองในรอบนี้
 *
 * personality_quiz มี resolve_method เป็น NULL จริงในฐานข้อมูล (CHECK ของ
 * 0014_quiz_engine.sql บังคับไว้) แม้ type ของ resolveMethod ในไฟล์นี้จะประกาศว่า
 * ไม่มี null ก็ตาม (ประกาศไว้แบบนั้นมาตั้งแต่ก่อน personality_quiz จะมีอยู่) —
 * cast ตรงนี้เพื่อเช็ค runtime ตามความจริงของคอลัมน์ ไม่ใช่ตามชนิดที่ประกาศไว้ ก่อน
 * ส่งต่อให้ fieldsFor() ซึ่งจะ throw TypeError ถ้า resolve เป็น null
 * (BY_RESOLVE[null] เป็น undefined แล้ว spread ...undefined ก็ throw ทันที — พิสูจน์
 * จริงแล้วว่า M7-S02 พังทั้งจอถ้าใครกดตรงเข้ามาที่กิจกรรมชนิดนี้) จอ M7-S02 ไม่ควร
 * มาถึงฟังก์ชันนี้เลยสำหรับ personality_quiz (ActivityRow.tsx และ actions.ts เปลี่ยน
 * ทางไปจอควิซแทนแล้ว) แต่การกันไว้ที่นี่ทำให้ URL ตรงเข้ามาก็ไม่พังเหมือนกัน
 */
export const fieldsForActivity = (view: ActivityView) => {
  const resolveMethod = view.resolveMethod as ResolveMethod | 'lookup' | null
  if (resolveMethod === null || resolveMethod === 'lookup') return []
  return fieldsFor(view.inputType, resolveMethod)
}

/**
 * ประโยคเดียวที่บอกว่าตอนนี้กิจกรรมนี้ทำอะไรอยู่ · กล่อง "สรุปการตั้งค่าปัจจุบัน" ของต้นแบบ
 *
 * Written as a sentence rather than a row of counters because the thing worth
 * catching here is a combination that reads wrong out loud — an activity that is
 * fully filled in, switched on, and has no way for anybody to start it.
 */
export function activitySummary(view: ActivityView): string {
  const entrance = view.isFollowEntry
    ? 'เริ่มเล่นตอนแอดเป็นเพื่อน'
    : view.isUnreachable
      ? 'ไม่มีทางเข้าถึง — ยังไม่มีคีย์เวิร์ดหรือปุ่มไหนพามา'
      : `เข้าจาก ${view.reachedBy.join(' · ')}`

  return [
    view.comboName,
    `ผลลัพธ์ ${view.outcomes.length} อัน`,
    `เงื่อนไข ${view.entryRules.length} ข้อ`,
    entrance,
    view.isEnabled ? 'เปิดอยู่' : 'ปิดอยู่ — ยังไม่ถูกโหลดขึ้นตอนส่งขึ้น LINE',
  ].join(' · ')
}

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

/**
 * การ์ดหนึ่งใบอย่างที่ช่องเลือกการ์ดต้องใช้
 *
 * ไม่มีชื่อ เพราะตาราง card ไม่มีคอลัมน์ชื่อเลย · ตัวตนเดียวที่การ์ดมีคือ code
 * ซึ่งเป็นสิ่งที่ปุ่มบนการ์ดใบอื่นอ้างถึงอยู่แล้ว · เหตุผลเดียวกับรางวัลที่จอ M7-S04
 * ใช้รหัสเป็นหัวข้อของแถว
 */
export type CardOption = { id: string; code: string }

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
      SELECT id, code FROM card WHERE campaign_id = ${campaignId} ORDER BY code`,
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
