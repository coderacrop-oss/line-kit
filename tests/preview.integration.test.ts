import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type postgres from 'postgres'
import { testDb } from '../lib/db/client'
import { clearConfigCache } from '../lib/db/queries'
import {
  ensurePreviewChannel, loadPreviewSnapshot, resetPreview, runPreviewEvent,
} from '../lib/db/preview'
import { previewLineChannelId } from '../lib/preview/sim'
import { seededRng } from '../lib/test-utils/rng'
import { seedLive } from './helpers/seed-live'

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/linekit_test'
const NOW = new Date('2026-08-17T05:00:00Z')

let sql: postgres.Sql

beforeAll(async () => {
  sql = testDb(url)
  await sql`SELECT 1`
})
beforeEach(() => clearConfigCache())
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

const say = (text: string) => ({ kind: 'text' as const, text })

const play = (campaignId: string, opts: { day?: number; soldOut?: boolean } = {}) =>
  runPreviewEvent(sql, {
    campaignId,
    input: say('เล่น'),
    dayOffset: opts.day ?? 0,
    stock: opts.soldOut ? 'sold_out' : 'as_configured',
    now: NOW,
    rng: seededRng(1),
  })

const said = (message: unknown) => JSON.stringify(message)

/** id ของช่องจริงที่ seedLive สร้าง · ทุกเทสต์ผูกเงื่อนไขไว้กับของตัวเองเท่านั้น */
async function realChannelId(lineChannelId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM channel WHERE line_channel_id = ${lineChannelId}`
  return row.id
}

describe('ช่องของชั้นตัวอย่าง', () => {
  it('สร้างเป็นชนิด preview และไม่มีกุญแจของ LINE อยู่ในนั้นเลย', async () => {
    const s = await seedLive(sql)
    const { channelId } = await ensurePreviewChannel(sql, s.campaignId)

    const [row] = await sql<{
      channel_type: string; encrypted_token: string | null; encrypted_secret: string | null
      line_channel_id: string
    }[]>`
      SELECT channel_type, encrypted_token, encrypted_secret, line_channel_id
        FROM channel WHERE id = ${channelId}`

    expect(row.channel_type).toBe('preview')
    expect(row.encrypted_token).toBe(null)
    expect(row.encrypted_secret).toBe(null)
    expect(row.line_channel_id).toBe(previewLineChannelId(s.campaignId))
  })

  it('เปิดจอซ้ำไม่ได้ช่องใหม่ — ไม่งั้นผู้เล่นจำลองหายทุกครั้งที่รีเฟรช', async () => {
    const s = await seedLive(sql)
    const first = await ensurePreviewChannel(sql, s.campaignId)
    const second = await ensurePreviewChannel(sql, s.campaignId)
    expect(second.channelId).toBe(first.channelId)
  })

  it('ไม่ใช่ช่องจริงของแคมเปญ แม้แคมเปญจะส่งขึ้นช่องจริงไปแล้ว', async () => {
    const s = await seedLive(sql)
    const { channelId } = await ensurePreviewChannel(sql, s.campaignId)
    expect(channelId).not.toBe(await realChannelId(s.lineChannelId))
  })
})

/**
 * สิ่งที่จอนี้ต้องเป็น — เส้นทางเดียวกับที่ผู้เล่นจริงเดิน
 *
 * Every assertion below goes through runPreviewEvent, which builds Ports with
 * the same makePorts the webhook route uses and hands them to the same
 * handleEvent. Nothing in the preview knows what a weighted draw is or what
 * "played today" means. If these pass while lib/engine says something else,
 * one of the two is not being run.
 */
describe('ทดลองเล่นเดินทางเดียวกับผู้เล่นจริง', () => {
  it('พิมพ์คีย์เวิร์ดแล้วได้การ์ดที่ตั้งไว้', async () => {
    const s = await seedLive(sql)
    const out = await play(s.campaignId)
    expect(said(out.message)).toContain('คุณได้รางวัล')
  })

  it('แก้ข้อความบนการ์ดแล้วเห็นผลทันที ไม่ต้องรีสตาร์ต', async () => {
    const s = await seedLive(sql)
    expect(said((await play(s.campaignId)).message)).toContain('คุณได้รางวัล')

    await sql`
      UPDATE card_block SET content = 'แก้กลางคัน'
       WHERE card_id = ${s.cardIds.win} AND block_type = 'body'`

    // วันใหม่ เพราะวันเดิมจะได้ผลเดิมจาก play_lock ตาม BR-32 ไม่ใช่การ์ดที่วาดใหม่
    expect(said((await play(s.campaignId, { day: 1 })).message)).toContain('แก้กลางคัน')
  })

  /**
   * การ์ดตั้งต้นกับการ์ดทักทายเป็นคอลัมน์ของช่อง ไม่ใช่ของแคมเปญ
   *
   * A preview channel made from nothing has neither, and the simulator would
   * then answer "ระบบขัดข้องชั่วคราว" to every unmatched message and say nothing
   * at all to a new follower — while the live channel answers properly. Those
   * are the two commonest things a player does, so getting them wrong here
   * would be the preview lying about the majority of its traffic.
   */
  it('พิมพ์คำที่ไม่ตรงคีย์เวิร์ดได้การ์ดตั้งต้นของช่องจริง', async () => {
    const s = await seedLive(sql)
    const out = await runPreviewEvent(sql, {
      campaignId: s.campaignId, input: say('อะไรก็ไม่รู้'),
      dayOffset: 0, stock: 'as_configured', now: NOW, rng: seededRng(1),
    })
    expect(said(out.message)).toContain('พิมพ์ว่า เล่น เพื่อเริ่ม')
  })

  it('แอดเป็นเพื่อนได้การ์ดทักทายของช่องจริง', async () => {
    const s = await seedLive(sql)
    const out = await runPreviewEvent(sql, {
      campaignId: s.campaignId, input: { kind: 'follow' },
      dayOffset: 0, stock: 'as_configured', now: NOW, rng: seededRng(1),
    })
    expect(said(out.message)).toContain('ยินดีต้อนรับ')
  })

  it('แก้การ์ดตั้งต้นที่ช่องจริงแล้วเปิดจอใหม่ ชั้นตัวอย่างตามไปด้วย', async () => {
    const s = await seedLive(sql)
    await ensurePreviewChannel(sql, s.campaignId)

    const [card] = await sql<{ id: string }[]>`
      INSERT INTO card (campaign_id, code, render_as)
      VALUES (${s.campaignId}, 'other_default', 'text') RETURNING id`
    await sql`
      INSERT INTO card_block (card_id, block_type, sort_order, content)
      VALUES (${card.id}, 'body', 0, 'ทักทายแบบใหม่')`
    await sql`
      UPDATE channel SET default_card_id = ${card.id}
       WHERE line_channel_id = ${s.lineChannelId}`

    const out = await runPreviewEvent(sql, {
      campaignId: s.campaignId, input: say('อะไรก็ไม่รู้'),
      dayOffset: 0, stock: 'as_configured', now: NOW, rng: seededRng(1),
    })
    expect(said(out.message)).toContain('ทักทายแบบใหม่')
  })
})

/**
 * ปุ่มข้ามวัน — ตัวที่ทำให้กติกา "วันละครั้ง" ทดสอบได้ภายในนาทีเดียว
 *
 * Without it a seven-day streak takes seven days to check, which means nobody
 * checks it. The assertion is not that a button exists; it is that the same
 * player, same activity, same config, gets a different answer on the other side
 * of midnight.
 */
describe('ปุ่มข้ามวัน', () => {
  it('เล่นซ้ำในวันเดียวกันโดนกติกาวันละครั้งกั้น', async () => {
    const s = await seedLive(sql, { oncePerDay: true })
    expect(said((await play(s.campaignId)).message)).toContain('คุณได้รางวัล')
    expect(said((await play(s.campaignId)).message)).toContain('วันนี้เล่นแล้ว')
  })

  it('ข้ามวันแล้วเล่นได้อีกครั้ง', async () => {
    const s = await seedLive(sql, { oncePerDay: true })
    await play(s.campaignId)
    expect(said((await play(s.campaignId, { day: 1 })).message)).toContain('คุณได้รางวัล')
  })

  it('ข้ามเจ็ดวันแล้วเล่นได้ครบเจ็ดครั้ง — การสะสมทั้งสัปดาห์จบในนาทีเดียว', async () => {
    const s = await seedLive(sql, { oncePerDay: true })
    for (let day = 0; day < 7; day++) {
      expect(said((await play(s.campaignId, { day })).message), `วันที่ ${day + 1}`)
        .toContain('คุณได้รางวัล')
    }

    const [row] = await sql<{ play_count: number }[]>`
      SELECT play_count FROM participant_activity
       WHERE activity_id = ${s.activityId}`
    expect(row.play_count).toBe(7)
  })

  it('ข้ามวันโดยไม่เล่นแล้วกลับมาเล่น — จำนวนครั้งไม่ได้เพิ่มตามวันที่ผ่านไป (ขาดวัน)', async () => {
    const s = await seedLive(sql, { oncePerDay: true })
    await play(s.campaignId, { day: 0 })
    await play(s.campaignId, { day: 3 })

    const [row] = await sql<{ play_count: number }[]>`
      SELECT play_count FROM participant_activity WHERE activity_id = ${s.activityId}`
    expect(row.play_count).toBe(2)
  })
})

/**
 * การแยกด้วยโครงสร้าง ไม่ใช่การกรอง
 *
 * Every row a play writes hangs off participant_id, and a participant hangs off
 * one channel. The simulated player sits on a channel of type preview, so a
 * report that starts from the real channel has nowhere to walk to reach them —
 * there is no WHERE clause anywhere that has to remember to leave them out, and
 * therefore none that can be forgotten.
 */
describe('ข้อมูลชั้นตัวอย่างไปโผล่ในรายงานของชั้นจริงไม่ได้', () => {
  it('ผู้เล่นจำลองไม่ได้อยู่ในช่องจริง', async () => {
    const s = await seedLive(sql)
    await play(s.campaignId)

    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM participant
       WHERE channel_id = ${await realChannelId(s.lineChannelId)}`
    expect(row.count).toBe(0)
  })

  it('เหตุการณ์ที่จำลองไม่เข้ารายงานที่นับจากช่องจริง', async () => {
    const s = await seedLive(sql)
    await play(s.campaignId)

    const countFor = async (lineChannelId: string) => {
      const [row] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count
          FROM event_log el
          JOIN participant p ON p.id = el.participant_id
          JOIN channel ch ON ch.id = p.channel_id
         WHERE ch.line_channel_id = ${lineChannelId}`
      return row.count
    }

    expect(await countFor(s.lineChannelId)).toBe(0)
    expect(await countFor(previewLineChannelId(s.campaignId))).toBeGreaterThan(0)
  })

  it('สิทธิ์รางวัลที่จำลองไม่เข้ารายงานที่นับจากช่องจริง', async () => {
    const s = await seedLive(sql)
    await play(s.campaignId)

    const [real] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
        FROM entitlement e
        JOIN participant p ON p.id = e.participant_id
       WHERE p.channel_id = ${await realChannelId(s.lineChannelId)}`
    expect(real.count).toBe(0)

    const snapshot = await loadPreviewSnapshot(sql, s.campaignId)
    expect(snapshot.entitlements.map((e) => e.code)).toContain('sticker')
  })
})

