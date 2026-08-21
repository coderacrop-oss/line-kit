import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replyMessage = vi.fn()
const linkRichMenu = vi.fn()
const markRichMenuLinked = vi.fn()
const findChannelByBotUserId = vi.fn()
const readChannelSecret = vi.fn()

vi.mock('@/lib/line/client', () => ({
  replyMessage: (...args: unknown[]) => replyMessage(...args),
  linkRichMenu: (...args: unknown[]) => linkRichMenu(...args),
}))

vi.mock('@/lib/db/client', () => ({ db: () => ({}) }))

vi.mock('@/lib/db/channels', () => ({
  findChannelByBotUserId: (...args: unknown[]) => findChannelByBotUserId(...args),
}))

vi.mock('@/lib/db/tokens', () => ({
  readChannelSecret: (...args: unknown[]) => readChannelSecret(...args),
}))

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

/** บัญชีที่ findChannelByBotUserId มีค่าเริ่มต้นให้เจอ — ใช้ secret/token เดียวกับที่ signedRequest เซ็นด้วยตามค่าเริ่มต้น */
const KNOWN_DESTINATION = 'U-bot-1'
const KNOWN_CHANNEL = { id: 'ch-1', lineChannelId: 'line-channel-1' }

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
  linkRichMenu.mockReset()
  linkRichMenu.mockResolvedValue(undefined)
  markRichMenuLinked.mockReset()
  liveCampaign = null

  findChannelByBotUserId.mockReset()
  findChannelByBotUserId.mockImplementation(async (_sql: unknown, destination: string) =>
    destination === KNOWN_DESTINATION ? KNOWN_CHANNEL : null)

  readChannelSecret.mockReset()
  readChannelSecret.mockImplementation(async (_sql: unknown, opts: { field: string }) =>
    opts.field === 'secret' ? 'test-secret' : 'test-token')
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/line/webhook', () => {
  it('รับ ping ตรวจสอบแบบ batch ว่างของ LINE โดยไม่แตะฐานข้อมูลหรือลายเซ็นเลย', async () => {
    const response = await POST(signedRequest({ events: [] }, 'wrong-secret'))
    expect(response.status).toBe(200)
    expect(findChannelByBotUserId).not.toHaveBeenCalled()
    expect(readChannelSecret).not.toHaveBeenCalled()
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

  const eventsBody = (destination: string) => ({
    destination,
    events: [{
      type: 'message', replyToken: 'rt-1', source: { type: 'user', userId: 'U1' },
      message: { type: 'text', text: 'เล่น' },
    }],
  })

  it('destination ที่ไม่รู้จัก (ไม่มีบัญชีไหนผูก bot user id นี้ไว้) → 401 ไม่ประมวลผล event', async () => {
    const response = await POST(signedRequest(eventsBody('unknown-bot-user-id')))
    expect(response.status).toBe(401)
    expect(readChannelSecret).not.toHaveBeenCalled()
    expect(replyMessage).not.toHaveBeenCalled()
  })

  it('ไม่มี destination เลยแต่มี event จริง → 401 (หา channel ไม่ได้เพื่อเลือกกุญแจมาตรวจ)', async () => {
    const response = await POST(signedRequest({ events: eventsBody(KNOWN_DESTINATION).events }))
    expect(response.status).toBe(401)
    expect(findChannelByBotUserId).not.toHaveBeenCalled()
  })

  it('rejects a request signed with the wrong secret ของบัญชีที่ destination ชี้ไป', async () => {
    const response = await POST(signedRequest(eventsBody(KNOWN_DESTINATION), 'wrong-secret'))
    expect(response.status).toBe(401)
    expect(replyMessage).not.toHaveBeenCalled()
  })

  it('rejects a request with no signature header', async () => {
    const request = new Request('https://example.com/api/line/webhook', {
      method: 'POST',
      body: JSON.stringify(eventsBody(KNOWN_DESTINATION)),
    })
    expect((await POST(request)).status).toBe(401)
  })

  /**
   * คุณสมบัติด้านความปลอดภัยตัวจริงของฟีเจอร์นี้: ลายเซ็นที่ถูกต้องของบัญชีหนึ่ง
   * ต้องใช้อ้างว่าเป็นอีกบัญชีหนึ่งไม่ได้ — ผู้โจมตีที่รู้ secret ของบัญชี B เอาไปเซ็น
   * payload ที่อ้างว่ามาจาก destination ของบัญชี A (ซึ่งใช้ secret คนละตัว) ต้องถูก
   * ปฏิเสธ เพราะ route ต้องตรวจกับกุญแจของบัญชีที่ destination ชี้ไปเท่านั้น
   * ไม่ใช่กุญแจของใครก็ได้ที่เซ็นมา
   */
  it('ลายเซ็นที่เซ็นด้วยกุญแจบัญชี B แล้วอ้างเป็น destination ของบัญชี A → ถูกปฏิเสธ', async () => {
    readChannelSecret.mockImplementation(async (_sql: unknown, opts: { channelId: string; field: string }) => {
      if (opts.field !== 'secret') return 'test-token'
      return opts.channelId === 'ch-1' ? 'secret-A' : 'secret-B'
    })
    findChannelByBotUserId.mockImplementation(async (_sql: unknown, destination: string) => {
      if (destination === 'dest-A') return { id: 'ch-1', lineChannelId: 'line-a' }
      if (destination === 'dest-B') return { id: 'ch-2', lineChannelId: 'line-b' }
      return null
    })

    // เซ็นด้วย secret-B จริง แต่ตัว body อ้าง destination เป็นบัญชี A
    const response = await POST(signedRequest(eventsBody('dest-A'), 'secret-B'))

    expect(response.status).toBe(401)
    expect(replyMessage).not.toHaveBeenCalled()
  })

  it('ลายเซ็นที่ถูกต้องของบัญชี B เอง (เซ็นด้วย secret-B อ้าง destination B) ผ่านได้ปกติ', async () => {
    readChannelSecret.mockImplementation(async (_sql: unknown, opts: { channelId: string; field: string }) => {
      if (opts.field !== 'secret') return 'test-token'
      return opts.channelId === 'ch-1' ? 'secret-A' : 'secret-B'
    })
    findChannelByBotUserId.mockImplementation(async (_sql: unknown, destination: string) => {
      if (destination === 'dest-A') return { id: 'ch-1', lineChannelId: 'line-a' }
      if (destination === 'dest-B') return { id: 'ch-2', lineChannelId: 'line-b' }
      return null
    })
    liveCampaign = campaignWithEntryMenu()

    const response = await POST(signedRequest(eventsBody('dest-B'), 'secret-B'))

    expect(response.status).toBe(200)
    expect(replyMessage).toHaveBeenCalledOnce()
  })

  it('channel ที่ยังไม่ผูกกุญแจเลย (readChannelSecret โยน) → ถือว่าตรวจไม่ผ่านเหมือนลายเซ็นผิด ไม่ใช่ 500', async () => {
    readChannelSecret.mockRejectedValue(new Error('บัญชีนี้ยังไม่ได้ผูกกุญแจของ LINE'))
    const response = await POST(signedRequest(eventsBody(KNOWN_DESTINATION)))
    expect(response.status).toBe(401)
  })
})

