import type postgres from 'postgres'

/** ตรงกับ CHECK ของ card_selector.returns */
export const SELECTOR_RETURNS = ['card', 'asset', 'text'] as const
export type SelectorReturn = (typeof SELECTOR_RETURNS)[number]

export const RETURN_NAME: Record<SelectorReturn, string> = {
  card: 'การ์ด',
  asset: 'ภาพ',
  text: 'ข้อความ',
}

/** ตรงกับ CHECK ของ card_selector.source_type */
export const SELECTOR_SOURCES = [
  'result', 'attribute', 'counter_level', 'campaign_day', 'campaign_round',
] as const
export type SelectorSource = (typeof SELECTOR_SOURCES)[number]

export const SOURCE_NAME: Record<SelectorSource, string> = {
  result: 'ผลลัพธ์ของกิจกรรม',
  attribute: 'ค่าที่ผู้เล่นตอบไว้',
  counter_level: 'ระดับของค่าสะสม',
  campaign_day: 'วันที่ของแคมเปญ',
  campaign_round: 'รอบของแคมเปญ',
}

/**
 * สองชนิดที่ source_key เก็บ "ความยาวรอบ" แทนที่จะเก็บชื่อของค่า
 *
 * card_selector has one source_key column and five source types, so the column
 * means a different thing depending on the row. Writing that down here is what
 * stops the two form fields on the edit screen from both trying to own it.
 */
export const CYCLE_SOURCES: readonly SelectorSource[] = ['campaign_day', 'campaign_round']

export const isCycleSource = (source: SelectorSource): boolean => CYCLE_SOURCES.includes(source)

/** สิ่งที่พิมพ์ลงช่อง "เลือกจากค่าไหน" ของแต่ละชนิด · ว่างคือชนิดนั้นไม่ต้องการ */
export const SOURCE_KEY_HINT: Record<SelectorSource, string> = {
  result: 'รหัสกิจกรรมที่จะอ่านผลลัพธ์ เช่น daily_draw — เว้นว่างได้ถ้ามีกิจกรรมเดียว',
  attribute: 'ชื่อค่าที่ผู้เล่นตอบไว้ เช่น pet_type',
  counter_level: 'รหัสค่าสะสมที่จะอ่านระดับ เช่น checkin_days',
  campaign_day: 'ชนิดนี้ไม่ได้ใช้ช่องนี้ — ใส่ความยาวรอบในช่องถัดไปแทน',
  campaign_round: 'ชนิดนี้ไม่ได้ใช้ช่องนี้ — ใส่ความยาวรอบในช่องถัดไปแทน',
}

/** คำอธิบายใต้ตารางว่าช่องเงื่อนไขรับอะไร · ต่างกันตามชนิดของค่าที่อ่าน */
export const SOURCE_COND_HINT: Record<SelectorSource, string> = {
  result: 'ใส่รหัสผลลัพธ์ให้ตรงตัว เช่น big_win',
  attribute: 'ใส่ค่าที่ผู้เล่นตอบไว้ให้ตรงตัว เช่น cat',
  counter_level: 'ใส่ตัวเลข ช่วง 3-5 หรือปลายเปิด ≥3 และ ≤5',
  campaign_day: 'ใส่วันที่เป็นตัวเลข ช่วง 1-7 หรือปลายเปิด ≥8',
  campaign_round: 'ใส่รอบเป็นตัวเลข ช่วง 1-4 หรือปลายเปิด ≥5',
}

export const asSelectorReturn = (raw: string | undefined | null): SelectorReturn | null =>
  (SELECTOR_RETURNS as readonly string[]).includes(raw ?? '') ? (raw as SelectorReturn) : null

export const asSelectorSource = (raw: string | undefined | null): SelectorSource | null =>
  (SELECTOR_SOURCES as readonly string[]).includes(raw ?? '') ? (raw as SelectorSource) : null

/**
 * เพดานของตารางทางเลือก (BR-27)
 *
 * Ten, because past ten nobody proofreads the table any more, and the row that
 * stops being read is the row that ships wrong. Splitting into a second set and
 * pointing a different block at it costs nothing.
 */
export const MAX_OPTIONS = 10

/** เตือนตั้งแต่ยังไม่ชน เพราะคนที่กำลังพิมพ์แถวที่แปดควรได้ยินก่อนแถวที่สิบเอ็ด */
export const NEAR_FULL_OPTIONS = 8

export type SelectorOptionRow = {
  id: string
  match_value: string | null
  range_min: number | null
  range_max: number | null
  result_value: string
  sort_order: number
}

/** ค่าที่ลงคอลัมน์เงื่อนไขทั้งสาม · อย่างน้อยหนึ่งตัวต้องไม่เป็น null ตาม CHECK */
export type Condition = {
  match_value: string | null
  range_min: number | null
  range_max: number | null
}

export type ConditionParse =
  | { ok: true; condition: Condition }
  | { ok: false; problem: string }

