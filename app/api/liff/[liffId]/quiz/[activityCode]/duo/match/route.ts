// app/api/liff/[liffId]/quiz/[activityCode]/duo/match/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { matchQuizPair } from '@/lib/db/quizPairs'
import { strongestAxis, validateAnswers, type Answer } from '@/lib/quiz/engine'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'
import { sendDuoMatchNotify } from '@/lib/db/quizNotify'

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

  const auth = await resolveLiffParticipant(sql, liffId, request)
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
  if (!Array.isArray(answers)) {
    return Response.json({ error: 'answers ต้องเป็น array' }, { status: 422, headers: LIFF_CORS_HEADERS })
  }
  const validationError = validateAnswers(activity.config, answers)
  if (validationError) {
    return Response.json({ error: validationError }, { status: 422, headers: LIFF_CORS_HEADERS })
  }

  try {
    const pair = await matchQuizPair(sql, activity.config, activity.id, inviterParticipantId, auth.participantId, answers)
    const isCallerSideB = pair.participantB === auth.participantId
    // scores.a is always the inviter's own scores, scores.b is always the caller's (side B) —
    // see lib/db/quizPairs.ts's matchQuizPair. strongestAxis() is a pure function (Task 3), cheap
    // to recompute here rather than persisting the axis-id strings redundantly on quiz_pair.
    // Uses strongestAxis (not dominantAxis) so axisMe/axisBuddy are real axis ids, matching what
    // quiz_pair.scores was actually matched on inside matchQuizPair — dominantAxis's multi-axis
    // type-code strings aren't valid results[].pair values under schema.ts's validation.
    const myScores = isCallerSideB ? pair.scores.b : pair.scores.a
    const buddyScores = isCallerSideB ? pair.scores.a : pair.scores.b
    const axisMe = strongestAxis(activity.config, myScores)
    const axisBuddy = strongestAxis(activity.config, buddyScores)
    const rule = activity.config.results.find((r) => r.code === pair.resultCode)!
    // แจ้ง A แบบ best-effort ก่อน return — await ไว้เพื่อให้ทำงานจบก่อน route handler
    // จบ (Next.js/serverless อาจ freeze function หลัง response ถูกส่งแล้ว) sendDuoMatchNotify
    // ไม่ throw ออกมาเองอยู่แล้วไม่ว่ากรณีไหน จึงไม่กระทบ response ของ B (spec §4/§6)
    await sendDuoMatchNotify(sql, {
      campaignId: activity.campaignId, channelId: auth.liffApp.channelId,
      config: activity.config, theme: activity.theme, inviterParticipantId: pair.participantA,
    })
    return Response.json({
      resultCode: pair.resultCode, title: rule.title, body: rule.body, imageUrl: rule.imageUrl,
      axisMe, axisBuddy,
    }, { headers: LIFF_CORS_HEADERS })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    // เช็คทีละข้อความที่รู้จักจริง (matchQuizPair โยนแค่สองแบบนี้) แทนการเชื่อ err.message
    // ทุกกรณี — ก่อนแก้ ข้อความดิบของ Postgres (เช่น inviterParticipantId ที่ไม่ใช่ UUID
    // จริง "invalid input syntax for type uuid") หรือ DB ล่ม จะหลุดออกไปเป็น 400 ให้ผู้ใช้
    // เห็นตรงๆ ทั้งที่ไม่ใช่ความผิดของคำขอเลย (Minor finding ของรีวิวรอบสุดท้าย)
    if (message === 'ยังไม่มีคำตอบของผู้ชวน') {
      return Response.json({ error: message }, { status: 404, headers: LIFF_CORS_HEADERS })
    }
    if (message === 'จับคู่กับตัวเองไม่ได้') {
      return Response.json({ error: message }, { status: 400, headers: LIFF_CORS_HEADERS })
    }
    return Response.json({ error: 'จับคู่ไม่สำเร็จ' }, { status: 500, headers: LIFF_CORS_HEADERS })
  }
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
