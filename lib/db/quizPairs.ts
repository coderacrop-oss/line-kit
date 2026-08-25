// lib/db/quizPairs.ts
import type postgres from 'postgres'
import { loadQuizAnswers, saveQuizAnswers } from './quizAnswers'
import type { Queryable } from './client'
import { resolvePair, type Answer } from '../quiz/engine'
import type { QuizConfig } from '../quiz/schema'

export type QuizPair = {
  id: string
  activityId: string
  participantA: string
  participantB: string
  resultCode: string
  scores: { a: Record<string, number>; b: Record<string, number>; combined: Record<string, number> }
  createdAt: Date
}

type QuizPairRow = {
  id: string; activity_id: string; participant_a: string; participant_b: string
  result_code: string; scores: QuizPair['scores']; created_at: Date
}

function toQuizPair(row: QuizPairRow): QuizPair {
  return {
    id: row.id, activityId: row.activity_id, participantA: row.participant_a, participantB: row.participant_b,
    resultCode: row.result_code, scores: row.scores, createdAt: row.created_at,
  }
}

const SELECT_COLUMNS = 'id, activity_id, participant_a, participant_b, result_code, scores, created_at'

export async function findQuizPair(
  sql: Queryable, activityId: string, participantA: string, participantB: string,
): Promise<QuizPair | null> {
  const [row] = await sql<QuizPairRow[]>`
    SELECT ${sql.unsafe(SELECT_COLUMNS)} FROM quiz_pair
     WHERE activity_id = ${activityId} AND participant_a = ${participantA} AND participant_b = ${participantB}`
  return row ? toQuizPair(row) : null
}

export async function listQuizPairsForParticipant(
  sql: Queryable, activityId: string, participantId: string,
): Promise<QuizPair[]> {
  const rows = await sql<QuizPairRow[]>`
    SELECT ${sql.unsafe(SELECT_COLUMNS)} FROM quiz_pair
     WHERE activity_id = ${activityId} AND (participant_a = ${participantId} OR participant_b = ${participantId})
     ORDER BY created_at DESC`
  return rows.map(toQuizPair)
}

/**
 * จับคู่ A+B ให้จริง — ห่อทั้งชุดใน transaction เดียว กัน race ของสอง request
 * join พร้อมกันที่จะจับคู่ครึ่งๆ กลางๆ (บั๊กที่เจอตอน research อ้างอิง เพราะที่นั่น
 * ไม่ได้ห่อด้วย transaction จริง) เช็ค idempotency ก่อนเปิด transaction เสมอ
 * ตาม spec §7 — ถ้ามีคู่นี้อยู่แล้วคืนแถวเดิม ไม่รันธุรกรรมซ้ำ
 *
 * การชนกันของสอง transaction พร้อมกันที่ยังไม่มีแถวอยู่ก่อน อาศัย unique index
 * (activity_id, participant_a, participant_b) เป็นตัวตัดสิน: ตัวที่ INSERT ก่อน
 * ชนะและ commit ปกติ ตัวที่สอง INSERT ชนกับ unique constraint แล้ว Postgres จะ
 * บล็อกรอจนตัวแรก commit แล้วจึงมาลอง ON CONFLICT ต่อ — ใช้ DO UPDATE SET
 * activity_id = EXCLUDED.activity_id (no-op) แทน DO NOTHING เพราะ DO NOTHING
 * จะไม่ยิง RETURNING เลยเมื่อชนกัน ทำให้ transaction ที่แพ้การแข่งไม่มีอะไรคืนให้
 * ผู้เรียก แม้ผลลัพธ์ปลายทางจะถูกต้อง (มีแถวเดียว) ก็ตาม
 *
 * รับ sql เป็น postgres.Sql ไม่ใช่ Queryable ที่กว้างกว่า — เพราะ .begin() มีอยู่
 * เฉพาะบน pool เท่านั้น TransactionSql (อีกฝั่งของ Queryable) ไม่มีให้เปิดซ้อน
 * ตามลวดลายเดียวกับ withBorrowedStock ใน lib/db/preview.ts
 *
 * คืน { pair, created } แทนที่จะคืนแค่ pair เฉยๆ — ผู้เรียก (เช่น route duo/match) ต้อง
 * รู้ว่าคู่นี้ "เพิ่งถูกสร้างจริงในคำขอนี้" หรือ "มีอยู่แล้ว" เพื่อตัดสินใจว่าควร push
 * แจ้งเตือน A ซ้ำหรือไม่ — DB layer นี้ idempotent อยู่แล้ว (คืนแถวเดิมถ้ามีอยู่) แต่ถ้า
 * ผู้เรียกยิง side effect เพิ่ม (push) แบบไม่มีเงื่อนไขทุกครั้งที่ฟังก์ชันนี้ return
 * สำเร็จ ก็จะเสีย idempotency นั้นไปที่ชั้น route แทน — `created` ต้องแม่นแม้ในเคส
 * race ของสอง transaction พร้อมกัน (คอมเมนต์ด้านบน) จึงใช้ `(xmax = 0) AS inserted`
 * แยกแยะ INSERT จริง จาก ON CONFLICT DO UPDATE ที่ถูกบังคับชนกัน — ตัวที่แพ้การแข่ง
 * (ผ่าน DO UPDATE) จะได้ created: false แม้ผ่าน pre-check ตอนต้นมาเหมือนกันก็ตาม
 */
export async function matchQuizPair(
  sql: postgres.Sql, cfg: QuizConfig, activityId: string,
  inviterParticipantId: string, bParticipantId: string, bAnswers: Answer[],
): Promise<{ pair: QuizPair; created: boolean }> {
  if (inviterParticipantId === bParticipantId) {
    throw new Error('จับคู่กับตัวเองไม่ได้')
  }

  const existing = await findQuizPair(sql, activityId, inviterParticipantId, bParticipantId)
  if (existing) return { pair: existing, created: false }

  return sql.begin(async (tx) => {
    const inviterAnswers = await loadQuizAnswers(tx, activityId, inviterParticipantId)
    if (inviterAnswers.length === 0) {
      throw new Error('ยังไม่มีคำตอบของผู้ชวน')
    }

    await saveQuizAnswers(tx, activityId, bParticipantId, bAnswers)
    const outcome = resolvePair(cfg, inviterAnswers, bAnswers)

    const [row] = await tx<(QuizPairRow & { inserted: boolean })[]>`
      INSERT INTO quiz_pair (activity_id, participant_a, participant_b, result_code, scores)
      VALUES (
        ${activityId}, ${inviterParticipantId}, ${bParticipantId}, ${outcome.resultCode},
        ${tx.json({ a: outcome.scoresA, b: outcome.scoresB, combined: outcome.combined })}
      )
      ON CONFLICT (activity_id, participant_a, participant_b) DO UPDATE SET activity_id = EXCLUDED.activity_id
      RETURNING ${tx.unsafe(SELECT_COLUMNS)}, (xmax = 0) AS inserted`
    return { pair: toQuizPair(row), created: row.inserted }
  })
}
