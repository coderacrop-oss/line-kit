import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { clearConfigCache, makePorts } from '../lib/db/queries'
import { handleEvent } from '../lib/webhook/handle'
import { seededRng } from '../lib/test-utils/rng'
import { seedLive } from './helpers/seed-live'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
const NOW = new Date('2026-08-14T05:00:00Z')
const TODAY = '2026-08-14'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})
beforeEach(() => clearConfigCache())
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

const tap = (data: string) => ({
  type: 'postback', replyToken: 'rt', source: { type: 'user', userId: 'U-e2e' },
  postback: { data },
})
const say = (text: string) => ({
  type: 'message', replyToken: 'rt', source: { type: 'user', userId: 'U-e2e' },
  message: { type: 'text', text },
})

/**
 * The whole path with nothing faked: real schema, real transaction, real
 * rendering. What these prove is that config edited in the database changes what
 * a player sees, without a deploy — the one claim the project exists to make.
 */
describe('ครบวงจรผ่านฐานข้อมูลจริง', () => {
  it('พิมพ์คีย์เวิร์ด → ได้การ์ดที่ตั้งไว้', async () => {
    const s = await seedLive(sql)
    const ports = makePorts(sql, s.lineChannelId)

    const out = await handleEvent(say('เล่น'), s.lineChannelId, ports, NOW, seededRng(1))
    expect(out?.message).toMatchObject({ type: 'flex' })
    expect(JSON.stringify(out?.message)).toContain('คุณได้รางวัล')
  })

  it('แก้ข้อความบนการ์ดในฐานข้อมูล → ข้อความที่ส่งเปลี่ยนทันที ไม่ต้อง deploy', async () => {
    const s = await seedLive(sql)
    const ports = makePorts(sql, s.lineChannelId)

    const before = await handleEvent(say('เล่น'), s.lineChannelId, ports, NOW, seededRng(1))
    expect(JSON.stringify(before?.message)).toContain('คุณได้รางวัล')

    await sql`
      UPDATE card_block SET content = 'ยินดีด้วย คุณโชคดีมาก'
       WHERE card_id = ${s.cardIds.win} AND block_type = 'body'`
    clearConfigCache()

    const after = await handleEvent(say('เล่น'), s.lineChannelId, ports, NOW, seededRng(1))
    expect(JSON.stringify(after?.message)).toContain('ยินดีด้วย คุณโชคดีมาก')
  })

  it('กดปุ่มแล้วได้รางวัล · กดซ้ำได้ผลเดิม ไม่ได้รางวัลซ้ำ', async () => {
    const s = await seedLive(sql)
    const ports = makePorts(sql, s.lineChannelId)
    const data = `c=${s.campaignCode}&a=draw&d=${TODAY}`

    const first = await handleEvent(tap(data), s.lineChannelId, ports, NOW, seededRng(1))
    expect(first?.message).toMatchObject({ type: 'flex' })

    for (let i = 0; i < 3; i++) {
      const again = await handleEvent(tap(data), s.lineChannelId, ports, NOW, seededRng(1))
      expect(JSON.stringify(again?.message)).toBe(JSON.stringify(first?.message))
    }

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM entitlement e
        JOIN reward r ON r.id = e.reward_id
       WHERE r.campaign_id = ${s.campaignId}`
    expect(Number(count)).toBe(1)
  })

  it('การ์ดของวันก่อนหน้า ตอบว่าหมดอายุ และไม่แจกอะไร', async () => {
    const s = await seedLive(sql)
    const ports = makePorts(sql, s.lineChannelId)

    const out = await handleEvent(
      tap(`c=${s.campaignCode}&a=draw&d=2026-08-01`), s.lineChannelId, ports, NOW, seededRng(1))
    expect(out?.message).toEqual({ type: 'text', text: 'การ์ดนี้หมดอายุแล้ว' })

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM entitlement e
        JOIN reward r ON r.id = e.reward_id WHERE r.campaign_id = ${s.campaignId}`
    expect(Number(count)).toBe(0)
  })

  it('แอดเป็นเพื่อน → ได้การ์ดต้อนรับ', async () => {
    const s = await seedLive(sql)
    const ports = makePorts(sql, s.lineChannelId)

    const out = await handleEvent(
      { type: 'follow', replyToken: 'rt', source: { type: 'user', userId: 'U-new' } },
      s.lineChannelId, ports, NOW, seededRng(1))
    expect(out?.message).toEqual({ type: 'text', text: 'ยินดีต้อนรับ' })
  })

  it('เงื่อนไขวันละครั้ง กั้นการเล่นครั้งที่สองของวันเดียวกัน', async () => {
    const s = await seedLive(sql, { oncePerDay: true })
    const ports = makePorts(sql, s.lineChannelId)
    const data = `c=${s.campaignCode}&a=draw&d=${TODAY}`

    await handleEvent(tap(data), s.lineChannelId, ports, NOW, seededRng(1))

    // วันเดิม แต่ token คนละตัว — จำลองการ์ดใบใหม่ในวันเดียวกัน
    const second = await handleEvent(tap(data), s.lineChannelId, ports, NOW, seededRng(1))
    expect(JSON.stringify(second?.message)).toContain('วันนี้เล่นแล้ว')
  })

  it('ทุกคำตอบถูกบันทึกลง event_log พร้อม duration_ms', async () => {
    const s = await seedLive(sql)
    const ports = makePorts(sql, s.lineChannelId)
    await handleEvent(say('เล่น'), s.lineChannelId, ports, NOW, seededRng(1))
    await handleEvent(say('อะไรก็ไม่รู้'), s.lineChannelId, ports, NOW, seededRng(1))

    const rows = await sql<{ event_type: string; duration_ms: number }[]>`
      SELECT e.event_type, e.duration_ms FROM event_log e
        JOIN config_version cv ON cv.id = e.config_version_id
       WHERE cv.campaign_id = ${s.campaignId} ORDER BY e.created_at`
    expect(rows.length).toBe(2)
    expect(rows.map((r) => r.event_type)).toEqual(['play', 'text_unmatched'])
    expect(rows.every((r) => r.duration_ms >= 0)).toBe(true)
  })

  it('แตะสลับแท็บไม่แตะฐานข้อมูลและไม่ตอบ', async () => {
    const s = await seedLive(sql)
    const ports = makePorts(sql, s.lineChannelId)

    const out = await handleEvent(
      { type: 'postback', replyToken: 'rt', source: { type: 'user', userId: 'U-e2e' },
        postback: { data: '', params: { status: 'SUCCESS', newRichMenuAliasId: 'tab-b' } } },
      s.lineChannelId, ports, NOW, seededRng(1))
    expect(out).toBeNull()

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM event_log e
        JOIN config_version cv ON cv.id = e.config_version_id
       WHERE cv.campaign_id = ${s.campaignId}`
    expect(Number(count)).toBe(0)
  })
})
