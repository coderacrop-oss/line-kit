import type { Queryable } from './client'
import type { Effect } from '../engine/effects'
import type { Outcome } from '../engine/resolve'

/** One ranked candidate, with the writes that outcome implies. */
export type RankedCandidate = {
  id: string
  card_id: string
  effects: Array<Record<string, unknown>>
}

export type PlayResult =
  | { replayed: true; result: { outcome_id: string; card_id: string; granted: unknown[] } }
  | { replayed: false; result: { outcome_id: string; card_id: string; granted: unknown[] } }
  | { replayed: false; exhausted: true }

/**
 * Effects travel to SQL in snake_case because that is what the function reads.
 * Converting here keeps the engine free of storage concerns.
 */
export function toSqlEffect(effect: Effect): Record<string, unknown> {
  switch (effect.type) {
    case 'set_attribute':
      return { type: 'set_attribute', key: effect.key, value: effect.value }
    case 'add_units':
      return { type: 'add_units', counter_code: effect.counterCode, amount: effect.amount }
    case 'grant_reward':
      return { type: 'grant_reward', reward_code: effect.rewardCode }
  }
}

/**
 * Build the ranked list the database walks.
 *
 * Every candidate carries its own effect list, so the database never has to
 * recompute what a lower-ranked outcome would grant — it just applies whichever
 * one it managed to take.
 */
export function buildRanked(
  ranked: Outcome[],
  effectsFor: (outcome: Outcome) => Effect[],
): RankedCandidate[] {
  return ranked.map((o) => ({
    id: o.id,
    card_id: o.cardId,
    effects: effectsFor(o).map(toSqlEffect),
  }))
}

export async function playAndApply(
  sql: Queryable,
  args: {
    participantId: string
    activityId: string
    campaignId: string
    periodKey: string
    playToken: string
    configVersionId: string
    ranked: RankedCandidate[]
    completesActivity?: boolean
  },
): Promise<PlayResult> {
  const rows = await sql<{ play_and_apply: PlayResult }[]>`
    SELECT play_and_apply(
      ${args.participantId}::uuid,
      ${args.activityId}::uuid,
      ${args.campaignId}::uuid,
      ${args.periodKey},
      ${args.playToken},
      ${args.configVersionId}::uuid,
      ${sql.json(args.ranked as never)},
      ${args.completesActivity ?? false}
    )`
  return rows[0].play_and_apply
}
