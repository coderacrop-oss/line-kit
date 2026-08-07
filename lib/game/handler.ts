import { buildFortuneCard } from '../flex/fortune'
import { buildGridCard } from '../flex/grid'
import { buildHintCard, buildWelcomeCard } from '../flex/prompt'
import type { FlexMessage } from '../flex/types'
import type { LineEvent } from '../line/types'
import { drawNine, randomFortune } from './draw'
import { findFortune } from './fortunes'
import { decodeAction } from './postback'

export const TRIGGER_WORDS = ['เสี่ยงทาย', 'เสี่ยงโชค', 'คุกกี้', 'ดวง', 'เล่น', 'fortune']

/** Decides what to reply with. Returns null when the event needs no reply. */
export function handleEvent(event: LineEvent, rng: () => number = Math.random): FlexMessage | null {
  if (event.type === 'follow') {
    return buildWelcomeCard()
  }

  if (event.type === 'message') {
    const text = event.message.text
    if (event.message.type !== 'text' || text === undefined) return null
    if (isTrigger(text)) return buildGridCard(drawNine(rng))
    // The hint card is only welcome in a 1:1 chat — sending it in a group for
    // every non-trigger message would spam the group.
    const isDirectChat = event.source === undefined || event.source.type === 'user'
    return isDirectChat ? buildHintCard() : null
  }

  if (event.type === 'postback') {
    const action = decodeAction(event.postback.data)
    if (action === null) return buildHintCard()
    if (action.kind === 'new') return buildGridCard(drawNine(rng))
    return buildFortuneCard(findFortune(action.fortuneId) ?? randomFortune(rng))
  }

  return null
}

function isTrigger(text: string): boolean {
  const normalised = text.trim().toLowerCase()
  return TRIGGER_WORDS.some((word) => normalised.includes(word))
}
