import type { Groups } from './groups'
import { substitute } from './vars'
import type { PlayerState } from '../state'

/** Shown when a card has no text at all. Never return an empty reply. */
const NOTHING_TO_SAY = 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่'

const CARRIES_TEXT = ['title', 'body', 'caption', 'button']

/**
 * The fallback shape, used both for text-mode cards and for the moment config
 * can no longer be trusted at all.
 *
 * Button labels survive the flattening. They are the only clue left about what
 * the player was meant to do next, and dropping them turns a usable message
 * into a dead end.
 */
export function toPlainText(groups: Groups, state: PlayerState): string {
  const lines = [...groups.top, ...groups.content, ...groups.footer]
    .filter((b) => CARRIES_TEXT.includes(b.blockType))
    .map((b) => substitute(b.content ?? '', state).trim())
    .filter((line) => line.length > 0)

  return lines.length > 0 ? lines.join('\n') : NOTHING_TO_SAY
}
