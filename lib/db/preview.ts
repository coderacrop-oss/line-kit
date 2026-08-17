import type postgres from 'postgres'
import {
  PREVIEW_LINE_UID, playBlockers, previewChannelName, previewLineChannelId, previewNow,
  type PreviewInput, type PreviewSnapshot, type PreviewStock,
} from '../preview/sim'
import type { LineMessage } from '../render/card'
import { handleEvent, type IncomingEvent } from '../webhook/handle'
import type { Queryable } from './client'
import { clearConfigCache, makePorts } from './queries'

/**
 * ชั้นตัวอย่างของแคมเปญหนึ่ง · ต่างจากชั้นจริงแค่ channel_type
 *
 * The screen does not own a second copy of the rules. It builds the same Ports
 * the webhook route builds, from the same makePorts, and hands them to the same
 * handleEvent — what changes is which channel row those Ports are pointed at.
 * That is a structural separation rather than a filter: every row a play writes
 * hangs off participant_id, a participant hangs off exactly one channel, and the
 * simulated player's channel is not the customer's. A report that starts from
 * the live channel has no edge to walk to reach preview data, so there is no
 * WHERE clause anybody has to remember — and therefore none anybody can forget.
 */

/** เลขเวอร์ชันที่ชั้นตัวอย่างจอง · การส่งขึ้นจริงเริ่มนับที่ 1 (§4.4) */
const PREVIEW_VERSION_NO = 0

export type PreviewChannel = { channelId: string; lineChannelId: string }

/** ชนิดของอินพุตและสถานะอยู่ที่ lib/preview/sim.ts เพราะฝั่งเบราว์เซอร์อ้างถึงมันด้วย */
export type { PreviewInput, PreviewSnapshot } from '../preview/sim'

export type PreviewRun = {
  /** null คือกติกาไม่ได้ให้ตอบอะไรเลย ซึ่งผู้เล่นจริงจะเจอเป็นความเงียบ */
  message: LineMessage | null
  snapshot: PreviewSnapshot
}

/**
 * ช่องของชั้นตัวอย่าง สร้างครั้งเดียวแล้วใช้ต่อ
 *
 * The row carries no keys at all, which the table's own CHECK insists on for
 * this tier — so "the preview cannot speak to LINE" is a fact about the schema
 * rather than a promise this file makes.
 *
 * It is published to the campaign because that is what findLiveCampaign looks
 * for. BR-68's index allows one live campaign per channel, and this channel
 * belongs to one campaign, so nothing here can take a real OA's slot.
 *
 * The default card, the greeting card and whether greeting is on at all are
 * columns of the *channel*, not of the campaign, so a freshly made preview row
 * has none of them. Left that way the simulator answers "ระบบขัดข้องชั่วคราว" to
 * every unmatched message and stays silent when somebody adds the account —
 * the two commonest paths a player takes, both reported wrong. They are copied
 * from whichever real channel the campaign is attached to, and copied again on
 * every open so editing them over there shows up here.
 */
