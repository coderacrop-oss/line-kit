import type postgres from 'postgres'

export const REWARD_TYPES = ['link', 'image', 'code', 'text'] as const
export type RewardType = (typeof REWARD_TYPES)[number]

export const REWARD_TYPE_NAME: Record<RewardType, string> = {
  link: 'ลิงก์',
  image: 'ภาพ',
  code: 'รหัสจากคลัง',
  text: 'ข้อความ',
}

export const asRewardType = (raw: string | undefined | null): RewardType | null =>
  (REWARD_TYPES as readonly string[]).includes(raw ?? '') ? (raw as RewardType) : null

/** เหลือน้อยกว่านี้คือใกล้หมด · ต้นแบบใช้เส้นเดียวกัน */
const LOW_STOCK_RATIO = 0.1

/** วางครั้งเดียวมากกว่านี้คือไฟล์ทั้งไฟล์ ไม่ใช่ชุดรหัสของแคมเปญ */
export const MAX_CODES_PER_IMPORT = 5000

/** รูปของรหัสคูปองที่ระบบรับ · ตัวอักษร ตัวเลข และขีด */
const CODE_VALUE_PATTERN = /^[A-Za-z0-9-]{4,24}$/

export type RewardRow = {
  id: string
  code: string
  reward_type: RewardType
  value: string | null
  quota: number | null
  issued_count: number
  valid_days: number | null
  use_limit: number | null
  /** มีแถวในตาราง coupon ผูกอยู่ · BR-55 บังคับสองช่องเมื่อเป็นจริง */
  has_coupon: boolean
  code_total: number
  code_issued: number
  /** ชื่อของทุกที่ที่แจกรางวัลนี้ · ว่างคือไม่มีทางถูกแจก */
  used_by: string[]
}

export type RewardView = {
  id: string
  code: string
  rewardType: RewardType
  typeName: string
  value: string | null
  quota: number | null
  issuedCount: number
  validDays: number | null
  useLimit: number | null
  isCoupon: boolean
  /** null เมื่อไม่จำกัดโควตา */
  remaining: number | null
  quotaText: string
  stockPercent: number
  isLowStock: boolean
  lowStockText: string | null
  codeStock: { total: number; issued: number; left: number } | null
  codesText: string | null
  /** จำนวนสิทธิ์ที่จะออกไปโดยไม่มีรหัสอยู่ในนั้น ถ้าแจกจนสุดโควตา */
  codeShortfall: number
  codeShortfallText: string | null
  /** ชนิดนี้ต้องมีค่าของรางวัล แต่ยังไม่ได้ตั้ง */
  valueMissingText: string | null
  couponGapText: string | null
  usedBy: string[]
  isOrphan: boolean
  canChangeType: boolean
  typeLockedWhy: string | null
  canDelete: boolean
  deleteBlockedWhy: string | null
}

/**
 * แถวหนึ่งของรางวัล อย่างที่จอต้องใช้
 *
 * issued_count is read here and never written. Its owner is the transaction
 * that creates the entitlement, which increments it in the same statement, so a
 * screen that let somebody type over it would produce a number disagreeing with
 * the number of entitlements that exist — and nothing in this system compares
 * the two. The first symptom is a client discovering they gave away more than
 * they owned.
 *
 * The code shortfall is the quieter version of the same failure. play_and_apply
 * looks for a free reward_code and, finding none, inserts the entitlement
 * anyway with reward_code_id NULL and still spends a unit of quota. Nobody is
 * told. The person holding that entitlement has nothing to redeem, so the
 * screen says the number before it happens rather than after.
 */