describe('ผูกเมนูตัวเข้าให้ผู้เล่น (route ทำจริง — handle.ts แค่ตัดสินใจ)', () => {
  const messageEvent = (text: string) => ({
    destination: KNOWN_DESTINATION,
    events: [{
      type: 'message', replyToken: 'rt-1', source: { type: 'user', userId: 'U1' },
      message: { type: 'text', text },
    }],
  })

  it('คีย์เวิร์ดที่ยังไม่เคยผูก → ตอบก่อน แล้วเรียกผูกเมนู แล้ว mark ว่าผูกแล้ว', async () => {
    liveCampaign = campaignWithEntryMenu()
    await POST(signedRequest(messageEvent('เล่น')))

    expect(replyMessage).toHaveBeenCalledOnce()
    expect(replyMessage).toHaveBeenCalledWith('test-token', 'rt-1', expect.anything())
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

  /**
   * ผลของ handleEvent สำหรับ follow ตอนปิดข้อความต้อนรับไว้ (greetingEnabled=false ใน
   * campaignWithEntryMenu ด้านบน) คือผูกเมนูอย่างเดียว ไม่มี message/replyToken เลย —
   * route ต้องไม่ยิง replyMessage ในเคสนี้ (เช็คด้วย "message" in handled) แต่ยังต้องผูก
   * เมนูให้ตามปกติ เพราะการผูกเมนูตัวเข้าไม่ขึ้นกับว่าเปิดข้อความทักทายไว้หรือไม่
   */
  it('แอดเป็นเพื่อน ปิดการทักทายไว้ แต่มีเมนูตัวเข้า → ผูกเมนูให้โดยไม่ตอบข้อความอะไรเลย', async () => {
    liveCampaign = campaignWithEntryMenu()
    const followEvent = {
      destination: KNOWN_DESTINATION,
      events: [{
        type: 'follow', replyToken: 'rt-1', source: { type: 'user', userId: 'U1' },
      }],
    }

    await POST(signedRequest(followEvent))

    expect(replyMessage).not.toHaveBeenCalled()
    expect(linkRichMenu).toHaveBeenCalledWith('test-token', 'U1', 'line-rm-entry')
    expect(markRichMenuLinked).toHaveBeenCalledWith('p-1')
  })
})