export async function ensurePreviewChannel(
  sql: Queryable, campaignId: string,
): Promise<PreviewChannel> {
  const lineChannelId = previewLineChannelId(campaignId)

  const [campaign] = await sql<{ name: string; created_by: string }[]>`
    SELECT name, created_by FROM campaign WHERE id = ${campaignId}`
  if (!campaign) throw new Error('ไม่พบแคมเปญนี้ — สร้างช่องทดลองเล่นไม่ได้')

  const [channel] = await sql<{ id: string }[]>`
    WITH live AS (
      SELECT ch.default_card_id, ch.greeting_card_id, ch.greeting_enabled
        FROM channel ch
        JOIN campaign_channel cc ON cc.channel_id = ch.id AND cc.campaign_id = ${campaignId}
       WHERE ch.channel_type <> 'preview'
       -- ที่ส่งขึ้นแล้วมาก่อน แล้วค่อย production ก่อน test ตามลำดับตัวอักษร
       ORDER BY cc.is_published DESC, ch.channel_type
       LIMIT 1)
    INSERT INTO channel (
      name, channel_type, line_channel_id, created_by,
      default_card_id, greeting_card_id, greeting_enabled)
    SELECT ${previewChannelName(campaign.name)}, 'preview', ${lineChannelId},
           ${campaign.created_by},
           live.default_card_id, live.greeting_card_id,
           COALESCE(live.greeting_enabled, false)
      FROM (VALUES (1)) AS one(x) LEFT JOIN live ON true
    ON CONFLICT (line_channel_id) DO UPDATE SET
      name = EXCLUDED.name,
      default_card_id = EXCLUDED.default_card_id,
      greeting_card_id = EXCLUDED.greeting_card_id,
      greeting_enabled = EXCLUDED.greeting_enabled
    RETURNING id`

  await sql`
    INSERT INTO campaign_channel (campaign_id, channel_id, is_published, published_at)
    VALUES (${campaignId}, ${channel.id}, true, now())
    ON CONFLICT (campaign_id, channel_id) DO NOTHING`

  // ทุกอย่างที่เขียนระหว่างเล่นอ้าง config_version_id · ชั้นตัวอย่างจึงต้องมีของ
  // ตัวเองหนึ่งใบ ไม่ใช่ไปยืมของช่องจริง ซึ่งจะทำให้แถวจำลองปนเข้าไปในรายงาน
  // ที่นับตามเวอร์ชันที่ส่งขึ้น
  await sql`
    INSERT INTO config_version (campaign_id, version_no, snapshot, channel_id, published_by)
    SELECT ${campaignId}, ${PREVIEW_VERSION_NO}, '{}'::jsonb, ${channel.id},
           ${campaign.created_by}
     WHERE NOT EXISTS (
             SELECT 1 FROM config_version cv
              WHERE cv.campaign_id = ${campaignId} AND cv.channel_id = ${channel.id})`

  return { channelId: channel.id, lineChannelId }
}

async function previewParticipantId(
  sql: Queryable, campaignId: string,
): Promise<string | null> {
  const [row] = await sql<{ id: string }[]>`
    SELECT p.id FROM participant p
      JOIN channel ch ON ch.id = p.channel_id
     WHERE ch.line_channel_id = ${previewLineChannelId(campaignId)}
       AND p.line_uid = ${PREVIEW_LINE_UID}`
  return row?.id ?? null
}

/**
 * สิ่งที่แผงขวาแสดง · ค่าสะสมมาครบทุกตัวของแคมเปญ ไม่ใช่เฉพาะตัวที่ขยับแล้ว
 *
 * A counter the simulated player has never touched is the one worth seeing:
 * zero out of seven is the state a card's progress bar is hardest to get right
 * in, and listing only rows that exist would hide it.
 */
export async function loadPreviewSnapshot(
  sql: Queryable, campaignId: string,
): Promise<PreviewSnapshot> {
  const participantId = await previewParticipantId(sql, campaignId)

  const [attributes, counters, entitlements] = await Promise.all([
    participantId
      ? sql<{ key: string; value: string }[]>`
          SELECT key, value FROM participant_attribute
           WHERE participant_id = ${participantId} AND campaign_id = ${campaignId}
           ORDER BY key`
      : [],
    sql<{ code: string; name: string; value: number; target: number }[]>`
      SELECT c.code, c.name, c.target, COALESCE(cv.value, 0)::int AS value
        FROM counter c
        LEFT JOIN counter_value cv
          ON cv.counter_id = c.id AND cv.participant_id = ${participantId}
       WHERE c.campaign_id = ${campaignId}
       ORDER BY c.code`,
    participantId
      ? sql<{ code: string; status: string }[]>`
          SELECT r.code, e.status FROM entitlement e
            JOIN reward r ON r.id = e.reward_id
           WHERE e.participant_id = ${participantId}
           ORDER BY r.code`
      : [],
  ])

  return {
    attributes: attributes.map((a) => ({ key: a.key, value: a.value })),
    counters: counters.map((c) => ({
      code: c.code, name: c.name, value: c.value, target: c.target,
    })),
    entitlements: entitlements.map((e) => ({ code: e.code, status: e.status })),
  }
}

