import type postgres from 'postgres'
import type { PublishConfig } from '../publish/validate'
import { listActivities } from './activities'
import type { ChannelType } from './channels'
import { listRewards } from './rewards'

/**
 * ทุกอย่างที่จอ M1-S04 อ่าน · และการเขียนครั้งเดียวที่การส่งขึ้นทำ
 *
 * ที่นี่เป็นที่เดียวในสไลซ์นี้ที่เขียน `config_version` และ `campaign_channel` —
 * สองตารางที่ก่อนหน้านี้มีแต่คนอ่าน · ลำดับของขั้นตอนอยู่ที่ Server Action ตาม
 * §4.4 ไม่ใช่ที่นี่ เพราะขั้นที่ 6 เป็นการยิงออกไปหา LINE ซึ่งไม่ควรซ่อนอยู่ใน
 * ฟังก์ชันที่ชื่อเหมือนการเขียนฐานข้อมูลเฉยๆ
 */

/** ชั้นของบัญชีที่ส่งขึ้นได้จริง · preview ไม่มีกุญแจตาม CHECK ของตาราง channel */
export const PUBLISHABLE_TYPES: readonly ChannelType[] = ['test', 'production']

export type PublishChannel = {
  id: string
  name: string
  channelType: ChannelType
  tokenLast4: string | null
  lastUsedAt: Date | null
  /**
   * รหัสช่องของ LINE · ตัวที่ webhook ใช้หาว่า event นี้เป็นของแคมเปญไหน
   *
   * ยังไม่มีหน้าจอไหนกรอกค่านี้ (หนี้ทางเทคนิคข้อ 2 ของ docs/HANDOFF.md) จอจึง
   * ต้องบอกตรงๆ เมื่อมันว่าง แทนที่จะส่งขึ้นแล้วปล่อยให้เงียบ
   */
  lineChannelId: string | null
  defaultCardId: string | null
  /** เวอร์ชันล่าสุดที่แคมเปญนี้เคยส่งขึ้นบัญชีนี้ · null คือยังไม่เคย */
  publishedVersion: number | null
  /** แคมเปญที่กำลังเปิดอยู่บนบัญชีนี้ · อาจเป็นแคมเปญนี้เอง (BR-68) */
  liveCampaign: { id: string; name: string } | null
  /** ค่าที่ผูกไว้เฉพาะบัญชีนี้ · null คือใช้ค่าตั้งต้นของแคมเปญ (BR-28) */
  dayLengthSec: number | null
  counterTargets: Record<string, number>
}

export type PublishCounter = { id: string; code: string; name: string; target: number }

/** ส่วนของ config ที่ไม่ขึ้นกับว่าจะส่งขึ้นบัญชีไหน */
export type PublishBase = Pick<PublishConfig, 'cards' | 'activities' | 'keywordRules' | 'rewards'>
  & { counters: PublishCounter[] }

export type PublishScreenData = {
  base: PublishBase
  channels: PublishChannel[]
  /** เวอร์ชันล่าสุดของแคมเปญนี้ ไม่ว่าจะส่งขึ้นบัญชีไหน · ครั้งถัดไปคือ +1 */
  latestVersion: number
  campaignDayLengthSec: number
}

type CardRow = { id: string; code: string; has_sample_text: boolean; blocks: number }
type KeywordRow = {
  id: string
  keyword: string
  target_activity_id: string | null
  target_card_id: string | null
}
type CounterRow = { id: string; code: string; name: string; target: number }
type ChannelRow = {
  id: string
  name: string
  channel_type: ChannelType
  token_last4: string | null
  last_used_at: Date | null
  line_channel_id: string | null
  default_card_id: string | null
  published_version: number | null
  live_campaign_id: string | null
  live_campaign_name: string | null
  day_length_sec: number | null
}

/**
 * ทุกอย่างที่ด่านตรวจต้องรู้ · อ่านจากที่เดียวกับที่จออื่นอ่าน
 *
 * กิจกรรมกับรางวัลถูกอ่านผ่าน `listActivities` และ `listRewards` ตัวเดียวกับที่จอ
 * M7-S02 และ M7-S04 ใช้ ไม่ได้เขียน SQL ชุดที่สองขึ้นมา — ด่านที่ตัดสินว่าจะยิงของ
 * ขึ้น LINE หรือไม่ ต้องมองเห็นของชุดเดียวกับที่คนตั้งค่ามองเห็นตอนกรอก ไม่งั้น
 * จอจะบอกว่าเรียบร้อยแล้วปุ่มจะปฏิเสธ หรือแย่กว่านั้นคือกลับกัน
 */
