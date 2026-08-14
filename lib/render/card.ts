import { groupBlocks, type CardBlock } from './groups'
import { toFlexBubble, toFlexCarousel, type Theme } from './flex'
import { toPlainText } from './text'
import type { PlayerState } from '../state'

export type RenderableCard = {
  code: string
  renderAs: 'flex_bubble' | 'flex_carousel' | 'imagemap' | 'imagemap_video' | 'text'
  blocks: CardBlock[]
  /** children of a carousel, in swipe order */
  children?: RenderableCard[]
}

export type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: object }

/** Alt text is what a notification shows, so it must read as a sentence. */
function altTextFor(card: RenderableCard, state: PlayerState): string {
  const flat = toPlainText(groupBlocks(card.blocks, state), state)
  return flat.split('\n')[0].slice(0, 400)
}

/**
 * One card plus one player's state becomes one LINE message.
 *
 * Shapes not yet supported fall back to plain text rather than throwing. A
 * config that asks for a rich message before the renderer exists still answers
 * the player — silence is the one outcome BR-01 rules out.
 */
export function renderCard(
  card: RenderableCard,
  state: PlayerState,
  theme: Theme,
): LineMessage {
  if (card.renderAs === 'text' || card.renderAs === 'imagemap' || card.renderAs === 'imagemap_video') {
    return { type: 'text', text: toPlainText(groupBlocks(card.blocks, state), state) }
  }

  if (card.renderAs === 'flex_carousel') {
    const children = card.children ?? []
    const bubbles = (children.length > 0 ? children : [card]).map((child) =>
      toFlexBubble(groupBlocks(child.blocks, state), state, theme),
    )
    return { type: 'flex', altText: altTextFor(card, state), contents: toFlexCarousel(bubbles) }
  }

  return {
    type: 'flex',
    altText: altTextFor(card, state),
    contents: toFlexBubble(groupBlocks(card.blocks, state), state, theme),
  }
}
