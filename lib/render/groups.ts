import { evaluateAll, type Condition, type PlayerState } from '../state'

export type BlockType =
  | 'image' | 'title' | 'body' | 'caption'
  | 'progress_bar' | 'divider' | 'spacer' | 'button'

export type CardBlock = {
  id: string
  blockType: BlockType
  sortOrder: number
  content: string | null
  showWhen: Condition[] | null
  options: Record<string, unknown> | null
}

export type Groups = {
  top: CardBlock[]
  content: CardBlock[]
  footer: CardBlock[]
}

/** LINE renders at most three buttons in a bubble's footer. */
const MAX_FOOTER_BUTTONS = 3

/**
 * Split a card's blocks into the three groups every output shares.
 *
 * The one rule that matters: order is preserved. A button in the middle of the
 * list stays in the middle. Only a trailing run of buttons becomes the footer,
 * and only a full-width image in first position becomes the hero. Anything else
 * would make the editor's list disagree with what the player sees, with nothing
 * on screen explaining why.
 *
 * Hidden blocks are removed before the footer is found, so the footer is
 * computed from what is actually visible rather than from the raw list.
 */
export function groupBlocks(blocks: CardBlock[], state: PlayerState): Groups {
  const visible = [...blocks]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((b) => evaluateAll(b.showWhen, state))

  const top: CardBlock[] = []
  let rest = visible

  const first = rest[0]
  if (first?.blockType === 'image' && first.options?.placement === 'full_top') {
    top.push(first)
    rest = rest.slice(1)
  }

  let cut = rest.length
  while (cut > 0 && rest[cut - 1].blockType === 'button') cut--

  let footer = rest.slice(cut)
  let content = rest.slice(0, cut)

  // More than three trailing buttons cannot all fit. Keep the last three and
  // leave the overflow in content rather than dropping it, so the author can
  // see that something did not fit.
  if (footer.length > MAX_FOOTER_BUTTONS) {
    const overflow = footer.slice(0, footer.length - MAX_FOOTER_BUTTONS)
    footer = footer.slice(footer.length - MAX_FOOTER_BUTTONS)
    content = [...content, ...overflow]
  }

  return { top, content, footer }
}
