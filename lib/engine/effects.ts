import type { Outcome } from './resolve'

export type EffectSpec =
  | { type: 'set_attribute'; key: string; value: string }
  | { type: 'add_units'; counterCode: string; amount: number }
  | { type: 'grant_reward'; rewardCode?: string }

export type Effect =
  | { type: 'set_attribute'; key: string; value: string }
  | { type: 'add_units'; counterCode: string; amount: number }
  | { type: 'grant_reward'; rewardCode: string }

/**
 * Turn what the activity says it does into a concrete list of writes.
 *
 * Nothing here touches storage — the list is data, and the transaction that
 * applies it decides whether it can. A grant naming no reward inherits the one
 * attached to the outcome that came up; if that outcome carries none, the grant
 * is dropped rather than issuing an entitlement to nothing, which would be a
 * row nobody could ever redeem.
 */
export function planEffects(spec: EffectSpec[], outcome: Outcome): Effect[] {
  const out: Effect[] = []

  for (const item of spec) {
    if (item.type === 'grant_reward') {
      const rewardCode = item.rewardCode ?? outcome.rewardCode
      if (rewardCode) out.push({ type: 'grant_reward', rewardCode })
      continue
    }
    out.push(item)
  }

  return out
}
