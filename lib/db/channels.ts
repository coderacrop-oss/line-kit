import type postgres from 'postgres'
import { periodKey } from '../daykey'
import { last4 } from '../crypto/secretbox'

/** ชั้นของบัญชี ตรงกับ CHECK ของคอลัมน์ channel_type ใน §5.2 */
export type ChannelType = 'preview' | 'test' | 'production'

/** เกินเท่านี้แล้ว "N วันก่อน" ไม่ช่วยให้นึกออก จึงบอกเป็นวันที่แทน */
const RECENT_DAYS = 30
const DAY_MS = 86_400_000

/** วันของแคมเปญเริ่มเที่ยงคืนเวลาไทยเสมอ (BR-04) — "ใช้ล่าสุด" ก็นับด้วยวันเดียวกัน */
const CLOCK_TZ = 'Asia/Bangkok'

/**
 * สามชั้น เรียงจากที่ทำอะไรพังไม่ได้ ไปหาที่พังแล้วลูกค้าเห็น
 *
 * The order is the point: it puts the tier a mistake is cheapest in first and
 * the tier a mistake is public in last, so reading the screen top to bottom is
 * reading from safe to dangerous. What each tier is called and how it is
 * described belongs to the screen, not here — this file decides which rows go
 * in which bucket, and nothing about how the bucket is labelled.
 */
export const TIER_ORDER: readonly ChannelType[] = ['preview', 'test', 'production']

export type ChannelRow = {
  id: string
  name: string
  channel_type: ChannelType
  token_last4: string | null
  key_version: number | null
  last_used_at: Date | null
  existing_keywords: string[]
  live_campaign_name: string | null
  published_version: number | null
}

/**
 * ทุกอย่างที่หน้าจอเห็นเกี่ยวกับบัญชีหนึ่งบัญชี
 *
 * There is no field here for a token or a secret, encrypted or otherwise. The
 * screen renders what this type carries, so the promise that a key is never
 * shown in full (BR-16) is kept by the shape of the data rather than by every
 * screen remembering to leave a column out.
 */
export type ChannelSummary = {
  id: string
  name: string
  channelType: ChannelType
  tokenLast4: string | null
  keyVersion: number | null
  lastUsedAt: Date | null
  existingKeywords: string[]
  liveCampaignName: string | null
  publishedVersion: number | null
  isEditable: boolean
}

export function summarizeChannel(row: ChannelRow): ChannelSummary {
  return {
    id: row.id,
    name: row.name,
    channelType: row.channel_type,
    tokenLast4: row.token_last4,
    keyVersion: row.key_version,
    lastUsedAt: row.last_used_at,
    existingKeywords: row.existing_keywords ?? [],
    liveCampaignName: row.live_campaign_name,
    publishedVersion: row.published_version,
    // ชั้น preview ไม่มีกุญแจให้แก้ และ CHECK ของตารางห้ามใส่ไว้อยู่แล้ว
    isEditable: row.channel_type !== 'preview',
  }
}

const dayNumber = (at: Date): number =>
  Date.parse(`${periodKey(at, CLOCK_TZ, 86_400)}T00:00:00Z`) / DAY_MS

/**
 * นานแค่ไหนแล้วที่บัญชีนี้พูดครั้งสุดท้าย
 *
 * The question this screen is opened with is "is this one still alive", and a
 * timestamp makes the reader do the subtraction. Past a month the count stops
 * helping — nobody pictures 45 days — so it turns back into a date.
 *
 * A time in the future reads as today rather than as a negative count: two
 * clocks that disagree by a second is a normal Tuesday, and "-1 วันก่อน" would
 * be the screen reporting its own bug as the channel's.
 */
export function describeLastUsed(at: Date | null, now: Date): string {
  if (!at) return 'ยังไม่เคยใช้'

  const days = dayNumber(now) - dayNumber(at)
  if (days <= 0) return 'วันนี้'
  if (days === 1) return 'เมื่อวาน'
  if (days <= RECENT_DAYS) return `${days} วันก่อน`
  return periodKey(at, CLOCK_TZ, 86_400)
}

