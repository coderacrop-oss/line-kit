import { db } from '@/lib/db/client'
import { LIFF_CORS_HEADERS, liffOptionsResponse } from '@/lib/liff/cors'
import { resolveLiffParticipant } from '@/lib/liff/auth'

export async function GET(
  request: Request, { params }: { params: Promise<{ liffId: string }> },
): Promise<Response> {
  const { liffId } = await params
  const auth = await resolveLiffParticipant(db(), liffId, request)
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: auth.status, headers: LIFF_CORS_HEADERS })
  }
  return Response.json({ participantId: auth.participantId }, { headers: LIFF_CORS_HEADERS })
}

export async function OPTIONS(): Promise<Response> {
  return liffOptionsResponse()
}
