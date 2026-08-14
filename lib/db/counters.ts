import type postgres from 'postgres'

export const COUNTER_MODES = ['accumulate', 'daily_unique', 'distinct'] as const
export type CounterMode = (typeof COUNTER_MODES)[number]

/** คำอธิบายของแต่ละวิธีนับ ถอดจากต้นแบบตรงๆ */
export const MODE_COPY: Record<CounterMode, { name: string; note: string }> = {
  accumulate: {
    name: 'บวกตามที่สั่ง',
    note: 'บวกตามจำนวนที่กิจกรรมสั่ง เช่นให้อาหารได้ 25 หน่วย',
  },
  daily_unique: {
    name: 'นับวันละ 1',
    note: 'เล่นกี่ครั้งในวันนั้นก็นับเป็น 1 · ใช้นับวันที่เล่นติดกัน',
  },
  distinct: {
    name: 'นับสิ่งที่ต่างกัน',
    note: 'นับสิ่งที่ต่างกัน ไม่นับซ้ำ เช่นทำครบ 3 ภารกิจ',
  },
}

/** ค่าจากฟอร์มเป็นข้อความที่ผู้ส่งแก้เองได้ · CHECK ของตารางรับแค่สามค่านี้ */
export const asCounterMode = (raw: string | undefined | null): CounterMode | null =>
  (COUNTER_MODES as readonly string[]).includes(raw ?? '') ? (raw as CounterMode) : null

export type MilestoneRow = { id: string; at_value: number; effects: unknown }

export type CounterRow = {
  id: string
  code: string
  name: string
  mode: CounterMode
  require_consecutive: boolean
  target: number
  /** จำนวนผู้เล่นที่มีค่าของค่าสะสมนี้อยู่แล้ว */
  participant_count: number
  milestones: MilestoneRow[]
  /** ชื่อกิจกรรมที่ผลลัพธ์ของมันบวกค่าเข้ามาที่ค่าสะสมนี้ */
  writers: string[]
  /** บัญชีที่ตั้งเป้าทับค่าตั้งต้น (DD-06) */
  overrides: string[]
  has_stamp_card: boolean
}

export type EffectView = { label: string; isDead: boolean }

export type MilestoneView = {
  id: string
  atValue: number
  effects: EffectView[]
  /** กุญแจของผลที่จอนี้มีช่องให้ติ๊ก · ใช้เป็นค่าตั้งต้นของฟอร์ม */
  effectKeys: string[]
  effectSummary: string
  isBeyondTarget: boolean
  /** ตำแหน่งหมุดบนแถบความคืบหน้า หน่วยเป็นเปอร์เซ็นต์ */
  leftPercent: number
}

export type CounterView = {
  id: string
  code: string
  name: string
  mode: CounterMode
  modeName: string
  modeNote: string
  requireConsecutive: boolean
  target: number
  participantCount: number
  milestones: MilestoneView[]
  writers: string[]
  hasWriter: boolean
  overrides: string[]
  canDelete: boolean
  /** เหตุผลที่ลบไม่ได้ · null เมื่อลบได้ */
  deleteBlockedWhy: string | null
}

