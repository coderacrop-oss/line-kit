import { db } from '@/lib/db/client'
import {
  findLiffSessionByKey, listLiffSessionsForParticipant, upsertLiffSession,
} from '@/lib/db/liffSessions'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'

/**
 * body สำหรับทาง API key ต้องมี lineUserId (spec §5.2) — สำหรับทาง id_token ช่องนี้
 * ถูกละเว้นเสมอ (resolveLiffParticipant อ่านตัวตนจาก token ที่ verify แล้วเท่านั้น)
 * ส่ง body?.lineUserId ให้ resolveLiffParticipant เผื่อไว้ทั้งสองทาง โดยไม่ต้องรู้ว่า
 * ทางไหนจะถูกใช้จริง
 */
async function readLineUserIdFromBody(request: Request): Promise<string | undefined> {
  try {
    const body = await request.clone().json() as { lineUserId?: string }
    return body.lineUserId
  } catch {
    return undefined
  }
}

export async function GET(
  request: Request, { params }: { params: Promise<{ liffId: string }> },
): Promise<Response> {
  const { liffId } = await params
  const sql = db()
  const auth = await resolveLiffParticipant(sql, liffId, request, { lineUserId: await readLineUserIdFromBody(request) })
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  const key = new URL(request.url).searchParams.get('key')
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
  const rawBody = await request.json() as { externalKey?: string; data?: unknown; lineUserId?: string }

  const auth = await resolveLiffParticipant(sql, liffId, request, { lineUserId: rawBody.lineUserId })
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }

  if (rawBody.data === undefined) {
    return Response.json({ error: 'ต้องมีช่อง data' }, { status: 400, headers: LIFF_CORS_HEADERS })
  }

  const session = await upsertLiffSession(sql, {
    liffAppId: auth.liffApp.id, participantId: auth.participantId,
    externalKey: rawBody.externalKey ?? null, data: rawBody.data,
  })
  return Response.json({ session }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