export function summarizeReward(row: RewardRow): RewardView {
  const usedBy = row.used_by ?? []
  const unlimited = row.quota === null

  // แยกตัวแปรออกมาเพื่อให้ TypeScript รู้ว่าผ่านการเช็ค null มาแล้ว — เดิม
  // `unlimited` เป็นตัวกลางที่คนอ่านเข้าใจ แต่ตัวตรวจชนิดตามไม่ทัน
  const quota = row.quota
  const remaining = quota === null ? null : Math.max(0, quota - row.issued_count)
  const stockPercent =
    quota === null
      ? 100
      : quota === 0
        ? 0
        : Math.max(0, Math.min(100, Math.round(((remaining as number) / quota) * 100)))

  // อ่านจากเปอร์เซ็นต์ที่เหลืออย่างเดียว · รางวัลที่ไม่จำกัดเหลือ 100% เสมอตามนิยาม
  // จึงไม่ต้องมีเงื่อนไขที่สองมาพูดเรื่องเดียวกันแล้วเถียงกันเองวันหลัง
  const isLowStock = stockPercent < LOW_STOCK_RATIO * 100

  const isCodeType = row.reward_type === 'code'
  const codeLeft = row.code_total - row.code_issued

  // โควตาบอกว่ายังแจกได้อีกกี่สิทธิ์ · คลังรหัสบอกว่ามีของให้ใส่ในสิทธิ์นั้นกี่ตัว
  // ไม่จำกัดโควตาแปลว่านับส่วนต่างไม่ได้ · ที่บอกได้คือคลังหมดแล้วหรือยัง
  const codeShortfall = isCodeType && remaining !== null ? Math.max(0, remaining - codeLeft) : 0
  const codeStockEmpty = isCodeType && remaining === null && codeLeft === 0

  const couponMissing = [
    row.valid_days === null ? 'อายุสิทธิ์' : null,
    row.use_limit === null ? 'ใช้ได้กี่ครั้งต่อคน' : null,
  ].filter((field): field is string => field !== null)

  const deleteBlockedWhy = row.issued_count > 0
    ? `ลบไม่ได้ — มีคนได้รับไปแล้ว ${row.issued_count} คน`
      + ' · สิทธิ์ที่ออกไปชี้มาที่รางวัลนี้ ลบแล้วสิทธิ์เหล่านั้นหายตามไปด้วย (ON DELETE CASCADE)'
    : usedBy.length > 0
      ? `ลบไม่ได้ — ${usedBy.join(' · ')} แจกรางวัลนี้อยู่`
      : null

  return {
    id: row.id,
    code: row.code,
    rewardType: row.reward_type,
    typeName: REWARD_TYPE_NAME[row.reward_type],
    value: row.value,
    quota: row.quota,
    issuedCount: row.issued_count,
    validDays: row.valid_days,
    useLimit: row.use_limit,
    isCoupon: row.has_coupon,
    remaining,
    quotaText: unlimited ? 'ไม่จำกัด' : `${remaining} / ${row.quota} สิทธิ์`,
    stockPercent,
    isLowStock,
    lowStockText: isLowStock
      ? `เหลือ ${stockPercent}% — ใกล้หมด เตรียมเพิ่มโควตาหรือเปลี่ยนน้ำหนักผลลัพธ์`
      : null,
    codeStock: isCodeType
      ? { total: row.code_total, issued: row.code_issued, left: codeLeft }
      : null,
    codesText: isCodeType
      ? `คลังรหัส ${row.code_total} · จ่ายไปแล้ว ${row.code_issued} · เหลือ ${codeLeft}`
      : null,
    codeShortfall,
    codeShortfallText: codeShortfall > 0 || codeStockEmpty
      ? (codeStockEmpty
          ? 'คลังรหัสหมดแล้ว และรางวัลนี้ไม่จำกัดโควตา'
          : `รหัสในคลังไม่พอกับโควตาที่ยังแจกได้อีก ${codeShortfall} สิทธิ์`)
        + ' — คนที่ได้รางวัลหลังรหัสหมดจะได้สิทธิ์ที่ไม่มีรหัสอยู่ในนั้น'
        + ' และโควตาถูกตัดไปเหมือนกัน โดยไม่มีอะไรรายงาน'
      : null,
    valueMissingText: !isCodeType && (row.value ?? '').trim() === ''
      ? `รางวัลชนิด "${REWARD_TYPE_NAME[row.reward_type]}" ยังไม่ได้ตั้งค่าของรางวัล`
        + ' — คนที่ได้รางวัลนี้จะได้การ์ดที่ไม่มีอะไรอยู่ในนั้น'
      : null,
    couponGapText: row.has_coupon && couponMissing.length > 0
      ? `คูปองต้องมี ${couponMissing.join(' และ ')} เสมอ (BR-55)`
        + ' — สิทธิ์ที่ไม่มีวันหมดอายุและไม่จำกัดจำนวนครั้ง คือคูปองที่ปิดไม่ได้'
      : null,
    usedBy,
    isOrphan: usedBy.length === 0,
    canChangeType: row.issued_count === 0,
    typeLockedWhy: row.issued_count > 0
      ? `แก้ชนิดไม่ได้ — มีคนได้รับไปแล้ว ${row.issued_count} คน`
        + ' สิทธิ์ที่ออกไปชี้มาที่รางวัลนี้ ไม่ได้ถือสำเนาของมันไว้'
      : null,
    canDelete: deleteBlockedWhy === null,
    deleteBlockedWhy,
  }
}