const RANGE = /^(\d{1,9})\s*[-–]\s*(\d{1,9})$/
const AT_LEAST = /^(?:>=|≥)\s*(\d{1,9})$/
const AT_MOST = /^(?:<=|≤)\s*(\d{1,9})$/

/**
 * อ่านช่องเงื่อนไขช่องเดียวให้เป็นสามคอลัมน์ที่ตารางมีจริง
 *
 * The prototype draws one narrow box and the table has three columns behind it,
 * with CHECK (match_value IS NOT NULL OR range_min IS NOT NULL OR range_max IS
 * NOT NULL) refusing a row that fills none of them. Parsing here rather than at
 * the database means an empty box is answered with a sentence instead of a
 * constraint name, and it means "3-5" is one decision written in one place
 * rather than a convention each screen re-invents.
 *
 * A bare number stays an exact match rather than becoming a one-wide range. An
 * attribute of "3" and a counter level of 3 are both written 3, and only the
 * exact column can hold the first of those.
 */
export function parseCondition(raw: string): ConditionParse {
  const text = raw.trim()
  if (text === '') {
    return { ok: false, problem: 'ต้องกรอกเงื่อนไขของแถวนี้ — แถวที่ไม่มีเงื่อนไขไม่มีทางถูกเลือก' }
  }
  if (text.length > 100) {
    return { ok: false, problem: 'เงื่อนไขยาวได้ไม่เกิน 100 ตัวอักษร' }
  }

  const range = RANGE.exec(text)
  if (range) {
    const min = Number(range[1])
    const max = Number(range[2])
    if (min > max) {
      return { ok: false, problem: `ช่วง "${text}" กลับหัว — ตัวหน้าต้องไม่มากกว่าตัวหลัง` }
    }
    return { ok: true, condition: { match_value: null, range_min: min, range_max: max } }
  }

  const atLeast = AT_LEAST.exec(text)
  if (atLeast) {
    return { ok: true, condition: { match_value: null, range_min: Number(atLeast[1]), range_max: null } }
  }

  const atMost = AT_MOST.exec(text)
  if (atMost) {
    return { ok: true, condition: { match_value: null, range_min: null, range_max: Number(atMost[1]) } }
  }

  return { ok: true, condition: { match_value: text, range_min: null, range_max: null } }
}

/** เขียนสามคอลัมน์กลับเป็นข้อความในช่องเดียว · อ่านแล้วแก้แล้วบันทึกต้องได้ของเดิม */
export function describeCondition(option: Condition): string {
  if (option.match_value !== null) return option.match_value
  if (option.range_min !== null && option.range_max !== null) {
    return `${option.range_min}-${option.range_max}`
  }
  if (option.range_min !== null) return `≥${option.range_min}`
  if (option.range_max !== null) return `≤${option.range_max}`
  return ''
}

export type SelectorRow = {
  id: string
  name: string
  returns: SelectorReturn
  source_type: SelectorSource
  source_key: string | null
  fallback_value: string
  option_count: number
  /** ทุกบล็อกของทุกการ์ดที่ดึงชุดนี้ไปใช้ · ว่างคือไม่มีใครใช้ */
  used_by: string[]
}

export type SelectorView = {
  id: string
  name: string
  returns: SelectorReturn
  returnName: string
  sourceType: SelectorSource
  sourceName: string
  sourceKey: string | null
  isCycle: boolean
  /** ความยาวรอบเป็นวัน · null เมื่อชนิดนี้ไม่ได้เป็นรอบ หรือยังไม่ได้ตั้ง */
  cycleDays: number | null
  cycleText: string | null
  condHint: string
  fallbackValue: string
  optionCount: number
  countText: string
  isNearFull: boolean
  isFull: boolean
  usedBy: string[]
  isOrphan: boolean
  canDelete: boolean
  deleteBlockedWhy: string | null
}

/**
 * แถวหนึ่งของชุดเนื้อหา อย่างที่จอต้องใช้
 *
 * The fallback is not summarised as "missing" anywhere, because it cannot be:
 * fallback_value is NOT NULL and every path that writes a selector goes through
 * a form that demands it. That is BR-27 the way it is meant to be held — the
 * set is consulted at the moment a card is being answered, and a set with
 * nothing to return is a card with nothing to say, so the moment to refuse is
 * before the row exists rather than in a warning on a list.
 *
 * Deletion is blocked by naming the blocks that point here. The table would
 * refuse too — card_block.selector_id has no ON DELETE clause, so the foreign
 * key is NO ACTION — but a constraint name does not tell anybody which card to
 * open first.
 */