/** ชื่อของสิ่งที่ผลที่ตามมาชี้ไปหา · ใช้เขียนป้ายและใช้บอกว่าอันไหนชี้ไปที่ไม่มีอยู่ */
export type CounterCatalogue = {
  counterNames: Record<string, string>
  rewardCodes: readonly string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

/**
 * ผลที่ตามมาอยู่ในคอลัมน์ JSONB · จอนี้เป็นผู้อ่าน ไม่ใช่ผู้เขียนคนเดียว
 *
 * The shape is whatever is in the column, and this screen is not the only thing
 * that can put something there — a seed, a fixture, a future activity editor.
 * So an effect it cannot name is described rather than dropped, and an effect
 * pointing at a code no longer in the campaign is reported as dead instead of
 * being drawn as if it worked. The counterpart of that is that nothing here
 * throws: one strange row would otherwise take the whole screen down and hide
 * the twelve rows that were fine.
 */
export function describeEffect(effect: unknown, catalogue: CounterCatalogue): EffectView {
  if (!isRecord(effect)) {
    return { label: `ผลที่อ่านไม่ออก: ${JSON.stringify(effect ?? null)}`, isDead: true }
  }

  const type = asText(effect.type)

  if (type === 'grant_reward') {
    const code = asText(effect.reward_code)
    if (!code) return { label: 'ให้สิทธิ์รางวัล — ยังไม่ได้ระบุว่ารางวัลไหน', isDead: true }
    const known = catalogue.rewardCodes.includes(code)
    return {
      label: known
        ? `ให้สิทธิ์รางวัล "${code}"`
        : `ให้สิทธิ์รางวัล "${code}" — ไม่มีรางวัลรหัสนี้ในแคมเปญแล้ว`,
      isDead: !known,
    }
  }

  if (type === 'add_units') {
    const code = asText(effect.counter_code)
    const amount = typeof effect.amount === 'number' ? effect.amount : 1
    if (!code) return { label: 'บวกค่าสะสม — ยังไม่ได้ระบุว่าค่าสะสมไหน', isDead: true }
    const name = catalogue.counterNames[code]
    return {
      label: name
        ? `ค่าสะสม "${name}" +${amount}`
        : `ค่าสะสม "${code}" +${amount} — ไม่มีค่าสะสมรหัสนี้ในแคมเปญแล้ว`,
      isDead: name === undefined,
    }
  }

  if (type === 'set_attribute') {
    return {
      label: `ตั้งค่า ${String(effect.key ?? '')} = ${String(effect.value ?? '')}`,
      isDead: false,
    }
  }

  return { label: `ผลชนิดที่จอนี้ยังไม่รู้จัก: ${JSON.stringify(effect)}`, isDead: true }
}

/**
 * กุญแจของผลที่จอนี้มีช่องให้ติ๊ก · null คือของที่จอนี้แทนด้วยช่องติ๊กไม่ได้
 *
 * The key deliberately leaves the amount out. A checkbox says which counter is
 * fed, not how much, so keying on the pair would make an existing "+25" a
 * different thing from the box the person just ticked and quietly leave both in
 * the column.
 */
export function effectKeyOf(effect: unknown): string | null {
  if (!isRecord(effect)) return null
  const type = asText(effect.type)
  if (type === 'grant_reward') {
    const code = asText(effect.reward_code)
    return code ? `reward:${code}` : null
  }
  if (type === 'add_units') {
    const code = asText(effect.counter_code)
    return code ? `counter:${code}` : null
  }
  return null
}

const effectFromKey = (key: string): Record<string, unknown> | null => {
  const separator = key.indexOf(':')
  if (separator < 1) return null
  const kind = key.slice(0, separator)
  const code = key.slice(separator + 1)
  if (!code) return null
  if (kind === 'reward') return { type: 'grant_reward', reward_code: code }
  if (kind === 'counter') return { type: 'add_units', counter_code: code, amount: 1 }
  return null
}

/**
 * ของที่ติ๊กไว้ รวมกับของที่จอนี้ไม่มีช่องให้ติ๊ก
 *
 * The form posts a set of checkboxes, and a set is a complete answer only about
 * the things the form can express. Everything else in the column — an attribute
 * write, an amount other than one, a type this screen has never heard of —
 * survives untouched, because saving a milestone must not be a way to silently
 * delete configuration nobody was shown.
 *
 * An effect that stays ticked keeps the object it already had rather than being
 * rebuilt, which is what stops "+25" from becoming "+1" the first time somebody
 * opens the screen and presses save without changing anything.
 */
export function mergeEffects(existing: unknown, chosenKeys: readonly string[]): unknown[] {
  const before = Array.isArray(existing) ? existing : []
  const wanted = new Set(chosenKeys)

  const kept: unknown[] = []
  const seen = new Set<string>()

  for (const effect of before) {
    const key = effectKeyOf(effect)
    if (key === null) {
      kept.push(effect)
      continue
    }
    if (wanted.has(key) && !seen.has(key)) {
      kept.push(effect)
      seen.add(key)
    }
  }

  for (const key of wanted) {
    if (seen.has(key)) continue
    const made = effectFromKey(key)
    if (made) {
      kept.push(made)
      seen.add(key)
    }
  }

  return kept
}

export type EffectOption = { key: string; label: string; isDead: boolean }

/**
 * ช่องติ๊กที่จุดปลดล็อกหนึ่งจุดควรเห็น
 *
 * The list is the campaign's rewards and counters, plus anything this milestone
 * already points at that is no longer one of them. Leaving that last group out
 * would be the quiet kind of wrong: a milestone granting a reward somebody
 * deleted would come back from the next save without it, because a checkbox
 * that was never drawn cannot be ticked, and the effect would be dropped by the
 * merge as though the person had asked for that.
 */
export function effectOptions(
  catalogue: CounterCatalogue, current: readonly string[] = [],
): EffectOption[] {
  const options: EffectOption[] = [
    ...catalogue.rewardCodes.map((code) => ({
      key: `reward:${code}`,
      label: `ให้สิทธิ์รางวัล "${code}"`,
      isDead: false,
    })),
    ...Object.entries(catalogue.counterNames).map(([code, name]) => ({
      key: `counter:${code}`,
      label: `ค่าสะสม "${name}" +1`,
      isDead: false,
    })),
  ]

  const known = new Set(options.map((option) => option.key))
  for (const key of current) {
    if (known.has(key)) continue
    known.add(key)
    const effect = effectFromKey(key)
    options.push({
      key,
      label: effect ? describeEffect(effect, catalogue).label : key,
      isDead: true,
    })
  }

  return options
}

/**
 * แถวหนึ่งของค่าสะสม อย่างที่จอต้องใช้
 *
 * canDelete is worked out here because deleting a counter is not the small act
 * the button makes it look like: counter_value hangs off it with ON DELETE
 * CASCADE, so removing a counter that people have been accumulating into takes
 * every player's progress with it and no foreign key objects. The reasons are
 * ordered by what is hardest to undo — lost player state first, then the
 * configuration that points here by code and would break silently.
 */
export function summarizeCounter(row: CounterRow, catalogue: CounterCatalogue): CounterView {
  const writers = row.writers ?? []
  const milestones = [...(row.milestones ?? [])]
    .sort((a, b) => a.at_value - b.at_value)
    .map((milestone) => {
      const raw = Array.isArray(milestone.effects) ? milestone.effects : []
      const effects = raw.map((effect) => describeEffect(effect, catalogue))
      // เป้าเป็นศูนย์ผ่าน CHECK ของตารางมาไม่ได้ แต่จอไม่ใช่ที่ที่ควรพังถ้ามันมาถึง
      // · การหนีบไว้ที่ 0–100 ทำให้ทุกกรณีลงเอยเป็นตำแหน่งที่วาดได้จริง
      const reach = (milestone.at_value / row.target) * 100
      return {
        id: milestone.id,
        atValue: milestone.at_value,
        effects,
        effectKeys: raw
          .map(effectKeyOf)
          .filter((key): key is string => key !== null),
        effectSummary: effects.length > 0
          ? effects.map((effect) => effect.label).join(' · ')
          : 'ยังไม่ได้ตั้งผลที่ตามมา',
        isBeyondTarget: milestone.at_value > row.target,
        leftPercent: Math.max(0, Math.min(100, Math.round(reach))),
      }
    })

  const deleteBlockedWhy = row.participant_count > 0
    ? `ลบไม่ได้ — มีผู้เล่นสะสมค่านี้อยู่แล้ว ${row.participant_count} คน`
      + ' · ค่าที่สะสมมาถูกลบตามไปด้วยทันที (ON DELETE CASCADE) และไม่มีที่ไหนเก็บสำเนาไว้'
    : row.has_stamp_card
      ? 'ลบไม่ได้ — มีบัตรแสตมป์ผูกอยู่กับค่าสะสมนี้ ลบแล้วบัตรหายไปด้วย'
      : writers.length > 0
        ? `ลบไม่ได้ — ${writers.join(' · ')} เขียนค่าเข้ามา`
          + ' · กิจกรรมอ้างค่าสะสมด้วยรหัส ไม่ใช่ด้วย id ลบแล้วผลลัพธ์นั้นจะเงียบไปเฉยๆ'
        : null

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    mode: row.mode,
    modeName: MODE_COPY[row.mode].name,
    modeNote: MODE_COPY[row.mode].note,
    requireConsecutive: row.require_consecutive,
    target: row.target,
    participantCount: row.participant_count,
    milestones,
    writers,
    hasWriter: writers.length > 0,
    overrides: row.overrides ?? [],
    canDelete: deleteBlockedWhy === null,
    deleteBlockedWhy,
  }
}

