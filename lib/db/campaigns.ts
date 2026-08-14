import type postgres from 'postgres'

/** นโยบายเก็บข้อมูลของ §5.4 — ปิดแคมเปญแล้วบวก 30 วัน */
const PURGE_AFTER_DAYS = 30
const DAY_MS = 86_400_000

export type CampaignStatus = 'draft' | 'published' | 'closed'

export type CampaignRow = {
  id: string
  name: string
  code: string
  status: CampaignStatus
  activity_count: number
  channel_name: string | null
  start_at: Date
  end_at: Date
}

export type CampaignSummary = {
  id: string
  name: string
  code: string
  status: CampaignStatus
  activityCount: number
  channelName: string | null
  daysLeft: number | null
  purgeInDays: number | null
}

const daysBetween = (from: Date, to: Date) => Math.ceil((to.getTime() - from.getTime()) / DAY_MS)

/**
 * A row has to answer two questions at once: is this live, and how long have I
 * got. Those are the two things people open this screen to find out, so they
 * belong in the same row rather than one screen apart.
 *
 * A closed campaign answers a third: when its player data disappears. That
 * deadline cannot be undone, so it is shown without being asked for. It replaces
 * the countdown rather than joining it — a finished campaign counting down to
 * its own end date is a number nobody can act on.
 */
export function summarize(row: CampaignRow, now: Date): CampaignSummary {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status,
    activityCount: row.activity_count,
    channelName: row.channel_name,
    daysLeft: row.status === 'closed' ? null : Math.max(0, daysBetween(now, row.end_at)),
    purgeInDays: row.status !== 'closed'
      ? null
      : Math.max(0, daysBetween(now, new Date(row.end_at.getTime() + PURGE_AFTER_DAYS * DAY_MS))),
  }
}

/**
 * ทุกแคมเปญเรียงตามความน่าจะเป็นที่คนเปิดหน้านี้มาหา
 *
 * count(*) comes back from postgres as a bigint, which the driver hands over as
 * a string; the ::int cast is what keeps activityCount a number all the way to
 * the screen instead of a "4" that renders correctly and compares wrong.
 */
export async function listCampaigns(sql: postgres.Sql, now: Date): Promise<CampaignSummary[]> {
  const rows = await sql<CampaignRow[]>`
    SELECT ca.id, ca.name, ca.code, ca.status, ca.start_at, ca.end_at,
           (SELECT count(*) FROM activity a WHERE a.campaign_id = ca.id)::int AS activity_count,
           (SELECT ch.name FROM campaign_channel cc
              JOIN channel ch ON ch.id = cc.channel_id
             WHERE cc.campaign_id = ca.id AND cc.is_published LIMIT 1) AS channel_name
      FROM campaign ca
     ORDER BY ca.status = 'published' DESC, ca.end_at DESC`
  return rows.map((row) => summarize(row, now))
}

export type CampaignDetail = {
  id: string
  name: string
  code: string
  status: CampaignStatus
  timezone: string
  dayLengthSec: number
  startAt: Date
  endAt: Date
  themePrimary: string | null
  /** มีคนเล่นไปแล้วหรือยัง — เปลี่ยนความยาววันตอนนี้กระทบคนที่กำลังรออยู่ */
  hasPlays: boolean
}

type DetailRow = {
  id: string
  name: string
  code: string
  status: CampaignStatus
  timezone: string
  day_length_sec: number
  start_at: Date
  end_at: Date
  theme: { primary?: string } | null
  has_plays: boolean
}

export async function loadCampaign(sql: postgres.Sql, id: string): Promise<CampaignDetail | null> {
  const [row] = await sql<DetailRow[]>`
    SELECT ca.id, ca.name, ca.code, ca.status, ca.timezone, ca.day_length_sec,
           ca.start_at, ca.end_at, ca.theme,
           EXISTS (SELECT 1 FROM play_lock pl
                     JOIN activity a ON a.id = pl.activity_id
                    WHERE a.campaign_id = ca.id) AS has_plays
      FROM campaign ca
     WHERE ca.id = ${id}`
  if (!row) return null

  return {
    id: row.id,
    name: row.name,
    code: row.code,
    status: row.status,
    timezone: row.timezone,
    dayLengthSec: row.day_length_sec,
    startAt: row.start_at,
    endAt: row.end_at,
    themePrimary: row.theme?.primary ?? null,
    hasPlays: row.has_plays,
  }
}
