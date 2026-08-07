import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifySignature } from './verify'

const SECRET = 'test-channel-secret'
const BODY = JSON.stringify({ events: [] })

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64')
}

describe('verifySignature', () => {
  it('accepts a signature produced with the right secret', () => {
    expect(verifySignature(BODY, sign(BODY), SECRET)).toBe(true)
  })

  it('rejects a signature produced with a different secret', () => {
    expect(verifySignature(BODY, sign(BODY, 'wrong-secret'), SECRET)).toBe(false)
  })

  it('rejects a body that was tampered with after signing', () => {
    const signature = sign(BODY)
    expect(verifySignature(BODY + ' ', signature, SECRET)).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(verifySignature(BODY, null, SECRET)).toBe(false)
  })

  it('rejects an empty signature header', () => {
    expect(verifySignature(BODY, '', SECRET)).toBe(false)
  })

  it('rejects a signature of the wrong length without throwing', () => {
    expect(() => verifySignature(BODY, 'short', SECRET)).not.toThrow()
    expect(verifySignature(BODY, 'short', SECRET)).toBe(false)
  })

  it('handles a body containing Thai text', () => {
    const thaiBody = JSON.stringify({ text: 'เสี่ยงทาย' })
    expect(verifySignature(thaiBody, sign(thaiBody), SECRET)).toBe(true)
  })
})
