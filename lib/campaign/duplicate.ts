import type postgres from 'postgres'
import { PUBLIC_PREFIX } from '../assets/store'

/**
 * ก๊อปแคมเปญ · สิ่งที่ตามไป และสิ่งที่ไม่ตามไปเด็ดขาด (BR-24)
 *
 * The refusals are the reason this file exists. Everything else here is
 * bookkeeping around them.
 *
 * Copying a channel binding would give the new campaign the old client's keys,
 * and the first time somebody published it the new campaign would start
 * speaking into that client's OA. A message that has reached LINE cannot be
 * recalled, so the mistake is not one an apology fixes.
 *
 * Copying player data would be quieter and worse. Two campaigns would each
 * claim the same participants, the same counters and the same issued
 * entitlements, and neither one's numbers would describe anything that
 * happened. A report nobody can trust is harder to notice than a report that is
 * obviously missing.
 *
 * Neither is a setting. There is no argument to this function that turns either
 * of them on, and the screen draws them as refusals rather than as unticked
 * boxes, because a box that can be ticked is a box somebody will tick.
 */

/** id เดิม → id ใหม่ · แต่ละตารางที่ถูกอ้างถึงต้องมีแผนที่ของตัวเอง */
type Ids = Map<string, string>

type Ctx = {
  /** ต้องเป็น sql ของธุรกรรม ไม่ใช่ pool · ครึ่งทางที่ค้างไว้คือแคมเปญที่ไม่มีใครซ่อมได้ */
  sql: postgres.Sql
  sourceId: string
  targetId: string
  actorId: string
  assets: Ids
  cards: Ids
  selectors: Ids
  activities: Ids
  counters: Ids
  rewards: Ids
}

type CopyStep = { table: string; run: (ctx: Ctx) => Promise<number> }

/** แผนที่ที่ยอมให้ค่าว่างผ่านไปได้ · คอลัมน์ที่ชี้ไปไหนก็ได้ส่วนใหญ่เป็น NULL ได้ */
const mapped = (ids: Ids, id: string | null): string | null =>
  id === null ? null : ids.get(id) ?? null

/**
 * ที่อยู่ของไฟล์ในแคมเปญใหม่
 *
 * `storage_path` is UNIQUE across the whole table, so the copied row cannot keep
 * the path the original has. The campaign segment is the one that changes;
 * the per-upload segment underneath it stays, which keeps the uploaded filename
 * visible in the library exactly as it was.
 *
 * `public_url` is deliberately *not* rewritten by the caller: the bytes on disk
 * are not duplicated, both rows point at the one file, and the screen says so.
 * Two rows sharing an image is safe here because nothing in this system
 * overwrites a stored file — BR-25 makes replacing an image write a new row at a
 * new path rather than change an existing one.
 */
export function rekeyStoragePath(path: string, targetCampaignId: string): string {
  const parts = path.split('/')
  if (parts.length >= 4 && parts[0] === PUBLIC_PREFIX) {
    parts[1] = targetCampaignId
    return parts.join('/')
  }
  // ที่อยู่ที่ไม่ได้มาจาก storagePathFor() · เติมหัวให้ไม่ชนของเดิมไว้ก่อน
  return `${PUBLIC_PREFIX}/${targetCampaignId}/${path}`
}

/**
 * ลำดับมีความหมาย · ตารางที่ถูกชี้ถึงต้องถูกก๊อปก่อนตารางที่ชี้ไปหามัน
 *
 * TABLES_TO_COPY is derived from this array rather than written beside it, so
 * the list on the screen and the work actually done cannot drift apart. Deleting
 * a step deletes the table from the list, which is what the tests read.
 */
