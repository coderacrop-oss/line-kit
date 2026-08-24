// app/api/liff/[liffId]/quiz/[activityCode]/duo/my-pairs/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { listQuizPairsForParticipant } from '@/lib/db/quizPairs'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

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

  const pairs = await listQuizPairsForParticipant(sql, activity.id, auth.participantId)
  const titleByCode = new Map(activity.config.results.map((r) => [r.code, r.title]))

  return Response.json({
    pairs: pairs.map((p) => ({
      resultCode: p.resultCode,
      title: titleByCode.get(p.resultCode) ?? p.resultCode,
      asA: p.participantA === auth.participantId,
      createdAt: p.createdAt.toISOString(),
    })),
  }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
