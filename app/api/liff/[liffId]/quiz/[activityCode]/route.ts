import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'
import { toPublicQuizConfig } from '@/lib/quiz/publicConfig'

export async function GET(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string }> },
): Promise<Response> {
  const { liffId, activityCode } = await params
  const sql = db()
  const auth = await resolveLiffParticipant(sql, liffId, request)
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const activity = await loadQuizActivity(sql, auth.liffApp.channelId, activityCode)
  if (!activity) {
    return Response.json({ error: 'ไม่พบควิซนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }

  return Response.json({ config: toPublicQuizConfig(activity.config) }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
