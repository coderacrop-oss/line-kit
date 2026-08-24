// lib/quiz/loadActivity.ts
import type { Queryable } from '../db/client'
import { QuizConfig } from './schema'

/**
 * แปลง (channelId, activityCode) → กิจกรรมควิซของแคมเปญที่ "live" บน LIFF ช่องทางนี้
 * — ต้องผ่าน campaign_channel.is_published เท่านั้น (channel เดียวกันอาจเคยพับลิช
 * แคมเปญเก่าไว้ก็ได้ แต่ที่ live ต้องมีแถวนี้เป็น true) ไม่ใช้ any() หรือ query อื่น
 * เพราะ route ทั้งสองของ Task 7/8 ต้องเห็นกฎเดียวกันเป๊ะๆ ผ่าน helper ตัวนี้ตัวเดียว
 *
 * ต้องเช็ค `a.is_enabled` และช่วงวันของแคมเปญ (`start_at`/`end_at`) ด้วย — เหมือนที่
 * lib/db/queries.ts (findLiveCampaign · `WHERE ... AND is_enabled`) และ
 * lib/engine/entry.ts (`ctx.now < campaignStart || ctx.now > campaignEnd`) บังคับกับ
 * ทุกกิจกรรมที่ chat-triggered engine เล่นได้ — ก่อนแก้ตรงนี้ แอดมินปิดกิจกรรมควิซ
 * หรือช่วงแคมเปญหมดอายุแล้ว LIFF ก็ยังรับเล่นต่อได้เรื่อยๆ (Finding 4)
 */
export async function loadQuizActivity(
  sql: Queryable, channelId: string, activityCode: string,
): Promise<{ id: string; config: QuizConfig } | null> {
  const [row] = await sql<{ id: string; input_config: unknown }[]>`
    SELECT a.id, a.input_config
      FROM activity a
      JOIN campaign_channel cc ON cc.campaign_id = a.campaign_id
      JOIN campaign ca ON ca.id = a.campaign_id
     WHERE cc.channel_id = ${channelId} AND cc.is_published
       AND a.code = ${activityCode} AND a.input_type = 'personality_quiz'
       AND a.is_enabled
       AND now() BETWEEN ca.start_at AND ca.end_at`
  if (!row) return null

  const parsed = QuizConfig.parse(row.input_config) // throws → surfaces as 500; a saved-but-invalid config is a bug, not a client error
  return { id: row.id, config: parsed }
}
