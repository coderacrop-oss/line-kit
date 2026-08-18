import { checkEntry, type EntryContext, type EntryRule } from './entry'
import { planEffects, type Effect, type EffectSpec } from './effects'
import { resolve, type Outcome, type ResolveInput, type ResolveMethod } from './resolve'

export type DecideInput = {
  entryRules: EntryRule[]
  resolveMethod: ResolveMethod
  outcomes: Outcome[]
  effectSpec: EffectSpec[]
  input: ResolveInput
  ctx: EntryContext
  rng: () => number
  /** answer when nothing can be resolved at all */
  fallbackCardId?: string
}

export type Decision =
  | { kind: 'blocked'; cardId: string }
  | { kind: 'played'; ranked: Outcome[]; effects: Effect[] }

/** Last resort when config gives us nothing to say. */
const NO_CARD = ''

/**
 * The whole decision, with no I/O anywhere in it.
 *
 * Effects are planned against the top-ranked outcome. The database may end up
 * taking a lower-ranked one when stock has run out and recomputes the reward
 * from whichever it took — this list is the intent, not the record.
 */
export function decide(input: DecideInput): Decision {
  const entry = checkEntry(input.entryRules, input.ctx)
  if (!entry.allowed) return { kind: 'blocked', cardId: entry.cardId }

  const ranked = resolve(input.resolveMethod, input.outcomes, input.input, input.rng)
  if (ranked.length === 0) {
    return { kind: 'blocked', cardId: input.fallbackCardId ?? NO_CARD }
  }

  return { kind: 'played', ranked, effects: planEffects(input.effectSpec, ranked[0]) }
}
