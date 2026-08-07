import { describe, expect, it } from 'vitest'
import { findFortune } from '../game/fortunes'
import { NEW_GAME_DATA } from '../game/postback'
import { TONE_STYLE } from './theme'
import type { FlexBox, FlexButton, FlexText } from './types'
import { buildFortuneCard, fortuneAltText } from './fortune'

const fortune = findFortune(1)!

describe('buildFortuneCard', () => {
  it('shows the fortune text in the body', () => {
    const card = buildFortuneCard(fortune)
    expect(JSON.stringify(card.contents.body)).toContain(fortune.text)
  })

  it('wraps the fortune text so long lines are not cut off', () => {
    const card = buildFortuneCard(fortune)
    const body = card.contents.body as FlexBox
    const textNode = body.contents.find(
      (node): node is FlexText => node.type === 'text' && node.text === fortune.text,
    )
    expect(textNode?.wrap).toBe(true)
  })

  it('colours the tone badge to match the tone', () => {
    for (const id of [1, 21, 41]) {
      const current = findFortune(id)!
      const card = buildFortuneCard(current)
      const header = card.contents.header as FlexBox
      const badge = header.contents[0] as FlexText
      expect(badge.text).toBe(TONE_STYLE[current.tone].label)
      expect(badge.color).toBe(TONE_STYLE[current.tone].color)
    }
  })

  it('offers a play-again button', () => {
    const card = buildFortuneCard(fortune)
    const footer = card.contents.footer as FlexBox
    const button = footer.contents[0] as FlexButton
    expect(button.type).toBe('button')
    expect(button.action.data).toBe(NEW_GAME_DATA)
  })

  it('uses an alt text that previews the fortune', () => {
    expect(fortuneAltText(fortune)).toContain(fortune.text)
    expect(buildFortuneCard(fortune).altText).toBe(fortuneAltText(fortune))
  })

  it('keeps alt text within the 400 character LINE limit', () => {
    for (const id of [1, 21, 41]) {
      expect(fortuneAltText(findFortune(id)!).length).toBeLessThanOrEqual(400)
    }
  })
})
