'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require'
import { db } from '@/lib/db/client'
import {
  asSelectorReturn, asSelectorSource, countOptions, isCycleSource, loadSelector,
  MAX_OPTIONS, parseCondition, type SelectorReturn, type SelectorSource,
} from '@/lib/db/selectors'

/** ความยาวรอบที่ยาวกว่าหนึ่งปีคือรอบที่ไม่มีวันวนครบ */
const MAX_CYCLE_DAYS = 366

const trimmed = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()

async function requireCampaign(sql: ReturnType<typeof db>, campaignId: string): Promise<void> {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM campaign WHERE id = ${campaignId}`
  if (!row) throw new Error('ไม่พบแคมเปญนี้')
}

type SelectorState = { id: string; returns: SelectorReturn; option_count: number }

/**
 * ชุดเนื้อหาที่อ้างถึงต้องอยู่ในแคมเปญที่ผูกมากับ action
 *
 * The selector id arrives in the URL, which anybody can type. Without the
 * campaign in the WHERE, every one of these actions would edit another client's
 * content set as happily as its own.
 */
async function requireSelector(
  sql: ReturnType<typeof db>, campaignId: string, selectorId: string,
): Promise<SelectorState> {
  const [row] = await sql<SelectorState[]>`
    SELECT s.id, s.returns,
           (SELECT count(*) FROM card_selector_option o WHERE o.selector_id = s.id)::int
             AS option_count
      FROM card_selector s WHERE s.id = ${selectorId} AND s.campaign_id = ${campaignId}`
  if (!row) throw new Error('ไม่พบชุดเนื้อหานี้ในแคมเปญนี้')
  return row
}

/**
 * ค่าที่ลง source_key · คอลัมน์เดียวที่มีความหมายห้าแบบ
 *
 * campaign_day and campaign_round put a cycle length there and the other three
 * put the name of the value being read, so the screen shows two boxes over one
 * column and this decides which one was the question. Reading the wrong box
 * would store "pet_type" as a cycle length, and the selector would then match
 * nothing and fall back forever without an error anywhere.
 */
function sourceKeyFor(source: SelectorSource, formData: FormData): string | null {
  if (isCycleSource(source)) {
    const raw = trimmed(formData, 'cycle_days')
    if (!/^\d+$/.test(raw)) {
      throw new Error('ความยาวรอบต้องเป็นจำนวนวันเป็นตัวเลข เช่น 7 สำหรับรายสัปดาห์')
    }
    const days = Number(raw)
    if (days < 1 || days > MAX_CYCLE_DAYS) {
      throw new Error(`ความยาวรอบต้องอยู่ระหว่าง 1 ถึง ${MAX_CYCLE_DAYS} วัน`)
    }
    return String(days)
  }

  const key = trimmed(formData, 'source_key')
  if (key === '') {
    if (source === 'attribute') throw new Error('ต้องบอกว่าจะอ่านค่าที่ผู้เล่นตอบไว้ตัวไหน')
    if (source === 'counter_level') throw new Error('ต้องบอกว่าจะอ่านระดับของค่าสะสมตัวไหน')
    return null
  }
  if (key.length > 100) throw new Error('ชื่อค่าที่อ่านยาวได้ไม่เกิน 100 ตัวอักษร')
  return key
}

/**
 * สร้างหรือแก้ชุดเนื้อหาหนึ่งชุด
 *
 * The fallback is demanded here rather than warned about later, because
 * fallback_value is NOT NULL and BR-27 is about the moment a card is being
 * answered: the set is asked for a value while somebody is waiting for a reply,
 * and a set with nothing to return is a card with nothing to say. A form that
 * accepted an empty one would be offering to create that silence.
 *
 * What the set returns is locked once it has options. A result_value written
 * for a text set is a sentence and the same column for a card set is a card id,
 * and nothing in the table records which of the two a given row was written as
 * — switching would leave ten rows of sentences where card ids are expected,
 * and the only symptom is a card that renders nothing.
 */
export async function saveSelector(
  campaignId: string, selectorId: string, formData: FormData,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireCampaign(sql, campaignId)

  const name = trimmed(formData, 'name')
  if (!name) throw new Error('ต้องตั้งชื่อชุดเนื้อหา')
  if (name.length > 100) throw new Error('ชื่อชุดเนื้อหายาวได้ไม่เกิน 100 ตัวอักษร')

  const returns = asSelectorReturn(trimmed(formData, 'returns'))
  if (!returns) throw new Error('ต้องเลือกว่าชุดนี้คืนอะไร')

  const source = asSelectorSource(trimmed(formData, 'source_type'))
  if (!source) throw new Error('ต้องเลือกว่าจะเลือกจากค่าไหน')

  const sourceKey = sourceKeyFor(source, formData)

  const fallback = trimmed(formData, 'fallback_value')
  if (!fallback) {
    throw new Error(
      'ต้องกรอกของสำรอง (BR-27) — ถ้าค่าที่อ่านมาไม่ตรงทางเลือกไหนเลยแล้วไม่มีของสำรอง'
      + ' ผู้เล่นจะกดแล้วเงียบ',
    )
  }

  let created: string | null = null

  if (selectorId) {
    const current = await requireSelector(sql, campaignId, selectorId)

    if (current.returns !== returns && current.option_count > 0) {
      throw new Error(
        `เปลี่ยนสิ่งที่ชุดนี้คืนไม่ได้ — มีทางเลือกอยู่แล้ว ${current.option_count} แถว`
        + ' ค่าในตารางถูกเขียนไว้เป็นของชนิดเดิม และไม่มีอะไรบอกว่าแถวไหนเขียนมาแบบเก่า'
        + ' · ลบทางเลือกออกก่อน หรือสร้างชุดใหม่',
      )
    }

    await sql`
      UPDATE card_selector
         SET name = ${name}, returns = ${returns}, source_type = ${source},
             source_key = ${sourceKey}, fallback_value = ${fallback}
       WHERE id = ${selectorId} AND campaign_id = ${campaignId}`
  } else {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO card_selector (campaign_id, name, returns, source_type, source_key,
                                 fallback_value)
      VALUES (${campaignId}, ${name}, ${returns}, ${source}, ${sourceKey}, ${fallback})
      RETURNING id`
    created = row.id
  }

  revalidatePath(`/campaigns/${campaignId}/selectors`)
  if (selectorId) revalidatePath(`/campaigns/${campaignId}/selectors/${selectorId}`)
  // สร้างเสร็จแล้วพาไปกรอกตารางทางเลือกต่อ · redirect โยนเพื่อเปลี่ยนหน้า จึงอยู่นอก try
  if (created) redirect(`/campaigns/${campaignId}/selectors/${created}`)
}

