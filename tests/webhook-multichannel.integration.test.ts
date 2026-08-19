import { createHmac, randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type postgres from 'postgres'
import { encryptSecret } from '../lib/crypto/secretbox'
import { clearConfigCache } from '../lib/db/queries'
import { testDb } from '../lib/db/client'

/**
 * webhook หนึ่งเส้นทางนี้ตอบได้หลายบัญชี LINE พร้อมกัน (M6-S0x) — เทสต์นี้ยิงใส่
 * app/api/line/webhook/route.ts ตัวจริง ผ่านฐานข้อมูลจริง ไม่ mock lib/db/channels
 * หรือ lib/db/tokens เลย (route.test.ts mock สองตัวนั้นเพื่อทดสอบ flow แยกหน่วย —
 * ที่นี่พิสูจน์ว่า SQL จริง + การเข้ารหัสจริง + ลายเซ็น HMAC จริง ต่อกันได้ถูกต้อง)
 * mock เฉพาะ fetch (ปลายทางจริงคือ api.line.me) และ '@/lib/db/client' ให้ใช้ pool
 * เดียวกับที่เทสต์นี้ seed ข้อมูลเข้าไป
 */
let sql: postgres.Sql

vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/db/client')>()),
  db: () => sql,
}))

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
const fetchMock = vi.fn()

beforeAll(async () => {
  // กุญแจเข้ารหัสของเทสต์สร้างสดทุกครั้ง · ไม่อ่านจาก .env และไม่มีค่าจริงในไฟล์นี้
  process.env.SECRET_KEY_V1 = randomBytes(32).toString('base64')
  sql = testDb(url)
  await sql`SELECT 1`
})