const COPY_STEPS: readonly CopyStep[] = [
  {
    table: 'asset',
    async run({ sql, sourceId, targetId, actorId, assets }) {
      const rows = await sql<{
        id: string; storage_path: string; public_url: string; media_type: string
        mime_type: string; imagemap_base_url: string | null; duration_sec: number | null
        bytes: number; width: number; height: number; replaces_asset_id: string | null
      }[]>`
        SELECT id, storage_path, public_url, media_type, mime_type, imagemap_base_url,
               duration_sec, bytes, width, height, replaces_asset_id
          FROM asset WHERE campaign_id = ${sourceId} ORDER BY created_at, id`

      for (const row of rows) {
        // used_in ไม่ตามมา · มันเก็บ id ของการ์ดในแคมเปญเดิม ซึ่งในแคมเปญใหม่
        // ชี้ไปหาของที่ไม่มีอยู่ · คลังภาพคำนวณใหม่จากการ์ดจริงอยู่แล้ว
        const [made] = await sql<{ id: string }[]>`
          INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type,
                             imagemap_base_url, duration_sec, bytes, width, height,
                             used_in, uploaded_by)
          VALUES (${targetId}, ${rekeyStoragePath(row.storage_path, targetId)},
                  ${row.public_url}, ${row.media_type}, ${row.mime_type},
                  ${row.imagemap_base_url}, ${row.duration_sec}, ${row.bytes},
                  ${row.width}, ${row.height}, '[]'::jsonb, ${actorId})
          RETURNING id`
        assets.set(row.id, made.id)
      }

      // ชี้กันเองภายในคลัง · ต่อทีหลังเพราะตอนแทรกยังไม่รู้ id ปลายทาง
      for (const row of rows) {
        const target = mapped(assets, row.replaces_asset_id)
        if (!target) continue
        await sql`UPDATE asset SET replaces_asset_id = ${target}
                   WHERE id = ${assets.get(row.id) ?? null}`
      }

      return rows.length
    },
  },

  {
    table: 'card',
    async run({ sql, sourceId, targetId, assets, cards }) {
      const rows = await sql<{
        id: string; code: string; render_as: string; parent_card_id: string | null
        sort_in_parent: number | null; tap_areas: unknown; video_asset_id: string | null
        video_end_uri: string | null; video_end_label: string | null
        template_code: string | null; has_sample_text: boolean
      }[]>`
        SELECT id, code, render_as, parent_card_id, sort_in_parent, tap_areas,
               video_asset_id, video_end_uri, video_end_label, template_code, has_sample_text
          FROM card WHERE campaign_id = ${sourceId} ORDER BY id`

      for (const row of rows) {
        const [made] = await sql<{ id: string }[]>`
          INSERT INTO card (campaign_id, code, render_as, sort_in_parent, tap_areas,
                            video_asset_id, video_end_uri, video_end_label,
                            template_code, has_sample_text)
          VALUES (${targetId}, ${row.code}, ${row.render_as}, ${row.sort_in_parent},
                  ${row.tap_areas as never}, ${mapped(assets, row.video_asset_id)},
                  ${row.video_end_uri}, ${row.video_end_label},
                  ${row.template_code}, ${row.has_sample_text})
          RETURNING id`
        cards.set(row.id, made.id)
      }

      // การ์ดในแคโรเซลชี้หาการ์ดแม่ที่อยู่ในชุดเดียวกัน · ต่อหลังแทรกครบ
      for (const row of rows) {
        const parent = mapped(cards, row.parent_card_id)
        if (!parent) continue
        await sql`UPDATE card SET parent_card_id = ${parent}
                   WHERE id = ${cards.get(row.id) ?? null}`
      }

      return rows.length
    },
  },

  {
    table: 'card_selector',
    async run({ sql, sourceId, targetId, selectors }) {
      const rows = await sql<{
        id: string; name: string; returns: string; source_type: string
        source_key: string | null; fallback_value: string
      }[]>`
        SELECT id, name, returns, source_type, source_key, fallback_value
          FROM card_selector WHERE campaign_id = ${sourceId} ORDER BY id`

      for (const row of rows) {
        const [made] = await sql<{ id: string }[]>`
          INSERT INTO card_selector (campaign_id, name, returns, source_type,
                                     source_key, fallback_value)
          VALUES (${targetId}, ${row.name}, ${row.returns}, ${row.source_type},
                  ${row.source_key}, ${row.fallback_value})
          RETURNING id`
        selectors.set(row.id, made.id)
      }
      return rows.length
    },
  },

  {
    table: 'card_selector_option',
    async run({ sql, selectors }) {
      let copied = 0
      for (const [oldId, newId] of selectors) {
        const rows = await sql<{
          match_value: string | null; range_min: number | null; range_max: number | null
          result_value: string; sort_order: number
        }[]>`
          SELECT match_value, range_min, range_max, result_value, sort_order
            FROM card_selector_option WHERE selector_id = ${oldId} ORDER BY sort_order, id`

        for (const row of rows) {
          await sql`
            INSERT INTO card_selector_option (selector_id, match_value, range_min,
                                              range_max, result_value, sort_order)
            VALUES (${newId}, ${row.match_value}, ${row.range_min}, ${row.range_max},
                    ${row.result_value}, ${row.sort_order})`
          copied += 1
        }
      }
      return copied
    },
  },

  {
    table: 'card_block',
    async run({ sql, cards, selectors }) {
      let copied = 0
      for (const [oldId, newId] of cards) {
        const rows = await sql<{
          block_type: string; sort_order: number; content: string | null
          selector_id: string | null; show_when: unknown; options: unknown
        }[]>`
          SELECT block_type, sort_order, content, selector_id, show_when, options
            FROM card_block WHERE card_id = ${oldId} ORDER BY sort_order, id`

        for (const row of rows) {
          await sql`
            INSERT INTO card_block (card_id, block_type, sort_order, content,
                                    selector_id, show_when, options)
            VALUES (${newId}, ${row.block_type}, ${row.sort_order}, ${row.content},
                    ${mapped(selectors, row.selector_id)},
                    ${row.show_when as never}, ${row.options as never})`
          copied += 1
        }
      }
      return copied
    },
  },

  {
    table: 'activity',
    async run({ sql, sourceId, targetId, cards, activities }) {
      const rows = await sql<{
        id: string; code: string; name: string; input_type: string; resolve_method: string
        input_config: unknown; resolve_config: unknown; entry_rules: unknown; effects: unknown
        fallback_card_id: string | null; trigger: string; is_enabled: boolean; sort_order: number
      }[]>`
        SELECT id, code, name, input_type, resolve_method, input_config, resolve_config,
               entry_rules, effects, fallback_card_id, trigger, is_enabled, sort_order
          FROM activity WHERE campaign_id = ${sourceId} ORDER BY sort_order, id`

      for (const row of rows) {
        const [made] = await sql<{ id: string }[]>`
          INSERT INTO activity (campaign_id, code, name, input_type, resolve_method,
                                input_config, resolve_config, entry_rules, effects,
                                fallback_card_id, trigger, is_enabled, sort_order)
          VALUES (${targetId}, ${row.code}, ${row.name}, ${row.input_type},
                  ${row.resolve_method}, ${row.input_config as never},
                  ${row.resolve_config as never}, ${row.entry_rules as never},
                  ${row.effects as never}, ${mapped(cards, row.fallback_card_id)},
                  ${row.trigger}, ${row.is_enabled}, ${row.sort_order})
          RETURNING id`
        activities.set(row.id, made.id)
      }
      return rows.length
    },
  },

  {
    table: 'counter',
    async run({ sql, sourceId, targetId, counters }) {
      const rows = await sql<{
        id: string; code: string; name: string; mode: string
        require_consecutive: boolean; target: number
      }[]>`
        SELECT id, code, name, mode, require_consecutive, target
          FROM counter WHERE campaign_id = ${sourceId} ORDER BY id`

      for (const row of rows) {
        const [made] = await sql<{ id: string }[]>`
          INSERT INTO counter (campaign_id, code, name, mode, require_consecutive, target)
          VALUES (${targetId}, ${row.code}, ${row.name}, ${row.mode},
                  ${row.require_consecutive}, ${row.target})
          RETURNING id`
        counters.set(row.id, made.id)
      }
      return rows.length
    },
  },

  {
    table: 'counter_milestone',
    async run({ sql, counters }) {
      let copied = 0
      for (const [oldId, newId] of counters) {
        const rows = await sql<{ at_value: number; effects: unknown }[]>`
          SELECT at_value, effects FROM counter_milestone
           WHERE counter_id = ${oldId} ORDER BY at_value`

        for (const row of rows) {
          await sql`INSERT INTO counter_milestone (counter_id, at_value, effects)
                    VALUES (${newId}, ${row.at_value}, ${row.effects as never})`
          copied += 1
        }
      }
      return copied
    },
  },

  {
    table: 'reward',
    async run({ sql, sourceId, targetId, rewards }) {
      const rows = await sql<{
        id: string; code: string; reward_type: string; value: string | null
        quota: number | null; valid_days: number | null; use_limit: number | null
      }[]>`
        SELECT id, code, reward_type, value, quota, valid_days, use_limit
          FROM reward WHERE campaign_id = ${sourceId} ORDER BY code`

      for (const row of rows) {
        // issued_count ไม่อยู่ในคอลัมน์ที่แทรก · แถวใหม่เริ่มที่ศูนย์ตาม DEFAULT
        // ก๊อปมาด้วยแปลว่าโควตาของแคมเปญใหม่ถูกใช้ไปแล้วโดยคนที่ไม่ได้เล่นมัน
        const [made] = await sql<{ id: string }[]>`
          INSERT INTO reward (campaign_id, code, reward_type, value, quota,
                              valid_days, use_limit)
          VALUES (${targetId}, ${row.code}, ${row.reward_type}, ${row.value},
                  ${row.quota}, ${row.valid_days}, ${row.use_limit})
          RETURNING id`
        rewards.set(row.id, made.id)
      }
      return rows.length
    },
  },

  {
    table: 'coupon',
    async run({ sql, rewards }) {
      let copied = 0
      for (const [oldId, newId] of rewards) {
        const rows = await sql<{
          discount_kind: string; value_min: number; value_max: number; value_step: number
          terms: string | null; needs_shop_confirm: boolean
        }[]>`
          SELECT discount_kind, value_min, value_max, value_step, terms, needs_shop_confirm
            FROM coupon WHERE reward_id = ${oldId}`

        for (const row of rows) {
          await sql`
            INSERT INTO coupon (reward_id, discount_kind, value_min, value_max,
                                value_step, terms, needs_shop_confirm)
            VALUES (${newId}, ${row.discount_kind}, ${row.value_min}, ${row.value_max},
                    ${row.value_step}, ${row.terms}, ${row.needs_shop_confirm})`
          copied += 1
        }
      }
      return copied
    },
  },

  {
    table: 'stamp_card',
    async run({ sql, sourceId, targetId, assets, cards, counters }) {
      const rows = await sql<{
        counter_id: string; slots: number; empty_asset_id: string
        filled_asset_id: string; card_id: string
      }[]>`
        SELECT counter_id, slots, empty_asset_id, filled_asset_id, card_id
          FROM stamp_card WHERE campaign_id = ${sourceId} ORDER BY id`

      let copied = 0
      for (const row of rows) {
        const counterId = mapped(counters, row.counter_id)
        const emptyId = mapped(assets, row.empty_asset_id)
        const filledId = mapped(assets, row.filled_asset_id)
        const cardId = mapped(cards, row.card_id)
        // ทุกช่องเป็น NOT NULL · ขาดตัวใดตัวหนึ่งแปลว่าของที่มันชี้ไปอยู่นอกแคมเปญนี้
        if (!counterId || !emptyId || !filledId || !cardId) continue

        await sql`
          INSERT INTO stamp_card (campaign_id, counter_id, slots, empty_asset_id,
                                  filled_asset_id, card_id)
          VALUES (${targetId}, ${counterId}, ${row.slots}, ${emptyId},
                  ${filledId}, ${cardId})`
        copied += 1
      }
      return copied
    },
  },

  {
    table: 'keyword_rule',
    async run({ sql, sourceId, targetId, activities, cards }) {
      const rows = await sql<{
        keyword: string; match_mode: string; target_activity_id: string | null
        target_card_id: string | null; sort_order: number
      }[]>`
        SELECT keyword, match_mode, target_activity_id, target_card_id, sort_order
          FROM keyword_rule WHERE campaign_id = ${sourceId} ORDER BY sort_order, keyword`

      let copied = 0
      for (const row of rows) {
        const activityId = mapped(activities, row.target_activity_id)
        const cardId = mapped(cards, row.target_card_id)
        // CHECK บังคับว่าต้องพาไปที่ใดที่หนึ่ง · คำที่ปลายทางหลุดไปคือคำที่ไม่ทำอะไร
        if (!activityId && !cardId) continue

        await sql`
          INSERT INTO keyword_rule (campaign_id, keyword, match_mode,
                                    target_activity_id, target_card_id, sort_order)
          VALUES (${targetId}, ${row.keyword}, ${row.match_mode},
                  ${activityId}, ${cardId}, ${row.sort_order})`
        copied += 1
      }
      return copied
    },
  },

  {
    table: 'rich_menu',
    async run({ sql, sourceId, targetId, assets }) {
      const rows = await sql<{
        alias: string; image_asset_id: string; areas: unknown
        is_entry: boolean; chat_bar_text: string
      }[]>`
        SELECT alias, image_asset_id, areas, is_entry, chat_bar_text
          FROM rich_menu WHERE campaign_id = ${sourceId} ORDER BY alias`

      let copied = 0
      for (const row of rows) {
        const imageId = mapped(assets, row.image_asset_id)
        if (!imageId) continue

        // line_rich_menu_id ไม่ตามมา · มันคือ id ของเมนูที่ลงทะเบียนไว้กับ OA เดิม
        // ก๊อปมาแล้วแคมเปญใหม่จะสั่งแก้เมนูบนบัญชีของลูกค้ารายเดิม — BR-24 ข้อเดียวกัน
        await sql`
          INSERT INTO rich_menu (campaign_id, alias, image_asset_id, areas,
                                 is_entry, chat_bar_text)
          VALUES (${targetId}, ${row.alias}, ${imageId}, ${row.areas as never},
                  ${row.is_entry}, ${row.chat_bar_text})`
        copied += 1
      }
      return copied
    },
  },
]

