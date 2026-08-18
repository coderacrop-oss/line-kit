import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replyMessage = vi.fn()
const linkRichMenu = vi.fn()
const markRichMenuLinked = vi.fn()

vi.mock('@/lib/line/client', () => ({
  replyMessage: (...args: unknown[]) => replyMessage(...args),
  linkRichMenu: (...args: unknown[]) => linkRichMenu(...args),
  getChannelSecret: () => 'test-secret',
  getAccessToken: () => 'test-token',
}))

vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))

// ค่าเริ่มต้นของ findLiveCampaign ให้เป็น null ไว้ก่อน — เทสต์เดิมทั้งหมด (401,
// empty batch, ฯลฯ) ไม่เคยไปถึงจุดที่ query จริงอยู่แล้ว ยกเว้นกลุ่มที่ตั้งเองท้ายไฟล์
let liveCampaign: unknown = null
vi.mock('@/lib/db/queries', () => ({
  makePorts: () => ({
    findLiveCampaign: async () => liveCampaign,
    ensureParticipant: async () => 'p-1',
    loadPlayerState: async () => ({
      attributes: {}, counters: {}, entitlements: [], playCounts: {}, completed: [],
    }),
    playsThisPeriod: async () => 0,
    play: async () => ({ kind: 'played', outcomeId: 'a', cardId: 'card-win' }),
    logEvent: async () => {},
    hasRichMenuLinked: async () => false,
    markRichMenuLinked: (...args: unknown[]) => markRichMenuLinked(...args),
  }),
}))

const { POST } = await import('./route')

function campaignWithEntryMenu() {
  return {
    campaignId: 'camp-1', code: 'krobpet', timezone: 'Asia/Bangkok', dayLengthSec: 86400,
    startAt: new Date('2026-08-01T00:00:00Z'), endAt: new Date('2026-08-31T00:00:00Z'),
    theme: { primary: '#17756A', secondary: '#EFF3F1', text: '#151F1D' }, configVersionId: 'cv-1',
    keywordRules: [{ id: 'k1', keyword: 'เล่น', matchMode: 'exact' as const, sortOrder: 1 }],
    keywordTargets: { k1: { cardId: 'card-win' } },
    activities: [],
    cardsById: {
      'card-win': { code: 'win', renderAs: 'text' as const, blocks: [
        { id: 'b1', blockType: 'body' as const, sortOrder: 1, content: 'ยินดีต้อนรับ', showWhen: null, options: null },
      ] },
    },
    defaultCardId: null, greetingCardId: null, greetingEnabled: false,
    entryRichMenuLineId: 'line-rm-entry',
  }
}

function signedRequest(body: unknown, secret = 'test-secret'): Request {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const signature = createHmac('sha256', secret).update(raw, 'utf8').digest('base64')
  return new Request('https://example.com/api/line/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': signature },
    body: raw,
  })
}

const originalLineChannelId = process.env.LINE_CHANNEL_ID

beforeEach(() => {
  replyMessage.mockReset()
  replyMessage.mockResolvedValue(undefined)
  linkRichMenu.mockReset()
  linkRichMenu.mockResolvedValue(undefined)
  markRichMenuLinked.mockReset()
  liveCampaign = null
  process.env.LINE_CHANNEL_ID = 'line-channel-1'
})

afterEach(() => {
  if (originalLineChannelId === undefined) delete process.env.LINE_CHANNEL_ID
  else process.env.LINE_CHANNEL_ID = originalLineChannelId
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

describe('ผูกเมนูตัวเข้าให้ผู้เล่น (route ทำจริง — handle.ts แค่ตัดสินใจ)', () => {
  const messageEvent = (text: string) => ({
    events: [{
      type: 'message', replyToken: 'rt-1', source: { type: 'user', userId: 'U1' },
      message: { type: 'text', text },
    }],
  })

  it('คีย์เวิร์ดที่ยังไม่เคยผูก → ตอบก่อน แล้วเรียกผูกเมนู แล้ว mark ว่าผูกแล้ว', async () => {
    liveCampaign = campaignWithEntryMenu()
    await POST(signedRequest(messageEvent('เล่น')))

    expect(replyMessage).toHaveBeenCalledOnce()
    expect(linkRichMenu).toHaveBeenCalledWith('test-token', 'U1', 'line-rm-entry')
    expect(markRichMenuLinked).toHaveBeenCalledWith('p-1')
  })

  it('ผูกเมนูไม่สำเร็จ → ไม่ mark ว่าผูกแล้ว และไม่กระทบคำตอบที่ส่งไปแล้ว (BR-01)', async () => {
    liveCampaign = campaignWithEntryMenu()
    linkRichMenu.mockRejectedValue(new Error('LINE ปฏิเสธ'))

    const response = await POST(signedRequest(messageEvent('เล่น')))

    expect(response.status).toBe(200)
    expect(replyMessage).toHaveBeenCalledOnce()
    expect(markRichMenuLinked).not.toHaveBeenCalled()
  })

  it('ข้อความปกติที่ไม่ติดคำสั่งผูกเมนู → ไม่เรียก linkRichMenu เลย', async () => {
    liveCampaign = { ...campaignWithEntryMenu(), entryRichMenuLineId: null }
    await POST(signedRequest(messageEvent('เล่น')))

    expect(replyMessage).toHaveBeenCalledOnce()
    expect(linkRichMenu).not.toHaveBeenCalled()
    expect(markRichMenuLinked).not.toHaveBeenCalled()
  })
})
