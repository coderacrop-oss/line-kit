// lib/db/quizGroups.ts
import type postgres from 'postgres'
import { loadQuizAnswers } from './quizAnswers'
import { scoreAnswers, strongestAxis } from '../quiz/engine'
import type { QuizConfig } from '../quiz/schema'

/**
 * สร้างกลุ่มใหม่ ใส่ creator เป็นสมาชิกคนแรกในธุรกรรมเดียว — คะแนนของ creator
 * แช่แข็ง (snapshot) ตอนนี้เลย ตรงกับพฤติกรรม quiz_pair.scores ของ duo (lib/db/quizPairs.ts)
 */
export async function createQuizGroup(
  sql: postgres.Sql, cfg: QuizConfig, activityId: string, creatorParticipantId: string,
): Promise<{ groupId: string }> {
  const answers = await loadQuizAnswers(sql, activityId, creatorParticipantId)
  if (answers.length === 0) throw new Error('ยังไม่ได้ตอบควิซ')

  const scores = scoreAnswers(cfg, answers)
  const topAxis = strongestAxis(cfg, scores)

  return sql.begin(async (tx) => {
    const [group] = await tx<{ id: string }[]>`
      INSERT INTO quiz_group (activity_id, created_by) VALUES (${activityId}, ${creatorParticipantId})
      RETURNING id`
    await tx`
      INSERT INTO quiz_group_member (group_id, participant_id, top_axis, axis_scores)
      VALUES (${group.id}, ${creatorParticipantId}, ${topAxis}, ${tx.json(scores)})`
    return { groupId: group.id }
  })
}

/**
 * เข้ากลุ่มผ่านลิงก์ — ล็อกแถว quiz_group ด้วย FOR UPDATE ก่อนนับสมาชิก กัน race ที่สอง
 * request join พร้อมกันตอนกลุ่มเหลือที่ 1 ที่นั่งสุดท้ายจะนับผ่านทั้งคู่แล้วเกิน max_members
 * (ไม่มี unique index ให้พึ่งแบบ matchQuizPair — ที่นี่ "เต็มหรือยัง" ต้องนับสมาชิกจริง
 * จึงต้องล็อกแถวพ่อแม่ให้ transaction ที่สองรอ transaction แรก commit ก่อนแล้วค่อยนับ)
 */
export async function joinQuizGroup(
  sql: postgres.Sql, cfg: QuizConfig, activityId: string, groupId: string, participantId: string,
): Promise<{ ok: true }> {
  const groupCfg = cfg.group!
  const answers = await loadQuizAnswers(sql, activityId, participantId)
  if (answers.length === 0) throw new Error('ยังไม่ได้ตอบควิซ')

  const scores = scoreAnswers(cfg, answers)
  const topAxis = strongestAxis(cfg, scores)

  return sql.begin(async (tx) => {
    const [group] = await tx<{ id: string }[]>`
      SELECT id FROM quiz_group WHERE id = ${groupId} AND activity_id = ${activityId} FOR UPDATE`
    if (!group) throw new Error('ไม่พบกลุ่มนี้')

    const [existing] = await tx`
      SELECT 1 FROM quiz_group_member WHERE group_id = ${groupId} AND participant_id = ${participantId}`
    if (existing) return { ok: true as const }

    const [{ count }] = await tx<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM quiz_group_member WHERE group_id = ${groupId}`
    if (count >= groupCfg.maxMembers) throw new Error('กลุ่มนี้เต็มแล้ว')

    await tx`
      INSERT INTO quiz_group_member (group_id, participant_id, top_axis, axis_scores)
      VALUES (${groupId}, ${participantId}, ${topAxis}, ${tx.json(scores)})`
    return { ok: true as const }
  })
}