export function summarizeSelector(row: SelectorRow): SelectorView {
  const usedBy = row.used_by ?? []
  const isCycle = isCycleSource(row.source_type)

  const cycleDays = isCycle && row.source_key !== null && /^\d+$/.test(row.source_key)
    ? Number(row.source_key)
    : null

  const deleteBlockedWhy = usedBy.length > 0
    ? `ลบไม่ได้ — ${usedBy.join(' · ')} ดึงชุดนี้ไปใช้อยู่`
    : null

  return {
    id: row.id,
    name: row.name,
    returns: row.returns,
    returnName: RETURN_NAME[row.returns],
    sourceType: row.source_type,
    sourceName: SOURCE_NAME[row.source_type],
    sourceKey: row.source_key,
    isCycle,
    cycleDays,
    cycleText: cycleDays === null ? null : `รอบละ ${cycleDays} วัน`,
    condHint: SOURCE_COND_HINT[row.source_type],
    fallbackValue: row.fallback_value,
    optionCount: row.option_count,
    countText: `${row.option_count}/${MAX_OPTIONS} ทางเลือก`,
    isNearFull: row.option_count >= NEAR_FULL_OPTIONS && row.option_count < MAX_OPTIONS,
    isFull: row.option_count >= MAX_OPTIONS,
    usedBy,
    isOrphan: usedBy.length === 0,
    canDelete: deleteBlockedWhy === null,
    deleteBlockedWhy,
  }
}

/**
 * ใครดึงชุดเนื้อหาไปใช้บ้าง · อ่านจาก card_block.selector_id ซึ่งเป็นทางเดียวที่มีจริง
 *
 * The prototype's empty line says "no card or activity uses this set", and only
 * the card half of that has a column behind it: an activity has no way to point
 * at a selector in this schema. Both halves are still true of an unused set, so
 * the sentence stands, but the query is written against what exists rather than
 * against what the sentence implies.
 */
function selectSelectors(sql: postgres.Sql, where: postgres.PendingQuery<SelectorRow[]>) {
  return sql<SelectorRow[]>`
    SELECT s.id, s.name, s.returns, s.source_type, s.source_key, s.fallback_value,
           (SELECT count(*) FROM card_selector_option o
             WHERE o.selector_id = s.id)::int AS option_count,
           used.labels AS used_by
      FROM card_selector s
      CROSS JOIN LATERAL (
        SELECT coalesce(array_agg(label ORDER BY label), ARRAY[]::text[]) AS labels
          FROM (
            SELECT DISTINCT 'การ์ด "' || c.code || '" · บล็อก ' || b.block_type AS label
              FROM card_block b
              JOIN card c ON c.id = b.card_id
             WHERE b.selector_id = s.id AND c.campaign_id = s.campaign_id
          ) refs
      ) used
     ${where}
     ORDER BY s.name`
}

export async function listSelectors(
  sql: postgres.Sql, campaignId: string,
): Promise<SelectorView[]> {
  const rows = await selectSelectors(
    sql, sql<SelectorRow[]>`WHERE s.campaign_id = ${campaignId}`,
  )
  return rows.map(summarizeSelector)
}

export type SelectorScreen = {
  selector: SelectorView
  options: SelectorOptionRow[]
  /** การ์ดของแคมเปญนี้ · ชุดที่คืนการ์ดเลือกได้แค่จากรายการนี้ */
  cards: Array<{ id: string; code: string }>
  /** ภาพของแคมเปญนี้ · ชุดที่คืนภาพเลือกได้แค่จากรายการนี้ */
  assets: Array<{ id: string; label: string; url: string }>
}

export async function loadSelector(
  sql: postgres.Sql, campaignId: string, id: string,
): Promise<SelectorScreen | null> {
  const [row] = await selectSelectors(
    sql, sql<SelectorRow[]>`WHERE s.campaign_id = ${campaignId} AND s.id = ${id}`,
  )
  if (!row) return null

  const [options, cards, assets] = await Promise.all([
    sql<SelectorOptionRow[]>`
      SELECT id, match_value, range_min, range_max, result_value, sort_order
        FROM card_selector_option WHERE selector_id = ${id}
       ORDER BY sort_order, id`,
    sql<{ id: string; code: string }[]>`
      SELECT id, code FROM card WHERE campaign_id = ${campaignId} ORDER BY code`,
    sql<{ id: string; storage_path: string; public_url: string }[]>`
      SELECT id, storage_path, public_url FROM asset
       WHERE campaign_id = ${campaignId} AND media_type = 'image'
       ORDER BY created_at DESC`,
  ])

  return {
    selector: summarizeSelector(row),
    options,
    cards,
    assets: assets.map((asset) => ({
      id: asset.id,
      label: asset.storage_path.split('/').pop() ?? asset.storage_path,
      url: asset.public_url,
    })),
  }
}

/** จำนวนทางเลือกที่ชุดนี้มีอยู่ตอนนี้ · action ถามก่อนเพิ่มแถว */
export async function countOptions(sql: postgres.Sql, selectorId: string): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    SELECT count(*) FROM card_selector_option WHERE selector_id = ${selectorId}`
  return Number(row.count)
}
