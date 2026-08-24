// lib/db/liffSessions.ts
import type { Queryable } from './client'

export type LiffSession = {
  id: string
  liffAppId: string
  participantId: string
  externalKey: string | null
  data: unknown
  createdAt: Date
  updatedAt: Date
}

type LiffSessionRow = {
  id: string
  liff_app_id: string
  participant_id: string
  external_key: string | null
  data: unknown
  created_at: Date
  updated_at: Date
}

function toLiffSession(row: LiffSessionRow): LiffSession {
  return {
    id: row.id, liffAppId: row.liff_app_id, participantId: row.participant_id,
    externalKey: row.external_key, data: row.data,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export async function listLiffSessionsForParticipant(
  sql: Queryable, liffAppId: string, participantId: string,
): Promise<LiffSession[]> {
  const rows = await sql<LiffSessionRow[]>`
    SELECT * FROM liff_session
     WHERE liff_app_id = ${liffAppId} AND participant_id = ${participantId}
     ORDER BY created_at DESC`
  return rows.map(toLiffSession)
}

/** ไม่กรองด้วย participant_id โดยตั้งใจ — คนละคนที่รู้ external_key เดียวกันอ่านได้ (spec §4/§6) */
export async function findLiffSessionByKey(
  sql: Queryable, liffAppId: string, externalKey: string,
): Promise<LiffSession | null> {
  const [row] = await sql<LiffSessionRow[]>`
    SELECT * FROM liff_session WHERE liff_app_id = ${liffAppId} AND external_key = ${externalKey}`
  return row ? toLiffSession(row) : null
}

/**
 * มี externalKey ที่ตรงกับแถวเดิมของ liff_app นี้ → อัปเดตทับ · ไม่มีหรือไม่ตรง →
 * สร้างแถวใหม่ผูกกับ participant ที่เรียก (spec §6, PUT /session)
 */
export async function upsertLiffSession(
  sql: Queryable,
  input: { liffAppId: string; participantId: string; externalKey: string | null; data: unknown },
): Promise<LiffSession> {
  if (input.externalKey) {
    const existing = await findLiffSessionByKey(sql, input.liffAppId, input.externalKey)
    if (existing) {
      const [row] = await sql<LiffSessionRow[]>`
        UPDATE liff_session
           SET data = ${sql.json(input.data as never)}, updated_at = now()
         WHERE id = ${existing.id}
         RETURNING *`
      return toLiffSession(row)
    }
  }

  const [row] = await sql<LiffSessionRow[]>`
    INSERT INTO liff_session (liff_app_id, participant_id, external_key, data)
    VALUES (${input.liffAppId}, ${input.participantId}, ${input.externalKey}, ${sql.json(input.data as never)})
    RETURNING *`
  return toLiffSession(row)
}