export type PreviewScreen = {
  campaignName: string
  /** ชื่อช่องที่จอต้องประกาศออกมา (BR-19) */
  channelName: string
  /** ปุ่มเมนูจำลอง · ถอดจากคีย์เวิร์ดของแคมเปญ */
  menu: Array<{ label: string; text: string }>
  snapshot: PreviewSnapshot
  /** เหตุผลที่ยังเล่นไม่ได้ · ว่างคือเล่นได้ */
  blockers: string[]
}

/**
 * ทุกอย่างที่จอต้องใช้ตอนเปิด · อ่านอย่างเดียว ไม่สร้างช่องให้
 *
 * Opening the screen writes nothing. The preview channel is created on the
 * first tap instead, because a page that provisions rows while rendering
 * provisions them again on every prefetch, and a campaign nobody ever
 * rehearsed would still collect a channel and a config version.
 *
 * The simulated rich menu is built from keyword rules rather than from
 * rich_menu, which has no screen behind it yet in this slice. A keyword is a
 * way in that already works, so the buttons here send something the engine
 * genuinely answers rather than miming a menu that does not exist.
 */
export async function loadPreviewScreen(
  sql: Queryable, campaignId: string,
): Promise<PreviewScreen | null> {
  const [campaign] = await sql<{ name: string }[]>`
    SELECT name FROM campaign WHERE id = ${campaignId}`
  if (!campaign) return null

  const [activities, keywords, snapshot] = await Promise.all([
    sql<{ is_enabled: boolean }[]>`
      SELECT is_enabled FROM activity WHERE campaign_id = ${campaignId}`,
    sql<{ keyword: string }[]>`
      SELECT DISTINCT ON (keyword) keyword FROM keyword_rule
       WHERE campaign_id = ${campaignId}
       ORDER BY keyword, sort_order`,
    loadPreviewSnapshot(sql, campaignId),
  ])

  return {
    campaignName: campaign.name,
    channelName: previewChannelName(campaign.name),
    menu: keywords.map((k) => ({ label: k.keyword, text: k.keyword })),
    snapshot,
    blockers: playBlockers(activities.map((a) => ({ isEnabled: a.is_enabled }))),
  }
}

/**
 * ลบผู้เล่นจำลองทิ้ง · ไม่ได้ลบช่อง
 *
 * Deleting the participant takes their attributes, counters, entitlements, play
 * locks and event log with it, because every one of those tables cascades from
 * it. Deleting the channel instead would work today and quietly destroy the
 * next thing that hangs off a channel.
 */
export async function resetPreview(sql: Queryable, campaignId: string): Promise<void> {
  await sql`
    DELETE FROM participant
     WHERE channel_id IN (
       SELECT id FROM channel WHERE line_channel_id = ${previewLineChannelId(campaignId)})`
}

function toEvent(input: PreviewInput): IncomingEvent {
  // โทเคนตอบกลับปลอม · จอนี้ไม่เรียก replyMessage เลย ข้อความที่ได้ถูกวาดในเบราว์เซอร์
  // ถ้าวันหนึ่งมีใครเอาผลจากที่นี่ไปส่งจริง LINE จะปฏิเสธโทเคนนี้ ซึ่งเป็นด่านสุดท้าย
  const replyToken = 'preview'
  const source = { type: 'user', userId: PREVIEW_LINE_UID }

  if (input.kind === 'text') {
    return { type: 'message', replyToken, source, message: { type: 'text', text: input.text } }
  }
  if (input.kind === 'postback') {
    return { type: 'postback', replyToken, source, postback: { data: input.data } }
  }
  return { type: 'follow', replyToken, source }
}

