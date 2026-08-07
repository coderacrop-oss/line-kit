import { describe, expect, it } from 'vitest'
import { FORTUNES, TONES, findFortune } from './fortunes'

describe('FORTUNES catalog', () => {
  it('has exactly 60 fortunes', () => {
    expect(FORTUNES).toHaveLength(60)
  })

  it('has unique ids', () => {
    const ids = FORTUNES.map((fortune) => fortune.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has 20 fortunes per tone', () => {
    for (const tone of TONES) {
      expect(FORTUNES.filter((fortune) => fortune.tone === tone)).toHaveLength(20)
    }
  })

  it('has non-empty text everywhere', () => {
    for (const fortune of FORTUNES) {
      expect(fortune.text.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('findFortune', () => {
  it('returns the fortune matching the id', () => {
    expect(findFortune(1)?.id).toBe(1)
  })

  it('returns undefined for an id that does not exist', () => {
    expect(findFortune(9999)).toBeUndefined()
  })
})