beforeEach(() => {
  clearConfigCache()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

const { POST } = await import('../app/api/line/webhook/route')

let unique = 0
const uid = () => `${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/**
 * บัญชี LINE ที่รันแคมเปญเปิดอยู่จริง หนึ่งบัญชี ครบทุกอย่างที่ webhook ต้องอ่าน:
 * กุญแจเข้ารหัสจริง (ถอดได้ผ่าน readChannelSecret ตัวจริง), destination ของตัวเอง,
 * และคีย์เวิร์ดหนึ่งคำที่ชี้ไปการ์ดข้อความของบัญชีนี้เท่านั้น
 */
async function seedLiveChannel(opts: { keyword: string; replyText: string; secret: string; token: string }) {
  const tag = uid()
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO app_user (email, role) VALUES (${`webhook-mc-${tag}@example.com`}, 'configurator')
    RETURNING id`
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, timezone, start_at, end_at, created_by)
    VALUES (${`multichannel ${tag}`}, ${`mc_${tag}`}, 'Asia/Bangkok',
            now() - interval '2 days', now() + interval '20 days', ${user.id})
    RETURNING id`
  const [card] = await sql<{ id: string }[]>`
    INSERT INTO card (campaign_id, code, render_as) VALUES (${campaign.id}, ${`reply_${tag}`}, 'text')
    RETURNING id`
  await sql`
    INSERT INTO card_block (card_id, block_type, sort_order, content)
    VALUES (${card.id}, 'body', 0, ${opts.replyText})`
  await sql`
    INSERT INTO keyword_rule (campaign_id, keyword, match_mode, target_card_id, sort_order)
    VALUES (${campaign.id}, ${opts.keyword}, 'exact', ${card.id}, 1)`

  const encToken = encryptSecret(opts.token)
  const encSecret = encryptSecret(opts.secret)
  const lineChannelId = `LINE-${tag}`
  const botUserId = `U-bot-${tag}`

  const [channel] = await sql<{ id: string }[]>`
    INSERT INTO channel (
      name, channel_type, line_channel_id, line_bot_user_id,
      encrypted_token, encrypted_secret, token_last4, key_version, created_by)
    VALUES (
      ${`OA multichannel ${tag}`}, 'test', ${lineChannelId}, ${botUserId},
      ${encToken.cipher}, ${encSecret.cipher}, ${opts.token.slice(-4)}, ${encToken.keyVersion}, ${user.id})
    RETURNING id`

  await sql`
    INSERT INTO campaign_channel (campaign_id, channel_id, is_published, published_at)
    VALUES (${campaign.id}, ${channel.id}, true, now())`
  await sql`
    INSERT INTO config_version (campaign_id, version_no, snapshot, channel_id, published_by)
    VALUES (${campaign.id}, 1, '{}'::jsonb, ${channel.id}, ${user.id})`

  return { channelId: channel.id, lineChannelId, botUserId, campaignId: campaign.id, cardId: card.id }
}

function eventsBody(destination: string, text: string) {
  return {
    destination,
    events: [{
      type: 'message', replyToken: `rt-${uid()}`, source: { type: 'user', userId: `U-${uid()}` },
      message: { type: 'text', text },
    }],
  }
}

function signedRequest(body: unknown, secret: string): Request {
  const raw = JSON.stringify(body)
  const signature = createHmac('sha256', secret).update(raw, 'utf8').digest('base64')
  return new Request('https://example.com/api/line/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': signature },
    body: raw,
  })
}

const replyBody = () => JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string) as { messages: Array<{ text?: string }> }
const replyAuth = () => (fetchMock.mock.calls.at(-1)?.[1]?.headers as Record<string, string>).Authorization

describe('webhook หลายบัญชี LINE พร้อมกัน · ผ่านฐานข้อมูลจริง', () => {
  it('สองบัญชี สองแคมเปญ resolve อิสระต่อกัน — คนละกุญแจ คนละการ์ด คนละ token ตอบ', async () => {
    const a = await seedLiveChannel({
      keyword: 'สวัสดีเอ', replyText: 'นี่คือคำตอบของช่อง A', secret: 'secret-of-channel-A', token: 'token-of-channel-A-0001',
    })
    const b = await seedLiveChannel({
      keyword: 'สวัสดีบี', replyText: 'นี่คือคำตอบของช่อง B', secret: 'secret-of-channel-B', token: 'token-of-channel-B-0002',
    })

    const resA = await POST(signedRequest(eventsBody(a.botUserId, 'สวัสดีเอ'), 'secret-of-channel-A'))
    expect(resA.status).toBe(200)
    expect(replyBody().messages[0].text).toBe('นี่คือคำตอบของช่อง A')
    expect(replyAuth()).toBe('Bearer token-of-channel-A-0001')

    const resB = await POST(signedRequest(eventsBody(b.botUserId, 'สวัสดีบี'), 'secret-of-channel-B'))
    expect(resB.status).toBe(200)
    expect(replyBody().messages[0].text).toBe('นี่คือคำตอบของช่อง B')
    expect(replyAuth()).toBe('Bearer token-of-channel-B-0002')

    // สลับกลับไปช่อง A อีกครั้ง (configCache เข้าแคชแล้วจากรอบแรก) ยังต้องได้การ์ด
    // ของ A เหมือนเดิม ไม่ใช่ของ B ที่เพิ่งอ่านล่าสุด — พิสูจน์ configCache ที่คีย์ด้วย
    // config_version_id (UUID ไม่ซ้ำข้ามบัญชี) ไม่ทำให้สองบัญชีที่ live พร้อมกันชนกัน
    const resA2 = await POST(signedRequest(eventsBody(a.botUserId, 'สวัสดีเอ'), 'secret-of-channel-A'))
    expect(resA2.status).toBe(200)
    expect(replyBody().messages[0].text).toBe('นี่คือคำตอบของช่อง A')
    expect(replyAuth()).toBe('Bearer token-of-channel-A-0001')
  })

  /**
   * คุณสมบัติด้านความปลอดภัยตัวจริง: ลายเซ็นที่ถูกต้องสำหรับบัญชี B (เซ็นด้วย secret
   * ของ B จริง) ต้องถูกปฏิเสธเมื่อ body อ้างว่า destination เป็นบัญชี A — เพราะ route
   * ต้องตรวจกับกุญแจของบัญชีที่ destination ชี้ไปเท่านั้น (secret ของ A) ไม่ใช่กุญแจ
   * ของใครก็ตามที่เซ็น payload มา
   */
  it('ลายเซ็นที่ถูกต้องของบัญชี B แต่ปลอมว่า destination เป็นบัญชี A → ถูกปฏิเสธ (401)', async () => {
    const a = await seedLiveChannel({
      keyword: 'คีย์เอ', replyText: 'ตอบจาก A', secret: 'real-secret-A', token: 'real-token-A',
    })
    const b = await seedLiveChannel({
      keyword: 'คีย์บี', replyText: 'ตอบจาก B', secret: 'real-secret-B', token: 'real-token-B',
    })
    void b

    // เซ็นด้วย secret ของ B จริง แต่ตัว body อ้าง destination เป็นของ A
    const forged = signedRequest(eventsBody(a.botUserId, 'คีย์เอ'), 'real-secret-B')
    const response = await POST(forged)

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ลายเซ็นที่ถูกต้องของบัญชี B เอง (เซ็นด้วย secret ของ B อ้าง destination ของ B เอง) ผ่านได้ปกติ — พิสูจน์กรณีปฏิเสธข้างบนไม่ใช่แค่ทุกอย่างพังหมด', async () => {
    const b = await seedLiveChannel({
      keyword: 'คีย์บีจริง', replyText: 'ตอบจาก B ของจริง', secret: 'real-secret-B2', token: 'real-token-B2',
    })

    const response = await POST(signedRequest(eventsBody(b.botUserId, 'คีย์บีจริง'), 'real-secret-B2'))

    expect(response.status).toBe(200)
    expect(replyBody().messages[0].text).toBe('ตอบจาก B ของจริง')
  })

  it('destination ที่ไม่มีบัญชีไหนผูก line_bot_user_id ไว้เลย → 401 ไม่ตอบอะไร', async () => {
    const response = await POST(
      signedRequest(eventsBody(`ไม่มีบัญชีไหนใช้-${uid()}`, 'อะไรก็ได้'), 'some-secret'))

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ลายเซ็นผิดของบัญชีที่มีอยู่จริง (เซ็นด้วยกุญแจอื่นที่ไม่ใช่ของบัญชีนั้นเลย) → 401', async () => {
    const a = await seedLiveChannel({
      keyword: 'คีย์เอ2', replyText: 'ตอบจาก A2', secret: 'real-secret-A2', token: 'real-token-A2',
    })

    const response = await POST(
      signedRequest(eventsBody(a.botUserId, 'คีย์เอ2'), 'ไม่ใช่กุญแจของใครเลย'))

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