export async function loadPublishScreen(
  sql: postgres.Sql,
  campaignId: string,
): Promise<PublishScreenData> {
  const [cards, activities, keywordRules, counters, rewards, channels, versions, campaign] =
    await Promise.all([
      sql<CardRow[]>`
        SELECT c.id, c.code, c.has_sample_text,
               (SELECT count(*) FROM card_block b WHERE b.card_id = c.id)::int AS blocks
          FROM card c WHERE c.campaign_id = ${campaignId} ORDER BY c.code`,
      listActivities(sql, campaignId),
      sql<KeywordRow[]>`
        SELECT id, keyword, target_activity_id, target_card_id
          FROM keyword_rule WHERE campaign_id = ${campaignId} ORDER BY sort_order, keyword`,
      sql<CounterRow[]>`
        SELECT id, code, name, target FROM counter
         WHERE campaign_id = ${campaignId} ORDER BY code`,
      listRewards(sql, campaignId),
      /*
       * บัญชีทุกใบที่ส่งขึ้นได้ ไม่ใช่เฉพาะที่แคมเปญนี้ผูกไว้แล้ว
       *
       * การผูกเกิดขึ้นตอนส่งขึ้น ไม่ใช่ก่อนหน้านั้น — จอที่แสดงเฉพาะบัญชีที่ผูกไว้
       * แล้วจะไม่มีบัญชีให้เลือกเลยในการส่งขึ้นครั้งแรก ซึ่งเป็นครั้งที่สำคัญที่สุด
       */
      sql<ChannelRow[]>`
        SELECT ch.id, ch.name, ch.channel_type, ch.token_last4, ch.last_used_at,
               ch.line_channel_id, ch.default_card_id,
               (SELECT max(cv.version_no) FROM config_version cv
                 WHERE cv.channel_id = ch.id AND cv.campaign_id = ${campaignId})
                 AS published_version,
               live.id AS live_campaign_id,
               live.name AS live_campaign_name,
               (SELECT cc.day_length_sec FROM campaign_channel cc
                 WHERE cc.channel_id = ch.id AND cc.campaign_id = ${campaignId})
                 AS day_length_sec
          FROM channel ch
          LEFT JOIN LATERAL (
            SELECT ca.id, ca.name FROM campaign_channel cc
              JOIN campaign ca ON ca.id = cc.campaign_id
             WHERE cc.channel_id = ch.id AND cc.is_published LIMIT 1
          ) live ON true
         WHERE ch.channel_type = ANY(${sql.array(PUBLISHABLE_TYPES as string[])})
         ORDER BY ch.channel_type, ch.name`,
      sql<{ latest: number | null }[]>`
        SELECT max(version_no) AS latest FROM config_version WHERE campaign_id = ${campaignId}`,
      sql<{ day_length_sec: number }[]>`
        SELECT day_length_sec FROM campaign WHERE id = ${campaignId}`,
    ])

  const targets = await sql<{ channel_id: string; code: string; target: number }[]>`
    SELECT t.channel_id, ct.code, t.target
      FROM campaign_channel_counter_target t
      JOIN counter ct ON ct.id = t.counter_id
     WHERE t.campaign_id = ${campaignId}`

  return {
    base: {
      cards: cards.map((card) => ({
        id: card.id,
        code: card.code,
        hasSampleText: card.has_sample_text,
        blocks: card.blocks,
      })),
      activities: activities.map((activity) => ({
        id: activity.id,
        code: activity.code,
        name: activity.name,
        inputType: activity.inputType,
        resolveMethod: activity.resolveMethod,
        fallbackCardId: activity.fallbackCardId,
        entryRules: activity.entryRules,
        outcomes: activity.outcomes,
        isEnabled: activity.isEnabled,
        trigger: activity.trigger,
        reachedBy: activity.reachedBy,
        counterCodes: Object.keys(activity.counterUnits),
      })),
      keywordRules: keywordRules.map((rule) => ({
        id: rule.id,
        keyword: rule.keyword,
        targetActivityId: rule.target_activity_id,
        targetCardId: rule.target_card_id,
      })),
      rewards: rewards.map((reward) => ({
        id: reward.id,
        code: reward.code,
        rewardType: reward.rewardType,
        codeShortfall: reward.codeShortfall,
      })),
      counters,
    },
    channels: channels.map((row) => ({
      id: row.id,
      name: row.name,
      channelType: row.channel_type,
      tokenLast4: row.token_last4,
      lastUsedAt: row.last_used_at,
      lineChannelId: row.line_channel_id,
      defaultCardId: row.default_card_id,
      publishedVersion: row.published_version,
      liveCampaign: row.live_campaign_id && row.live_campaign_name
        ? { id: row.live_campaign_id, name: row.live_campaign_name }
        : null,
      dayLengthSec: row.day_length_sec,
      counterTargets: Object.fromEntries(
        targets.filter((t) => t.channel_id === row.id).map((t) => [t.code, t.target]),
      ),
    })),
    latestVersion: versions[0]?.latest ?? 0,
    campaignDayLengthSec: campaign[0]?.day_length_sec ?? 86_400,
  }
}

