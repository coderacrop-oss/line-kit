/**
 * ตัวเลขและรหัสของผู้เล่นจำลอง · ไม่มีอะไรในไฟล์นี้แตะฐานข้อมูล
 *
 * The simulator's whole job is to run the real handler against a different
 * clock and a different channel. Both of those are decided here, apart from any
 * I/O, so the rules that make the simulation honest can be tested without a
 * database standing by.
 */

const DAY_SEC = 86_400

/**
 * ผู้เล่นจำลองมีคนเดียวต่อแคมเปญ และเป็นคนเดิมทุกครั้งที่เปิดจอ
 *
 * A fresh id per visit would mean every reload started a player who had never
 * played, which is the one state the screen already shows without any help.
 * What is hard to reach — a streak on day six, a counter one unit from its
 * target — only exists if the same player is still there tomorrow.
 */
export const PREVIEW_LINE_UID = 'preview-player'

/**
 * รหัสช่องของชั้นตัวอย่าง · หน้าตาที่บัญชี LINE จริงเป็นไปไม่ได้
 *
 * channel.line_channel_id is UNIQUE across the whole table (BR-68), so the
 * preview row has to hold something no real OA can ever present. LINE issues
 * all-digit ids, and this shape has a colon in it, so the two can never
 * collide — which matters because a collision would point the simulator at a
 * customer's live account.
 */
const PREFIX = 'preview:'

export function previewLineChannelId(campaignId: string): string {
  return `${PREFIX}${campaignId}`
}

export function isPreviewLineChannelId(lineChannelId: string): boolean {
  return lineChannelId.startsWith(PREFIX)
}

/**
 * ชื่อช่องของชั้นตัวอย่าง · BR-19 บังคับให้จอบอกว่ากำลังทำงานกับช่องไหน
 *
 * One function rather than one string in the row and another on the screen. The
 * screen names the channel before the row exists — it is created on the first
 * tap, not on page load — so the two would have to agree by hand.
 */
export function previewChannelName(campaignName: string): string {
  return `ตัวอย่าง · ${campaignName}`
}

/**
 * เวลาที่ผู้เล่นจำลองอยู่ ณ ตอนนี้ หลังกดข้ามวันไปแล้ว `dayOffset` ครั้ง
 *
 * handleEvent already takes `now` as an argument, so skipping a day is moving
 * that argument rather than teaching the engine about a simulator. One step is
 * one campaign day, because the campaign's own day length is what periodKey
 * counts "played today" against — stepping a fixed 24h would leave a campaign
 * with a two-minute day sitting in the same period after a skip, and the button
 * would look like it worked while changing nothing.
 *
 * A day length of zero means the whole campaign is one period. The clock still
 * has to move, because time-window rules read the wall clock rather than the
 * period, so the step falls back to a real day.
 *
 * Going backwards is refused rather than supported. Plays are recorded against
 * the period they happened in, and rewinding past one of them would show a
 * player who has not played yet holding what that play granted.
 */
export function previewNow(base: Date, dayOffset: number, dayLengthSec: number): Date {
  const step = dayLengthSec > 0 ? dayLengthSec : DAY_SEC
  const skipped = Math.max(0, Math.trunc(dayOffset))
  return new Date(base.getTime() + skipped * step * 1000)
}

/** วันแรกคือวันที่ 1 · คนอ่านหน้าจอไม่ได้นับจากศูนย์ */
export function dayLabel(dayOffset: number): string {
  return `วันที่ ${Math.max(0, Math.trunc(dayOffset)) + 1}`
}

/**
 * สิ่งที่ผู้เล่นจำลองทำได้ · สามอย่างเท่าที่ handleEvent รับ
 *
 * Kept here rather than beside the database code because the client component
 * names these types too, and a browser bundle that reaches for lib/db reaches
 * for postgres.
 */
export type PreviewInput =
  | { kind: 'text'; text: string }
  | { kind: 'postback'; data: string }
  | { kind: 'follow' }

/** สถานะของผู้เล่นจำลองอย่างที่แผงขวาแสดง */
export type PreviewSnapshot = {
  attributes: Array<{ key: string; value: string }>
  counters: Array<{ code: string; name: string; value: number; target: number }>
  entitlements: Array<{ code: string; status: string }>
}

/**
 * เหตุผลที่แคมเปญนี้ยังทดลองเล่นไม่ได้ · ว่างคือเล่นได้
 *
 * An enabled activity is the whole requirement, because queries.ts only loads
 * enabled ones into the config: with none, every tap resolves to the fallback
 * and the screen would look broken rather than unconfigured. Saying which of
 * the two it is costs one sentence and saves the reader a trip through the
 * activity list to find out there is nothing in it.
 */
export function playBlockers(activities: { isEnabled: boolean }[]): string[] {
  if (activities.length === 0) {
    return ['ยังไม่มีกิจกรรม — เพิ่มกิจกรรมแรกก่อนถึงจะทดลองเล่นได้']
  }
  if (!activities.some((activity) => activity.isEnabled)) {
    return ['กิจกรรมทั้งหมดปิดอยู่ — เปิดอย่างน้อย 1 กิจกรรม']
  }
  return []
}

/** สภาพของคลังรางวัลที่จะจำลอง (BR-83) */
export type PreviewStock = 'as_configured' | 'sold_out'

export const STOCK_MODES: ReadonlyArray<{
  value: PreviewStock
  label: string
  note: string
}> = [
  {
    value: 'as_configured',
    label: 'ตามที่ตั้งไว้',
    note: 'คลังรางวัลเหลือเท่าที่ตั้งไว้จริง — ผู้เล่นจำลองจะได้รางวัลตามผลที่ออก',
  },
  {
    value: 'sold_out',
    label: 'รางวัลหมดทุกชิ้น',
    note: 'จำลองว่าโควตารางวัลทุกตัวหมดพอดี เพื่อดูการ์ดสำรอง (BR-31) ที่ปกติต้องรอจนของหมดจริงถึงจะเห็น',
  },
]