/**
 * ลบชุดเนื้อหา · ทำได้เฉพาะตอนที่ยังไม่มีบล็อกไหนดึงไปใช้
 *
 * The table would refuse this on its own — card_block.selector_id has no ON
 * DELETE clause — but the error it raises names a constraint rather than the
 * card somebody has to open first. The options do cascade, which is right: they
 * are parts of the set, not references to it.
 */
export async function deleteSelector(campaignId: string, selectorId: string): Promise<void> {
  await requireRole('configurator')
  const sql = db()

  const found = await loadSelector(sql, campaignId, selectorId)
  if (!found) throw new Error('ไม่พบชุดเนื้อหานี้ในแคมเปญนี้')
  if (!found.selector.canDelete) throw new Error(found.selector.deleteBlockedWhy as string)

  await sql`DELETE FROM card_selector WHERE id = ${selectorId} AND campaign_id = ${campaignId}`
  revalidatePath(`/campaigns/${campaignId}/selectors`)
}

/**
 * เพิ่มหรือแก้ทางเลือกหนึ่งแถว
 *
 * A content editor may rewrite what a row returns and nothing else (Permission
 * Matrix · L1 §2). The condition is which player sees which row, which is the
 * campaign's path rather than its copy, and adding or removing rows changes how
 * many paths there are. The restriction is enforced by writing a different
 * statement rather than by hiding the boxes, because a hidden box is a hint and
 * the action is the door.
 *
 * The ceiling is checked before the insert rather than trusted to the table.
 * Nothing in the schema counts rows per selector, so this is the only place
 * BR-27's ten exists — which is worth saying out loud, because a rule enforced
 * in exactly one place is a rule that ends the moment somebody opens psql.
 */
