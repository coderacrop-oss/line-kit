// app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/add-pairs/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { addPairsToQuizGroup } from '@/lib/db/quizGroups'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

export async function POST(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string; groupId: string }> },
): Promise<Response> {
  const { liffId, activityCode, groupId } = await params
  const sql = db()

  let body: { pairIds?: string[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'อ่าน request body ไม่ได้ — ต้องเป็น JSON' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const auth = await resolveLiffParticipant(sql, liffId, request)
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const activity = await loadQuizActivity(sql, auth.liffApp.channelId, activityCode)
  if (!activity) {
    return Response.json({ error: 'ไม่พบควิซนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }
  if (!activity.config.group?.enabled) {
    return Response.json({ error: 'ควิซนี้ไม่เปิดผลลัพธ์กลุ่ม' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }

  const pairIds = body.pairIds ?? []
  if (!Array.isArray(pairIds) || pairIds.length === 0) {
    return Response.json({ error: 'pairIds ต้องเป็น array ที่ไม่ว่าง' }, { status: 422, headers: LIFF_CORS_HEADERS })
  }

  try {
    const result = await addPairsToQuizGroup(sql, activity.config, activity.id, groupId, auth.participantId, pairIds)
    return Response.json(result, { headers: LIFF_CORS_HEADERS })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message === 'ไม่พบกลุ่มนี้') {
      return Response.json({ error: message }, { status: 404, headers: LIFF_CORS_HEADERS })
    }
    if (message === 'ไม่ใช่ผู้สร้างกลุ่มนี้') {
      return Response.json({ error: message }, { status: 403, headers: LIFF_CORS_HEADERS })
    }
    return Response.json({ error: 'เติมสมาชิกไม่สำเร็จ' }, { status: 500, headers: LIFF_CORS_HEADERS })
  }
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