/**
 * เล่นจริงหนึ่งครั้ง แล้วคืนคลังรางวัลให้เท่าที่ยืมมา
 *
 * reward.issued_count and reward_code.assigned_to belong to the campaign, not to
 * a participant, so the channel separation does not reach them: ten rehearsals
 * of a ten-piece reward would hand ten real customers "หมดแล้ว". The rows are
 * taken FOR UPDATE first, which is the same lock play_and_apply takes, so a real
 * play cannot slip between the borrow and the return — it waits, and then reads
 * the count the preview never changed.
 *
 * The same lock is what makes "รางวัลหมด" viewable at all (BR-83). Spending the
 * stock for the duration of one transaction shows the card a player sees when
 * the last prize has gone, without giving the last prize away.
 */
async function withBorrowedStock<T>(
  sql: postgres.Sql,
  args: { campaignId: string; previewChannelId: string; stock: PreviewStock },
  body: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    const before = await tx<{ id: string; quota: number | null; issued_count: number }[]>`
      SELECT id, quota, issued_count FROM reward
       WHERE campaign_id = ${args.campaignId}
       ORDER BY id
         FOR UPDATE`

    if (args.stock === 'sold_out') {
      await tx`
        UPDATE reward SET quota = issued_count WHERE campaign_id = ${args.campaignId}`
    }

    const out = await body(tx)

    await tx`
      UPDATE reward_code SET assigned_to = NULL, assigned_at = NULL
       WHERE assigned_to IN (
         SELECT id FROM participant WHERE channel_id = ${args.previewChannelId})`

    for (const row of before) {
      await tx`
        UPDATE reward SET quota = ${row.quota}, issued_count = ${row.issued_count}
         WHERE id = ${row.id}`
    }

    return out
  }) as Promise<T>
}

/**
 * หนึ่งครั้งที่ผู้เล่นจำลองแตะอะไรสักอย่าง
 *
 * The published config never changes, so makePorts caches it by version id and
 * never evicts. A campaign being rehearsed is the opposite: somebody is editing
 * a card in another tab and pressing play here to see what changed. Clearing the
 * cache first is what makes this screen able to answer that question, and the
 * cost is that the next webhook request re-reads a config that cannot have
 * changed anyway.
 */
export async function runPreviewEvent(
  sql: postgres.Sql,
  args: {
    campaignId: string
    input: PreviewInput
    dayOffset: number
    stock: PreviewStock
    now?: Date
    rng?: () => number
  },
): Promise<PreviewRun> {
  const { channelId, lineChannelId } = await ensurePreviewChannel(sql, args.campaignId)

  // ความยาวหนึ่งวันอ่านด้วยสูตรเดียวกับที่ findLiveCampaign อ่าน ไม่งั้นปุ่มข้ามวัน
  // จะเดินคนละก้าวกับคาบที่ engine นับ แล้วกดแล้วเหมือนไม่มีอะไรเกิดขึ้น
  const [clock] = await sql<{ day_length_sec: number }[]>`
    SELECT COALESCE(cc.day_length_sec, ca.day_length_sec)::int AS day_length_sec
      FROM campaign ca
      LEFT JOIN campaign_channel cc
        ON cc.campaign_id = ca.id AND cc.channel_id = ${channelId}
     WHERE ca.id = ${args.campaignId}`

  if (!clock) throw new Error('ไม่พบแคมเปญนี้')

  const now = previewNow(args.now ?? new Date(), args.dayOffset, clock.day_length_sec)

  clearConfigCache()

  const message = await withBorrowedStock(
    sql,
    { campaignId: args.campaignId, previewChannelId: channelId, stock: args.stock },
    async (tx) => {
      const ports = makePorts(tx, lineChannelId)
      const handled = await handleEvent(
        toEvent(args.input), lineChannelId, ports, now, args.rng ?? Math.random,
      )
      return handled?.message ?? null
    },
  )

  return { message, snapshot: await loadPreviewSnapshot(sql, args.campaignId) }
}
