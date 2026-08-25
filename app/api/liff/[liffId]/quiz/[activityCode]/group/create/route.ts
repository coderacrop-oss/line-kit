// app/api/liff/[liffId]/quiz/[activityCode]/group/create/route.ts
import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'
import { createQuizGroup } from '@/lib/db/quizGroups'
import { loadQuizActivity } from '@/lib/quiz/loadActivity'

export async function POST(
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
  if (!activity.config.group?.enabled) {
    return Response.json({ error: 'ควิซนี้ไม่เปิดผลลัพธ์กลุ่ม' }, { status: 404, headers: LIFF_CORS_HEADERS })
  }

  try {
    const { groupId } = await createQuizGroup(sql, activity.config, activity.id, auth.participantId)
    const shareUrl = `https://liff.line.me/${auth.liffApp.liffId}?groupId=${groupId}&activityCode=${activityCode}`
    return Response.json({ groupId, shareUrl }, { headers: LIFF_CORS_HEADERS })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message === 'ยังไม่ได้ตอบควิซ') {
      return Response.json({ error: message }, { status: 400, headers: LIFF_CORS_HEADERS })
    }
    return Response.json({ error: 'สร้างกลุ่มไม่สำเร็จ' }, { status: 500, headers: LIFF_CORS_HEADERS })
  }
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
