import { normalizeText } from '../match/keyword'

export type KeywordConflict = { keyword: string; channelName: string }

export type KeywordRuleView = {
  id: string
  keyword: string
  matchMode: 'exact' | 'contains'
  sortOrder: number
  targetActivityId: string | null
  targetCardId: string | null
}

export type KeywordCatalogue = {
  activities: Array<{ id: string; name: string; isEnabled: boolean }>
  cards: Array<{ id: string; code: string }>
}

export type TargetView = {
  kind: 'activity' | 'card' | 'dead'
  label: string
  /** สิ่งที่ตั้งไว้กับสิ่งที่จะเกิดขึ้นจริงไม่ตรงกัน · null คือตรงกัน */
  warning: string | null
}

/**
 * เตือนเมื่อคีย์เวิร์ดของแคมเปญชนกับคำที่ลูกค้าตั้งไว้เองใน OA Manager (BR-44)
 *
 * A collision is worse than it sounds: the client's own auto-reply answers
 * first, the activity never runs, and our logs look completely normal because
 * the event never reached us. Nothing on either side reports a problem, so the
 * screen has to.
 *
 * Both sides go through normalizeText, the same function the matcher uses on an
 * incoming message. existing_keywords is typed in by hand from someone else's
 * OA Manager, so normalising only our side would let " PROMO " sit beside
 * "promo" and report nothing — precisely the case the warning exists for.
 *
 * Every bound channel is checked and every hit is reported, because a word that
 * is free on one OA may be taken on another and the person fixing it needs to
 * know which accounts to go and look at.
 */
export function findConflicts(
  keywords: string[],
  channels: Array<{ name: string; existingKeywords: string[] }>,
): KeywordConflict[] {
  const conflicts: KeywordConflict[] = []

  for (const keyword of keywords) {
    const needle = normalizeText(keyword)
    // คำว่างไม่ใช่คำ · ถ้าปล่อยผ่านจะไปตรงกับช่องว่างที่ SA เผลอกรอกไว้ทุกบรรทัด
    if (!needle) continue

    for (const channel of channels) {
      const taken = channel.existingKeywords.some((k) => normalizeText(k) === needle)
      if (taken) conflicts.push({ keyword: keyword.trim(), channelName: channel.name })
    }
  }

  return conflicts
}

/**
 * เรียงกติกาตามลำดับที่เครื่องตรวจจริง · exact ทั้งกลุ่มก่อน แล้วค่อย contains
 *
 * The screen prints "exact is checked first, then top to bottom" above the list,
 * and a list drawn in creation order turns that sentence into a lie the reader
 * has no way to see through. matchKeyword decides the order; this only mirrors
 * it. The input array is left alone because the caller renders from it too.
 */
export function inMatchOrder<T extends { matchMode: 'exact' | 'contains'; sortOrder: number }>(
  rules: readonly T[],
): T[] {
  return [...rules].sort((a, b) =>
    a.matchMode === b.matchMode
      ? a.sortOrder - b.sortOrder
      : (a.matchMode === 'exact' ? -1 : 1))
}

/**
 * ปลายทางที่จะเกิดขึ้นจริงเมื่อมีคนพิมพ์คำนี้ · ไม่ใช่ปลายทางที่กรอกไว้เฉยๆ
 *
 * handle.ts tries the activity first and only reaches the card when that
 * activity is not among the enabled ones, so a row that prints whatever is in
 * target_activity_id would describe a rule that does something else. The two
 * disagreeing cases both get a sentence: an activity switched off after the rule
 * was written, and a rule holding both targets where the card can never run.
 */
export function describeTarget(rule: KeywordRuleView, catalogue: KeywordCatalogue): TargetView {
  const activity = rule.targetActivityId
    ? catalogue.activities.find((a) => a.id === rule.targetActivityId)
    : undefined
  const card = rule.targetCardId
    ? catalogue.cards.find((c) => c.id === rule.targetCardId)
    : undefined

  if (activity?.isEnabled) {
    return {
      kind: 'activity',
      label: activity.name,
      warning: card ? `การ์ด ${card.code} ที่ตั้งไว้ด้วยจะไม่ถูกใช้ — กิจกรรมมาก่อนเสมอ` : null,
    }
  }

  const blocked = activity
    ? `กิจกรรม “${activity.name}” ถูกปิดอยู่`
    : rule.targetActivityId
      ? 'กิจกรรมปลายทางหายไปแล้ว'
      : null

  if (card) {
    return {
      kind: 'card',
      label: card.code,
      warning: blocked ? `${blocked} — คำนี้จะตอบด้วยการ์ดใบนี้แทน` : null,
    }
  }

  return {
    kind: 'dead',
    label: activity?.name ?? '—',
    warning: `${blocked ?? 'คำนี้ยังไม่ได้ชี้ไปไหน'} — คนที่พิมพ์คำนี้จะได้การ์ดตั้งต้นของบัญชี`,
  }
}
