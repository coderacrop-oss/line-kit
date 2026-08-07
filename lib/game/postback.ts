export type GameAction = { kind: 'open'; fortuneId: number } | { kind: 'new' }

export const NEW_GAME_DATA = 'a=new'

export function encodeOpen(fortuneId: number): string {
  return new URLSearchParams({ a: 'open', f: String(fortuneId) }).toString()
}

/**
 * Parses postback data. Returns null when the payload is not something this
 * game produced. Validates shape only — whether the id exists in the catalog
 * is the caller's call, since a stale id still means "open a cookie".
 */
export function decodeAction(data: string): GameAction | null {
  const params = new URLSearchParams(data)
  const action = params.get('a')

  if (action === 'new') return { kind: 'new' }
  if (action !== 'open') return null

  const raw = params.get('f')
  if (raw === null || raw.trim() === '') return null

  const fortuneId = Number(raw)
  if (!Number.isInteger(fortuneId)) return null

  return { kind: 'open', fortuneId }
}
