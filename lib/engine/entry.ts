import { evaluate, type Condition, type PlayerState } from '../state'

export type EntryRule = { type: string; cardId: string; [key: string]: unknown }

export type EntryContext = {
  state: PlayerState
  now: Date
  /** how many times this player already played this activity this period */
  playsThisPeriod: number
  campaignStart: Date
  campaignEnd: Date
}

export type EntryResult = { allowed: true } | { allowed: false; cardId: string }

const CONDITION_TYPES = [
  'has_attribute', 'not_has_attribute', 'has_entitlement',
  'activity_completed', 'activity_not_completed', 'activity_play_count',
]

function hourIn(tz: string, at: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(at),
  )
}

function passes(rule: EntryRule, ctx: EntryContext): boolean {
  if (rule.type === 'limit') {
    return ctx.playsThisPeriod < Number(rule.count ?? 1)
  }

  if (rule.type === 'time_window') {
    if (ctx.now < ctx.campaignStart || ctx.now > ctx.campaignEnd) return false
    const hours = rule.hoursOfDay as number[] | undefined
    if (!hours || hours.length === 0) return true
    return hours.includes(hourIn(String(rule.timezone ?? 'UTC'), ctx.now))
  }

  if (CONDITION_TYPES.includes(rule.type)) {
    return evaluate(rule as unknown as Condition, ctx.state)
  }

  // An unknown rule type means config and code disagree. Refusing entry is the
  // safe half of that disagreement: the player sees a card explaining why,
  // instead of quietly receiving a reward the rule was written to block.
  return false
}

/**
 * Walk the rules in order and stop at the first that fails.
 *
 * Order matters because each rule carries its own card: the player is told the
 * first reason they cannot play, which is the one they can act on. Reporting
 * the last failure would explain a rule they never reached.
 */
export function checkEntry(rules: EntryRule[], ctx: EntryContext): EntryResult {
  for (const rule of rules) {
    if (!passes(rule, ctx)) return { allowed: false, cardId: rule.cardId }
  }
  return { allowed: true }
}
