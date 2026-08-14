import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken, getChannelSecret, replyMessage } from './client'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('LINE_CHANNEL_ACCESS_TOKEN', 'test-token')
  vi.stubEnv('LINE_CHANNEL_SECRET', 'test-secret')
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('environment readers', () => {
  it('reads both LINE credentials', () => {
    expect(getAccessToken()).toBe('test-token')
    expect(getChannelSecret()).toBe('test-secret')
  })

  it('names the missing variable when it is not set', () => {
    vi.stubEnv('LINE_CHANNEL_SECRET', '')
    expect(() => getChannelSecret()).toThrow(/LINE_CHANNEL_SECRET/)
  })
})

describe('replyMessage', () => {
  it('posts the message to the LINE reply endpoint', async () => {
    const message = ({ type: 'flex', altText: 'test', contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } } })
    await replyMessage('reply-token-123', message)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.line.me/v2/bot/message/reply')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(init.body)).toEqual({
      replyToken: 'reply-token-123',
      messages: [message],
    })
  })

  it('throws when LINE rejects the reply', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'Invalid reply token' })
    await expect(replyMessage('stale-token', ({ type: 'flex', altText: 'test', contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } } }))).rejects.toThrow(/400/)
  })

  it('passes an abort signal so a stalled LINE API call cannot hang forever', async () => {
    await replyMessage('reply-token-123', ({ type: 'flex', altText: 'test', contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } } }))

    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