/**
 * ตารางที่ตามไปกับแคมเปญใหม่ · อ่านจากงานที่ทำจริง ไม่ใช่รายการที่เขียนไว้ข้างๆ
 */
export const TABLES_TO_COPY: readonly string[] = COPY_STEPS.map((step) => step.table)

/**
 * ตารางที่ไม่ตามไปเด็ดขาด · เขียนไว้เป็นรายการเพราะมันคือกฎ ไม่ใช่ผลข้างเคียง
 *
 * Two kinds of thing are on this list and they are refused for two different
 * reasons.
 *
 * `channel` and `campaign_channel` are the credentials and the binding that uses
 * them. A copied binding makes the new campaign live on the old client's OA the
 * moment somebody publishes it.
 *
 * Everything after them is a record of something a real person did. Copying it
 * would attribute one person's play, one person's counter and one person's prize
 * to two campaigns at once, and no report drawn afterwards would be true of
 * either.
 *
 * `reward_code` is the one that reads like config and is not. The rows carry
 * real coupon codes that exist outside this system, and 0003_reward_code_scope
 * narrowed the uniqueness on `assigned_to` from the whole table to one reward —
 * which is correct for play, and removes the only thing that would have made the
 * database notice the same physical code being handed to a person in campaign A
 * and a different person in campaign B. Nothing would object; two customers would
 * simply turn up holding the same coupon.
 *
 * `config_version` is refused because it is the publish history. A copy would
 * claim the new campaign had been published by people who never saw it, and
 * `published_by` is exactly what the version screen reads.
 */
