import type postgres from 'postgres'

/** ตรงกับ CHECK ของ card.render_as ทุกค่า ไม่ใช่แค่ค่าที่สไลซ์นี้เปิดให้สร้าง */
export const CARD_RENDER_TYPES = [
  'flex_bubble', 'flex_carousel', 'imagemap', 'imagemap_video', 'text',
] as const
export type CardRenderType = (typeof CARD_RENDER_TYPES)[number]

export const CARD_RENDER_NAME: Record<CardRenderType, string> = {
  flex_bubble: 'การ์ดเดี่ยว',
  flex_carousel: 'การ์ดปัดได้',
  imagemap: 'ริชเมสเสจ',
  imagemap_video: 'ริชวิดีโอ',
  text: 'ข้อความล้วน',
}

/** ชนิดของสิ่งที่ชี้มาหาการ์ดได้ · ชื่อกลุ่มของตัวกรอง ไม่ใช่ชื่อของแถวเดียว */
export const CARD_REF_KINDS = ['activity', 'keyword', 'channel', 'carousel', 'stamp'] as const
export type CardRefKind = (typeof CARD_REF_KINDS)[number]

export type CardRef = { kind: CardRefKind; label: string }

/**
 * ตัวกรองของ M3-S01 · ทั้งหมด แล้วแยกตามชนิดของสิ่งที่ชี้มา แล้วปิดท้ายด้วยที่ไม่มีใครชี้
 *
 * The names are the filter. There is no parallel list of keys to keep in step
 * with them, because a second list is a second thing to get wrong and this
 * screen's whole point is that one fact is written down once.
 */
export const CARD_FILTERS = [
  'ทั้งหมด', 'กิจกรรม', 'คีย์เวิร์ด', 'บัญชี LINE', 'ชุดปัด', 'บัตรแสตมป์', 'ยังไม่ถูกใช้',
] as const
export type CardFilter = (typeof CARD_FILTERS)[number]

/** null คือกรองด้วยอย่างอื่นที่ไม่ใช่ชนิดของผู้อ้างอิง */
const FILTER_KIND: Record<CardFilter, CardRefKind | null> = {
  'ทั้งหมด': null,
  'กิจกรรม': 'activity',
  'คีย์เวิร์ด': 'keyword',
  'บัญชี LINE': 'channel',
  'ชุดปัด': 'carousel',
  'บัตรแสตมป์': 'stamp',
  'ยังไม่ถูกใช้': null,
}

export const asCardFilter = (raw: string | undefined | null): CardFilter =>
  (CARD_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as CardFilter) : 'ทั้งหมด'

export type CardRow = {
  id: string
  code: string
  render_as: CardRenderType
  /** มีบล็อกภาพอยู่ในการ์ดใบนี้ · แถบภาพหัวการ์ดของต้นแบบขึ้นอยู่กับข้อนี้ */
  has_image: boolean
  /** ข้อความของบล็อกแรกที่มีข้อความ · null เมื่อบล็อกนั้นดึงจากชุดเนื้อหาแทน */
  title_text: string | null
  /** ชื่อชุดเนื้อหาที่บล็อกนั้นดึงมาใช้ · null เมื่อเป็นข้อความคงที่ */
  title_selector: string | null
  /** ทุกที่ที่ชี้มาหาการ์ดใบนี้ · ว่างคือไม่มีทางถูกส่ง */
  used_by: CardRef[]
}

export type CardView = {
  id: string
  code: string
  renderAs: CardRenderType
  renderName: string
  hasImage: boolean
  /** ข้อความบนการ์ดอย่างที่เขียนไว้ · ตัวแปรยังไม่ถูกแทนค่า เหมือนที่ต้นแบบแสดง */
  previewText: string | null
  usedBy: CardRef[]
  isOrphan: boolean
}

/**
 * แถวหนึ่งของการ์ด อย่างที่จอต้องใช้
 *
 * "ไม่มีใครใช้" is read from the references themselves rather than from a column
 * saying so, on the same principle that gives remaining stock one owner: two
 * places holding the same fact are two places that can disagree, and the one
 * that disagrees quietly is the one a person acts on. There is no flag to read
 * here even if somebody wanted to — card carries no such column — and that is
 * the shape to keep, because the claim this feeds is "nothing can ever send
 * this card", which is the reason the screen is worth opening.
 */
export function summarizeCard(row: CardRow): CardView {
  const usedBy = row.used_by ?? []

  return {
    id: row.id,
    code: row.code,
    renderAs: row.render_as,
    renderName: CARD_RENDER_NAME[row.render_as],
    hasImage: row.has_image,
    previewText: row.title_text
      ?? (row.title_selector ? `เลือกจากชุดเนื้อหา "${row.title_selector}"` : null),
    usedBy,
    isOrphan: usedBy.length === 0,
  }
}

/**
 * กรองในฝั่งเซิร์ฟเวอร์ · จอนี้ไม่มี state ฝั่ง client
 *
 * Filtering by kind asks the references, and so does "ยังไม่ถูกใช้" — the same
 * array answers both questions, so a card can never be counted as used by the
 * one and unused by the other.
 */
