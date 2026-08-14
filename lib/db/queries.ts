import type postgres from 'postgres'
import type { CardBlock } from '../render/groups'
import type { RenderableCard } from '../render/card'
import type { PlayerState } from '../state'
import type { LiveCampaign, PlayOutcome, Ports } from '../webhook/ports'
import { buildRanked, playAndApply } from './apply'
import { planEffects } from '../engine/effects'

/**
 * Published config never changes (BR-05), so it is cached by config version id
 * and never invalidated. A new publish is a new version, which is a new key —
 * there is no stale entry to evict, and therefore no eviction to get wrong.
 */
const configCache = new Map<string, LiveCampaign>()

export function clearConfigCache(): void {
  configCache.clear()
}

type CampaignRow = {
  campaign_id: string
  code: string
  timezone: string
  day_length_sec: number
  start_at: Date
  end_at: Date
  theme: { primary?: string; secondary?: string; text?: string }
  config_version_id: string
  default_card_id: string | null
  greeting_card_id: string | null
  greeting_enabled: boolean
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

const DEFAULT_THEME = { primary: '#17756A', secondary: '#EFF3F1', text: '#151F1D' }

async function loadCards(sql: postgres.Sql, campaignId: string) {
  const cards = await sql<{
    id: string; code: string; render_as: RenderableCard['renderAs']
    parent_card_id: string | null; sort_in_parent: number | null
  }[]>`
    SELECT id, code, render_as, parent_card_id, sort_in_parent
      FROM card WHERE campaign_id = ${campaignId}`

  const blocks = await sql<(CardBlock & { card_id: string })[]>`
    SELECT b.id, b.card_id, b.block_type AS "blockType", b.sort_order AS "sortOrder",
           b.content, b.show_when AS "showWhen", b.options
      FROM card_block b
      JOIN card c ON c.id = b.card_id
     WHERE c.campaign_id = ${campaignId}
     ORDER BY b.sort_order`

  const byCard = new Map<string, CardBlock[]>()
  for (const b of blocks) {
    const { card_id, ...block } = b
    if (!byCard.has(card_id)) byCard.set(card_id, [])
    byCard.get(card_id)!.push(block)
  }

  const cardsById: Record<string, RenderableCard> = {}
  for (const c of cards) {
    cardsById[c.id] = { code: c.code, renderAs: c.render_as, blocks: byCard.get(c.id) ?? [] }
  }

  // Carousel children hang off their parent in swipe order.
  for (const c of cards) {
    if (!c.parent_card_id) continue
    const parent = cardsById[c.parent_card_id]
    if (!parent) continue
    parent.children = [...(parent.children ?? []), cardsById[c.id]]
  }
  for (const card of Object.values(cardsById)) {
    if (card.children) {
      const order = new Map(cards.map((c) => [c.code, c.sort_in_parent ?? 0]))
      card.children.sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0))
    }
  }

  return cardsById
}

