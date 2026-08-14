import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { listCampaigns, loadCampaign } from '../lib/db/campaigns'
import { testDb } from '../lib/db/client'
import { seed } from './helpers/seed'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})

afterAll(async () => { await sql?.end({ timeout: 5 }) })

let unique = 0
// สุ่มต่อท้ายด้วยเหตุผลเดียวกับ seed() — ไฟล์เทสต์คนละไฟล์อยู่คนละ worker
const tag = () =>
  `t${Date.now().toString(36)}${(unique++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

async function makeCampaign(
  userId: string,
  opts: { status?: 'draft' | 'published' | 'closed'; startAt?: string; endAt?: string } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO campaign (name, code, status, start_at, end_at, created_by)
    VALUES ('Extra', ${tag()}, ${opts.status ?? 'draft'},
            ${opts.startAt ?? '2026-01-01T00:00:00Z'},
            ${opts.endAt ?? '2026-12-01T00:00:00Z'}, ${userId})
    RETURNING id`
  return row.id
}

const find = (rows: Awaited<ReturnType<typeof listCampaigns>>, id: string) => {
  const row = rows.find((r) => r.id === id)
  if (!row) throw new Error(`campaign ${id} missing from the list`)
  return row
}

/**
 * The list query against a real schema.
 *
 * summarize() is unit tested, so what is left here is the half a pure function
 * cannot check: that the column names exist, that the joins find the row they
 * are meant to find, and that the counts arrive as numbers rather than as the
 * strings postgres hands back for a bigint.
 */
describe('listCampaigns · ฐานข้อมูลจริง', () => {
  it('เห็นแคมเปญที่เพิ่งสร้าง พร้อมจำนวนกิจกรรมและชื่อบัญชีที่ผูกไว้', async () => {
    const s = await seed(sql)
    const row = find(await listCampaigns(sql, new Date()), s.campaignId)

    expect(row.name).toBe('Seed')
    expect(row.activityCount).toBe(1)
    expect(row.channelName).toBe('Seed preview')
  })

  it('จำนวนกิจกรรมเป็นตัวเลข ไม่ใช่สตริงที่ postgres คืนมาสำหรับ bigint', async () => {
    const s = await seed(sql)
    const row = find(await listCampaigns(sql, new Date()), s.campaignId)

    expect(typeof row.activityCount).toBe('number')
  })

  it('แคมเปญที่ยังไม่ผูกบัญชี คืน null ไม่ใช่ทำให้แถวหายไปทั้งแถว', async () => {
    const s = await seed(sql)
    const lonely = await makeCampaign(s.userId)
    const row = find(await listCampaigns(sql, new Date()), lonely)

    expect(row.channelName).toBeNull()
    expect(row.activityCount).toBe(0)
  })

  // BR-68 ให้ OA หนึ่งบัญชีรันแคมเปญได้ทีละหนึ่ง แถวที่ยังไม่ส่งขึ้นจึงไม่ใช่ชื่อบัญชีของแคมเปญนี้
  it('ผูกบัญชีไว้แต่ยังไม่ส่งขึ้น ยังไม่นับว่าเป็นบัญชีของแคมเปญนี้', async () => {
    const s = await seed(sql)
    const pending = await makeCampaign(s.userId)
    const [channel] = await sql<{ id: string }[]>`
      INSERT INTO channel (name, channel_type, created_by)
      VALUES ('OA ที่ยังไม่ส่งขึ้น', 'preview', ${s.userId}) RETURNING id`
    await sql`
      INSERT INTO campaign_channel (campaign_id, channel_id, is_published)
      VALUES (${pending}, ${channel.id}, false)`

    expect(find(await listCampaigns(sql, new Date()), pending).channelName).toBeNull()
  })

  // ร่างสองตัวคร่อมวันจบของตัวที่ส่งขึ้นแล้ว — เรียงตามวันจบเพียงอย่างเดียว
  // ไม่ว่าจะขึ้นหรือลง จะดันร่างตัวใดตัวหนึ่งขึ้นมาก่อนเสมอ
  it('แคมเปญที่ส่งขึ้นแล้วมาก่อนแคมเปญร่างเสมอ ไม่ว่าวันจบจะเป็นเมื่อไร', async () => {
    const s = await seed(sql)
    const earlier = await makeCampaign(s.userId, { status: 'draft', endAt: '2026-03-01T00:00:00Z' })
    const live = await makeCampaign(s.userId, { status: 'published', endAt: '2026-06-01T00:00:00Z' })
    const later = await makeCampaign(s.userId, { status: 'draft', endAt: '2026-09-01T00:00:00Z' })

    const rows = await listCampaigns(sql, new Date())
    const at = (id: string) => rows.findIndex((r) => r.id === id)

    expect(at(live)).toBeLessThan(at(earlier))
    expect(at(live)).toBeLessThan(at(later))
  })

  it('แคมเปญที่จบแล้วนับถอยหลังไปที่วันลบข้อมูล ไม่ใช่วันจบ', async () => {
    const s = await seed(sql)
    const done = await makeCampaign(s.userId, {
      status: 'closed', startAt: '2026-01-01T00:00:00Z', endAt: '2026-02-01T00:00:00Z',
    })

    const row = find(await listCampaigns(sql, new Date('2026-02-15T00:00:00Z')), done)
    expect(row.daysLeft).toBeNull()
    expect(row.purgeInDays).toBe(16)
  })
})

describe('loadCampaign · ฐานข้อมูลจริง', () => {
  it('อ่านค่าที่หน้าตั้งค่าต้องใช้ครบ', async () => {
    const s = await seed(sql)
    const found = await loadCampaign(sql, s.campaignId)

    expect(found).toMatchObject({
      id: s.campaignId, name: 'Seed', status: 'draft',
      timezone: 'Asia/Bangkok', dayLengthSec: 86400, hasPlays: false,
    })
    expect(found?.startAt).toBeInstanceOf(Date)
    expect(found?.endAt).toBeInstanceOf(Date)
  })

  it('id ที่ไม่มีอยู่ คืน null ไม่ใช่โยน', async () => {
    expect(await loadCampaign(sql, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  // ความยาววันเป็นค่าเดียวในหน้านี้ที่แก้แล้วกระทบคนที่กำลังรออยู่ตอนนั้น
  it('มีคนเล่นไปแล้วรู้ได้ — เป็นเงื่อนไขของคำเตือนตอนแก้ความยาววัน', async () => {
    const s = await seed(sql)
    await sql`
      INSERT INTO play_lock (participant_id, activity_id, period_key, play_token, result)
      VALUES (${s.participantIds[0]}, ${s.activityId}, '2026-08-14', ${`pl-${tag()}`}, '{}'::jsonb)`

    expect((await loadCampaign(sql, s.campaignId))?.hasPlays).toBe(true)
  })

  it('ธีมที่ยังไม่ได้ตั้ง คืน null ไม่ใช่สีที่หน้าจอเดาเอง', async () => {
    const s = await seed(sql)
    expect((await loadCampaign(sql, s.campaignId))?.themePrimary).toBeNull()

    await sql`UPDATE campaign SET theme = '{"primary":"#123456"}'::jsonb WHERE id = ${s.campaignId}`
    expect((await loadCampaign(sql, s.campaignId))?.themePrimary).toBe('#123456')
  })
})
