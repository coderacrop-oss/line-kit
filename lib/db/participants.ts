import type { Queryable } from './client'

/**
 * แถวเดียวใน `participant` ต่อ (channel, line_uid) — ใช้ทั้งจาก webhook (คีย์ด้วย
 * line_channel_id ที่ LINE ส่งมา, แปลงเป็น channel.id ก่อนเรียกที่นี่ ดู queries.ts)
 * และจาก LIFF auth (มี channel.id อยู่ในมือแล้วตรงๆ จาก liff_app.channel_id) — คนละ
 * ทางเข้า แต่ INSERT ... ON CONFLICT เดียวกัน จึงเป็น participant แถวเดียวกันเสมอ
 * ไม่ว่าจะคุยกับบอทผ่านแชทหรือผ่าน LIFF (spec §3.1)
 */
export async function ensureParticipantByChannelId(
  sql: Queryable, channelId: string, lineUid: string,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO participant (channel_id, line_uid)
    VALUES (${channelId}, ${lineUid})
    ON CONFLICT (channel_id, line_uid)
      DO UPDATE SET last_seen_at = now()
    RETURNING id`
  return row.id
}