export function makePorts(sql: postgres.Sql, lineChannelIdOverride?: string): Ports {
  return {
    async findLiveCampaign(lineChannelId) {
      const target = lineChannelIdOverride ?? lineChannelId

      const [row] = await sql<CampaignRow[]>`
        SELECT ca.id AS campaign_id, ca.code, ca.timezone,
               COALESCE(cc.day_length_sec, ca.day_length_sec) AS day_length_sec,
               ca.start_at, ca.end_at, ca.theme,
               cv.id AS config_version_id,
               ch.default_card_id, ch.greeting_card_id, ch.greeting_enabled
          FROM channel ch
          JOIN campaign_channel cc ON cc.channel_id = ch.id AND cc.is_published
          JOIN campaign ca ON ca.id = cc.campaign_id
          JOIN config_version cv ON cv.campaign_id = ca.id AND cv.channel_id = ch.id
         WHERE ch.line_channel_id = ${target}
         ORDER BY cv.version_no DESC
         LIMIT 1`

      if (!row) return null

      const cached = configCache.get(row.config_version_id)
      if (cached) return cached

      const activities = await sql<{
        id: string; code: string; input_type: LiveCampaign['activities'][number]['inputType']
        resolve_method: LiveCampaign['activities'][number]['resolveMethod']
        resolve_config: { outcomes?: LiveCampaign['activities'][number]['outcomes'] }
        entry_rules: LiveCampaign['activities'][number]['entryRules']
        effects: LiveCampaign['activities'][number]['effectSpec']
        fallback_card_id: string | null; trigger: 'manual' | 'follow'
      }[]>`
        SELECT id, code, input_type, resolve_method, resolve_config,
               entry_rules, effects, fallback_card_id, trigger
          FROM activity
         WHERE campaign_id = ${row.campaign_id} AND is_enabled
         ORDER BY sort_order`

      const rules = await sql<{
        id: string; keyword: string; match_mode: 'exact' | 'contains'; sort_order: number
        target_activity_id: string | null; target_card_id: string | null
      }[]>`
        SELECT id, keyword, match_mode, sort_order, target_activity_id, target_card_id
          FROM keyword_rule WHERE campaign_id = ${row.campaign_id} ORDER BY sort_order`

      const keywordTargets: LiveCampaign['keywordTargets'] = {}
      for (const r of rules) {
        keywordTargets[r.id] = {
          activityId: r.target_activity_id ?? undefined,
          cardId: r.target_card_id ?? undefined,
        }
      }

      const live: LiveCampaign = {
        campaignId: row.campaign_id,
        code: row.code,
        timezone: row.timezone,
        dayLengthSec: row.day_length_sec,
        startAt: row.start_at,
        endAt: row.end_at,
        theme: { ...DEFAULT_THEME, ...row.theme },
        configVersionId: row.config_version_id,
        keywordRules: rules.map((r) => ({
          id: r.id, keyword: r.keyword, matchMode: r.match_mode, sortOrder: r.sort_order,
        })),
        keywordTargets,
        activities: activities.map((a) => ({
          id: a.id, code: a.code, inputType: a.input_type, resolveMethod: a.resolve_method,
          // JSONB columns are external input as far as this code is concerned.
          // A column holding a JSON string rather than an array used to make
          // every entry rule unrecognisable, which refused entry to everyone.
          outcomes: asArray(a.resolve_config?.outcomes),
          entryRules: asArray(a.entry_rules),
          effectSpec: asArray(a.effects),
          fallbackCardId: a.fallback_card_id,
          trigger: a.trigger,
        })),
        cardsById: await loadCards(sql, row.campaign_id),
        defaultCardId: row.default_card_id,
        greetingCardId: row.greeting_card_id,
        greetingEnabled: row.greeting_enabled,
      }

      configCache.set(row.config_version_id, live)
      return live
    },

    async ensureParticipant(lineChannelId, lineUid) {
      const target = lineChannelIdOverride ?? lineChannelId
      const [row] = await sql<{ id: string }[]>`
        WITH ch AS (SELECT id FROM channel WHERE line_channel_id = ${target})
        INSERT INTO participant (channel_id, line_uid)
        SELECT ch.id, ${lineUid} FROM ch
        ON CONFLICT (channel_id, line_uid)
          DO UPDATE SET last_seen_at = now()
        RETURNING id`
      return row.id
    },

    async loadPlayerState(participantId, campaignId) {
      const [attributes, counters, entitlements, activities] = await Promise.all([
        sql<{ key: string; value: string }[]>`
          SELECT key, value FROM participant_attribute
           WHERE participant_id = ${participantId} AND campaign_id = ${campaignId}`,
        sql<{ code: string; value: number }[]>`
          SELECT c.code, cv.value FROM counter_value cv
            JOIN counter c ON c.id = cv.counter_id
           WHERE cv.participant_id = ${participantId} AND c.campaign_id = ${campaignId}`,
        sql<{ code: string }[]>`
          SELECT r.code FROM entitlement e
            JOIN reward r ON r.id = e.reward_id
           WHERE e.participant_id = ${participantId} AND r.campaign_id = ${campaignId}`,
        sql<{ code: string; play_count: number; status: string }[]>`
          SELECT a.code, pa.play_count, pa.status FROM participant_activity pa
            JOIN activity a ON a.id = pa.activity_id
           WHERE pa.participant_id = ${participantId} AND a.campaign_id = ${campaignId}`,
      ])

      const state: PlayerState = {
        attributes: Object.fromEntries(attributes.map((a) => [a.key, a.value])),
        counters: Object.fromEntries(counters.map((c) => [c.code, c.value])),
        entitlements: entitlements.map((e) => e.code),
        playCounts: Object.fromEntries(activities.map((a) => [a.code, a.play_count])),
        completed: activities.filter((a) => a.status === 'completed').map((a) => a.code),
      }
      return state
    },

    async playsThisPeriod(participantId, activityId, periodKey) {
      const [row] = await sql<{ count: string }[]>`
        SELECT count(*) FROM play_lock
         WHERE participant_id = ${participantId}
           AND activity_id = ${activityId}
           AND period_key = ${periodKey}`
      return Number(row.count)
    },

    async play(args): Promise<PlayOutcome> {
      const out = await playAndApply(sql, {
        participantId: args.participantId,
        activityId: args.activity.id,
        campaignId: args.campaignId,
        periodKey: args.periodKey,
        playToken: `${args.participantId}:${args.activity.id}:${args.periodKey}`,
        configVersionId: args.configVersionId,
        // Each candidate carries its own writes, so the database never has to
        // recompute what a lower-ranked outcome would have granted.
        ranked: buildRanked(args.ranked, (o) => planEffects(args.activity.effectSpec, o)),
      })

      if ('exhausted' in out) return { kind: 'exhausted' }
      return {
        kind: out.replayed ? 'replayed' : 'played',
        outcomeId: out.result.outcome_id,
        cardId: out.result.card_id,
      }
    },

    async logEvent(args) {
      await sql`
        INSERT INTO event_log (
          participant_id, activity_id, config_version_id, event_type,
          postback_data, result, duration_ms)
        VALUES (
          ${args.participantId}, ${args.activityId}, ${args.configVersionId},
          ${args.eventType}, ${args.postbackData},
          ${args.result === null ? null : sql.json(args.result as never)},
          ${args.durationMs})`
    },
  }
}
