import { db } from '@/lib/db/client'
import {
  findLiffSessionByKey, listLiffSessionsForParticipant, upsertLiffSession,
} from '@/lib/db/liffSessions'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'

/** "" หรือช่องว่างล้วนถือว่า "ไม่ได้ส่งมา" — กัน key ว่างชนกับ unique index ที่ยกเว้นแค่ NULL (spec §4/§6) */
function normalizeKey(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}

export async function GET(
  request: Request, { params }: { params: Promise<{ liffId: string }> },
): Promise<Response> {
  const { liffId } = await params
  const sql = db()
  const auth = await resolveLiffParticipant(sql, liffId, request)
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const key = normalizeKey(new URL(request.url).searchParams.get('key'))
  if (key) {
    const session = await findLiffSessionByKey(sql, auth.liffApp.id, key)
    if (!session) return Response.json({ error: 'ไม่พบข้อมูลของ key นี้' }, { status: 404, headers: LIFF_CORS_HEADERS })
    return Response.json({ session }, { headers: LIFF_CORS_HEADERS })
  }

  const sessions = await listLiffSessionsForParticipant(sql, auth.liffApp.id, auth.participantId)
  return Response.json({ sessions }, { headers: LIFF_CORS_HEADERS })
}

export async function PUT(
  request: Request, { params }: { params: Promise<{ liffId: string }> },
): Promise<Response> {
  const { liffId } = await params
  const sql = db()

  let rawBody: { externalKey?: string; data?: unknown; lineUserId?: string }
  try {
    rawBody = await request.json() as { externalKey?: string; data?: unknown; lineUserId?: string }
  } catch {
    return Response.json({ error: 'อ่าน request body ไม่ได้ — ต้องเป็น JSON' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const auth = await resolveLiffParticipant(sql, liffId, request, { lineUserId: rawBody.lineUserId })
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  if (rawBody.data === undefined) {
    return Response.json({ error: 'ต้องมีช่อง data' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const session = await upsertLiffSession(sql, {
    liffAppId: auth.liffApp.id, participantId: auth.participantId,
    externalKey: normalizeKey(rawBody.externalKey), data: rawBody.data,
  })
  return Response.json({ session }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
