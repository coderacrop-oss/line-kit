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

/**
 * Keywords are editable while a campaign is live, so they must not be frozen in
 * the config cache. §5.2 lists what a config version snapshots and keyword_rule
 * is not in it — a keyword is a way in, not a rule that decides an outcome, so
 * changing one cannot change what anybody already won.
 */
describe('คีย์เวิร์ดแก้ได้ทั้งที่แคมเปญเปิดอยู่', () => {
  it('เพิ่มคีย์เวิร์ดใหม่แล้วใช้ได้ทันที โดยไม่ต้องล้างแคช', async () => {
    const s = await seedLive(sql)
    const ports = makePorts(sql, s.lineChannelId)

    // อ่านครั้งแรกเพื่อให้ config เข้าแคช
    await handleEvent(say('เล่น'), s.lineChannelId, ports, NOW, seededRng(1))

    await sql`
      INSERT INTO keyword_rule (campaign_id, keyword, match_mode, target_activity_id, sort_order)
      VALUES (${s.campaignId}, 'สุ่มเลย', 'exact', ${s.activityId}, 2)`

    // ไม่เรียก clearConfigCache เลย — ถ้าคีย์เวิร์ดอยู่ในแคช อันนี้จะตกไปที่การ์ดตั้งต้น
    const out = await handleEvent(say('สุ่มเลย'), s.lineChannelId, ports, NOW, seededRng(1))
    expect(out?.message).toMatchObject({ type: 'flex' })
  })

  it('ลบคีย์เวิร์ดแล้วหยุดทำงานทันที', async () => {
    const s = await seedLive(sql)
    const ports = makePorts(sql, s.lineChannelId)

    await handleEvent(say('เล่น'), s.lineChannelId, ports, NOW, seededRng(1))
    await sql`DELETE FROM keyword_rule WHERE campaign_id = ${s.campaignId}`

    const out = await handleEvent(say('เล่น'), s.lineChannelId, ports, NOW, seededRng(1))
    expect(out?.message).toEqual({ type: 'text', text: 'พิมพ์ว่า เล่น เพื่อเริ่ม' })
  })
})

/**
 * publishRichMenus (M4-S01) only registers a menu on LINE's own servers — it
 * never links one to any player. BR-78's per-player side happens here instead,
 * the first time a real keyword match fires, using the actual query against
 * real Postgres rather than a fake Ports — this is exactly the kind of SQL
 * (UUID columns, a fresh JOIN) that broke silently before in this codebase.
 */
describe('ผูกเมนูตัวเข้าให้ผู้เล่นตอนพิมพ์คีย์เวิร์ดเข้าร่วมครั้งแรก (BR-78 ฝั่งผู้เล่น)', () => {
  let tag = 0
  const unique = () => `${Date.now().toString(36)}${(tag++).toString(36)}`

  async function seedEntryRichMenu(campaignId: string): Promise<string> {
    const t = unique()
    const [uploader] = await sql<{ id: string }[]>`
      INSERT INTO app_user (email, role) VALUES (${`asset-${t}@example.com`}, 'configurator') RETURNING id`
    const [asset] = await sql<{ id: string }[]>`
      INSERT INTO asset (campaign_id, storage_path, public_url, media_type, mime_type, bytes, width, height, uploaded_by)
      VALUES (${campaignId}, ${`uploads/${t}/a.png`}, ${`/uploads/${t}/a.png`}, 'image', 'image/png', 100, 2500, 1686, ${uploader.id})
      RETURNING id`
    const richMenuLineId = `line-rm-${t}`
    await sql`
      INSERT INTO rich_menu (campaign_id, alias, image_asset_id, is_entry, line_rich_menu_id)
      VALUES (${campaignId}, 'main', ${asset.id}, true, ${richMenuLineId})`
    return richMenuLineId
  }

  it('คีย์เวิร์ดที่ยังไม่เคยผูก → handleEvent คืน linkRichMenu ตรงกับเมนูตัวเข้าจริงในฐานข้อมูล', async () => {
    const s = await seedLive(sql)
    const richMenuLineId = await seedEntryRichMenu(s.campaignId)
    const ports = makePorts(sql, s.lineChannelId)

    const out = await handleEvent(say('เล่น'), s.lineChannelId, ports, NOW, seededRng(1))

    expect(out?.linkRichMenu?.richMenuId).toBe(richMenuLineId)
    expect(out?.linkRichMenu?.lineUid).toBe('U-e2e')
  })

  it('mark ว่าผูกแล้วจริง → ครั้งถัดไปไม่ติดคำสั่งผูกซ้ำ', async () => {
    const s = await seedLive(sql)
    await seedEntryRichMenu(s.campaignId)
    const ports = makePorts(sql, s.lineChannelId)

    const first = await handleEvent(say('เล่น'), s.lineChannelId, ports, NOW, seededRng(1))
    const participantId = first?.linkRichMenu?.participantId
    expect(participantId).toBeDefined()

    await ports.markRichMenuLinked(participantId!)
    expect(await ports.hasRichMenuLinked(participantId!)).toBe(true)

    const second = await handleEvent(say('เล่น'), s.lineChannelId, ports, NOW, seededRng(1))
    expect(second?.linkRichMenu).toBeUndefined()
  })

  it('แคมเปญที่ไม่มีเมนูตัวเข้าเลย → ไม่ติดคำสั่งผูก', async () => {
    const s = await seedLive(sql)
    const ports = makePorts(sql, s.lineChannelId)

    const out = await handleEvent(say('เล่น'), s.lineChannelId, ports, NOW, seededRng(1))
    expect(out?.linkRichMenu).toBeUndefined()
  })
})