/**
 * ทุกอย่างที่จอค่าสะสมต้องใช้ในครั้งเดียว
 *
 * writers is derived by reading activity.effects rather than from a column that
 * says so, because nothing maintains such a column and the claim it feeds —
 * "nothing writes into this counter, it will never go up" — is the reason
 * anyone opens this screen twice.
 */
function selectCounters(sql: postgres.Sql, where: postgres.PendingQuery<CounterRow[]>) {
  return sql<CounterRow[]>`
    SELECT c.id, c.code, c.name, c.mode, c.require_consecutive, c.target,
           (SELECT count(*) FROM counter_value v WHERE v.counter_id = c.id)::int
             AS participant_count,
           (SELECT coalesce(
                     jsonb_agg(jsonb_build_object('id', m.id, 'at_value', m.at_value,
                                                  'effects', m.effects)
                               ORDER BY m.at_value),
                     '[]'::jsonb)
              FROM counter_milestone m WHERE m.counter_id = c.id) AS milestones,
           (SELECT coalesce(array_agg(a.name ORDER BY a.name), ARRAY[]::text[])
              FROM activity a
             WHERE a.campaign_id = c.campaign_id
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.effects) e
                            WHERE e->>'type' = 'add_units'
                              AND e->>'counter_code' = c.code)) AS writers,
           (SELECT coalesce(array_agg(ch.name || ' → เป้า ' || t.target ORDER BY ch.name),
                            ARRAY[]::text[])
              FROM campaign_channel_counter_target t
              JOIN channel ch ON ch.id = t.channel_id
             WHERE t.counter_id = c.id) AS overrides,
           EXISTS (SELECT 1 FROM stamp_card s WHERE s.counter_id = c.id) AS has_stamp_card
      FROM counter c
     ${where}
     ORDER BY c.code`
}