export async function saveSelectorOption(
  campaignId: string, selectorId: string, optionId: string, formData: FormData,
): Promise<void> {
  const session = await requireRole('configurator', 'content_editor')
  const sql = db()
  await requireSelector(sql, campaignId, selectorId)

  const isContentEditor = session.role === 'content_editor'

  if (isContentEditor && !optionId) {
    throw new Error(
      'ผู้ดูแลเนื้อหาเพิ่มทางเลือกไม่ได้ — จำนวนแถวคือจำนวนทางเดินของแคมเปญ (Permission Matrix · L1 §2)',
    )
  }

  const value = trimmed(formData, 'result_value')
  if (!value) throw new Error('ต้องกรอกสิ่งที่แถวนี้จะคืน — แถวที่ไม่คืนอะไรเลยเท่ากับไม่มีแถวนี้')
  if (value.length > 2000) throw new Error('ค่าที่คืนยาวได้ไม่เกิน 2000 ตัวอักษร')

  if (isContentEditor) {
    const changed = await sql`
      UPDATE card_selector_option SET result_value = ${value}
       WHERE id = ${optionId} AND selector_id = ${selectorId}
       RETURNING id`
    if (changed.length === 0) throw new Error('ไม่พบทางเลือกแถวนี้ในชุดนี้')

    revalidatePath(`/campaigns/${campaignId}/selectors/${selectorId}`)
    return
  }

  const parsed = parseCondition(String(formData.get('condition') ?? ''))
  if (!parsed.ok) throw new Error(parsed.problem)
  const { match_value, range_min, range_max } = parsed.condition

  if (optionId) {
    const changed = await sql`
      UPDATE card_selector_option
         SET match_value = ${match_value}, range_min = ${range_min}, range_max = ${range_max},
             result_value = ${value}
       WHERE id = ${optionId} AND selector_id = ${selectorId}
       RETURNING id`
    if (changed.length === 0) throw new Error('ไม่พบทางเลือกแถวนี้ในชุดนี้')
  } else {
    const already = await countOptions(sql, selectorId)
    if (already >= MAX_OPTIONS) {
      throw new Error(
        `เต็ม ${MAX_OPTIONS} ทางเลือกแล้ว — เพิ่มอีกไม่ได้ (BR-27)`
        + ' · ถ้าต้องการมากกว่านี้ให้แยกเป็นชุดที่สองแล้วให้คนละช่องของการ์ดใช้คนละชุด',
      )
    }

    await sql`
      INSERT INTO card_selector_option (selector_id, match_value, range_min, range_max,
                                        result_value, sort_order)
      SELECT ${selectorId}, ${match_value}, ${range_min}, ${range_max}, ${value},
             coalesce(max(sort_order), -1) + 1
        FROM card_selector_option WHERE selector_id = ${selectorId}`
  }

  revalidatePath(`/campaigns/${campaignId}/selectors/${selectorId}`)
}

/**
 * เอาทางเลือกออกหนึ่งแถว
 *
 * Only a configurator. Removing a row removes a way through the campaign, and
 * every player whose value used to land on it now lands on the fallback instead
 * — silently, because falling back is the normal thing for this table to do.
 */
export async function deleteSelectorOption(
  campaignId: string, selectorId: string, optionId: string,
): Promise<void> {
  await requireRole('configurator')
  const sql = db()
  await requireSelector(sql, campaignId, selectorId)

  await sql`
    DELETE FROM card_selector_option WHERE id = ${optionId} AND selector_id = ${selectorId}`
  revalidatePath(`/campaigns/${campaignId}/selectors/${selectorId}`)
}
