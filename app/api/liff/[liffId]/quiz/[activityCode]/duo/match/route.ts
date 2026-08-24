// app/api/liff/[liffId]/quiz/[activityCode]/duo/match/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { matchQuizPair } from '@/lib/db/quizPairs'
import { dominantAxis, validateAnswers, type Answer } from '@/lib/quiz/engine'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

export async function POST(
  request: Request, { params }: { params: Promise<{ liffId: string; activityCode: string }> },
): Promise<Response> {
  const { liffId, activityCode } = await params
  const sql = db()

  let body: { inviterParticipantId?: string; answers?: Answer[] }
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
  if (activity.config.mode !== 'duo') {
    return Response.json({ error: 'ควิซนี้เป็นโหมด solo ไม่ใช่ duo' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const inviterParticipantId = body.inviterParticipantId
  if (!inviterParticipantId) {
    return Response.json({ error: 'ต้องมี inviterParticipantId' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const answers = body.answers ?? []
  const validationError = validateAnswers(activity.config, answers)
  if (validationError) {
    return Response.json({ error: validationError }, { status: 422, headers: LIFF_CORS_HEADERS })
  }

  try {
    const pair = await matchQuizPair(sql, activity.config, activity.id, inviterParticipantId, auth.participantId, answers)
    const isCallerSideB = pair.participantB === auth.participantId
    // scores.a is always the inviter's own scores, scores.b is always the caller's (side B) —
    // see lib/db/quizPairs.ts's matchQuizPair. dominantAxis() is a pure function (Task 3), cheap
    // to recompute here rather than persisting the type-code strings redundantly on quiz_pair.
    const myScores = isCallerSideB ? pair.scores.b : pair.scores.a
    const buddyScores = isCallerSideB ? pair.scores.a : pair.scores.b
    const axisMe = dominantAxis(activity.config, myScores)
    const axisBuddy = dominantAxis(activity.config, buddyScores)
    const rule = activity.config.results.find((r) => r.code === pair.resultCode)!
    return Response.json({
      resultCode: pair.resultCode, title: rule.title, body: rule.body, imageUrl: rule.imageUrl,
      axisMe, axisBuddy,
    }, { headers: LIFF_CORS_HEADERS })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'จับคู่ไม่สำเร็จ'
    const status = message === 'ยังไม่มีคำตอบของผู้ชวน' ? 404 : 400
    return Response.json({ error: message }, { status, headers: LIFF_CORS_HEADERS })
  }
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
