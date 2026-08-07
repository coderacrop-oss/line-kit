import { FORTUNES, TONES, type Fortune } from './fortunes'

export const GRID_SIZE = 9

const PER_TONE = 3

/** Draws nine distinct fortunes, three of each tone, in shuffled positions. */
export function drawNine(rng: () => number = Math.random): Fortune[] {
  const picked: Fortune[] = []
  for (const tone of TONES) {
    const pool = FORTUNES.filter((fortune) => fortune.tone === tone)
    picked.push(...shuffle(pool, rng).slice(0, PER_TONE))
  }
  return shuffle(picked, rng)
}

export function randomFortune(rng: () => number = Math.random): Fortune {
  return FORTUNES[Math.floor(rng() * FORTUNES.length)]
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