export const TABLES_NEVER_COPIED: readonly string[] = [
  // กุญแจและการผูกบัญชี
  'channel',
  'campaign_channel',
  'campaign_channel_counter_target',
  // ข้อมูลผู้เล่นทุกชนิด
  'participant',
  'participant_attribute',
  'participant_activity',
  'counter_value',
  'entitlement',
  'reward_code',
  'play_lock',
  'quiz_round',
  'pending_input',
  // ประวัติและบันทึก
  'config_version',
  'event_log',
  'effect_log',
  'token_access_log',
  'campaign_stat',
  'export_log',
  'api_key',
]

export type DuplicateInput = {
  sourceId: string
  name: string
  code: string
  startAt: string
  endAt: string
  actorId: string
}

export type DuplicateResult = { id: string; counts: Record<string, number> }

/** รหัสสั้นที่แนบไปกับ postback ทุกปุ่ม (BR-33) — ตรงกับ CHECK ของคอลัมน์ */
const CODE_PATTERN = /^[a-z0-9_]{1,20}$/

/**
 * ตรวจก่อนแตะฐานข้อมูล · คืนประโยคที่คนกรอกฟอร์มเอาไปแก้ได้ หรือ null ถ้าผ่าน
 *
 * The table's CHECK constraints guarantee these; this is what turns a violation
 * into something readable. Dates are not carried over from the source at all —
 * a new campaign is a different stretch of time by definition, and a copied
 * start date is a copied mistake that only shows up on the day it matters.
 */