export type CodeBatch =
  | { ok: true; codes: string[] }
  | { ok: false; problems: string[] }

/**
 * อ่านรหัสที่วางมาทั้งชุด · ผิดแถวเดียวคือไม่นำเข้าเลยสักแถว
 *
 * Duplicates inside one paste are refused rather than quietly deduped, which is
 * a decision and not an accident. A list containing the same code twice came
 * out of an export that was wrong, and dropping one of the pair leaves somebody
 * believing they loaded a number of codes they do not own — which is the number
 * they will quote to the client. Refusing hands the problem back to the file it
 * came from.
 *
 * Only the first three problems are named. A paste of five thousand rows with
 * the wrong separator produces five thousand identical complaints, and a wall
 * of those is read as noise rather than as an instruction.
 */
export function parseCodeBatch(text: string, existing: readonly string[]): CodeBatch {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '')

  if (lines.length === 0) {
    return { ok: false, problems: ['ยังไม่มีรหัสให้นำเข้า — วางหนึ่งรหัสต่อบรรทัด'] }
  }
  if (lines.length > MAX_CODES_PER_IMPORT) {
    return {
      ok: false,
      problems: [`นำเข้าได้ครั้งละไม่เกิน ${MAX_CODES_PER_IMPORT} รหัส — วางมา ${lines.length} แถว`],
    }
  }

  const already = new Set(existing)
  const seen = new Map<string, number>()
  const problems: string[] = []

  lines.forEach((code, index) => {
    const row = index + 1
    if (!CODE_VALUE_PATTERN.test(code)) {
      problems.push(`แถว ${row} ("${code}") รูปแบบไม่ถูกต้อง — ใช้ได้แค่ A-Z 0-9 และ - ยาว 4–24 ตัว`)
      return
    }
    const twin = seen.get(code)
    if (twin !== undefined) {
      problems.push(`แถว ${row} ("${code}") ซ้ำกับแถว ${twin} ในไฟล์เดียวกัน`)
      return
    }
    if (already.has(code)) {
      problems.push(`แถว ${row} ("${code}") มีอยู่ในคลังแล้ว`)
      return
    }
    seen.set(code, row)
  })

  if (problems.length === 0) return { ok: true, codes: lines }

  const shown = problems.slice(0, 3)
  if (problems.length > shown.length) {
    shown.push(`และอีก ${problems.length - shown.length} แถว`)
  }
  return { ok: false, problems: shown }
}

export type RewardCodeRow = {
  id: string
  code_value: string
  assigned_at: Date | null
}

/**
 * ทุกที่ที่แจกรางวัลหนึ่งตัวได้ ตามที่ schema เขียนไว้จริง
 *
 * Derived from the JSONB the engine actually reads rather than from a column
 * saying so, because no such column exists and the claim this feeds — "nothing
 * points here, this reward can never be given out" — is the reason the screen
 * is worth opening. An outcome grants by rewardCode inside resolve_config, an
 * activity effect and a milestone effect both grant by reward_code, and all
 * three are matched.
 */
