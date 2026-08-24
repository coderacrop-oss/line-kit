import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { saveQuizAnswers } from '@/lib/db/quizAnswers'
import { resolveSolo, validateAnswers, type Answer } from '@/lib/quiz/engine'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

export async function POST(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string }> },
): Promise<Response> {
  const { liffId, activityCode } = await params
  const sql = db()

  let body: { answers?: Answer[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'อ่าน request body ไม่ได้ — ต้องเป็น JSON' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const auth = await resolveLiffParticipant(sql, liffId, request, {})
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const activity = await loadQuizActivity(sql, auth.liffApp.channelId, activityCode)
  if (!activity) {
    return Response.json({ error: 'ไม่พบควิซนี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }
  if (activity.config.mode !== 'solo') {
    return Response.json({ error: 'ควิซนี้เป็นโหมด duo ไม่ใช่ solo' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const answers = body.answers ?? []
  const validationError = validateAnswers(activity.config, answers)
  if (validationError) {
    return Response.json({ error: validationError }, { status: 422, headers: LIFF_CORS_HEADERS })
  }

  await saveQuizAnswers(sql, activity.id, auth.participantId, answers)
  const outcome = resolveSolo(activity.config, answers)
  const rule = activity.config.results.find((r) => r.code === outcome.resultCode)!

  return Response.json({
    resultCode: outcome.resultCode, title: rule.title, body: rule.body, imageUrl: rule.imageUrl,
    axisScores: outcome.scores,
  }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