export function validateDuplicate(
  input: Pick<DuplicateInput, 'sourceId' | 'name' | 'code' | 'startAt' | 'endAt'>,
): string | null {
  if (!input.sourceId) return 'เลือกแคมเปญต้นทางก่อน'
  if (!input.name.trim()) return 'ต้องกรอกชื่อแคมเปญใหม่'
  if (!CODE_PATTERN.test(input.code)) return 'รหัสต้องเป็น a-z 0-9 _ ยาว 1–20 ตัว'
  if (!input.startAt || !input.endAt) return 'ต้องกรอกวันเริ่มและวันสิ้นสุดทั้งคู่ (BR-29)'
  if (Date.parse(input.endAt) <= Date.parse(input.startAt)) {
    return 'วันสิ้นสุดต้องมากกว่าวันเริ่ม'
  }
  return null
}

/**
 * ก๊อปแคมเปญหนึ่งตัว ในธุรกรรมเดียว
 *
 * One transaction because a half-copied campaign is worse than no copy: the
 * screen would show something that looks finished, and finding out which of
 * thirteen tables stopped partway is not work anybody can do from the UI.
 *
 * The new campaign is always a draft, is never bound to a channel, and never
 * inherits a scheduled publish. Those three together are what make "copied"
 * mean "nothing has happened yet".
 */
