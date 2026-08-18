/**
 * Everything the engine and the renderer are allowed to know about a player.
 *
 * Deliberately one object rather than several: the same snapshot feeds entry
 * rules, block visibility, and template variables, and the preview's state
 * switcher moves this and nothing else. Split it and the preview starts lying
 * about what a player would actually see.
 */
export type PlayerState = {
  attributes: Record<string, string>
  counters: Record<string, number>
  /** reward codes this player already holds */
  entitlements: string[]
  /** activity code → how many times played, all days combined */
  playCounts: Record<string, number>
  /** activity codes the player has finished */
  completed: string[]
  /** outcome id decided this round, when there is one */
  lastResult?: string
}

export type Condition =
  | { type: 'has_attribute'; key: string; value?: string }
  | { type: 'not_has_attribute'; key: string }
  | { type: 'has_entitlement'; rewardCode: string }
  | { type: 'activity_completed'; activityCode: string }
  | { type: 'activity_not_completed'; activityCode: string }
  | { type: 'activity_play_count'; activityCode: string; op: 'lt' | 'gte'; count: number }

export function evaluate(condition: Condition, state: PlayerState): boolean {
  switch (condition.type) {
    case 'has_attribute': {
      const held = state.attributes[condition.key]
      if (held === undefined) return false
      return condition.value === undefined || held === condition.value
    }
    case 'not_has_attribute':
      return state.attributes[condition.key] === undefined

    case 'has_entitlement':
      return state.entitlements.includes(condition.rewardCode)

    case 'activity_completed':
      return state.completed.includes(condition.activityCode)

    case 'activity_not_completed':
      return !state.completed.includes(condition.activityCode)

    case 'activity_play_count': {
      // Never played counts as zero, not as missing — otherwise "played fewer
      // than once" would be false for someone who has never played at all.
      const played = state.playCounts[condition.activityCode] ?? 0
      return condition.op === 'lt' ? played < condition.count : played >= condition.count
    }
  }
}

export function evaluateAll(
  conditions: Condition[] | null | undefined,
  state: PlayerState,
): boolean {
  if (!conditions || conditions.length === 0) return true
  return conditions.every((c) => evaluate(c, state))
}