/**
 * config ที่ด่านตรวจรับ · ประกอบจากส่วนกลางบวกกับบัญชีที่เลือก
 *
 * `channelType` กับ `defaultCardId` มาจากบัญชี ไม่ใช่จากแคมเปญ — BR-18 ถามว่า
 * ปลายทางเป็นบัญชีจริงหรือไม่ และ BR-39 ถามหาการ์ดตั้งต้นของบัญชีนั้น ทั้งสอง
 * ข้อจึงเปลี่ยนคำตอบเมื่อเลือกบัญชีคนละใบ · แยกฟังก์ชันไว้เพื่อให้จอกับ action
 * ประกอบ config ด้วยวิธีเดียวกันเป๊ะ ไม่ใช่ต่างคนต่างประกอบแล้วได้คนละก้อน
 */
export function configFor(
  base: PublishBase,
  channel: PublishChannel | null,
  confirmed: boolean,
): PublishConfig {
  return {
    cards: base.cards,
    activities: base.activities,
    keywordRules: base.keywordRules,
    rewards: base.rewards,
    counters: base.counters,
    channelType: channel?.channelType ?? 'test',
    confirmed,
    defaultCardId: channel?.defaultCardId ?? null,
  }
}

/**
 * ภาพนิ่งของทั้งชุดที่ engine จะอ่านต่อไป · แก้ไม่ได้หลังบันทึก
 *
 * เก็บเป็นก้อนเดียวเพราะสิ่งที่ตอบผู้เล่นวันนี้ต้องเป็นสิ่งเดียวกับที่ตอบเขาพรุ่งนี้
 * แม้จะมีคนเข้าไปแก้การ์ดระหว่างนั้น
 */
export function snapshotOf(base: PublishBase, channel: PublishChannel): unknown {
  return {
    channelId: channel.id,
    channelType: channel.channelType,
    cards: base.cards,
    activities: base.activities,
    keywordRules: base.keywordRules,
    counters: base.counters,
    rewards: base.rewards,
  }
}

export type PublishResult = { versionNo: number }

/**
 * ขั้น 4 · 7 ของ §4.4 พร้อมกันในธุรกรรมเดียว
 *
 * `runAtLine` ถูกเรียกอยู่ข้างในธุรกรรม ไม่ใช่หลังจากมัน — §4.4 บอกว่าถ้าขั้น 6
 * ล้ม ต้องย้อนขั้น 4 ทิ้ง ไม่ให้เหลือ version ที่ไม่ได้ใช้ · การให้การยิงออกไป
 * หา LINE อยู่ในธุรกรรมทำให้การย้อนกลับเป็นสิ่งที่ฐานข้อมูลทำให้เอง แทนที่จะเป็น
 * โค้ดลบแถวคืนที่ต้องถูกจำไว้ว่ามีอยู่ และล้มได้เองอีกรอบ
 *
 * สิ่งที่แลกไปคือธุรกรรมค้างอยู่ตลอดเวลาที่รอ LINE ตอบ ซึ่งรับได้เพราะฝั่ง
 * client ตั้ง timeout ไว้ และการส่งขึ้นเกิดขึ้นวันละไม่กี่ครั้ง ไม่ใช่ทุกข้อความ
 */
export async function writePublish(
  sql: postgres.Sql,
  opts: {
    campaignId: string
    channelId: string
    publishedBy: string
    snapshot: unknown
    runAtLine: () => Promise<void>
  },
): Promise<PublishResult> {
  return sql.begin(async (tx) => {
    const [version] = await tx<{ version_no: number }[]>`
      INSERT INTO config_version (campaign_id, version_no, snapshot, channel_id, published_by)
      SELECT ${opts.campaignId},
             coalesce(max(version_no), 0) + 1,
             ${tx.json(opts.snapshot as never)},
             ${opts.channelId},
             ${opts.publishedBy}
        FROM config_version WHERE campaign_id = ${opts.campaignId}
      RETURNING version_no`

    await tx`
      INSERT INTO campaign_channel (campaign_id, channel_id, is_published, published_at)
      VALUES (${opts.campaignId}, ${opts.channelId}, true, now())
      ON CONFLICT (campaign_id, channel_id)
      DO UPDATE SET is_published = true, published_at = now()`

    await tx`UPDATE campaign SET status = 'published' WHERE id = ${opts.campaignId}`

    await opts.runAtLine()

    return { versionNo: version.version_no }
  }) as Promise<PublishResult>
}