export async function duplicateCampaign(
  sql: postgres.Sql, input: DuplicateInput,
): Promise<DuplicateResult> {
  const invalid = validateDuplicate(input)
  if (invalid) throw new Error(invalid)

  return sql.begin(async (tx) => {
    // `code` เป็น UNIQUE ทั้งตาราง · ปล่อยให้ฐานข้อมูลเป็นคนพูด แล้วคนกดจะเจอ
    // "duplicate key value violates unique constraint" ซึ่งไม่ได้บอกว่าต้องแก้ช่องไหน
    const [taken] = await tx<{ id: string }[]>`
      SELECT id FROM campaign WHERE code = ${input.code}`
    if (taken) throw new Error(`รหัส "${input.code}" มีแคมเปญอื่นใช้อยู่แล้ว — ตั้งรหัสใหม่ที่ยังไม่มีใครใช้`)

    const [source] = await tx<{ timezone: string; day_length_sec: number; theme: unknown }[]>`
      SELECT timezone, day_length_sec, theme FROM campaign WHERE id = ${input.sourceId}`
    if (!source) throw new Error('ไม่พบแคมเปญต้นทาง')

    const [made] = await tx<{ id: string }[]>`
      INSERT INTO campaign (name, code, timezone, day_length_sec, start_at, end_at,
                            status, theme, created_by)
      VALUES (${input.name.trim()}, ${input.code}, ${source.timezone},
              ${source.day_length_sec}, ${input.startAt}, ${input.endAt},
              'draft', ${source.theme as never}, ${input.actorId})
      RETURNING id`

    const ctx: Ctx = {
      sql: tx as unknown as postgres.Sql,
      sourceId: input.sourceId,
      targetId: made.id,
      actorId: input.actorId,
      assets: new Map(),
      cards: new Map(),
      selectors: new Map(),
      activities: new Map(),
      counters: new Map(),
      rewards: new Map(),
    }

    const counts: Record<string, number> = {}
    for (const step of COPY_STEPS) {
      counts[step.table] = await step.run(ctx)
    }

    return { id: made.id, counts }
  }) as Promise<DuplicateResult>
}

/**
 * นับของที่จะถูกก๊อป ก่อนกด · ตัวเลขบนจอต้องมาจากแถวจริง ไม่ใช่จากคำสัญญา
 */
