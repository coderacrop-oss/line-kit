import { describe, expect, it } from 'vitest'
import { GRID_ALT_TEXT } from '../flex/grid'
import { fortuneAltText } from '../flex/fortune'
import { HINT_ALT_TEXT, WELCOME_ALT_TEXT } from '../flex/prompt'
import type { LineEvent } from '../line/types'
import { seededRng } from '../test-utils/rng'
import { findFortune } from './fortunes'
import { NEW_GAME_DATA, encodeOpen } from './postback'
import { handleEvent } from './handler'

function textEvent(text: string): LineEvent {
  return { type: 'message', replyToken: 'token', message: { type: 'text', text } }
}

function postbackEvent(data: string): LineEvent {
  return { type: 'postback', replyToken: 'token', postback: { data } }
}

describe('handleEvent', () => {
  it('greets a new follower', () => {
    const reply = handleEvent({ type: 'follow', replyToken: 'token' }, seededRng(1))
    expect(reply?.altText).toBe(WELCOME_ALT_TEXT)
  })

  it('sends the grid for a trigger word', () => {
    expect(handleEvent(textEvent('เสี่ยงทาย'), seededRng(1))?.altText).toBe(GRID_ALT_TEXT)
  })

  it('recognises a trigger word inside a longer sentence', () => {
    expect(handleEvent(textEvent('ขอเสี่ยงทายหน่อยครับ'), seededRng(1))?.altText).toBe(GRID_ALT_TEXT)
  })

  it('ignores surrounding whitespace and letter case', () => {
    expect(handleEvent(textEvent('  FORTUNE  '), seededRng(1))?.altText).toBe(GRID_ALT_TEXT)
  })

  it('sends the hint card for an unrecognised message', () => {
    expect(handleEvent(textEvent('สวัสดีครับ'), seededRng(1))?.altText).toBe(HINT_ALT_TEXT)
  })

  it('opens the exact fortune the tapped tile carries', () => {
    const fortune = findFortune(42)!
    const reply = handleEvent(postbackEvent(encodeOpen(42)), seededRng(1))
    expect(reply?.altText).toBe(fortuneAltText(fortune))
  })

  it('falls back to a random fortune when the id no longer exists', () => {
    const reply = handleEvent(postbackEvent(encodeOpen(9999)), seededRng(1))
    expect(reply?.altText).toContain('คำทำนายของคุณ:')
  })

  it('sends a fresh grid for the play-again postback', () => {
    expect(handleEvent(postbackEvent(NEW_GAME_DATA), seededRng(1))?.altText).toBe(GRID_ALT_TEXT)
  })

  it('sends the hint card for malformed postback data', () => {
    expect(handleEvent(postbackEvent('a=bogus'), seededRng(1))?.altText).toBe(HINT_ALT_TEXT)
  })

  it('stays silent for non-text messages', () => {
    const sticker: LineEvent = {
      type: 'message',
      replyToken: 'token',
      message: { type: 'sticker' },
    }
    expect(handleEvent(sticker, seededRng(1))).toBeNull()
  })

  it('stays silent for events it does not handle', () => {
    expect(handleEvent({ type: 'unfollow' }, seededRng(1))).toBeNull()
  })
})
