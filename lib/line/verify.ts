import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verifies the x-line-signature header against the raw request body.
 * The body must be the exact bytes LINE sent — re-serialising parsed JSON
 * changes whitespace and key order, which breaks the signature.
 */
export function verifySignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): boolean {
  if (!signature) return false

  const expected = Buffer.from(
    createHmac('sha256', channelSecret).update(rawBody, 'utf8').digest('base64'),
  )
  const received = Buffer.from(signature)

  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}