export function filterCards(
  cards: readonly CardView[],
  filter: CardFilter = 'ทั้งหมด',
): CardView[] {
  if (filter === 'ทั้งหมด') return [...cards]
  if (filter === 'ยังไม่ถูกใช้') return cards.filter((card) => card.isOrphan)

  const kind = FILTER_KIND[filter]
  return cards.filter((card) => card.usedBy.some((ref) => ref.kind === kind))
}

/**
 * ทุกทางที่การ์ดหนึ่งใบถูกส่งออกไปได้ ตามที่ schema เขียนไว้จริง
 *
 * Eight branches because there are eight, and leaving any of them out turns the
 * dashed "ไม่มีใครใช้" pill into an invitation to delete a card that a running
 * campaign still answers with. Three of them live inside JSONB the engine reads
 * — an outcome's cardId, an entry rule's cardId — with no foreign key behind
 * them, so nothing but this query knows about those references at all.
 *
 * The two channel branches go through campaign_channel rather than reading
 * channel directly: a channel belongs to the account and can be shared, so the
 * default card of some other campaign's OA is not a reference from here.
 */
function selectCards(sql: postgres.Sql, where: postgres.PendingQuery<CardRow[]>) {
  return sql<CardRow[]>`
    SELECT c.id, c.code, c.render_as,
           EXISTS (SELECT 1 FROM card_block b
                    WHERE b.card_id = c.id AND b.block_type = 'image') AS has_image,
           t.content AS title_text,
           t.selector_name AS title_selector,
           used.refs AS used_by
      FROM card c
      LEFT JOIN LATERAL (
        SELECT b.content, sel.name AS selector_name
          FROM card_block b
          LEFT JOIN card_selector sel ON sel.id = b.selector_id
         WHERE b.card_id = c.id AND b.block_type IN ('title', 'body', 'caption')
         ORDER BY (b.block_type <> 'title'), b.sort_order
         LIMIT 1
      ) t ON true
      CROSS JOIN LATERAL (
        SELECT coalesce(
                 jsonb_agg(jsonb_build_object('kind', kind, 'label', label) ORDER BY label),
                 '[]'::jsonb) AS refs
          FROM (
            SELECT 'activity' AS kind, a.name || ' · การ์ดสำรอง' AS label
              FROM activity a
             WHERE a.campaign_id = c.campaign_id AND a.fallback_card_id = c.id
             UNION
            SELECT 'activity', a.name || ' · ผลลัพธ์ "' || coalesce(o->>'id', '') || '"'
              FROM activity a, jsonb_array_elements(coalesce(a.resolve_config->'outcomes',
                                                             '[]'::jsonb)) o
             WHERE a.campaign_id = c.campaign_id AND o->>'cardId' = c.id::text
             UNION
            SELECT 'activity', a.name || ' · กติกาการเข้าเล่น'
              FROM activity a
             WHERE a.campaign_id = c.campaign_id
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.entry_rules) e
                            WHERE e->>'cardId' = c.id::text)
             UNION
            SELECT 'keyword', 'คีย์เวิร์ด "' || k.keyword || '"'
              FROM keyword_rule k
             WHERE k.campaign_id = c.campaign_id AND k.target_card_id = c.id
             UNION
            SELECT 'channel', 'บัญชี ' || ch.name || ' · การ์ดตั้งต้น'
              FROM channel ch
              JOIN campaign_channel cc ON cc.channel_id = ch.id
             WHERE cc.campaign_id = c.campaign_id AND ch.default_card_id = c.id
             UNION
            SELECT 'channel', 'บัญชี ' || ch.name || ' · การ์ดทักทาย'
              FROM channel ch
              JOIN campaign_channel cc ON cc.channel_id = ch.id
             WHERE cc.campaign_id = c.campaign_id AND ch.greeting_card_id = c.id
             UNION
            SELECT 'carousel', 'การ์ด ' || p.code || ' · ใบในชุดปัด'
              FROM card p WHERE p.id = c.parent_card_id
             UNION
            SELECT 'stamp', 'บัตรแสตมป์ของค่าสะสม "' || ct.name || '"'
              FROM stamp_card s
              JOIN counter ct ON ct.id = s.counter_id
             WHERE s.campaign_id = c.campaign_id AND s.card_id = c.id
          ) refs
      ) used
     ${where}
     ORDER BY c.code`
}

export async function listCards(sql: postgres.Sql, campaignId: string): Promise<CardView[]> {
  const rows = await selectCards(sql, sql<CardRow[]>`WHERE c.campaign_id = ${campaignId}`)
  return rows.map(summarizeCard)
}

/**
 * การ์ดใบเดียว อย่างที่จอ M3-S02 ขั้น 3 (บล็อกเอดิเตอร์) ต้องใช้
 *
 * ใช้ query เดียวกับ `listCards` ผ่าน `selectCards` เพื่อให้ "ใครใช้การ์ดนี้อยู่"
 * กับ "ไม่มีใครใช้" ตอบเหมือนกันทั้งจอรายการและจอแก้ทีละใบ ไม่ใช่สองความจริงที่
 * อาจไม่ตรงกัน
 */
export async function loadCard(
  sql: postgres.Sql, campaignId: string, cardId: string,
): Promise<CardView | null> {
  const rows = await selectCards(
    sql, sql<CardRow[]>`WHERE c.campaign_id = ${campaignId} AND c.id = ${cardId}`,
  )
  const [row] = rows
  return row ? summarizeCard(row) : null
}