/**
 * กุญแจอย่างที่หน้าจอเห็นได้ · สี่ตัวท้ายเท่านั้น (BR-16)
 *
 * Passed through last4 again rather than trusted: the column is written by an
 * action today, but a backfill or an older row could hold more than four
 * characters, and the mask is the last place that can still refuse to print it.
 */
export function maskedKey(tokenLast4: string | null): string {
  return tokenLast4 ? `••••${last4(tokenLast4)}` : 'ยังไม่มีกุญแจ'
}

/**
 * แถวหนึ่งบอกได้ไหมว่าตอนนี้มีแคมเปญไหนอยู่บนบัญชีนี้ (BR-68)
 *
 * One OA runs one campaign at a time, enforced by the partial unique index on
 * campaign_channel. That makes "which one is on it right now" a question with
 * exactly one answer, and the answer is what somebody about to publish needs
 * before they find out by overwriting it.
 *
 * A version number without a live campaign says nothing useful — the campaign
 * that produced it has since been taken down — so it is only shown beside one.
 */
export function describePublished(channel: ChannelSummary): { label: string; isLive: boolean } {
  if (!channel.liveCampaignName) return { label: 'ยังไม่ส่งขึ้น', isLive: false }
  return {
    label: channel.publishedVersion === null
      ? 'ส่งขึ้นแล้ว'
      : `ส่งขึ้นแล้ว · v${channel.publishedVersion}`,
    isLive: true,
  }
}

export type ChannelGroup = { type: ChannelType; channels: ChannelSummary[] }

/**
 * สามกลุ่มเสมอ แม้กลุ่มไหนจะว่าง
 *
 * A list of only the tiers that have something in them cannot say which tier is
 * missing, and "no production account yet" is the single most useful sentence
 * this screen has.
 */
export function groupByTier(channels: readonly ChannelSummary[]): ChannelGroup[] {
  return TIER_ORDER.map((type) => ({
    type,
    channels: channels.filter((channel) => channel.channelType === type),
  }))
}

/**
 * บัญชีที่ตรงกับเงื่อนไข พร้อมแคมเปญที่เปิดอยู่บนแต่ละบัญชี
 *
 * The published campaign is read per channel because BR-68 allows exactly one
 * of them — the partial unique index on campaign_channel is what makes the
 * subquery's LIMIT 1 honest rather than a guess at which row to keep.
 *
 * The columns holding the ciphertext are not in the SELECT at all. Leaving them
 * out of the query is stronger than leaving them out of the render: nothing that
 * later reads this result can print what was never fetched, and adding a screen
 * cannot re-open the hole by accident.
 */
function selectChannels(sql: postgres.Sql, where: postgres.PendingQuery<ChannelRow[]>) {
  return sql<ChannelRow[]>`
    SELECT ch.id, ch.name, ch.channel_type, ch.token_last4, ch.key_version,
           ch.last_used_at, ch.existing_keywords,
           (SELECT ca.name FROM campaign_channel cc
              JOIN campaign ca ON ca.id = cc.campaign_id
             WHERE cc.channel_id = ch.id AND cc.is_published LIMIT 1) AS live_campaign_name,
           (SELECT max(cv.version_no) FROM config_version cv
             WHERE cv.channel_id = ch.id) AS published_version
      FROM channel ch
     ${where}
     ORDER BY ch.name`
}

export async function listChannels(sql: postgres.Sql): Promise<ChannelSummary[]> {
  const rows = await selectChannels(sql, sql<ChannelRow[]>``)
  return rows.map(summarizeChannel)
}

export async function loadChannel(sql: postgres.Sql, id: string): Promise<ChannelSummary | null> {
  const [row] = await selectChannels(sql, sql<ChannelRow[]>`WHERE ch.id = ${id}`)
  return row ? summarizeChannel(row) : null
}
