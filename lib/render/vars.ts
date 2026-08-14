import type { PlayerState } from '../state'

const PATTERN = /\{\{\s*(counter|attr)\.([a-z0-9_]+)\s*\}\}/gi

/**
 * Fill a card's text with values from the player's own state.
 *
 * Read-only by design: no arithmetic, no formatting, no fallbacks expressed in
 * the template. An untouched counter reads as 0 because that is what it is. An
 * unset attribute reads as empty — showing raw braces to a player would be
 * worse than showing nothing. An unrecognised prefix is left intact so a typo
 * stays visible to whoever is editing the card.
 */
export function substitute(text: string, state: PlayerState): string {
  return text.replace(PATTERN, (_match, kind: string, key: string) =>
    kind.toLowerCase() === 'counter'
      ? String(state.counters[key] ?? 0)
      : state.attributes[key] ?? '',
  )
}
