import { describe, expect, it } from 'vitest'
import { NEW_GAME_DATA } from '../game/postback'
import type { FlexBox, FlexButton } from './types'
import {
  HINT_ALT_TEXT,
  WELCOME_ALT_TEXT,
  buildHintCard,
  buildWelcomeCard,
} from './prompt'

describe('prompt cards', () => {
  it('both put the player one tap from a new game', () => {
    for (const card of [buildWelcomeCard(), buildHintCard()]) {
      const footer = card.contents.footer as FlexBox
      const button = footer.contents[0] as FlexButton
      expect(button.action.data).toBe(NEW_GAME_DATA)
    }
  })

  it('uses distinct alt text so the two cards are tellable apart', () => {
    expect(buildWelcomeCard().altText).toBe(WELCOME_ALT_TEXT)
    expect(buildHintCard().altText).toBe(HINT_ALT_TEXT)
    expect(WELCOME_ALT_TEXT).not.toBe(HINT_ALT_TEXT)
  })

  it('tells the player which word starts the game', () => {
    expect(JSON.stringify(buildHintCard())).toContain('เสี่ยงทาย')
  })
})
