import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const replyMessage = vi.fn()

vi.mock('@/lib/line/client', () => ({
  replyMessage: (...args: unknown[]) => replyMessage(...args),
  getChannelSecret: () => 'test-secret',
  getAccessToken: () => 'test-token',
}))

const { POST } = await import('./route')

function signedRequest(body: unknown, secret = 'test-secret'): Request {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const signature = createHmac('sha256', secret).update(raw, 'utf8').digest('base64')
  return new Request('https://example.com/api/line/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': signature },
    body: raw,
  })
}

beforeEach(() => {
  replyMessage.mockReset()
  replyMessage.mockResolvedValue(undefined)
})

describe('POST /api/line/webhook', () => {
  it('rejects a request signed with the wrong secret', async () => {
    const response = await POST(signedRequest({ events: [] }, 'wrong-secret'))
    expect(response.status).toBe(401)
    expect(replyMessage).not.toHaveBeenCalled()
  })

  it('rejects a request with no signature header', async () => {
    const request = new Request('https://example.com/api/line/webhook', {
      method: 'POST',
      body: JSON.stringify({ events: [] }),
    })
    expect((await POST(request)).status).toBe(401)
  })

  it('accepts the empty verification payload LINE sends from the console', async () => {
    expect((await POST(signedRequest({ events: [] }))).status).toBe(200)
  })

  it('returns 200 for a signed body that is not valid JSON', async () => {
    expect((await POST(signedRequest('not json'))).status).toBe(200)
  })

  it('returns 200 for a signed body of literal null', async () => {
    expect((await POST(signedRequest(null))).status).toBe(200)
  })

  it('returns 200 when events is not an array', async () => {
    expect((await POST(signedRequest({ events: 5 }))).status).toBe(200)
  })
})
