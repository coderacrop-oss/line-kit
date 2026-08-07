import { describe, expect, it } from 'vitest'
import { NEW_GAME_DATA, decodeAction, encodeOpen } from './postback'

describe('encodeOpen', () => {
  it('encodes the fortune id into the payload', () => {
    expect(encodeOpen(42)).toBe('a=open&f=42')
  })

  it('stays well under the 300 character postback limit', () => {
    expect(encodeOpen(999999).length).toBeLessThan(300)
  })
})

describe('decodeAction', () => {
  it('round-trips an encoded open action', () => {
    expect(decodeAction(encodeOpen(42))).toEqual({ kind: 'open', fortuneId: 42 })
  })

  it('decodes the new-game payload', () => {
    expect(decodeAction(NEW_GAME_DATA)).toEqual({ kind: 'new' })
  })

  it('accepts an id that is not in the catalog and lets the caller decide', () => {
    expect(decodeAction('a=open&f=9999')).toEqual({ kind: 'open', fortuneId: 9999 })
  })

  it('rejects a non-numeric fortune id', () => {
    expect(decodeAction('a=open&f=abc')).toBeNull()
  })

  it('rejects a missing fortune id', () => {
    expect(decodeAction('a=open')).toBeNull()
  })

  it('rejects an unknown action', () => {
    expect(decodeAction('a=bogus')).toBeNull()
  })

  it('rejects empty data', () => {
    expect(decodeAction('')).toBeNull()
  })
})