export async function countCopyable(
  sql: postgres.Sql, campaignId: string,
): Promise<Record<string, number>> {
  const [row] = await sql<{
    activity: number; card: number; asset: number
    counter: number; reward: number; rich_menu: number
  }[]>`
    SELECT (SELECT count(*) FROM activity  WHERE campaign_id = ${campaignId})::int AS activity,
           (SELECT count(*) FROM card      WHERE campaign_id = ${campaignId})::int AS card,
           (SELECT count(*) FROM asset     WHERE campaign_id = ${campaignId})::int AS asset,
           (SELECT count(*) FROM counter   WHERE campaign_id = ${campaignId})::int AS counter,
           (SELECT count(*) FROM reward    WHERE campaign_id = ${campaignId})::int AS reward,
           (SELECT count(*) FROM rich_menu WHERE campaign_id = ${campaignId})::int AS rich_menu`
  return { ...row }
}

/**
 * สิ่งที่ตามไป อย่างที่คนอ่านจอเข้าใจ
 *
 * The wording for assets is not the prototype's. The mock promises the image
 * files themselves are copied on storage; this slice copies the row and leaves
 * both campaigns pointing at the one file, which is safe here only because
 * nothing in this system ever overwrites a stored file (BR-25). Saying "copied"
 * would be the screen describing work that did not happen.
 */
export const COPIED_LABELS: readonly string[] = [
  'กิจกรรมและการตั้งค่าทั้งหมด',
  'การ์ดและข้อความ',
  'ภาพในคลัง (ใช้ไฟล์เดิมร่วมกัน ไม่ได้คัดลอกไฟล์บน storage)',
  'นิยามค่าสะสมและรางวัล (จำนวนที่แจกไปแล้วเริ่มที่ 0)',
  'คีย์เวิร์ดและ Rich Menu',
]

/**
 * สิ่งที่ไม่ตามไป พร้อมเหตุผลของแต่ละข้อ
 *
 * The reason is what makes each line a refusal rather than an option somebody
 * left switched off. A list of five things that are "not copied" invites the
 * question of where the setting is; a list of five things that are not copied
 * *because* reads as a decision already taken, which is what it is.
 */
export const REFUSED_LABELS: ReadonlyArray<{ what: string; why: string }> = [
  {
    what: 'บัญชี LINE และกุญแจทั้งหมด',
    why: 'ก๊อปตามไปแล้วแคมเปญใหม่จะยิงเข้า OA ของลูกค้ารายเดิมทันทีที่ส่งขึ้น',
  },
  {
    what: 'ผู้ร่วมสนุก',
    why: 'คนคนเดียวจะกลายเป็นผู้เล่นของสองแคมเปญพร้อมกัน ตัวเลขของทั้งคู่จึงไม่ใช่ของใครเลย',
  },
  {
    what: 'ค่าสะสมของผู้เล่น',
    why: 'ยอดสะสมเป็นของคนที่เล่นจริง แคมเปญใหม่ยังไม่มีใครเล่น ยอดที่ก๊อปมาจึงเป็นของที่ไม่เคยเกิด',
  },
  {
    what: 'สิทธิ์รางวัลที่จ่ายไปแล้ว',
    why: 'สิทธิ์ผูกกับรุ่นที่ส่งขึ้นจริง แคมเปญใหม่ยังไม่เคยส่งขึ้น จึงไม่มีรุ่นให้ผูก',
  },
  {
    what: 'รหัสคูปองในคลัง',
    why: 'เป็นรหัสที่ใช้ได้จริงนอกระบบ ก๊อปไปแล้วลูกค้าสองคนจะถือรหัสเดียวกัน และตารางไม่ห้าม',
  },
  {
    what: 'ประวัติ version และสถิติ',
    why: 'แคมเปญใหม่ยังไม่เคยถูกส่งขึ้น ประวัติที่ก๊อปมาจะเป็นชื่อคนที่ไม่เคยเห็นมัน และบันทึกทั้งหมดก็ไม่ตามไปด้วยเหตุผลเดียวกัน',
  },
]

/**
 * ประโยคที่จอเอาไปบอกว่าก๊อปอะไรมาบ้าง · เรียงตามที่คนมองหา
 */
export function describeCounts(counts: Record<string, number>): string {
  return [
    `กิจกรรม ${counts.activity ?? 0}`,
    `การ์ด ${counts.card ?? 0}`,
    `ภาพ ${counts.asset ?? 0}`,
    `ค่าสะสม ${counts.counter ?? 0}`,
    `รางวัล ${counts.reward ?? 0}`,
    `Rich Menu ${counts.rich_menu ?? 0}`,
  ].join(' · ')
}
