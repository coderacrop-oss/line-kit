import type postgres from 'postgres'
import type { KeywordRuleView } from '../campaign/keywords'

export type KeywordChannel = {
  name: string
  /** คีย์เวิร์ดที่ลูกค้าตั้งไว้เองใน OA Manager · SA กรอกไว้ที่จอบัญชี LINE */
  existingKeywords: string[]
  isPublished: boolean
}

export type KeywordScreenData = {
  rules: KeywordRuleView[]
  activities: Array<{ id: string; name: string; code: string; isEnabled: boolean }>
  cards: Array<{ id: string; code: string }>
  channels: KeywordChannel[]
}

type RuleRow = {
  id: string
  keyword: string
  match_mode: 'exact' | 'contains'
  sort_order: number
  target_activity_id: string | null
  target_card_id: string | null
}

/**
 * ทุกอย่างที่จอคีย์เวิร์ดต้องใช้ · กติกา ปลายทางที่เลือกได้ และบัญชีที่ต้องเตือน
 *
 * The rules are read the way makePorts reads them, ordered by sort_order, so the
 * screen starts from the same list the webhook does. The activities keep the
 * disabled ones: the engine skips them, and a screen that hid them could not
 * explain a rule that already points at one.
 *
 * Channels are every channel the campaign is bound to, published or not. An
 * unpublished binding is a collision that has not happened yet, and the day it
 * is published is a bad day to find out.
 */
export async function loadKeywordScreen(
  sql: postgres.Sql,
  campaignId: string,
): Promise<KeywordScreenData> {
  const [rules, activities, cards, channels] = await Promise.all([
    sql<RuleRow[]>`
      SELECT id, keyword, match_mode, sort_order, target_activity_id, target_card_id
        FROM keyword_rule WHERE campaign_id = ${campaignId} ORDER BY sort_order, keyword`,
    sql<{ id: string; name: string; code: string; is_enabled: boolean }[]>`
      SELECT id, name, code, is_enabled FROM activity
       WHERE campaign_id = ${campaignId} ORDER BY sort_order, name`,
    sql<{ id: string; code: string }[]>`
      SELECT id, code FROM card
       WHERE campaign_id = ${campaignId} AND owner_activity_id IS NULL
       ORDER BY code`,
    sql<{ name: string; existing_keywords: string[]; is_published: boolean }[]>`
      SELECT ch.name, ch.existing_keywords, cc.is_published
        FROM campaign_channel cc
        JOIN channel ch ON ch.id = cc.channel_id
       WHERE cc.campaign_id = ${campaignId}
       ORDER BY cc.is_published DESC, ch.name`,
  ])

  return {
    rules: rules.map((r) => ({
      id: r.id,
      keyword: r.keyword,
      matchMode: r.match_mode,
      sortOrder: r.sort_order,
      targetActivityId: r.target_activity_id,
      targetCardId: r.target_card_id,
    })),
    activities: activities.map((a) => ({
      id: a.id, name: a.name, code: a.code, isEnabled: a.is_enabled,
    })),
    cards,
    channels: channels.map((c) => ({
      name: c.name,
      existingKeywords: c.existing_keywords ?? [],
      isPublished: c.is_published,
    })),
  }
}
