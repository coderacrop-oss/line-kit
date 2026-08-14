/** LINE caps postback data at 300 characters. */
const MAX_LENGTH = 300

export type Postback = {
  /** campaign code — a card left in a chat outlives its campaign */
  c: string
  /** activity code */
  a: string
  /** period key the card was issued for */
  d: string
  /** quiz round token, when the activity asks a series of questions */
  r?: string
  /** which option the player tapped */
  p?: string
}

const KEYS = ['c', 'a', 'd', 'r', 'p'] as const

export function encodePostback(p: Postback): string {
  const parts: string[] = []
  for (const key of KEYS) {
    const value = p[key]
    if (value !== undefined) parts.push(`${key}=${encodeURIComponent(value)}`)
  }
  const encoded = parts.join('&')

  // Checked when the button is built, not when it is sent: an over-long payload
  // fails at send time with nothing on screen explaining why.
  if (encoded.length > MAX_LENGTH) {
    throw new Error(
      `postback is ${encoded.length} characters, over LINE's limit of ${MAX_LENGTH}`,
    )
  }
  return encoded
}

export function decodePostback(raw: string): Postback | null {
  if (!raw) return null

  const out: Record<string, string> = {}
  for (const pair of raw.split('&')) {
    const index = pair.indexOf('=')
    if (index < 1) return null
    const key = pair.slice(0, index)
    if (!(KEYS as readonly string[]).includes(key)) return null
    out[key] = decodeURIComponent(pair.slice(index + 1))
  }

  // Campaign, activity and period are what make a stale tap detectable. A
  // payload missing any of them is not ours.
  if (!out.c || !out.a || !out.d) return null
  return out as Postback
}
