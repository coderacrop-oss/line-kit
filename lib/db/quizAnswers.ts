// lib/db/quizAnswers.ts
import type { Queryable } from './client'

/**
 * รูปเดียวกับ Answer ของ lib/quiz/engine.ts แต่ไม่ import มันโดยตั้งใจ — เลเยอร์ฐาน
 * ข้อมูลไม่ควรผูกกับโมดูลคิดคะแนน
 */
export type QuizAnswerInput = { questionId: string; optionId: string }

/** บันทึกทับคำตอบเดิมของคำถามเดียวกันได้เสมอ — ไม่มีการล็อกเมื่อทำครบ (BR ของ quiz) */
export async function saveQuizAnswers(
  sql: Queryable,
  activityId: string,
  participantId: string,
  answers: QuizAnswerInput[],
): Promise<void> {
  if (answers.length === 0) return
  const rows = answers.map((a) => ({
    activity_id: activityId,
    participant_id: participantId,
    question_id: a.questionId,
    option_id: a.optionId,
  }))
  await sql`
    INSERT INTO quiz_answer ${sql(rows, 'activity_id', 'participant_id', 'question_id', 'option_id')}
    ON CONFLICT (activity_id, participant_id, question_id)
    DO UPDATE SET option_id = EXCLUDED.option_id, answered_at = now()`
}

export async function loadQuizAnswers(
  sql: Queryable,
  activityId: string,
  participantId: string,
): Promise<QuizAnswerInput[]> {
  const rows = await sql<{ question_id: string; option_id: string }[]>`
    SELECT question_id, option_id FROM quiz_answer
     WHERE activity_id = ${activityId} AND participant_id = ${participantId}`
  return rows.map((r) => ({ questionId: r.question_id, optionId: r.option_id }))
}