export type CountersScreen = {
  counters: CounterView[]
  catalogue: CounterCatalogue
}

async function catalogueOf(
  sql: postgres.Sql, campaignId: string, counters: readonly CounterRow[],
): Promise<CounterCatalogue> {
  const rewards = await sql<{ code: string }[]>`
    SELECT code FROM reward WHERE campaign_id = ${campaignId} ORDER BY code`
  return {
    counterNames: Object.fromEntries(counters.map((row) => [row.code, row.name])),
    rewardCodes: rewards.map((row) => row.code),
  }
}

export async function loadCountersScreen(
  sql: postgres.Sql, campaignId: string,
): Promise<CountersScreen> {
  const rows = await selectCounters(sql, sql<CounterRow[]>`WHERE c.campaign_id = ${campaignId}`)
  const catalogue = await catalogueOf(sql, campaignId, rows)
  return { counters: rows.map((row) => summarizeCounter(row, catalogue)), catalogue }
}

export async function loadCounter(
  sql: postgres.Sql, campaignId: string, id: string,
): Promise<{ counter: CounterView; catalogue: CounterCatalogue } | null> {
  // ชื่อของค่าสะสมตัวอื่นต้องมาด้วย · ผลที่ตามมาของจุดปลดล็อกชี้ไปหาค่าสะสมตัวไหนก็ได้
  const all = await selectCounters(sql, sql<CounterRow[]>`WHERE c.campaign_id = ${campaignId}`)
  const row = all.find((candidate) => candidate.id === id)
  if (!row) return null

  const catalogue = await catalogueOf(sql, campaignId, all)
  return { counter: summarizeCounter(row, catalogue), catalogue }
}
