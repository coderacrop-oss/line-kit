// lib/quiz/loadActivity.ts
import type { Queryable } from '../db/client'
import { QuizConfig } from './schema'

/**
 * แปลง (channelId, activityCode) → กิจกรรมควิซของแคมเปญที่ "live" บน LIFF ช่องทางนี้
 * — ต้องผ่าน campaign_channel.is_published เท่านั้น (channel เดียวกันอาจเคยพับลิช
 * แคมเปญเก่าไว้ก็ได้ แต่ที่ live ต้องมีแถวนี้เป็น true) ไม่ใช้ any() หรือ query อื่น
 * เพราะ route ทั้งสองของ Task 7/8 ต้องเห็นกฎเดียวกันเป๊ะๆ ผ่าน helper ตัวนี้ตัวเดียว
 */
export async function loadQuizActivity(
  sql: Queryable, channelId: string, activityCode: string,
): Promise<{ id: string; config: QuizConfig } | null> {
  const [row] = await sql<{ id: string; input_config: unknown }[]>`
    SELECT a.id, a.input_config
      FROM activity a
      JOIN campaign_channel cc ON cc.campaign_id = a.campaign_id
     WHERE cc.channel_id = ${channelId} AND cc.is_published
       AND a.code = ${activityCode} AND a.input_type = 'personality_quiz'`
  if (!row) return null

  const parsed = QuizConfig.parse(row.input_config) // throws → surfaces as 500; a saved-but-invalid config is a bug, not a client error
  return { id: row.id, config: parsed }
}
