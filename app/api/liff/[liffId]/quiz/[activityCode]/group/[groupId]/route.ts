// app/api/liff/[liffId]/quiz/[activityCode]/group/[groupId]/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { getQuizGroup } from '@/lib/db/quizGroups'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

export async function GET(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string; groupId: string }> },
): Promise<Response> {
  const { liffId, activityCode, groupId } = await params
  const sql = db()
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

  const view = await getQuizGroup(sql, activity.config, activity.id, groupId)
  if (!view) {
    return Response.json({ error: 'ไม่พบกลุ่มนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }

  const amIMember = view.members.some((m) => m.participantId === auth.participantId)
  const canJoin = view.totalMembers < view.maxMembers && !amIMember

  return Response.json({ ...view, amIMember, canJoin }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