/**
 * โควตาไม่ใช่ของที่ผูกกับผู้เล่น มันผูกกับแคมเปญ
 *
 * reward.issued_count and reward_code.assigned_to sit on the campaign's own
 * rows, which the preview shares with the live tier — the channel separation
 * does not reach them. Ten rehearsals of a ten-piece reward would hand the
 * screen "หมดแล้ว" for ten real customers. So the simulator takes the campaign's
 * reward rows FOR UPDATE, runs the real play, and puts the stock back before it
 * commits: a real play cannot interleave, and the preview leaves the count as
 * it found it.
 */
describe('การเล่นจำลองไม่กินโควตาของจริง', () => {
  it('จำนวนที่ออกไปแล้วเท่าเดิมหลังเล่นจำลอง', async () => {
    const s = await seedLive(sql)
    const issued = async () => {
      const [row] = await sql<{ issued_count: number }[]>`
        SELECT issued_count FROM reward WHERE campaign_id = ${s.campaignId} AND code = 'sticker'`
      return row.issued_count
    }

    const before = await issued()
    expect(said((await play(s.campaignId)).message)).toContain('คุณได้รางวัล')
    expect(await issued()).toBe(before)
  })

  it('แต่ผู้เล่นจำลองยังถือสิทธิ์นั้นอยู่จริง จะได้ทดสอบการ์ดที่ขึ้นกับสิทธิ์ต่อได้', async () => {
    const s = await seedLive(sql)
    await play(s.campaignId)
    const snapshot = await loadPreviewSnapshot(sql, s.campaignId)
    expect(snapshot.entitlements.map((e) => e.code)).toEqual(['sticker'])
  })

  it('รหัสในคลังไม่ถูกจองออกไปให้ผู้เล่นจำลอง', async () => {
    const s = await seedLive(sql)
    const [reward] = await sql<{ id: string }[]>`
      UPDATE reward SET reward_type = 'code', value = NULL
       WHERE campaign_id = ${s.campaignId} AND code = 'sticker' RETURNING id`
    await sql`
      INSERT INTO reward_code (reward_id, code_value) VALUES (${reward.id}, 'CODE-0001')`

    await play(s.campaignId)

    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM reward_code
       WHERE reward_id = ${reward.id} AND assigned_to IS NOT NULL`
    expect(row.count).toBe(0)
  })
})

/**
 * สถานะที่เกิดยาก (BR-83)
 *
 * "What does a player see when the last prize has gone" is a question worth
 * answering before the last prize goes. Reaching it for real means giving away
 * the whole quota, so the simulator sets the campaign's stock to spent inside
 * the same transaction it restores it in.
 */
describe('สลับดูสถานะที่เกิดยาก', () => {
  it('รางวัลหมด → ได้การ์ดสำรองแทน (BR-31)', async () => {
    const s = await seedLive(sql)
    const out = await play(s.campaignId, { soldOut: true })
    expect(said(out.message)).toContain('ของรางวัลหมดแล้ว')
  })

  it('ดูสถานะรางวัลหมดแล้ว โควตาจริงกลับมาเท่าเดิม', async () => {
    const s = await seedLive(sql)
    await play(s.campaignId, { soldOut: true })

    const [row] = await sql<{ quota: number | null; issued_count: number }[]>`
      SELECT quota, issued_count FROM reward
       WHERE campaign_id = ${s.campaignId} AND code = 'sticker'`
    expect(row.quota).toBe(100)
    expect(row.issued_count).toBe(0)
  })

  it('สลับกลับมาโหมดปกติแล้วได้รางวัลตามเดิม', async () => {
    const s = await seedLive(sql)
    await play(s.campaignId, { soldOut: true })
    expect(said((await play(s.campaignId, { day: 1 })).message)).toContain('คุณได้รางวัล')
  })
})

describe('ปุ่มเริ่มใหม่', () => {
  it('ลบผู้เล่นจำลองพร้อมทุกอย่างที่เขาสะสมไว้', async () => {
    const s = await seedLive(sql)
    await play(s.campaignId)
    expect((await loadPreviewSnapshot(sql, s.campaignId)).entitlements.length).toBe(1)

    await resetPreview(sql, s.campaignId)
    expect((await loadPreviewSnapshot(sql, s.campaignId)).entitlements).toEqual([])
  })

  it('เริ่มใหม่แล้วกติกาวันละครั้งก็เริ่มใหม่ด้วย', async () => {
    const s = await seedLive(sql, { oncePerDay: true })
    await play(s.campaignId)
    await resetPreview(sql, s.campaignId)
    expect(said((await play(s.campaignId)).message)).toContain('คุณได้รางวัล')
  })

  it('ไม่ได้ลบช่องตัวอย่างทิ้ง — ลบแล้วประวัติของช่องอื่นจะพลอยหายไปด้วย', async () => {
    const s = await seedLive(sql)
    const { channelId } = await ensurePreviewChannel(sql, s.campaignId)
    await resetPreview(sql, s.campaignId)

    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM channel WHERE id = ${channelId}`
    expect(row.count).toBe(1)
  })
})

describe('แผงสถานะผู้เล่นจำลอง', () => {
  it('ค่าสะสมของแคมเปญขึ้นครบ แม้ผู้เล่นยังไม่เคยแตะตัวไหนเลย', async () => {
    const s = await seedLive(sql)
    await sql`
      INSERT INTO counter (campaign_id, code, name, mode, target)
      VALUES (${s.campaignId}, 'stamp', 'แสตมป์', 'accumulate', 7)`

    const snapshot = await loadPreviewSnapshot(sql, s.campaignId)
    expect(snapshot.counters).toEqual([{ code: 'stamp', name: 'แสตมป์', value: 0, target: 7 }])
  })

  it('ยังไม่เคยเล่นก็ยังตอบได้ว่าไม่มีอะไร ไม่ใช่ล้ม', async () => {
    const s = await seedLive(sql)
    const snapshot = await loadPreviewSnapshot(sql, s.campaignId)
    expect(snapshot.attributes).toEqual([])
    expect(snapshot.entitlements).toEqual([])
  })
})
