// lib/db/quizGroups.ts
import type postgres from 'postgres'
import { loadQuizAnswers } from './quizAnswers'
import type { Queryable } from './client'
import { scoreAnswers, strongestAxis } from '../quiz/engine'
import { evaluateGroupArchetype } from '../quiz/groupEngine'
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

export type QuizGroupMember = { participantId: string; topAxis: string; joinedAt: Date }
export type QuizGroupView = {
  groupId: string
  totalMembers: number
  minMembers: number
  maxMembers: number
  members: QuizGroupMember[]
  result: { code: string; title: string; body: string; imageUrl?: string } | null
  isLocked: boolean
}

/**
 * ผลลัพธ์คำนวณสดจากสมาชิกปัจจุบันทุกครั้งที่เรียก จนกว่าจะถึง resultLocksAt แล้ว
 * "แช่แข็ง" ผลไว้ถาวรใน quiz_group.locked_archetype_code — ตรงกับพฤติกรรมของ
 * getGroup ใน KimLIFF's group.ts ทุกประการ (รวมถึงการที่ endpoint นี้ทำ UPDATE ได้
 * แม้จะเป็น GET ในทาง HTTP ก็ตาม — เขียนแค่ครั้งเดียวตอนข้ามเกณฑ์ล็อกพอดี)
 */
export async function getQuizGroup(
  sql: Queryable, cfg: QuizConfig, activityId: string, groupId: string,
): Promise<QuizGroupView | null> {
  const groupCfg = cfg.group!

  const [group] = await sql<{ id: string; locked_archetype_code: string | null }[]>`
    SELECT id, locked_archetype_code FROM quiz_group WHERE id = ${groupId} AND activity_id = ${activityId}`
  if (!group) return null

  const memberRows = await sql<{ participant_id: string; top_axis: string; axis_scores: Record<string, number>; joined_at: Date }[]>`
    SELECT participant_id, top_axis, axis_scores, joined_at FROM quiz_group_member
     WHERE group_id = ${groupId} ORDER BY joined_at ASC`

  const members = memberRows.map((m) => ({ topAxis: m.top_axis, axisScores: m.axis_scores }))
  const total = memberRows.length

  let archetype = null as ReturnType<typeof evaluateGroupArchetype>
  let isLocked = false

  if (group.locked_archetype_code) {
    isLocked = true
    archetype = groupCfg.archetypes.find((a) => a.code === group.locked_archetype_code) ?? null
  } else {
    archetype = evaluateGroupArchetype(cfg, members)
    if (groupCfg.resultLocksAt > 0 && total >= groupCfg.resultLocksAt && archetype) {
      await sql`UPDATE quiz_group SET locked_archetype_code = ${archetype.code}, locked_at = now() WHERE id = ${groupId}`
      isLocked = true
    }
  }

  return {
    groupId: group.id, totalMembers: total, minMembers: groupCfg.minMembers, maxMembers: groupCfg.maxMembers,
    members: memberRows.map((m) => ({ participantId: m.participant_id, topAxis: m.top_axis, joinedAt: m.joined_at })),
    result: archetype ? { code: archetype.code, title: archetype.title, body: archetype.body, imageUrl: archetype.imageUrl } : null,
    isLocked,
  }
}

/**
 * ทางลัดให้ creator เติมคู่ duo ที่จับคู่สำเร็จแล้วเข้ากลุ่มโดยตรง — ห่อทั้ง loop ใน
 * transaction เดียวและล็อกแถว quiz_group ด้วย FOR UPDATE เหมือน joinQuizGroup ทุก
 * ประการ (ไม่ใช่ "ไม่มีคู่แข่ง concurrent" อย่างที่ดูตอนแรก): creator เรียก endpoint
 * นี้พร้อมๆ กับที่มีคนอื่นกด join ผ่านลิงก์สาธารณะเข้ากลุ่มเดียวกันได้ ทั้งสองทางเขียน
 * ลง quiz_group_member ของกลุ่มเดียวกัน และไม่มี DB-level constraint ไหนคุมจำนวน
 * สมาชิกต่อกลุ่มไว้เลย — ผู้เขียนคนที่สองที่แตะตารางนี้จึงต้องล็อกแถวพ่อแม่แบบเดียวกับ
 * joinQuizGroup ไม่งั้น cap จะรั่วเงียบๆ ภายใต้ concurrency (ประเด็นที่ reviewer ของ
 * Task 4 ชี้ไว้ตรงๆ) เช็คจำนวนสมาชิกสดใหม่ทุกรอบ loop ขณะยังถือ lock อยู่ ก่อน insert
 * แต่ละคู่ — เพื่อให้ join ที่แข่งพร้อมกันถูก serialize กับ transaction นี้จริง
 */
export async function addPairsToQuizGroup(
  sql: postgres.Sql, cfg: QuizConfig, activityId: string, groupId: string,
  creatorParticipantId: string, pairIds: string[],
): Promise<{ added: number }> {
  const groupCfg = cfg.group!

  return sql.begin(async (tx) => {
    const [group] = await tx<{ id: string; created_by: string }[]>`
      SELECT id, created_by FROM quiz_group WHERE id = ${groupId} AND activity_id = ${activityId} FOR UPDATE`
    if (!group) throw new Error('ไม่พบกลุ่มนี้')
    if (group.created_by !== creatorParticipantId) throw new Error('ไม่ใช่ผู้สร้างกลุ่มนี้')

    let added = 0
    for (const pairId of pairIds) {
      const [pair] = await tx<{ participant_a: string; participant_b: string; scores: { a: Record<string, number>; b: Record<string, number> } }[]>`
        SELECT participant_a, participant_b, scores FROM quiz_pair WHERE id = ${pairId} AND activity_id = ${activityId}`
      if (!pair) continue

      let partnerId: string
      let partnerScores: Record<string, number>
      if (pair.participant_a === creatorParticipantId) {
        partnerId = pair.participant_b
        partnerScores = pair.scores.b
      } else if (pair.participant_b === creatorParticipantId) {
        partnerId = pair.participant_a
        partnerScores = pair.scores.a
      } else {
        continue
      }

      const [existing] = await tx`SELECT 1 FROM quiz_group_member WHERE group_id = ${groupId} AND participant_id = ${partnerId}`
      if (existing) continue

      const [{ count }] = await tx<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM quiz_group_member WHERE group_id = ${groupId}`
      if (count >= groupCfg.maxMembers) continue

      const topAxis = strongestAxis(cfg, partnerScores)
      await tx`
        INSERT INTO quiz_group_member (group_id, participant_id, top_axis, axis_scores)
        VALUES (${groupId}, ${partnerId}, ${topAxis}, ${tx.json(partnerScores)})`
      added++
    }

    return { added }
  })
}
