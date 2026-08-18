import type { CardBlock, Groups } from './groups'
import { substitute } from './vars'
import type { PlayerState } from '../state'

export type Theme = { primary: string; secondary: string; text: string }

/** LINE renders at most 12 bubbles in a carousel. */
const MAX_BUBBLES = 12

const TEXT_SIZES: Record<string, string> = { title: 'lg', body: 'md', caption: 'sm' }

function textComponent(block: CardBlock, state: PlayerState, theme: Theme) {
  return {
    type: 'text',
    text: substitute(block.content ?? '', state),
    size: TEXT_SIZES[block.blockType] ?? 'md',
    weight: block.blockType === 'title' ? 'bold' : 'regular',
    color: block.blockType === 'caption' ? theme.secondary : theme.text,
    wrap: true,
  }
}

function progressComponent(block: CardBlock, state: PlayerState, theme: Theme) {
  const counter = String(block.options?.counter ?? '')
  const target = Number(block.options?.target ?? 0)
  const value = state.counters[counter] ?? 0

  // Clamped both ways: a player past the goal sees a full bar rather than one
  // overflowing its own track, and a target of zero cannot divide by zero.
  const percent = target > 0 ? Math.min(100, Math.max(0, Math.round((value / target) * 100))) : 0

  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: theme.secondary,
    height: '8px',
    cornerRadius: '4px',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        contents: [],
        width: `${percent}%`,
        backgroundColor: theme.primary,
        height: '8px',
        cornerRadius: '4px',
      },
    ],
  }
}

function component(block: CardBlock, state: PlayerState, theme: Theme): object {
  switch (block.blockType) {
    case 'image':
      return {
        type: 'image',
        url: substitute(block.content ?? '', state),
        size: 'full',
        aspectMode: 'cover',
      }
    case 'title':
    case 'body':
    case 'caption':
      return textComponent(block, state, theme)
    case 'progress_bar':
      return progressComponent(block, state, theme)
    case 'divider':
      return { type: 'separator', margin: 'md' }
    case 'spacer':
      return { type: 'box', layout: 'vertical', contents: [], height: '12px' }
    case 'button':
      return {
        type: 'button',
        style: 'primary',
        color: theme.primary,
        action: {
          label: substitute(block.content ?? '', state),
          ...((block.options?.action as object) ?? {}),
        },
      }
  }
}

export function toFlexBubble(groups: Groups, state: PlayerState, theme: Theme): object {
  const body = groups.content.map((b) => component(b, state, theme))

  // LINE rejects an empty box, and a card with every block hidden is a real
  // state the author can reach with the preview's state switcher.
  if (body.length === 0) body.push({ type: 'filler' })

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: body },
  }

  const hero = groups.top[0]
  if (hero) bubble.hero = component(hero, state, theme)

  if (groups.footer.length > 0) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: groups.footer.map((b) => component(b, state, theme)),
    }
  }

  return bubble
}

export function toFlexCarousel(bubbles: object[]): object {
  if (bubbles.length === 0) {
    throw new Error('a carousel needs at least one bubble')
  }
  if (bubbles.length > MAX_BUBBLES) {
    throw new Error(
      `carousel has ${bubbles.length} bubbles, over LINE's limit of ${MAX_BUBBLES}`,
    )
  }
  return { type: 'carousel', contents: bubbles }
}
