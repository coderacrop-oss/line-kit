import { NextResponse } from 'next/server'
import { handleEvent } from '@/lib/game/handler'
import { getChannelSecret, replyMessage } from '@/lib/line/client'
import type { LineWebhookBody } from '@/lib/line/types'
import { verifySignature } from '@/lib/line/verify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text()

  if (!verifySignature(rawBody, request.headers.get('x-line-signature'), getChannelSecret())) {
    return new NextResponse('Invalid signature', { status: 401 })
  }

  let body: LineWebhookBody
  try {
    body = JSON.parse(rawBody) as LineWebhookBody
  } catch {
    // Signature checked out, so this came from LINE. Nothing to act on.
    return NextResponse.json({ ok: true })
  }

  for (const event of body.events ?? []) {
    try {
      const message = handleEvent(event)
      if (message && 'replyToken' in event && event.replyToken) {
        await replyMessage(event.replyToken, message)
      }
    } catch (error) {
      // Never surface this as a non-200: LINE retries failed deliveries,
      // which would send the player the same card twice.
      console.error('[line-webhook] failed to handle event', error)
    }
  }

  return NextResponse.json({ ok: true })
}