function selectRewards(sql: postgres.Sql, where: postgres.PendingQuery<RewardRow[]>) {
  return sql<RewardRow[]>`
    SELECT r.id, r.code, r.reward_type, r.value, r.quota, r.issued_count,
           r.valid_days, r.use_limit,
           EXISTS (SELECT 1 FROM coupon cp WHERE cp.reward_id = r.id) AS has_coupon,
           (SELECT count(*) FROM reward_code rc WHERE rc.reward_id = r.id)::int AS code_total,
           (SELECT count(*) FROM reward_code rc
             WHERE rc.reward_id = r.id AND rc.assigned_to IS NOT NULL)::int AS code_issued,
           used.labels AS used_by
      FROM reward r
      CROSS JOIN LATERAL (
        SELECT coalesce(array_agg(label ORDER BY label), ARRAY[]::text[]) AS labels
          FROM (
            SELECT a.name || ' · ผลที่ตามมาของกิจกรรม' AS label
              FROM activity a
             WHERE a.campaign_id = r.campaign_id
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.effects) e
                            WHERE e->>'type' = 'grant_reward' AND e->>'reward_code' = r.code)
             UNION
            SELECT a.name || ' · ผลลัพธ์ "' || coalesce(o->>'id', '') || '"'
              FROM activity a, jsonb_array_elements(coalesce(a.resolve_config->'outcomes',
                                                             '[]'::jsonb)) o
             WHERE a.campaign_id = r.campaign_id AND o->>'rewardCode' = r.code
             UNION
            SELECT 'ค่าสะสม "' || c.name || '" · จุดปลดล็อก ' || m.at_value
              FROM counter c
              JOIN counter_milestone m ON m.counter_id = c.id
             WHERE c.campaign_id = r.campaign_id
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.effects) e
                            WHERE e->>'type' = 'grant_reward' AND e->>'reward_code' = r.code)
          ) refs
      ) used
     ${where}
     ORDER BY r.code`
}

export async function listRewards(sql: postgres.Sql, campaignId: string): Promise<RewardView[]> {
  const rows = await selectRewards(sql, sql<RewardRow[]>`WHERE r.campaign_id = ${campaignId}`)
  return rows.map(summarizeReward)
}

export type RewardScreen = {
  reward: RewardView
  codes: RewardCodeRow[]
  /** ภาพในคลังของแคมเปญนี้ · ชนิด image เลือกจากรายการนี้เท่านั้น */
  images: Array<{ id: string; label: string; url: string }>
}

export async function loadReward(
  sql: postgres.Sql, campaignId: string, id: string,
): Promise<RewardScreen | null> {
  const [row] = await selectRewards(
    sql, sql<RewardRow[]>`WHERE r.campaign_id = ${campaignId} AND r.id = ${id}`,
  )
  if (!row) return null

  const [codes, images] = await Promise.all([
    sql<RewardCodeRow[]>`
      SELECT id, code_value, assigned_at FROM reward_code
       WHERE reward_id = ${id} ORDER BY assigned_at NULLS FIRST, code_value LIMIT 200`,
    sql<{ id: string; storage_path: string; public_url: string }[]>`
      SELECT id, storage_path, public_url FROM asset
       WHERE campaign_id = ${campaignId} AND media_type = 'image'
       ORDER BY created_at DESC`,
  ])

  return {
    reward: summarizeReward(row),
    codes,
    images: images.map((image) => ({
      id: image.id,
      label: image.storage_path.split('/').pop() ?? image.storage_path,
      url: image.public_url,
    })),
  }
}

/** รหัสทุกตัวที่รางวัลนี้มีอยู่แล้ว · ตัวนำเข้าเทียบกับรายการนี้ก่อนเขียน */
export async function existingCodeValues(
  sql: postgres.Sql, rewardId: string,
): Promise<string[]> {
  const rows = await sql<{ code_value: string }[]>`
    SELECT code_value FROM reward_code WHERE reward_id = ${rewardId}`
  return rows.map((row) => row.code_value)
}
