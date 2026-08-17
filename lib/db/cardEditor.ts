import type postgres from 'postgres'
import type { CampaignStatus } from './campaigns'
import { loadCard, type CardView } from './cards'
import type { SelectorReturn } from './selectors'
import type { CardBlock } from '../render/groups'

/**
 * ทุกอย่างที่จอ M3-S02 ขั้น 3 (บล็อกเอดิเตอร์) ต้องอ่าน — การ์ดหนึ่งใบพร้อมบล็อกของมัน
 * บวกกับรายการที่ฟอร์มของแต่ละบล็อกต้องเลือกจาก (ชุดเนื้อหา · กิจกรรม · รางวัล ·
 * ค่าสะสม)
 *
 * เหมือนที่ `loadActivity` ใน lib/db/activities.ts ทำกับกิจกรรม — โหลดครั้งเดียว
 * ให้ครบ ไม่ใช่ให้แต่ละฟอร์มย่อยยิง query ของตัวเอง
 */

export type CardSelectorOption = { id: string; name: string; returns: SelectorReturn }

export type CardEditorScreen = {
  card: CardView
  templateCode: string | null
  hasSampleText: boolean
  campaignName: string
  campaignStatus: CampaignStatus
  blocks: CardBlock[]
  /** ชุดเนื้อหาของแคมเปญนี้ — กรองตามชนิดที่บล็อกแต่ละแบบใช้ได้ที่จอเอง ไม่ใช่ที่นี่ */
  selectors: CardSelectorOption[]
  activities: Array<{ id: string; code: string; name: string }>
  rewardCodes: string[]
  counterCodes: string[]
}

type CardMetaRow = {
  campaign_id: string
  template_code: string | null
  has_sample_text: boolean
  campaign_name: string
  campaign_status: CampaignStatus
}

type BlockRow = CardBlock & { card_id: string }

/**
 * โหลดทุกอย่างที่จอต้องใช้ในทีเดียว · คืน `null` เมื่อการ์ดไม่อยู่ในแคมเปญนี้
 *
 * แยกจาก `loadCard` (lib/db/cards.ts) เพราะที่นั่นตอบคำถาม "ใครใช้การ์ดนี้อยู่"
 * ซึ่งจอรายการ M3-S01 กับจอนี้ต้องตอบเหมือนกัน ส่วนที่นี่ตอบคำถามที่จอรายการไม่ต้อง
 * รู้เลย — บล็อกมีอะไรบ้าง และมีอะไรให้เลือกบ้าง
 */
export async function loadCardEditor(
  sql: postgres.Sql, campaignId: string, cardId: string,
): Promise<CardEditorScreen | null> {
  const [meta] = await sql<CardMetaRow[]>`
    SELECT c.campaign_id, c.template_code, c.has_sample_text,
           ca.name AS campaign_name, ca.status AS campaign_status
      FROM card c
      JOIN campaign ca ON ca.id = c.campaign_id
     WHERE c.id = ${cardId} AND c.campaign_id = ${campaignId}`
  if (!meta) return null

  const [card, blockRows, selectors, activities, rewards, counters] = await Promise.all([
    loadCard(sql, campaignId, cardId),
    sql<BlockRow[]>`
      SELECT id, card_id, block_type AS "blockType", sort_order AS "sortOrder",
             content, show_when AS "showWhen", options
        FROM card_block WHERE card_id = ${cardId} ORDER BY sort_order`,
    sql<{ id: string; name: string; returns: SelectorReturn }[]>`
      SELECT id, name, returns FROM card_selector
       WHERE campaign_id = ${campaignId} ORDER BY name`,
    sql<{ id: string; code: string; name: string }[]>`
      SELECT id, code, name FROM activity
       WHERE campaign_id = ${campaignId} ORDER BY sort_order, code`,
    sql<{ code: string }[]>`
      SELECT code FROM reward WHERE campaign_id = ${campaignId} ORDER BY code`,
    sql<{ code: string }[]>`
      SELECT code FROM counter WHERE campaign_id = ${campaignId} ORDER BY code`,
  ])
  if (!card) return null

  return {
    card,
    templateCode: meta.template_code,
    hasSampleText: meta.has_sample_text,
    campaignName: meta.campaign_name,
    campaignStatus: meta.campaign_status,
    blocks: blockRows.map(({ card_id: _cardId, ...block }) => block),
    selectors,
    activities,
    rewardCodes: rewards.map((r) => r.code),
    counterCodes: counters.map((c) => c.code),
  }
}
