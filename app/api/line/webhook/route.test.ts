import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRID_ALT_TEXT } from '@/lib/flex/grid'

const replyMessage = vi.fn()

vi.mock('@/lib/line/client', () => ({
  replyMessage: (...args: unknown[]) => replyMessage(...args),
  getChannelSecret: () => 'test-secret',
  getAccessToken: () => 'test-token',
}))

const { POST } = await import('./route')

function signedRequest(body: unknown, secret = 'test-secret'): Request {
  const raw = JSON.stringify(body)
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

afterEach(() => {
  vi.restoreAllMocks()
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
    const response = await POST(signedRequest({ events: [] }))
    expect(response.status).toBe(200)
    expect(replyMessage).not.toHaveBeenCalled()
  })

  it('replies with the grid when a player sends a trigger word', async () => {
    const response = await POST(
      signedRequest({
        events: [
          {
            type: 'message',
            replyToken: 'reply-token',
            message: { type: 'text', text: 'เสี่ยงทาย' },
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
    expect(replyMessage).toHaveBeenCalledTimes(1)
    const [token, message] = replyMessage.mock.calls[0]
    expect(token).toBe('reply-token')
    expect(message.altText).toBe(GRID_ALT_TEXT)
  })

  it('still returns 200 when replying fails, so LINE does not retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    replyMessage.mockRejectedValue(new Error('LINE reply failed: 400'))

    const response = await POST(
      signedRequest({
        events: [
          {
            type: 'message',
            replyToken: 'reply-token',
            message: { type: 'text', text: 'เสี่ยงทาย' },
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
  })

  it('returns 200 for a signed body that is not valid JSON', async () => {
    const raw = 'not json'
    const signature = createHmac('sha256', 'test-secret').update(raw, 'utf8').digest('base64')
    const request = new Request('https://example.com/api/line/webhook', {
      method: 'POST',
      headers: { 'x-line-signature': signature },
      body: raw,
    })
    expect((await POST(request)).status).toBe(200)
  })
})
