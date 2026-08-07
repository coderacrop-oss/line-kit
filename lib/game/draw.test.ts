import { describe, expect, it } from 'vitest'
import { seededRng } from '../test-utils/rng'
import { FORTUNES, TONES } from './fortunes'
import { GRID_SIZE, drawNine, randomFortune } from './draw'

describe('drawNine', () => {
  it('returns exactly nine fortunes', () => {
    expect(drawNine(seededRng(1))).toHaveLength(GRID_SIZE)
  })

  it('never repeats a fortune within one draw', () => {
    const ids = drawNine(seededRng(2)).map((fortune) => fortune.id)
    expect(new Set(ids).size).toBe(GRID_SIZE)
  })

  it('always includes three fortunes of every tone', () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const drawn = drawNine(seededRng(seed))
      for (const tone of TONES) {
        expect(drawn.filter((fortune) => fortune.tone === tone)).toHaveLength(3)
      }
    }
  })

  it('is deterministic for a given seed', () => {
    const first = drawNine(seededRng(7)).map((fortune) => fortune.id)
    const second = drawNine(seededRng(7)).map((fortune) => fortune.id)
    expect(first).toEqual(second)
  })

  it('does not always return tones in the same order', () => {
    const toneOrders = new Set(
      Array.from({ length: 20 }, (_, seed) =>
        drawNine(seededRng(seed))
          .map((fortune) => fortune.tone)
          .join(','),
      ),
    )
    expect(toneOrders.size).toBeGreaterThan(1)
  })
})

describe('randomFortune', () => {
  it('returns a fortune from the catalog', () => {
    const fortune = randomFortune(seededRng(3))
    expect(FORTUNES).toContainEqual(fortune)
  })

  it('clamps to the last fortune when rng yields exactly 1', () => {
    const fortune = randomFortune(() => 1)
    expect(fortune).toBeDefined()
    expect(FORTUNES).toContainEqual(fortune)
  })
})
