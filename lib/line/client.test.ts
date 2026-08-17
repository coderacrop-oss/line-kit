import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken, getChannelSecret, replyMessage, setWebhookEndpoint } from './client'

import type { FlexMessage } from '../flex/types'

/** Smallest Flex message LINE accepts, for exercising the client itself. */
function testMessage(): FlexMessage {
  return {
    type: 'flex',
    altText: 'test',
    contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } },
  }
}


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
    const message = testMessage()
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
    await expect(replyMessage('stale-token', testMessage())).rejects.toThrow(/400/)
  })

  it('passes an abort signal so a stalled LINE API call cannot hang forever', async () => {
    await replyMessage('reply-token-123', testMessage())

    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

/**
 * ขั้น 6 ของ §4.4 · ตั้ง webhook ให้บัญชีที่กำลังส่งขึ้น
 */
describe('setWebhookEndpoint', () => {
  it('ตั้ง endpoint ที่ปลายทางของ LINE ด้วย PUT', async () => {
    await setWebhookEndpoint('oa-token', 'https://example.com/api/line/webhook')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.line.me/v2/bot/channel/webhook/endpoint')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ endpoint: 'https://example.com/api/line/webhook' })
  })

  /**
   * โทเคนมาจากพารามิเตอร์ ไม่ใช่จาก env
   *
   * นี่คือความต่างทั้งหมดระหว่างระบบที่พูดแทน OA ได้ตัวเดียวกับระบบที่พูดแทนบัญชี
   * ไหนก็ได้ · env ถูกตั้งไว้ในเทสต์นี้ด้วยค่าอื่น ถ้าวันหนึ่งมีคนเปลี่ยนไปอ่าน env
   * เพื่อความสะดวก เทสต์นี้จะเป็นตัวที่ฟ้อง
   */
  it('ใช้โทเคนที่ส่งเข้ามา ไม่ใช่โทเคนใน env', async () => {
    await setWebhookEndpoint('oa-token', 'https://example.com/api/line/webhook')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer oa-token')
    expect(init.headers.Authorization).not.toContain('test-token')
  })

  it('LINE ปฏิเสธแล้วโยน พร้อมรหัสสถานะที่ตอบมา', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'Invalid token' })
    await expect(setWebhookEndpoint('bad', 'https://example.com/hook')).rejects.toThrow(/401/)
  })

  it('มี abort signal เหมือนกัน — LINE ที่ไม่ตอบต้องไม่ค้างธุรกรรมไว้ตลอดกาล', async () => {
    await setWebhookEndpoint('oa-token', 'https://example.com/hook')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
